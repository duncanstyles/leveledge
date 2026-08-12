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
export let targetArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -20), 40, 0xef4444, 4, 3);
export let virtualBall = new THREE.Mesh(new THREE.SphereGeometry(4.6, 8, 6), new THREE.MeshBasicMaterial({ color: 0x0284c7, wireframe: true, transparent: true, opacity: 0.6 }));

export const wizardTableGroup = new THREE.Group();
export const tableMesh = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshBasicMaterial({color: 0x94a3b8, transparent: true, opacity: 0.2, side: THREE.DoubleSide}));
export const headingArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, pivotBaseY - defaultRad - 1, 25), 50, 0xef4444, 5, 4);

export let mainMalletMesh = null; 
export let ghostMalletMesh = null; 
export let baseStlSize = new THREE.Vector3(1, 1, 1);
export let impactLasers = [];
export let controls = null;

// --- TRAIL SETUP ---
export const MAX_TRAIL_POINTS = 5000; 
export const trailPositions = new Float32Array(MAX_TRAIL_POINTS * 3); 
export const trailColors = new Float32Array(MAX_TRAIL_POINTS * 3); 
export let rawTracePoints = []; 

// Add this near your other exports at the top of scene.js
export let hemiLight;

export const trailGeometry = new THREE.BufferGeometry(); 
// --- FIXED: Inject memory buffers BEFORE the 3D engine compiles the geometry ---
trailPositions.fill(0); 
trailColors.fill(0);
trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3)); 
trailGeometry.setAttribute('color', new THREE.BufferAttribute(trailColors, 3));
trailGeometry.setDrawRange(0, 0); 

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
    
    // --- FIXED: Initialize OrbitControls AFTER the canvas is physically on the screen ---
    controls = new THREE.OrbitControls(camera, renderer.domElement); 
    controls.enableDamping = true; 
    controls.target.set(0, pivotBaseY - defaultRad, 0); 
    controls.update();

    // --- RESTORED: Scene Lighting & Background ---
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

    targetArrow.visible = false; 
    targetEnvironmentGroup.add(targetArrow);

    // --- RESTORED: Add the successfully compiled trace line to the scene ---
    scene.add(trailLine); 

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
        
        const edgesGeo = new THREE.EdgesGeometry(geometry, 15); 
        const ghostMaterial = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.35 });
        const ghostModel = new THREE.LineSegments(edgesGeo, ghostMaterial); 
        ghostModel.rotation.set(-Math.PI/2, 0, -Math.PI/2); 
        
        ghostMalletMesh = ghostModel; 
        ghostMalletMesh.position.set(0, 0, 0); 
        ghostMalletMesh.visible = true; 
        ghostHeadJoint.add(ghostMalletMesh);
        
        window.dispatchEvent(new Event('modelLoaded'));
    });
}

export function drawStrikeLaser(cast) {
    impactLasers.forEach(m => scene.remove(m)); impactLasers.length = 0;
    if (!cast || !cast.pos || cast.isWhiff) return;
    let laserGroup = new THREE.Group(); let cylGeo = new THREE.CylinderGeometry(0.15, 0.15, 1.5, 8); cylGeo.rotateX(Math.PI / 2); let cylMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
    let correctedRot = cast.rot.clone(); let laserDir = new THREE.Vector3(0, 0, 1).applyQuaternion(correctedRot);
    if (laserDir.z < 0) { let flipRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI); correctedRot.multiply(flipRot); }
    let impactOffset = new THREE.Vector3(-cast.rawDev, 0, 0); let trueOrigin = impactOffset.applyQuaternion(correctedRot).add(cast.pos);
    for(let i=0; i<10; i++) { let dash = new THREE.Mesh(cylGeo, cylMat); let forwardStep = new THREE.Vector3(0, 0, (i * 3.0) + 0.75); dash.position.copy(forwardStep.applyQuaternion(correctedRot).add(trueOrigin)); dash.quaternion.copy(correctedRot); laserGroup.add(dash); }
    scene.add(laserGroup); impactLasers.push(laserGroup);
}

export function updateSmoothTrail(limitIndex = rawTracePoints.length) {
    let pts = rawTracePoints.slice(0, limitIndex); 
    if (pts.length < 2) { trailGeometry.setDrawRange(0, 0); return; }
    
    let curve = new THREE.CatmullRomCurve3(pts.map(p => p.pos), false, 'centripetal', 0.5);
    let sampleCount = pts.length * 3; 
    if (sampleCount >= MAX_TRAIL_POINTS) sampleCount = MAX_TRAIL_POINTS - 1; 
    let smoothPoints = curve.getPoints(sampleCount);
    
    for (let i = 0; i <= sampleCount; i++) {
        if (i >= MAX_TRAIL_POINTS) break;
        trailPositions[i * 3] = smoothPoints[i].x; 
        trailPositions[i * 3 + 1] = smoothPoints[i].y; 
        trailPositions[i * 3 + 2] = smoothPoints[i].z;
        let t = i / sampleCount; 
        let rawIdx = Math.min(Math.floor(t * pts.length), pts.length - 1);
        trailColors[i * 3] = pts[rawIdx].color.r; 
        trailColors[i * 3 + 1] = pts[rawIdx].color.g; 
        trailColors[i * 3 + 2] = pts[rawIdx].color.b;
    }
    trailGeometry.attributes.position.needsUpdate = true; 
    trailGeometry.attributes.color.needsUpdate = true; 
    trailGeometry.setDrawRange(0, sampleCount + 1);
}

export function rebuildArcPts(radius) {
    let arcPts = []; let baseVec = new THREE.Vector3(0, -radius, 0); 
    for(let i=-60; i<=60; i+=2) { 
            let a = THREE.MathUtils.degToRad(i); 
            let v = baseVec.clone().applyAxisAngle(new THREE.Vector3(1,0,0), a); 
            arcPts.push(v);
    }
    let curve = new THREE.CatmullRomCurve3(arcPts); let tubeGeo = new THREE.TubeGeometry(curve, 60, 0.15, 8, false); 
    if (ghostRail.geometry) ghostRail.geometry.dispose(); ghostRail.geometry = tubeGeo;
}

export function clearImpactLasers() {
    impactLasers.forEach(m => scene.remove(m)); 
    impactLasers.length = 0;
}

export function setLoadedRadius(val) { loadedRadius = val; }