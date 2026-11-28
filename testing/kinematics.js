// kinematics.js

export const difficultyMatrix = {
    novice:       { name: "Novice",       distances: [2, 4, 6, 8],    starColor: "#94a3b8", starChar: "★" },
    intermediate: { name: "Intermediate", distances: [3, 6, 9, 12],   starColor: "#cd7f32", starChar: "★" },
    advanced:     { name: "Advanced",     distances: [4, 8, 12, 16],  starColor: "#c0c0c0", starChar: "★" },
    expert:       { name: "Expert",       distances: [5, 10, 15, 20], starColor: "#f59e0b", starChar: "★" }
};

export function getStarRating(offsetCm, angleDeg, isStrike = true) {
    let activeTier = document.getElementById('difficultySelect').value || "intermediate"; 
    let profile = difficultyMatrix[activeTier];
    let faceWidthCM = parseFloat(document.getElementById('malletWidthInput').value) || 6.0;
    let ss = parseFloat(document.getElementById('sweetSpotInput').value) || 1.5; 
    let outOfBounds = isStrike ? (Math.abs(offsetCm) > ss) : (Math.abs(offsetCm) >= (faceWidthCM / 2.0));
    if (outOfBounds) return { string: "", color: "var(--text-muted)" }; 
    let angleRad = angleDeg * (Math.PI / 180.0); 
    let checkHit = (distM) => Math.abs((distM * 100.0) * Math.tan(angleRad)) <= 9.2; 
    let stars = "";
    if (checkHit(profile.distances[3])) stars = profile.starChar.repeat(4); 
    else if (checkHit(profile.distances[2])) stars = profile.starChar.repeat(3); 
    else if (checkHit(profile.distances[1])) stars = profile.starChar.repeat(2); 
    else if (checkHit(profile.distances[0])) stars = profile.starChar.repeat(1);
    return { string: stars, color: profile.starColor };
}

export function getShaftTwist(q) {
    // Horizontal face normal heading relative to target line (+Z), immune to pitch & lie angle
    let v = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    if ((v.x * v.x + v.z * v.z) < 0.0001) return 0;
    let deg = THREE.MathUtils.radToDeg(Math.atan2(v.x, v.z));
    if (deg > 90) deg -= 180;
    else if (deg < -90) deg += 180;
    return deg;
}

export function calcAccuracyData(strikeX, locTwist, pathAngleRads, maxTwistDegPerSec, dwellMs) {
    let faceWidthCM = parseFloat(document.getElementById('malletWidthInput').value) || 6.0; 
    let isWhiff = Math.abs(strikeX) >= (faceWidthCM / 2.0);
    let estAccRange = 0.0; let trueAccRange = 0.0; let trueLaunchDeg = locTwist; let estLaunchThetaRads = 0; let trueLaunchThetaRads = 0; let collisionDeflection = 0;
    if (!isWhiff) {
        let faceAngleRads = locTwist * (Math.PI / 180.0);
        let safePathRads = pathAngleRads || 0;
        estLaunchThetaRads = (0.80 * faceAngleRads) + (0.20 * safePathRads);
        if (Math.abs(estLaunchThetaRads) < 0.0001) estAccRange = 35.0; else estAccRange = Math.min(35.0, 0.092 / Math.abs(Math.sin(estLaunchThetaRads)));

        // strikeX > 0 means mallet is Left of ball (ball struck Right half of face) -> twists face Player Right (-)
        let twistMagnitude = Math.abs(maxTwistDegPerSec);
        collisionDeflection = twistMagnitude * (dwellMs / 1000.0);
        if (strikeX > 0) collisionDeflection = -collisionDeflection;

        let dynamicFaceAngleRads = (locTwist + (collisionDeflection * 0.5)) * (Math.PI / 180.0);
        trueLaunchThetaRads = (0.80 * dynamicFaceAngleRads) + (0.20 * safePathRads);
        trueLaunchDeg = trueLaunchThetaRads * (180.0 / Math.PI);
        if (Math.abs(trueLaunchThetaRads) < 0.0001) trueAccRange = 35.0; else trueAccRange = Math.min(35.0, 0.092 / Math.abs(Math.sin(trueLaunchThetaRads)));
    }
    return { isWhiff, estAccRange, trueAccRange, trueLaunchDeg, estLaunchRads: estLaunchThetaRads, trueLaunchRads: trueLaunchThetaRads, collisionDeflection };
}

export function calculateImpactForce(speedMps, massKgOverride = null) { 
    if (!speedMps || speedMps <= 0) return 0;
    let massEl = document.getElementById('massInput'); 
    let massKg = massKgOverride ?? (massEl ? (parseFloat(massEl.value) / 1000.0) : 1.0); 
    let ballMassKg = 0.454;
    let ballSpeedMps = speedMps * (massKg * 1.8) / (massKg + ballMassKg);
    let transferredImpulse = ballMassKg * ballSpeedMps;
    let dwellSec = calculateTrueDwell(speedMps, 0, massKg) / 1000.0;
    return transferredImpulse / dwellSec; 
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

export function calculateOffCenterImpact(
    peakTwistDegPerSec,
    speedMps,
    massGOverride = null,
    headLengthCmOverride = null,
    faceWidthCmOverride = null
) {
    if (speedMps <= 0.5 || Math.abs(peakTwistDegPerSec) < 10) return 0;

    // Reference mallet baseline where 0.1125 was originally tuned
    const REF_BALL_MASS_G = 454.0;
    const REF_MALLET_MASS_G = 1350.0;
    const REF_HEAD_LEN_CM = 25.0;
    const REF_FACE_WID_CM = 6.0;
    const REF_INERTIA_TERM = (REF_MALLET_MASS_G + REF_BALL_MASS_G) *
                             (REF_HEAD_LEN_CM * REF_HEAD_LEN_CM + REF_FACE_WID_CM * REF_FACE_WID_CM);

    let massEl = document.getElementById('massInput');
    let lenEl  = document.getElementById('malletLengthInput');
    let widEl  = document.getElementById('malletWidthInput');

    let massG       = massGOverride       ?? (massEl ? parseFloat(massEl.value) : REF_MALLET_MASS_G);
    let headLenCM   = headLengthCmOverride ?? (lenEl ? parseFloat(lenEl.value)  : REF_HEAD_LEN_CM);
    let faceWidthCM = faceWidthCmOverride  ?? (widEl ? parseFloat(widEl.value)  : REF_FACE_WID_CM);

    if (!isFinite(massG) || massG <= 200) massG = REF_MALLET_MASS_G;
    if (!isFinite(headLenCM) || headLenCM <= 5) headLenCM = REF_HEAD_LEN_CM;
    if (!isFinite(faceWidthCM) || faceWidthCM <= 2) faceWidthCM = REF_FACE_WID_CM;

    let inertiaTerm = (massG + REF_BALL_MASS_G) * (headLenCM * headLenCM + faceWidthCM * faceWidthCM);
    let inertiaScale = inertiaTerm / REF_INERTIA_TERM;

    let distanceMm = (peakTwistDegPerSec / speedMps) * 0.1125 * inertiaScale;

    // Dynamically calculate the physical edge based on stored mallet width
    let maxDeviationMm = (faceWidthCM * 10.0) / 2.0;
    if (distanceMm > maxDeviationMm) return maxDeviationMm;
    if (distanceMm < -maxDeviationMm) return -maxDeviationMm;

    return distanceMm;
}

export function anchorSwingToImpact(swing) {
    if (!swing || !swing.casts || swing.casts.length === 0) return;

    let strikeCast = swing.casts.find(c => c.isStrike || c.isHit) || swing.casts[swing.casts.length - 1];
    
    let impactEuler = new THREE.Euler().setFromQuaternion(strikeCast.pivotQuat, 'YXZ');
    let impactYaw = impactEuler.y;
    let correctionQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -impactYaw);

    // 1. Rotate the raw trace points (Fixing the .rot typo)
    if (swing.rawTracePoints) {
        swing.rawTracePoints.forEach(pt => {
            if (pt.pos) pt.pos.applyQuaternion(correctionQuat);
            if (pt.rot) pt.rot.premultiply(correctionQuat); 
        });
    }

    // 2. Rotate the scrubber/replay frames so playback aligns with the trace
    if (swing.frames) {
        swing.frames.forEach(frame => {
            if (frame.pivotPos) frame.pivotPos.applyQuaternion(correctionQuat);
            if (frame.rotation) frame.rotation.premultiply(correctionQuat);
        });
    }

    // 3. Rotate every single cast (Practice & Strike)
    swing.casts.forEach(cast => {
        if (cast.pivotPos) cast.pivotPos.applyQuaternion(correctionQuat);
        if (cast.pivotQuat) cast.pivotQuat.premultiply(correctionQuat);
        if (cast.pos) cast.pos.applyQuaternion(correctionQuat);
        
        if (cast.taredYaw !== undefined) cast.taredYaw -= THREE.MathUtils.radToDeg(impactYaw);
        if (cast.pathAngleRads !== undefined) cast.pathAngleRads -= impactYaw;
    });

    // 4. Rotate the static UI/Review states
    if (swing.baseMatrixQuat) swing.baseMatrixQuat.premultiply(correctionQuat);
    if (swing.finalReviewPivotPos) swing.finalReviewPivotPos.applyQuaternion(correctionQuat);
    if (swing.finalReviewPivotQuat) swing.finalReviewPivotQuat.premultiply(correctionQuat);
    if (swing.setupQuat) swing.setupQuat.premultiply(correctionQuat);
}
