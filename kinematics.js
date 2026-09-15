// kinematics.js

export const difficultyMatrix = {
    novice:       { name: "Novice",       distances: [2, 4, 6, 8],    starColor: "#94a3b8", starChar: "★" },
    intermediate: { name: "Intermediate", distances: [3, 6, 9, 12],   starColor: "#cd7f32", starChar: "★" },
    advanced:     { name: "Advanced",     distances: [4, 8, 12, 16],  starColor: "#c0c0c0", starChar: "★" },
    expert:       { name: "Expert",       distances: [5, 10, 15, 20], starColor: "#f59e0b", starChar: "★" }
};

export function getStarRating(offsetCm, angleDeg) {
    let activeTier = document.getElementById('difficultySelect').value || "intermediate"; 
    let profile = difficultyMatrix[activeTier];
    let ss = parseFloat(document.getElementById('sweetSpotInput').value) || 1.5; 
    if (Math.abs(offsetCm) > ss) return { string: "", color: "var(--text-muted)" }; 
    let angleRad = angleDeg * (Math.PI / 180.0); 
    let checkHit = (distM) => Math.abs(offsetCm + (distM * 100.0) * Math.tan(angleRad)) <= 9.2; 
    let stars = "";
    if (checkHit(profile.distances[3])) stars = profile.starChar.repeat(4); 
    else if (checkHit(profile.distances[2])) stars = profile.starChar.repeat(3); 
    else if (checkHit(profile.distances[1])) stars = profile.starChar.repeat(2); 
    else if (checkHit(profile.distances[0])) stars = profile.starChar.repeat(1);
    return { string: stars, color: profile.starColor };
}

export function getShaftTwist(q) {
    // Relies on the global THREE object loaded in your HTML
    let v = new THREE.Vector3(0, 0, 1).applyQuaternion(q); 
    let up = new THREE.Vector3(0, 1, 0).applyQuaternion(q); 
    let projZ = new THREE.Vector3(0, 0, 1).projectOnPlane(up);
    if (projZ.lengthSq() < 0.0001) return 0; 
    projZ.normalize(); 
    let angle = v.angleTo(projZ); 
    let cross = new THREE.Vector3().crossVectors(projZ, v);
    if (cross.dot(up) < 0) angle = -angle; 
    let deg = THREE.MathUtils.radToDeg(angle);
    if (deg > 90) deg -= 180; else if (deg < -90) deg += 180;
    return deg;
}

export function calcAccuracyData(strikeX, locTwist, pathAngleRads, maxTwistDegPerSec, dwellMs) {
    let faceWidthCM = parseFloat(document.getElementById('malletWidthInput').value) || 6.0; 
    let isWhiff = Math.abs(strikeX) >= (faceWidthCM / 2.0);
    let ssTolerance = parseFloat(document.getElementById('sweetSpotInput').value) || 1.5;
    let estAccRange = 0.0; let trueAccRange = 0.0; let trueLaunchDeg = locTwist; let estLaunchThetaRads = 0; let trueLaunchThetaRads = 0;
    if (!isWhiff) {
        let faceAngleRads = locTwist * (Math.PI / 180.0); estLaunchThetaRads = faceAngleRads;
        if (Math.abs(strikeX) > ssTolerance) { estLaunchThetaRads = (0.80 * faceAngleRads) + (0.20 * pathAngleRads); }
        if (Math.abs(estLaunchThetaRads) < 0.0001) estAccRange = 35.0; else estAccRange = Math.min(35.0, 0.092 / Math.abs(Math.sin(estLaunchThetaRads)));
        let twistMagnitude = Math.abs(maxTwistDegPerSec); let collisionDeflection = twistMagnitude * (dwellMs / 1000.0); if (strikeX < 0) collisionDeflection = -collisionDeflection; 
        let dynamicFaceAngleRads = (locTwist + (collisionDeflection * 0.5)) * (Math.PI / 180.0); trueLaunchThetaRads = dynamicFaceAngleRads;
        if (Math.abs(strikeX) > ssTolerance) { trueLaunchThetaRads = (0.80 * dynamicFaceAngleRads) + (0.20 * pathAngleRads); }
        trueLaunchDeg = trueLaunchThetaRads * (180.0 / Math.PI);
        if (Math.abs(trueLaunchThetaRads) < 0.0001) trueAccRange = 35.0; else trueAccRange = Math.min(35.0, 0.092 / Math.abs(Math.sin(trueLaunchThetaRads)));
    }
    return { isWhiff, estAccRange, trueAccRange, trueLaunchDeg, estLaunchRads: estLaunchThetaRads, trueLaunchRads: trueLaunchThetaRads };
}

export function calculateImpactForce(speedMps) { 
    let massEl = document.getElementById('massInput'); 
    let massKg = massEl ? (parseFloat(massEl.value) / 1000.0) : 1.0; 
    return (massKg * speedMps) / 0.0015; 
}

export function calculateMomentum(speedMps) { 
    let massEl = document.getElementById('massInput'); 
    let massKg = massEl ? (parseFloat(massEl.value) / 1000.0) : 1.0; 
    
    // Pure Momentum (Mass x Velocity). No division by time!
    return (massKg * speedMps); 
}

export function calculateEstimatedDistance(velocityMps, massKg, lawnSpeedPlummers) {
    let lawnMult = 0.50 + (lawnSpeedPlummers - 10) * 0.075;
    let ballSpeedMPS = velocityMps * (massKg * 1.8) / (massKg + 0.454);
    return (ballSpeedMPS * ballSpeedMPS) * lawnMult;
}

export function calculatePendulumDelta(fullPeriodSeconds, handleLengthCm) {
    if (!fullPeriodSeconds || fullPeriodSeconds <= 0) return null;
    let r_m = (9.81 * fullPeriodSeconds * fullPeriodSeconds) / (4.0 * Math.PI * Math.PI);
    return (r_m * 100.0) - handleLengthCm;
}

export function calculateCollisionDeflection(maxTwistDegPerSec, dwellMs, strikeX) {
    if (!dwellMs || dwellMs <= 0) return 0;
    let twistDeflectionVal = Math.abs(maxTwistDegPerSec) * (dwellMs / 1000.0);
    if (strikeX < 0) twistDeflectionVal = -twistDeflectionVal;
    return twistDeflectionVal;
}

export function calculateTrueDwell(zVel, peakG, massKg) {
    if (zVel <= 0) return 1.5; // Failsafe
    
    // 1. HERTZIAN CONTACT MODEL
    // Bypasses the 16G sensor limit entirely.
    // True dwell time for rigid elastic bodies scales inversely to the 1/5th power of velocity.
    
    // A gentle 1.0 m/s tap yields ~2.5ms of dwell. 
    // A violent 10.0 m/s strike compresses the ball faster, dropping dwell to ~1.5ms.
    let dwellMs = 2.5 / Math.pow(zVel, 0.2);
    
    // 2. Clamp to the physical realities of a croquet strike (0.5ms to 5.0ms)
    return Math.max(0.5, Math.min(5.0, dwellMs));
}

export function calculateOffCenterImpact(peakTwistDegPerSec, speedMps) {
    // Prevent division by zero and filter out noise from tiny taps
    if (speedMps <= 0.5 || !peakTwistDegPerSec) return 0; 
    
    // The constant 0.1125 is an empirical baseline for a standard 1kg mallet.
    // It scales the ratio of angular velocity to linear velocity into millimeters.
    let distanceMm = (Math.abs(peakTwistDegPerSec) / speedMps) * 0.1125;
    
    // Cap at 30mm (the physical edge of a standard 6cm wide mallet face)
    return Math.min(distanceMm, 30.0); 
}

