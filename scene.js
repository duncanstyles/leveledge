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
export let ghostRail = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.8 })); 
export let floorGrid = new THREE.GridHelper(100, 40, 0x38bdf8, 0x94a3b8);

// Create the vertical grid
export let verticalGrid = new THREE.GridHelper(100, 40, 0x38bdf8, 0x94a3b8);
// Rotate 90 degrees on the Z-axis to stand it up perfectly along the swing path
verticalGrid.rotation.z = Math.PI / 2;
// Stretch it to be twice as long (200 units) without changing the 100-unit height
verticalGrid.scale.z = 2;
// Hide it by default
verticalGrid.visible = false;

export let targetArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -20), 40, 0xef4444, 4, 3);
export let virtualBall = new THREE.Mesh(new THREE.SphereGeometry(4.6, 8, 6), new THREE.MeshBasicMaterial({ color: 0x0284c7, wireframe: true, transparent: true, opacity: 0.6 }));


// Add to your exports near virtualBall
export let rollingBall = new THREE.Mesh(
    new THREE.SphereGeometry(4.6, 16, 16), 
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })
);

export let targetMarker = new THREE.Mesh(
    new THREE.RingGeometry(10, 15, 32), 
    new THREE.MeshBasicMaterial({ color: 0x10b981, side: THREE.DoubleSide, transparent: true, opacity: 0.6 })
);

export const wizardTableGroup = new THREE.Group();
export const tableMesh = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshBasicMaterial({color: 0x94a3b8, transparent: true, opacity: 0.2, side: THREE.DoubleSide}));
export const headingArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, pivotBaseY - defaultRad - 1, 25), 50, 0xef4444, 5, 4);

export let mainMalletMesh = null; 
export let ghostMalletMesh = null; 
export let handleMesh = null;      // NEW
export let ghostHandleMesh = null; // NEW
export let baseStlSize = new THREE.Vector3(1, 1, 1);
export let impactLasers = [];
export let controls = null;

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

// Base Center Line
export const trailLine = new THREE.Line(trailGeometry, new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 3, transparent: true, opacity: 0.9 }));
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

    targetMarker.rotation.x = Math.PI / 2; // Lay flat on the floor
    targetMarker.visible = false;
    rollingBall.visible = false;

    scene.add(targetMarker);
    scene.add(rollingBall);

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
    
    // 4. Extend the line forward 10 meters, and slightly backward into the mallet
    let distance = 100.0; 
    let endPos = startPos.clone().add(direction.clone().multiplyScalar(distance));
    let backPos = startPos.clone().add(direction.clone().multiplyScalar(-0.25)); 

    // 5. Build the Red Dotted Line
    let laserGeo = new THREE.BufferGeometry().setFromPoints([backPos, endPos]);
    let laserMat = new THREE.LineDashedMaterial({
        color: 0xff0000,
        linewidth: 5,
        dashSize: 1,
        gapSize: 0.5,
        transparent: true,
        opacity: 0.8
    });

    let laserMesh = new THREE.Line(laserGeo, laserMat);
    laserMesh.computeLineDistances(); 

    scene.add(laserMesh);         
    impactLasers.push(laserMesh); 
}

export function updateSmoothTrail(limitIndex = rawTracePoints.length) {
    let pts = rawTracePoints.slice(0, limitIndex); 
    if (pts.length < 2) { 
        trailGeometry.setDrawRange(0, 0); 
        ribbonGeometry.setDrawRange(0, 0);
        twistRibbonGeometry.setDrawRange(0, 0);
        return; 
    }
    
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
        let faceCenter = smoothPoints[i].clone().add(vNormal.clone().multiplyScalar(activeOffsetZ));

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

            let pathTangent = new THREE.Vector3();
            let segmentLength = 0; 
            
            if (i < sampleCount) {
                pathTangent.subVectors(smoothPoints[i+1], smoothPoints[i]);
                segmentLength = pathTangent.length();
                pathTangent.normalize();
            } else {
                pathTangent.subVectors(smoothPoints[i], smoothPoints[i-1]);
                segmentLength = pathTangent.length();
                pathTangent.normalize();
            }
            
            let vUp = new THREE.Vector3(0, 1, 0).applyQuaternion(qInterp);
            let vLeft = new THREE.Vector3().crossVectors(vUp, pathTangent).normalize();
            if (vLeft.lengthSq() < 0.001) vLeft = new THREE.Vector3(1,0,0).applyQuaternion(qInterp); 

            let progress = i / sampleCount; 
            let edgeFade = 1.0;

            if (progress < 0.20) edgeFade = progress / 0.20;
            else if (progress > 0.80) edgeFade = (1.0 - progress) / 0.20;

            let speedFade = 1.0;
            if (segmentLength < 0.4) { 
                speedFade = Math.max(0, segmentLength / 0.4); 
            }

            let totalLateralExposure = vNormal.dot(vLeft) * (activeOffsetZ * 2.0) * twistMagnifier * edgeFade * speedFade;
            
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

export function rebuildArcPts(radius) {
    let arcPts = []; 
    // Shift the origin of the perfect ghost arc forward by malletHalfLength
    let baseVec = new THREE.Vector3(0, -radius, activeOffsetZ); 
    
    for(let i=-60; i<=60; i+=2) { 
            let a = THREE.MathUtils.degToRad(i); 
            let v = baseVec.clone().applyAxisAngle(new THREE.Vector3(1,0,0), a); 
            arcPts.push(v);
    }
    let curve = new THREE.CatmullRomCurve3(arcPts); let tubeGeo = new THREE.TubeGeometry(curve, 60, 0.15, 8, false); 
    if (ghostRail.geometry) ghostRail.geometry.dispose(); ghostRail.geometry = tubeGeo;
}

export function clearImpactLasers() {
    impactLasers.forEach(m => {
        scene.remove(m);
        // THE FIX: Explicitly destroy the geometry and material to prevent GPU memory leaks
        if (m.geometry) m.geometry.dispose();
        if (m.material) m.material.dispose();
    }); 
    impactLasers.length = 0;
}

export function setLoadedRadius(val) { loadedRadius = val; }