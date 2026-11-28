// scene.js
import { formatOffset } from './utils.js';

export const scene = new THREE.Scene(); 
export const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
export const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); 

export let defaultRad = 127; 
export let pivotBaseY = 24.6; 
export let loadedRadius = 127;

// --- EXPORTED SCENE OBJECTS ---
export const masterPivot = new THREE.Group(); 
export const masterBlock = new THREE.Group(); 
export const faceTrackerNode = new THREE.Group(); 
export const physicsTrackingNode = new THREE.Group(); 
export const headJoint = new THREE.Group(); 

export const ghostPivot = new THREE.Group(); 
export const ghostBlock = new THREE.Group(); 
export const ghostHeadJoint = new THREE.Group(); 

export const targetEnvironmentGroup = new THREE.Group();
export let ghostRail = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineDashedMaterial({ color: 0x38bdf8, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.85 })
);
export let floorGrid = new THREE.GridHelper(100, 40, 0x38bdf8, 0x94a3b8);

function createScaledVerticalGrid(heightCm = 75, lengthCm = 200, stepCm = 2.5, centerColor = 0x38bdf8, gridColor = 0x94a3b8) {
    const halfH = heightCm / 2;
    const halfL = lengthCm / 2;
    const cols = Math.round(lengthCm / stepCm);
    const rows = Math.round(heightCm / stepCm);

    const positions = [];
    const colors = [];
    const cCenter = new THREE.Color(centerColor);
    const cGrid = new THREE.Color(gridColor);

    // Vertical lines along the swing path (Z)
    for (let i = 0; i <= cols; i++) {
        const z = -halfL + i * stepCm;
        const col = Math.abs(z) < 0.001 ? cCenter : cGrid; // Highlight z = 0 impact line
        positions.push(0, -halfH, z, 0, halfH, z);
        colors.push(col.r, col.g, col.b, col.r, col.g, col.b);
    }

    // Horizontal height lines (Y)
    for (let j = 0; j <= rows; j++) {
        const y = -halfH + j * stepCm;
        positions.push(0, y, -halfL, 0, y, halfL);
        colors.push(cGrid.r, cGrid.g, cGrid.b, cGrid.r, cGrid.g, cGrid.b);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.25 });
    const grid = new THREE.LineSegments(geo, mat);
    grid.visible = false;
    return grid;
}

// Create the 75cm high x 200cm long vertical grid (5cm x 5cm squares to match floorGrid)
export let verticalGrid = createScaledVerticalGrid(150, 300, 5);

export let targetArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -20), 40, 0xef4444, 4, 3);
export let virtualBall = new THREE.Mesh(new THREE.SphereGeometry(4.6, 8, 6), new THREE.MeshBasicMaterial({ color: 0x0284c7, wireframe: true, transparent: true, opacity: 0.6 }));

export const wizardTableGroup = new THREE.Group();
export const tableMesh = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshBasicMaterial({color: 0x94a3b8, transparent: true, opacity: 0.2, side: THREE.DoubleSide}));
export const headingArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, pivotBaseY - defaultRad - 1, 25), 50, 0xef4444, 5, 4);

export let mainMalletMesh = null; 
export let ghostMalletMesh = null; 
export let handleMesh = null;      // NEW
export let ghostHandleMesh = null; // NEW
export let baseStlSize = new THREE.Vector3(1, 1, 1);
export let impactLasers = [];
export let activeTargetBallMesh = null;
export let rollingBallMesh = null;
export let controls = null;

let ballAnimState = null;
let explosionParticles = [];
let droneCamEnabled = true;
let droneCamActive = false;
let droneSavedCamPos = null;
let droneSavedTarget = null;

export function setDroneCamEnabled(enabled) {
    droneCamEnabled = !!enabled;
    if (!droneCamEnabled) {
        releaseDroneCamera(true);
    }
}

export function releaseDroneCamera(restoreView = false) {
    if (!droneCamActive) return;
    droneCamActive = false;
    if (restoreView && droneSavedCamPos && droneSavedTarget && controls) {
        camera.position.copy(droneSavedCamPos);
        controls.target.copy(droneSavedTarget);
        controls.update();
    }
    droneSavedCamPos = null;
    droneSavedTarget = null;
}

// --- TRAIL SETUP ---
export const MAX_TRAIL_POINTS = 5000; 
export const trailPositions = new Float32Array(MAX_TRAIL_POINTS * 3); 
export const trailColors = new Float32Array(MAX_TRAIL_POINTS * 3); 
export let rawTracePoints = []; 

export let hemiLight;

export const trailGeometry = new THREE.BufferGeometry(); 
trailPositions.fill(0); 
trailColors.fill(0);
trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3)); 
trailGeometry.setAttribute('color', new THREE.BufferAttribute(trailColors, 3));
trailGeometry.setDrawRange(0, 0); 

// ==========================================
// VISUALIZER GEOMETRIES (WOBBLE & TWIST)
// ==========================================
export let malletHalfWidth = 3.0;
export function setMalletHalfWidth(val) { malletHalfWidth = val; }

export let malletHalfLength = 13.8;
export let activeOffsetZ = 10.0;

export function setActiveOffsetZ(val) {
    activeOffsetZ = val;
}

export let malletHalfHeight = 3.0; 
export let twistMagnifier = 4.0; 

export function setMalletDimensions(len, wid) {
    malletHalfLength = len / 2.0;
    malletHalfHeight = wid / 2.0;
}

export function setTwistMagnifier(val) { 
    twistMagnifier = val; 
}

// 1. Wobble Ribbon (Flat Width)
export const ribbonGeometry = new THREE.BufferGeometry(); 
export const ribbonPositions = new Float32Array(MAX_TRAIL_POINTS * 6 * 3); 
export const ribbonColors = new Float32Array(MAX_TRAIL_POINTS * 6 * 3); 
ribbonPositions.fill(0); ribbonColors.fill(0);
ribbonGeometry.setAttribute('position', new THREE.BufferAttribute(ribbonPositions, 3));
ribbonGeometry.setAttribute('color', new THREE.BufferAttribute(ribbonColors, 3));
ribbonGeometry.setDrawRange(0, 0);

export const ribbonMesh = new THREE.Mesh(
    ribbonGeometry, 
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.5 })
);
ribbonMesh.frustumCulled = false;

// 2. Twist Indicator (Center-Face Flaring Ribbon)
export const twistRibbonGeometry = new THREE.BufferGeometry(); 
export const twistRibbonPositions = new Float32Array(MAX_TRAIL_POINTS * 6 * 3); 
export const twistRibbonColors = new Float32Array(MAX_TRAIL_POINTS * 6 * 3); 
twistRibbonPositions.fill(0); twistRibbonColors.fill(0);
twistRibbonGeometry.setAttribute('position', new THREE.BufferAttribute(twistRibbonPositions, 3));
twistRibbonGeometry.setAttribute('color', new THREE.BufferAttribute(twistRibbonColors, 3));
twistRibbonGeometry.setDrawRange(0, 0);

export const twistRibbonMesh = new THREE.Mesh(
    twistRibbonGeometry, 
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
);
twistRibbonMesh.frustumCulled = false;

// Alias export to prevent your main.js from crashing if it still imports "combMesh"
export const combMesh = twistRibbonMesh;

// Helpers to push vertices into the geometry buffers
function addRibbonVertex(idx, pos, col) {
    ribbonPositions[idx * 3] = pos.x; ribbonPositions[idx * 3 + 1] = pos.y; ribbonPositions[idx * 3 + 2] = pos.z;
    ribbonColors[idx * 3] = col.r; ribbonColors[idx * 3 + 1] = col.g; ribbonColors[idx * 3 + 2] = col.b;
}

function addTwistVertex(idx, pos, r, g, b) {
    twistRibbonPositions[idx * 3] = pos.x; twistRibbonPositions[idx * 3 + 1] = pos.y; twistRibbonPositions[idx * 3 + 2] = pos.z;
    twistRibbonColors[idx * 3] = r; twistRibbonColors[idx * 3 + 1] = g; twistRibbonColors[idx * 3 + 2] = b;
}

// Base Center Line (3D Tube matching Optimum Swing Arc 0.15cm radius)
export const trailLine = new THREE.Mesh(trailGeometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }));
trailLine.frustumCulled = false;

export function initScene() {
    hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2); 
    hemiLight.position.set(0, 50, 0); 
    scene.add(hemiLight);

    camera.position.set(100, pivotBaseY - defaultRad, 0); 
    renderer.setSize(window.innerWidth, window.innerHeight); 
    renderer.domElement.style.position = 'absolute'; 
    renderer.domElement.style.top = '0'; 
    renderer.domElement.style.left = '0'; 
    renderer.domElement.style.zIndex = '1';
    document.body.appendChild(renderer.domElement);
    
    controls = new THREE.OrbitControls(camera, renderer.domElement); 
    controls.enableDamping = true; 
    controls.target.set(0, pivotBaseY - defaultRad, 0); 
    controls.update();

    scene.background = new THREE.Color(0xe2e8f0); 

    window.addEventListener('resize', () => { renderer.setSize(window.innerWidth, window.innerHeight); camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); controls.update(); });

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const headlamp = new THREE.DirectionalLight(0xffffff, 0.8); camera.add(headlamp); scene.add(camera);

    virtualBall.visible = false; scene.add(virtualBall);
    ghostRail.visible = false;

    wizardTableGroup.visible = false;
    scene.add(wizardTableGroup);

    tableMesh.rotation.x = -Math.PI / 2;
    tableMesh.position.y = pivotBaseY - defaultRad - 1.5; 
    wizardTableGroup.add(tableMesh);
    wizardTableGroup.add(headingArrow);

    scene.add(masterPivot); masterPivot.add(masterBlock);
    masterBlock.add(faceTrackerNode); physicsTrackingNode.position.set(0, 0, 0); masterBlock.add(physicsTrackingNode);
    masterBlock.add(headJoint);
    
    scene.add(ghostPivot); ghostPivot.add(ghostBlock); ghostBlock.add(ghostHeadJoint);
        
    scene.add(targetEnvironmentGroup);
    targetEnvironmentGroup.add(ghostRail); 

    floorGrid.material.transparent = true; 
    floorGrid.material.opacity = 0.5;
    floorGrid.visible = false; 
    targetEnvironmentGroup.add(floorGrid);

    // Add the new vertical grid
    verticalGrid.material.transparent = true;
    verticalGrid.material.opacity = 0.25; // Slightly more transparent so it doesn't block the mallet
    targetEnvironmentGroup.add(verticalGrid);

    targetArrow.visible = false; 
    targetEnvironmentGroup.add(targetArrow);

    // --- ADD ALL TRACES TO SCENE (Hidden by default via CSS/UI) ---
    scene.add(trailLine); 
    scene.add(ribbonMesh);
    scene.add(twistRibbonMesh);
    
    const loader = new THREE.STLLoader();
    loader.load('./model.stl', function (geometry) {
        geometry.center(); 
        geometry.computeVertexNormals(); 
        
        const material = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.6, roughness: 0.3 });
        const customModel = new THREE.Mesh(geometry, material); 
        
        geometry.computeBoundingBox(); 
        geometry.boundingBox.getSize(baseStlSize);
        customModel.rotation.set(-Math.PI/2, 0, -Math.PI/2); 
        
        mainMalletMesh = customModel; 
        mainMalletMesh.position.set(0, 0, 0); 
        headJoint.add(mainMalletMesh); 
        
        // --- NEW: Add the Solid Handle Stub ---
        // 25cm tall, shifted up so its base sits in the center of the mallet head
        const handleGeo = new THREE.CylinderGeometry(1.2, 1.2, 25, 16);
        handleGeo.translate(0, 12.5, 0); 
        const handleMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.8 });
        handleMesh = new THREE.Mesh(handleGeo, material);
        headJoint.add(handleMesh);
        // --------------------------------------
        
        const edgesGeo = new THREE.EdgesGeometry(geometry, 15); 
        const ghostMaterial = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.35 });
        const ghostModel = new THREE.LineSegments(edgesGeo, ghostMaterial); 
        ghostModel.rotation.set(-Math.PI/2, 0, -Math.PI/2); 
        
        ghostMalletMesh = ghostModel; 
        ghostMalletMesh.position.set(0, 0, 0); 
        ghostMalletMesh.visible = true; 
        ghostHeadJoint.add(ghostMalletMesh);
        
        // --- NEW: Add the Ghost Handle Stub ---
        const ghostHandleMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.35 });
        const ghostHandleEdges = new THREE.EdgesGeometry(handleGeo);
        ghostHandleMesh = new THREE.LineSegments(ghostHandleEdges, ghostHandleMat);
        ghostHeadJoint.add(ghostHandleMesh);
        // --------------------------------------
        
        window.dispatchEvent(new Event('modelLoaded'));
    });
}

export function drawStrikeLaser(cast) {
    clearImpactLasers();
    if (!cast) return;

    // 1. Anchor the laser directly to the center of the virtual ball
    let startPos = virtualBall.position.clone();
    
    // 2. Shift the start point to the back edge of the ball (radius is 4.6cm)
    // This perfectly represents the exact point of impact between the flat face and the sphere.
    let backEdgeOffset = new THREE.Vector3(0, 0, -4.6);
    if (typeof ghostPivot !== 'undefined' && ghostPivot) {
        backEdgeOffset.applyQuaternion(ghostPivot.quaternion);
    }
    startPos.add(backEdgeOffset);
    
    // 3. Grab the true physical trajectory of the ball
    let launchRads = cast.trueLaunchRads || 0;
    
    let direction = new THREE.Vector3(0, 0, 1);
    direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), launchRads);
    
    if (typeof ghostPivot !== 'undefined' && ghostPivot) {
        direction.applyQuaternion(ghostPivot.quaternion);
    }
    
    // 4. Target distance (for green target line & target ball) vs. actual hit distance (for red ball path line)
    let isMatchActive = !document.getElementById('game-mode-dashboard')?.classList.contains('hidden');
    let targetDistMeters = (cast.targetDistM !== undefined && cast.targetDistM !== null && !isNaN(cast.targetDistM))
        ? cast.targetDistM
        : (isMatchActive
            ? (parseFloat(document.getElementById('matchDistSetup')?.value) || 10.0)
            : (parseFloat(document.getElementById('trainerDistSetup')?.value) || 10.0));
    let targetDistance = (targetDistMeters * 100.0) + 4.6;

    let hitDistMeters = Math.max(0.2, cast.estDist ?? targetDistMeters);
    let actualDistance = (hitDistMeters * 100.0) + 4.6;

    let endPos = startPos.clone().add(direction.clone().multiplyScalar(actualDistance));
    let backPos = startPos.clone().add(direction.clone().multiplyScalar(-0.25)); 

    // 5. Build the Green Dashed Perfect Target Line (0° straight along target line)
    let targetDir = new THREE.Vector3(0, 0, 1);
    if (typeof ghostPivot !== 'undefined' && ghostPivot) {
        targetDir.applyQuaternion(ghostPivot.quaternion);
    }
    let targetEndPos = startPos.clone().add(targetDir.clone().multiplyScalar(targetDistance));
    let targetBackPos = startPos.clone().add(targetDir.clone().multiplyScalar(-0.25));

    let targetGeo = new THREE.BufferGeometry().setFromPoints([targetBackPos, targetEndPos]);
    let targetMat = new THREE.LineDashedMaterial({
        color: 0x10b981,
        linewidth: 5,
        dashSize: 4,
        gapSize: 2,
        transparent: true,
        opacity: 0.75
    });

    let targetMesh = new THREE.Line(targetGeo, targetMat);
    targetMesh.computeLineDistances();

    scene.add(targetMesh);
    impactLasers.push(targetMesh);

    // 6. Add Virtual Target Ball on the Perfect Target Line at the Target Distance
    let targetBallGeo = new THREE.SphereGeometry(4.6, 16, 12);
    let targetBallMat = new THREE.MeshBasicMaterial({
        color: 0x10b981,
        wireframe: true,
        transparent: true,
        opacity: 0.75
    });
    let targetBallMesh = new THREE.Mesh(targetBallGeo, targetBallMat);
    targetBallMesh.position.copy(targetEndPos);
    scene.add(targetBallMesh);
    impactLasers.push(targetBallMesh);
    activeTargetBallMesh = targetBallMesh;

    if (!cast.isWhiff) {
        // 7. Build the Red Dotted Actual Ball Launch Line
        let laserGeo = new THREE.BufferGeometry().setFromPoints([backPos, endPos]);
        let laserMat = new THREE.LineDashedMaterial({
            color: 0xff0000,
            linewidth: 5,
            dashSize: 4,
            gapSize: 2,
            transparent: true,
            opacity: 0.8
        });

        let laserMesh = new THREE.Line(laserGeo, laserMat);
        laserMesh.computeLineDistances(); 

        scene.add(laserMesh);         
        impactLasers.push(laserMesh); 

        // 8. Add Red Striker Ball on the Actual Launch Line at the Target Distance
        let launchTargetPos = startPos.clone().add(direction.clone().multiplyScalar(targetDistance));
        let launchBallGeo = new THREE.SphereGeometry(4.6, 16, 12);
        let launchBallMat = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            wireframe: true,
            transparent: true,
            opacity: 0.85
        });
        rollingBallMesh = new THREE.Mesh(launchBallGeo, launchBallMat);
        rollingBallMesh.userData.targetLinePos = launchTargetPos.clone();
        rollingBallMesh.position.copy(launchTargetPos);
        scene.add(rollingBallMesh);
    }
}

function rebuildTraceTube(pts, hideBackswing) {
    let runs = [];
    let currentRun = [];

    for (let i = 0; i < pts.length; i++) {
        let p = pts[i];
        if (hideBackswing && !p.isForward) {
            if (currentRun.length >= 2) runs.push(currentRun);
            currentRun = [];
        } else {
            let q = p.rot || new THREE.Quaternion();
            let vNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
            currentRun.push({
                facePos: p.pos.clone().addScaledVector(vNormal, malletHalfLength),
                color: p.color
            });
        }
    }
    if (currentRun.length >= 2) runs.push(currentRun);

    let allPositions = [];
    let allColors = [];
    let allIndices = [];
    let vertexOffset = 0;
    const radialSegments = 8;

    for (let r = 0; r < runs.length; r++) {
        let run = runs[r];
        let segCurve = new THREE.CatmullRomCurve3(run.map(item => item.facePos), false, 'centripetal', 0.5);
        let segSteps = Math.min(1500, Math.max(2, (run.length - 1) * 3));
        let tube = new THREE.TubeGeometry(segCurve, segSteps, 0.10, radialSegments, false);

        let posArr = tube.attributes.position.array;
        for (let k = 0; k < posArr.length; k++) allPositions.push(posArr[k]);

        for (let s = 0; s <= segSteps; s++) {
            let t = s / segSteps;
            let rawIdx = t * (run.length - 1);
            let i1 = Math.floor(rawIdx);
            let i2 = Math.min(run.length - 1, Math.ceil(rawIdx));
            let f = rawIdx - i1;
            let c1 = run[i1].color;
            let c2 = run[i2].color;
            let cR = c1.r + (c2.r - c1.r) * f;
            let cG = c1.g + (c2.g - c1.g) * f;
            let cB = c1.b + (c2.b - c1.b) * f;

            for (let v = 0; v <= radialSegments; v++) {
                allColors.push(cR, cG, cB);
            }
        }

        let idxArr = tube.index.array;
        for (let k = 0; k < idxArr.length; k++) allIndices.push(idxArr[k] + vertexOffset);

        vertexOffset += tube.attributes.position.count;
        tube.dispose();
    }

    let mergedGeo = new THREE.BufferGeometry();
    if (allPositions.length > 0) {
        mergedGeo.setAttribute('position', new THREE.Float32BufferAttribute(allPositions, 3));
        mergedGeo.setAttribute('color', new THREE.Float32BufferAttribute(allColors, 3));
        mergedGeo.setIndex(allIndices);
    }
    if (trailLine.geometry) trailLine.geometry.dispose();
    trailLine.geometry = mergedGeo;
}

export function updateSmoothTrail(limitIndex = rawTracePoints.length) {
    let pts = rawTracePoints.slice(0, limitIndex); 
    if (pts.length < 2) { 
        if (trailLine.geometry) trailLine.geometry.dispose();
        trailLine.geometry = new THREE.BufferGeometry();
        ribbonGeometry.setDrawRange(0, 0);
        twistRibbonGeometry.setDrawRange(0, 0);
        return; 
    }
    let hideBackswingEl = document.getElementById('hideBackswingCheck');
    rebuildTraceTube(pts, hideBackswingEl ? hideBackswingEl.checked : true);
    
    let curve = new THREE.CatmullRomCurve3(pts.map(p => p.pos), false, 'centripetal', 0.5);
    let sampleCount = pts.length * 3; 
    if (sampleCount >= MAX_TRAIL_POINTS) sampleCount = MAX_TRAIL_POINTS - 1; 
    let smoothPoints = curve.getPoints(sampleCount);
    
    let leftPts = [], rightPts = [];
    let tLeftPts = [], tRightPts = []; 
    let interpColors = [];

    // THE FIX: If drawing a new trace, clear any NaN gaps from the GPU buffers
    // by instantly resetting the draw range and forcing a clean attribute update.
    trailGeometry.setDrawRange(0, 0);
    ribbonGeometry.setDrawRange(0, 0);
    twistRibbonGeometry.setDrawRange(0, 0);
    
    trailPositions.fill(0);
    trailColors.fill(0);
    
    // PERFORMANCE FIX: Check the UI toggle ONCE before the loop, not 5000 times!
    let hideBackswingToggle = document.getElementById('hideBackswingCheck');
    let hideBackswing = hideBackswingToggle ? hideBackswingToggle.checked : true;
    let lastValidTangent = new THREE.Vector3(0, 0, 1);
    
    for (let i = 0; i <= sampleCount; i++) {
        if (i >= MAX_TRAIL_POINTS) break;
        
        let t = i / sampleCount; 
        let rawIdxFloat = t * (pts.length - 1);
        let idx1 = Math.floor(rawIdxFloat);
        let idx2 = Math.ceil(rawIdxFloat);
        let lerpFactor = rawIdxFloat - idx1;
        
        let cR = pts[idx1].color.r + (pts[idx2].color.r - pts[idx1].color.r) * lerpFactor;
        let cG = pts[idx1].color.g + (pts[idx2].color.g - pts[idx1].color.g) * lerpFactor;
        let cB = pts[idx1].color.b + (pts[idx2].color.b - pts[idx1].color.b) * lerpFactor;
        
        trailColors[i * 3] = cR; trailColors[i * 3 + 1] = cG; trailColors[i * 3 + 2] = cB;
        interpColors.push({r: cR, g: cG, b: cB});
        
        let q1 = pts[idx1].rot || new THREE.Quaternion();
        let q2 = pts[idx2].rot || new THREE.Quaternion();
        let qInterp = new THREE.Quaternion().copy(q1).slerp(q2, lerpFactor);
        
        let vNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(qInterp);
        let faceCenter = smoothPoints[i].clone().add(vNormal.clone().multiplyScalar(malletHalfLength));

        // --- THE VISUAL BREAK LOGIC ---
        if (hideBackswing && !pts[idx1].isForward) {
            // Break Center Trace
            trailPositions[i * 3] = NaN; 
            trailPositions[i * 3 + 1] = NaN; 
            trailPositions[i * 3 + 2] = NaN;
            
            // Break Wobble Ribbon
            leftPts.push(new THREE.Vector3(NaN, NaN, NaN));
            rightPts.push(new THREE.Vector3(NaN, NaN, NaN));
            
            // Break Twist Ribbon
            tLeftPts.push({ pos: new THREE.Vector3(NaN, NaN, NaN), color: { r: 0, g: 0, b: 0 } });
            tRightPts.push({ pos: new THREE.Vector3(NaN, NaN, NaN), color: { r: 0, g: 0, b: 0 } });
        } else {
            // Draw standard forward trace normally
            trailPositions[i * 3] = faceCenter.x; 
            trailPositions[i * 3 + 1] = faceCenter.y; 
            trailPositions[i * 3 + 2] = faceCenter.z;
            
            let vRightOffset = new THREE.Vector3(malletHalfWidth, 0, 0).applyQuaternion(qInterp);
            let vLeftOffset = new THREE.Vector3(-malletHalfWidth, 0, 0).applyQuaternion(qInterp);
            rightPts.push(faceCenter.clone().add(vRightOffset));
            leftPts.push(faceCenter.clone().add(vLeftOffset));

            // Smoothed tangent over ±3 samples within the same swing direction (prevents impact-zone spikes)
            let curForward = !!pts[idx1].isForward;
            let iPrev = i;
            let iNext = i;
            for (let step = 1; step <= 3; step++) {
                if (i - step >= 0) {
                    let pIdx = Math.floor(((i - step) / sampleCount) * (pts.length - 1));
                    if (!!pts[pIdx].isForward === curForward) iPrev = i - step;
                }
                if (i + step <= sampleCount) {
                    let nIdx = Math.floor(((i + step) / sampleCount) * (pts.length - 1));
                    if (!!pts[nIdx].isForward === curForward) iNext = i + step;
                }
            }

            let pathTangent = new THREE.Vector3().subVectors(smoothPoints[iNext], smoothPoints[iPrev]);
            let chordLen = pathTangent.length();
            let segmentLength = chordLen / Math.max(1, iNext - iPrev);

            if (chordLen > 0.2) {
                pathTangent.divideScalar(chordLen);
                if (!curForward) pathTangent.negate();
                if (pathTangent.dot(vNormal) > 0.5) {
                    lastValidTangent.copy(pathTangent);
                } else {
                    pathTangent.copy(lastValidTangent);
                }
            } else {
                pathTangent.copy(lastValidTangent);
            }

            let vUp = new THREE.Vector3(0, 1, 0).applyQuaternion(qInterp);
            let vLeft = new THREE.Vector3().crossVectors(vUp, pathTangent).normalize();
            if (vLeft.lengthSq() < 0.001) vLeft = new THREE.Vector3(1, 0, 0).applyQuaternion(qInterp);

            let progress = i / sampleCount; 
            let edgeFade = 1.0;

            if (progress < 0.20) edgeFade = progress / 0.20;
            else if (progress > 0.80) edgeFade = (1.0 - progress) / 0.20;

            let speedFade = 1.0;
            if (segmentLength < 0.4) { 
                speedFade = Math.max(0, segmentLength / 0.4); 
            }

            let totalLateralExposure = vNormal.dot(vLeft) * (activeOffsetZ * 2.0) * twistMagnifier * edgeFade * speedFade;
            totalLateralExposure = Math.max(-15.0, Math.min(15.0, totalLateralExposure));
            
            let pRoot = faceCenter.clone();
            let pEdge = faceCenter.clone();
            let cRoot = { r: 1.0, g: 1.0, b: 1.0 }; 
            let cEdge = { r: 1.0, g: 1.0, b: 1.0 };

            if (totalLateralExposure > 0.1) { 
                pEdge.sub(vLeft.clone().multiplyScalar(totalLateralExposure));
                cEdge = { r: 1.0, g: 0.2, b: 0.2 };
            } else if (totalLateralExposure < -0.1) { 
                pEdge.sub(vLeft.clone().multiplyScalar(totalLateralExposure));
                cEdge = { r: 0.0, g: 0.5, b: 1.0 };
            }

            tLeftPts.push({ pos: pRoot, color: cRoot });
            tRightPts.push({ pos: pEdge, color: cEdge });
        }
    }
    
    trailGeometry.attributes.position.needsUpdate = true; 
    trailGeometry.attributes.color.needsUpdate = true; 
    trailGeometry.setDrawRange(0, sampleCount + 1);
    
    let vertexIndex = 0;
    let twistVertexIndex = 0;

    for (let i = 1; i <= sampleCount; i++) {
        if (i >= MAX_TRAIL_POINTS) break;
        
        addRibbonVertex(vertexIndex++, leftPts[i-1], interpColors[i-1]);
        addRibbonVertex(vertexIndex++, rightPts[i-1], interpColors[i-1]);
        addRibbonVertex(vertexIndex++, leftPts[i], interpColors[i]);
        addRibbonVertex(vertexIndex++, rightPts[i-1], interpColors[i-1]);
        addRibbonVertex(vertexIndex++, rightPts[i], interpColors[i]);
        addRibbonVertex(vertexIndex++, leftPts[i], interpColors[i]);

        addTwistVertex(twistVertexIndex++, tLeftPts[i-1].pos, tLeftPts[i-1].color.r, tLeftPts[i-1].color.g, tLeftPts[i-1].color.b);
        addTwistVertex(twistVertexIndex++, tRightPts[i-1].pos, tRightPts[i-1].color.r, tRightPts[i-1].color.g, tRightPts[i-1].color.b);
        addTwistVertex(twistVertexIndex++, tLeftPts[i].pos, tLeftPts[i].color.r, tLeftPts[i].color.g, tLeftPts[i].color.b);
        
        addTwistVertex(twistVertexIndex++, tRightPts[i-1].pos, tRightPts[i-1].color.r, tRightPts[i-1].color.g, tRightPts[i-1].color.b);
        addTwistVertex(twistVertexIndex++, tRightPts[i].pos, tRightPts[i].color.r, tRightPts[i].color.g, tRightPts[i].color.b);
        addTwistVertex(twistVertexIndex++, tLeftPts[i].pos, tLeftPts[i].color.r, tLeftPts[i].color.g, tLeftPts[i].color.b);
    }
    
    ribbonGeometry.attributes.position.needsUpdate = true; ribbonGeometry.attributes.color.needsUpdate = true;
    ribbonGeometry.setDrawRange(0, vertexIndex);
    
    twistRibbonGeometry.attributes.position.needsUpdate = true; twistRibbonGeometry.attributes.color.needsUpdate = true;
    twistRibbonGeometry.setDrawRange(0, twistVertexIndex);
}

export function rebuildArcPts(radius, halfAngleDeg = 60, faceZ = activeOffsetZ) {
    let arcPts = [];
    let zOrigin = (typeof faceZ === 'number' && !isNaN(faceZ)) ? faceZ : activeOffsetZ;
    let baseVec = new THREE.Vector3(0, -radius, zOrigin);
    let maxDeg = Math.max(10, Math.min(110, halfAngleDeg || 60));
    let steps = 60;

    for (let i = 0; i <= steps; i++) {
        let aDeg = -maxDeg + (2 * maxDeg * (i / steps));
        let a = THREE.MathUtils.degToRad(aDeg);
        let v = baseVec.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), a);
        arcPts.push(v);
    }

    let curve = new THREE.CatmullRomCurve3(arcPts);
    let lineGeo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(120));
    if (ghostRail.geometry) ghostRail.geometry.dispose();
    ghostRail.geometry = lineGeo;
    ghostRail.computeLineDistances();
}

export function clearImpactLasers() {
    ballAnimState = null;
    impactLasers.forEach(m => {
        scene.remove(m);
        // THE FIX: Explicitly destroy the geometry and material to prevent GPU memory leaks
        if (m.geometry) m.geometry.dispose();
        if (m.material) m.material.dispose();
    }); 
    impactLasers.length = 0;
    activeTargetBallMesh = null;
    if (rollingBallMesh) {
        scene.remove(rollingBallMesh);
        if (rollingBallMesh.geometry) rollingBallMesh.geometry.dispose();
        if (rollingBallMesh.material) rollingBallMesh.material.dispose();
        rollingBallMesh = null;
    }
}

export function setLoadedRadius(val) { loadedRadius = val; }

export function positionGhostReferenceBehindBall(extensionCm = 0, faceZ = malletHalfLength) {
    const safeExt = Number.isFinite(extensionCm) ? extensionCm : 0;
    const zFace = (typeof faceZ === 'number' && !isNaN(faceZ)) ? faceZ : malletHalfLength;
    ghostPivot.quaternion.identity();
    ghostPivot.position.set(0, pivotBaseY + safeExt, 0);
    ghostBlock.position.set(0, -(loadedRadius + safeExt), 0);
    // Place front striking face (+malletHalfLength) flush against the back of the ball (zFace)
    ghostHeadJoint.quaternion.identity();
    ghostHeadJoint.position.set(0, 0, zFace - malletHalfLength);
}

export function resetGhostHeadToPivot() {
    ghostHeadJoint.quaternion.identity();
    ghostHeadJoint.position.set(0, 0, 0);
}

function spawnBallExplosion(centerPos) {
    const colors = [0xff4500, 0xffae00, 0xef4444, 0x38bdf8, 0xffffff];
    for (let i = 0; i < 48; i++) {
        const size = 0.7 + Math.random() * 1.1;
        const geo = new THREE.SphereGeometry(size, 6, 6);
        const mat = new THREE.MeshBasicMaterial({
            color: colors[i % colors.length],
            transparent: true,
            opacity: 1.0
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(centerPos);

        // Random outward velocity burst (cm/s) biased slightly upward
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI * 0.65;
        const speed = 60 + Math.random() * 180;
        const vel = new THREE.Vector3(
            Math.sin(phi) * Math.cos(theta) * speed,
            Math.cos(phi) * speed + 40,
            Math.sin(phi) * Math.sin(theta) * speed
        );

        scene.add(mesh);
        explosionParticles.push({ mesh, vel, life: 1.0 });
    }
}

export function resetBallRollAnimation(preImpact = false) {
    ballAnimState = null;
    releaseDroneCamera(false);
    if (impactLasers[2]) impactLasers[2].visible = !preImpact;
    if (virtualBall) virtualBall.visible = true;
    if (rollingBallMesh) {
        if (preImpact && virtualBall) {
            rollingBallMesh.position.copy(virtualBall.position);
        } else if (rollingBallMesh.userData.targetLinePos) {
            rollingBallMesh.position.copy(rollingBallMesh.userData.targetLinePos);
        }
        rollingBallMesh.visible = true;
    }
    if (activeTargetBallMesh) {
        activeTargetBallMesh.visible = true;
    }
    explosionParticles.forEach(p => {
        scene.remove(p.mesh);
        if (p.mesh.geometry) p.mesh.geometry.dispose();
        if (p.mesh.material) p.mesh.material.dispose();
    });
    explosionParticles.length = 0;
}

export function startBallRollAnimation(cast, onBombHitCallback = null) {
    if (!cast || !virtualBall) return;

    // Ensure lasers, green target ball, and red striker ball exist
    if (!activeTargetBallMesh || !rollingBallMesh) drawStrikeLaser(cast);
    resetBallRollAnimation(true);

    // Blue wireframe virtualBall remains stationary at startCenter
    let startCenter = virtualBall.position.clone();
    let targetHomePos = activeTargetBallMesh
        ? activeTargetBallMesh.position.clone()
        : startCenter.clone();

    let launchRads = cast.trueLaunchRads || 0;
    let dir = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), launchRads);
    if (typeof ghostPivot !== 'undefined' && ghostPivot) {
        dir.applyQuaternion(ghostPivot.quaternion);
    }
    dir.normalize();

    let isMatchActive = !document.getElementById('game-mode-dashboard')?.classList.contains('hidden');
    let targetDistMeters = (cast.targetDistM !== undefined && cast.targetDistM !== null && !isNaN(cast.targetDistM))
        ? cast.targetDistM
        : (isMatchActive
            ? (parseFloat(document.getElementById('matchDistSetup')?.value) || 10.0)
            : (parseFloat(document.getElementById('trainerDistSetup')?.value) || 10.0));
    let targetDistCm = targetDistMeters * 100.0;
    let targetLinePos = startCenter.clone().addScaledVector(dir, targetDistCm);

    // Ensure a hit shot always travels at least to the green target ball so it never stops millimeter-short
    let totalDistM = Math.max(0.25, cast.estDist ?? 2.0);
    let totalDistCm = totalDistM * 100.0;
    if (cast.isHit && totalDistCm < targetDistCm + 5.0) {
        totalDistCm = targetDistCm + 5.0;
    }

    // Pace roll duration so acceleration & lawn-drag deceleration are clearly visible (1.2s to 3.2s)
    let stopTimeSec = Math.max(1.2, Math.min(3.2, Math.sqrt(totalDistCm / 100.0) * 0.85));

    // Place the red ball at the strike point to begin rolling
    if (rollingBallMesh) {
        rollingBallMesh.position.copy(startCenter);
        rollingBallMesh.visible = true;
    }

    if (droneCamEnabled && !droneCamActive) {
        droneCamActive = true;
        droneSavedCamPos = camera.position.clone();
        droneSavedTarget = controls ? controls.target.clone() : new THREE.Vector3(0, pivotBaseY - loadedRadius, 0);
    }

    ballAnimState = {
        startPos: startCenter,
        targetHomePos,
        targetLinePos,
        dir,
        totalDistCm,
        stopTimeSec,
        elapsedSec: 0,
        exploded: false,
        postExplosionTimer: 0,
        onBombHit: onBombHitCallback
    };
}

export function updateBallAndExplosionAnimation(dtSec, onAnimationComplete = null) {
    // 1. Update rolling red ball & explosion state
    if (ballAnimState) {
        if (!ballAnimState.exploded) {
            ballAnimState.elapsedSec += dtSec;
            let u = Math.min(1.0, ballAnimState.elapsedSec / ballAnimState.stopTimeSec);

            // Exact constant-deceleration kinematics: v(u) = v0*(1 - u), s(u) = D*(2u - u^2)
            // Starts at full launch speed (2*D/T) and decelerates linearly to 0 m/s at u = 1
            let traveledCm = ballAnimState.totalDistCm * (2.0 * u - u * u);

            if (rollingBallMesh) {
                rollingBallMesh.visible = true;
                rollingBallMesh.position.copy(ballAnimState.startPos).addScaledVector(ballAnimState.dir, traveledCm);
            }

            // Check collision with the green target ball (two 4.6cm radius balls touch at 9.2cm center distance)
            if (rollingBallMesh && activeTargetBallMesh && activeTargetBallMesh.visible) {
                let distToTarget = rollingBallMesh.position.distanceTo(activeTargetBallMesh.position);
                if (distToTarget <= 9.5) {
                    ballAnimState.exploded = true;
                    ballAnimState.postExplosionTimer = 0;
                    let boomPos = rollingBallMesh.position.clone().lerp(activeTargetBallMesh.position, 0.5);
                    rollingBallMesh.visible = false;
                    activeTargetBallMesh.visible = false;
                    spawnBallExplosion(boomPos);
                    if (typeof ballAnimState.onBombHit === 'function') {
                        ballAnimState.onBombHit();
                    }
                }
            }

            // Once the red ball comes to a complete stop, return it to its spot on the red line beside the green ball
            if (!ballAnimState.exploded && u >= 1.0) {
                if (rollingBallMesh) {
                    rollingBallMesh.position.copy(ballAnimState.targetLinePos);
                    rollingBallMesh.visible = true;
                }
                ballAnimState = null;
                if (typeof onAnimationComplete === 'function') onAnimationComplete();
            }
        } else {
            // After explosion finishes (~1.1s), restore both balls at the target distance on their respective lines
            ballAnimState.postExplosionTimer += dtSec;
            if (ballAnimState.postExplosionTimer >= 1.1) {
                if (activeTargetBallMesh) {
                    activeTargetBallMesh.position.copy(ballAnimState.targetHomePos);
                    activeTargetBallMesh.visible = true;
                }
                if (rollingBallMesh) {
                    rollingBallMesh.position.copy(ballAnimState.targetLinePos);
                    rollingBallMesh.visible = true;
                }
                ballAnimState = null;
                if (typeof onAnimationComplete === 'function') onAnimationComplete();
            }
        }
        if (impactLasers[2]) impactLasers[2].visible = !ballAnimState;
    }

    // 1b. Update Drone Follow camera while ball is rolling or exploding
    if (droneCamActive && controls) {
        if (ballAnimState) {
            const currentBallPos = (rollingBallMesh && rollingBallMesh.visible)
                ? rollingBallMesh.position
                : ballAnimState.startPos;
            const forwardDir = ballAnimState.dir;
            const followDistCm = 38.0;
            const followHeightCm = 24.0;
            const lookAheadCm = 45.0;

            const desiredCamPos = currentBallPos.clone()
                .addScaledVector(forwardDir, -followDistCm)
                .add(new THREE.Vector3(0, followHeightCm, 0));

            const desiredLookAt = currentBallPos.clone()
                .addScaledVector(forwardDir, lookAheadCm)
                .add(new THREE.Vector3(0, 2.0, 0));

            const blend = Math.min(1.0, dtSec * 6.0);
            camera.position.lerp(desiredCamPos, blend);
            controls.target.lerp(desiredLookAt, blend);
            controls.update();
        } else {
            releaseDroneCamera(true);
        }
    }

    // 2. Update 3D explosion shrapnel particles
    for (let i = explosionParticles.length - 1; i >= 0; i--) {
        let p = explosionParticles[i];
        p.life -= dtSec * 0.85;
        if (p.life <= 0) {
            scene.remove(p.mesh);
            if (p.mesh.geometry) p.mesh.geometry.dispose();
            if (p.mesh.material) p.mesh.material.dispose();
            explosionParticles.splice(i, 1);
            continue;
        }

        // Apply gravity (-350 cm/s^2) and air drag
        p.vel.y -= 350.0 * dtSec;
        p.vel.multiplyScalar(Math.max(0, 1.0 - 1.5 * dtSec));
        p.mesh.position.addScaledVector(p.vel, dtSec);

        // Bounce off lawn plane (-loadedRadius + pivotBaseY)
        let floorY = pivotBaseY - loadedRadius + 0.5;
        if (p.mesh.position.y < floorY) {
            p.mesh.position.y = floorY;
            p.vel.y = Math.abs(p.vel.y) * 0.45;
        }

        p.mesh.material.opacity = Math.max(0, p.life);
        p.mesh.scale.setScalar(Math.max(0.2, p.life));
    }
}