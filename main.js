import { initAudio, audioCtx, playBeep, playDoubleBeep, playTick, isAudioInitialized, isSoundEnabled, toggleSoundState, playSuccessSound, playBombSound } from './audio.js';
import { difficultyMatrix, getStarRating, getShaftTwist, calcAccuracyData, calculateImpactForce, calculateMomentum, calculateEstimatedDistance, calculatePendulumDelta, calculateCollisionDeflection, calculateTrueDwell, calculateOffCenterImpact, anchorSwingToImpact } from './kinematics.js';
import { showToast, formatOffset, buildCastRowHTML } from './utils.js';
import {
    supabaseClient, currentUser, setCurrentUser,
    playerProfile, playerMallets, activeMallet, setActiveMalletLocal,
    loadPlayerProfile, savePlayerProfile, fetchPlayerMallets,
    loadOfflineMalletFallback, syncConnectedMallet,
    saveActiveMalletSpecs, saveActiveMalletCalibration,
    selectMalletFromBag, removeMalletFromBag, releaseMalletOwnership,
    fetchCloudMatches, fetchCloudStrikes, savePracticeCastsToCloud, updatePracticeStrikeInCloud,
    fetchCloudTraining, deleteCloudSession, getAiCoachFeedback
} from './cloud.js';

import { 
    scene, camera, renderer, controls, defaultRad, pivotBaseY, loadedRadius, setLoadedRadius,
    masterPivot, masterBlock, faceTrackerNode, physicsTrackingNode, headJoint,
    ghostPivot, ghostBlock, ghostHeadJoint,
    targetEnvironmentGroup, ghostRail, floorGrid, verticalGrid, targetArrow, virtualBall,
    wizardTableGroup, tableMesh, headingArrow,
    mainMalletMesh, ghostMalletMesh, baseStlSize, impactLasers, clearImpactLasers,
    handleMesh, ghostHandleMesh,
    MAX_TRAIL_POINTS, trailPositions, trailColors, rawTracePoints, trailGeometry, trailLine,
    initScene, drawStrikeLaser, updateSmoothTrail, rebuildArcPts, hemiLight,
    ribbonMesh, setMalletHalfWidth, twistRibbonMesh, setMalletDimensions, setTwistMagnifier,
    setActiveOffsetZ, startBallRollAnimation, resetBallRollAnimation, updateBallAndExplosionAnimation,
    positionGhostReferenceBehindBall, resetGhostHeadToPivot, setDroneCamEnabled, releaseDroneCamera
} from './scene.js';

// --- CACHED APP CONFIG & DOM ELEMENTS FOR PERFORMANCE ---
const AppConfig = {
    metronomeEnabled: false,
    metronomeBpm: 60,
    practiceLimitSec: 10.0,
    massKg: 1.0,
    flatMag: 1.0,
    malletLengthCm: 27.6,
    malletWidthCm: 6.0,
    offsetZCm: 10.0,
    handleLengthCm: 91.4,
    sweetSpot: 1.5,
    lawnSpeed: 10.0,
    ledGuidance: true,
    singleSwing: false,
    radiusInput: 127,
    isSubscribed: true,
    hideBackswing: true,
    faultSensitivity: 1
};

const DisplayElements = {
    countdown: document.getElementById('live-countdown'),
    liveSpeed: document.getElementById('live-speed'),
    liveForce: document.getElementById('live-force'),
    liveApplied: document.getElementById('live-applied'),
    // liveDev: document.getElementById('live-dev'),
    liveLean: document.getElementById('live-lean'),
    liveTempo: document.getElementById('live-tempo')
};

const scrubberLabelEl = document.getElementById('scrubberLabel');

const LastRendered = {
    countdownText: "",
    countdownClass: ""
};

function syncAppConfig() {
    let metroCheck = document.getElementById('metronomeCheck');
    AppConfig.metronomeEnabled = metroCheck ? metroCheck.checked : false;

    let bpmContainer = document.getElementById('metronomeBpmContainer');
    if (bpmContainer && metroCheck) {
        if (metroCheck.checked) {
            bpmContainer.classList.remove('hidden');
        } else {
            bpmContainer.classList.add('hidden');
        }
    }

    let offZInp = document.getElementById('offsetZInput');
    AppConfig.offsetZCm = offZInp ? (parseFloat(offZInp.value) || 10.0) : 10.0;

    let hlInp = document.getElementById('handleLengthInput');
    AppConfig.handleLengthCm = hlInp ? (parseFloat(hlInp.value) || 91.4) : 91.4;
    
    let metroBpm = document.getElementById('metronomeBpm');
    AppConfig.metronomeBpm = metroBpm ? (parseFloat(metroBpm.value) || 60) : 60;
    
    let pracInp = document.getElementById('practiceInput');
    AppConfig.practiceLimitSec = pracInp ? (parseFloat(pracInp.value) || 10.0) : 10.0;
    
    let massInp = document.getElementById('massInput');
    AppConfig.massKg = massInp ? ((parseFloat(massInp.value) || 1000) / 1000.0) : 1.0;
    
    let magInp = document.getElementById('flatMagInput');
    AppConfig.flatMag = magInp ? (parseFloat(magInp.value) || 1.0) : 1.0;
    if (typeof setTwistMagnifier === 'function') setTwistMagnifier(AppConfig.flatMag); // <-- Push to 3D Scene
    
    let lenInp = document.getElementById('malletLengthInput');
    AppConfig.malletLengthCm = lenInp ? (parseFloat(lenInp.value) || 27.6) : 27.6;
    
    let widInp = document.getElementById('malletWidthInput');
    AppConfig.malletWidthCm = widInp ? (parseFloat(widInp.value) || 6.0) : 6.0;
    
    let ssInp = document.getElementById('sweetSpotInput');
    AppConfig.sweetSpot = ssInp ? (parseFloat(ssInp.value) || 1.5) : 1.5;
    
    let lawnInp = document.getElementById('lawnSpeedInput');
    AppConfig.lawnSpeed = lawnInp ? (parseFloat(lawnInp.value) || 10.0) : 10.0;
    
    let ledCheck = document.getElementById('ledGuidanceCheck');
    AppConfig.ledGuidance = ledCheck ? ledCheck.checked : true;
    
    let singleCheck = document.getElementById('singleSwingCheck');
    AppConfig.singleSwing = singleCheck ? singleCheck.checked : false;
    
    let radInp = document.getElementById('radiusInput');
    AppConfig.radiusInput = radInp ? (parseFloat(radInp.value) || 127) : 127;

    let subCheck = document.getElementById('subscribedCheck');
    AppConfig.isSubscribed = subCheck ? subCheck.checked : true;

    let backswingCheck = document.getElementById('hideBackswingCheck');
    AppConfig.hideBackswing = backswingCheck ? backswingCheck.checked : true;

    let faultInp = document.getElementById('faultSensitivityInput');
    let parsedFault = faultInp ? parseInt(faultInp.value, 10) : 1;
    AppConfig.faultSensitivity = isNaN(parsedFault) ? 1 : parsedFault;
}

document.body.addEventListener('input', syncAppConfig);
document.body.addEventListener('change', syncAppConfig);

window.pristinePathAngleRads = 0;

// Exact right-handed basis mapping from calibrated sensor ENU frame to Three.js (+X Left, +Y Up, +Z Target)
const Q_SENSOR_TO_THREE_OUT = new THREE.Quaternion(0.5, 0.5, 0.5, -0.5);
const Q_SENSOR_TO_THREE_IN  = new THREE.Quaternion(0.5, 0.5, -0.5, -0.5);

function mapFirmwareQuatToThree(q0, q1, q2, q3) {
    return Q_SENSOR_TO_THREE_OUT.clone()
        .multiply(new THREE.Quaternion(q1, q2, q3, q0).normalize())
        .multiply(Q_SENSOR_TO_THREE_IN)
        .normalize();
}

initScene();

function bindLinkedSpinners(distId, twistId) {
    const distEl = document.getElementById(distId);
    const twistEl = document.getElementById(twistId);
    
    distEl.addEventListener('input', () => {
        let d = parseFloat(distEl.value) || 10;
        if (d < 0.1) d = 0.1;
        let angle = Math.atan(0.092 / d) * (180 / Math.PI);
        twistEl.value = angle.toFixed(2);
    });
    
    twistEl.addEventListener('input', () => {
        let a = parseFloat(twistEl.value) || 1.0;
        if (a < 0.01) a = 0.01;
        let dist = 0.092 / Math.tan(a * Math.PI / 180);
        distEl.value = dist.toFixed(1);
    });
}

bindLinkedSpinners('trainerDistSetup', 'trainerTwistSetup');
bindLinkedSpinners('matchDistSetup', 'matchTwistSetup');

document.getElementById('matchLedToggle').addEventListener('change', (e) => {
    const grp = document.getElementById('matchToleranceGroup');
    if (e.target.checked) {
        grp.style.opacity = '1'; grp.style.pointerEvents = 'auto';
    } else {
        grp.style.opacity = '0.4'; grp.style.pointerEvents = 'none';
    }
});

document.getElementById('openTrainerModalBtn').onclick = () => {
    document.getElementById('trainer-setup-modal').showModal();
};

document.getElementById('openMatchModalBtn').onclick = () => {
    let matchLed = document.getElementById('matchLedToggle');
    if (matchLed) matchLed.dispatchEvent(new Event('change'));
    
    document.getElementById('match-setup-modal').showModal();
};

document.getElementById('closeTrainerSetupBtn').onclick = () => document.getElementById('trainer-setup-modal').close();
document.getElementById('closeMatchSetupBtn').onclick = () => document.getElementById('match-setup-modal').close();

async function syncConfigurationToMallet() {
    let ledGuidance = AppConfig.ledGuidance ? 1 : 0;
    let radius = AppConfig.radiusInput;
    let mass = AppConfig.massKg * 1000;
    let impact = parseFloat(document.getElementById('impactInput').value) || 1.5;
    let offsetY = parseFloat(document.getElementById('offsetYInput').value) || 5.5;
    let timeout = parseInt(document.getElementById('timeoutInput').value) || 5;
    let sweetSpot = AppConfig.sweetSpot;
    let twist = parseFloat(document.getElementById('twistToleranceInput').value) || 1.0;

    let payload = [ 67, radius, mass / 10, impact * 10, offsetY * 10, timeout, sweetSpot * 10, ledGuidance, Math.round(twist * 10), AppConfig.faultSensitivity ];
    await sendBleCommand(payload, true);
}

document.getElementById('confirmStartTrainerBtn').onclick = async () => {
    document.getElementById('twistToleranceInput').value = parseFloat(document.getElementById('trainerTwistSetup').value) || 1.0;
    document.getElementById('ledGuidanceCheck').checked = true;
    syncAppConfig();
    
    await syncConfigurationToMallet();
    document.getElementById('trainer-setup-modal').close();
    startTrainerSequence();
};

document.getElementById('confirmStartMatchBtn').onclick = async () => {
    document.getElementById('lawnSpeedInput').value = document.getElementById('matchLawnSetup').value;
    updateLawnSpeedLabel();
    
    let useLed = document.getElementById('matchLedToggle').checked;
    document.getElementById('ledGuidanceCheck').checked = useLed;
    document.getElementById('twistToleranceInput').value = parseFloat(document.getElementById('matchTwistSetup').value) || 1.0;
    syncAppConfig();

    await syncConfigurationToMallet();
    document.getElementById('match-setup-modal').close();
    startMatchSequence();
};

async function startTrainerSequence() {
    if (appState === 2 || appState === 3 || appState === 4 || appState === 4.5) return; 
    clearTimeout(window.finalizeTimerId);
    window.finalizeTimerId = null;
    window.lastCompletedSwingIdx = null;
    window.peakFollowThroughTheta = -Infinity;
    window.peakFollowThroughIdx = -1;
    window.followThroughLastMoveTime = 0;
    let success = await sendBleCommand([90]); // 'Z'
    if (!success) { showToast("BLE Error."); return; }
    
    zeroRawBLEQuat.copy(currentRawBLEQuat);
    
    if (isBallEnabled) { 
        ghostPivot.quaternion.identity(); 
        updateSystemGeometry(); 
        virtualBall.visible = true; 
    } else { virtualBall.visible = false; }

    appState = 2; calibrationPhase = 'RED'; redStartTime = Date.now(); lastJsTime = redStartTime;
    isLive = true; isReviewingLog = false; playbackMode = false; isPaused = false;
    impactDetected = false; hasLiftedOff = false; lockedFaceZ = null; addressPivotX = 0;
    window.pendingStrikePacket = null;
    window.pristineImpactQuat = null;
    window.pristineImpactQuat_m8 = null;
    window.pristineStep8ms = null;
    window.strikeCastGenerated = false;
    window.followThroughComplete = false;
    
    let camX = isViewFlipped ? -100 : 100; camera.position.set(camX, pivotBaseY - loadedRadius, 0); controls.target.set(0, pivotBaseY - loadedRadius, 0); controls.update();
    
    targetQuaternion.copy(lastRawQuat); 
    currentQuaternion.copy(targetQuaternion); 
    masterPivot.quaternion.copy(currentQuaternion);

    document.getElementById('ready-group').classList.add('hidden'); document.getElementById('cancelArmBtn').classList.remove('hidden');
    let swingStateTxt = document.getElementById('swing-state'); if(swingStateTxt) { swingStateTxt.innerText = "ESTABLISHING HEADING..."; swingStateTxt.className = "text-danger text-center font-bold mb-4"; }
    DisplayElements.countdown.classList.add('hidden'); document.getElementById('calibration-container').classList.remove('hidden');
    let calibBar = document.getElementById('calibration-bar'); calibBar.style.width = "0%"; calibBar.style.background = "var(--danger)";
    preRollBuffer = []; castData = []; clearImpactLasers(); rawTracePoints.length = 0; updateSmoothTrail(0);
    rebuildArcPts(loadedRadius, getOptimumArcHalfAngleDeg(loadedRadius));
    let arcToggle = document.getElementById('optimumArcToggle');
    ghostRail.visible = arcToggle ? arcToggle.checked : false;
    masterPivot.position.set(0, pivotBaseY, 0); masterBlock.position.set(0, -loadedRadius, 0); headJoint.quaternion.identity(); finalReviewExtension = 0;
    isForwardSwing = true; lastForwardPassTime = 0;
}

async function startMatchSequence() {
    let ts = Math.floor(Date.now() / 1000);
    let payload = [75, ts & 0xFF, (ts >> 8) & 0xFF, (ts >> 16) & 0xFF, (ts >> 24) & 0xFF];
    let success = await sendBleCommand(payload);
    if (success) {
        inGameMode = true; 
        rebuildArcPts(loadedRadius, getOptimumArcHalfAngleDeg(loadedRadius));
        appState = 7;
        gmStrokeCount = 0;
        window.matchAligned = false;
        window.matchSwinging = false;
        document.getElementById('gm-stroke-count').innerText = "0";
        document.getElementById('gm-latest-stats').innerHTML = "Awaiting Next Strike...<br><span style='font-size:0.75rem; color:var(--text-muted); font-weight:normal;'>Quickly twist shaft clockwise to arm mallet.</span>";
        document.getElementById('game-mode-dashboard').classList.remove('hidden');
        document.getElementById('ready-group').classList.add('hidden');
        showToast("On-Course Match Started!");
    } else { 
        showToast("BLE Error."); 
    }
}

document.getElementById('menuToggleBtn').onclick = () => { document.getElementById('menu-drawer').classList.toggle('open'); };

// --- NEW HISTORY & ANALYTICS PANEL LOGIC ---
let activePanelMode = 'history'; // Tracks which view is currently injected into the panel

function setPanelContent(mode) {
    activePanelMode = mode;
    if (mode === 'history') {
        document.getElementById('training-tab-content').classList.remove('hidden');
        document.getElementById('cloud-training-tab-content').classList.add('hidden');
        document.getElementById('match-tab-content').classList.add('hidden');
    } else {
        document.getElementById('training-tab-content').classList.add('hidden');
        document.getElementById('cloud-training-tab-content').classList.remove('hidden');
        document.getElementById('match-tab-content').classList.remove('hidden');
        
        // Fetch fresh cloud data if applicable
        if (currentUser) {
            fetchCloudMatches();
            if (AppConfig.isSubscribed) {
                fetchCloudTraining();
            } else {
                document.getElementById('performance-dashboard')?.classList.add('hidden');
                const container = document.getElementById('cloud-training-container');
                if (container) {
                    container.innerHTML = '<div class="text-muted text-center p-5">Upgrade to <span class="text-accent font-bold">PRO</span> to view Cloud Sessions &amp; Analytics.</div>';
                }
            }
        } else {
            document.getElementById('performance-dashboard')?.classList.add('hidden');
            const container = document.getElementById('cloud-training-container');
            if (container) {
                container.innerHTML = '<div class="text-muted text-center p-5">Please log in to view Cloud Sessions.</div>';
            }
        }
    }
}

function togglePanelState(targetMode) {
    const panel = document.getElementById('history-panel');
    const controlPanel = document.getElementById('control-panel');
    const isOpen = window.innerWidth <= 768 ? panel.classList.contains('mobile-open') : !panel.classList.contains('desktop-closed');

    if (isOpen && activePanelMode === targetMode) {
        // Close it if they click the same button that is already open
        if (window.innerWidth <= 768) {
            panel.classList.remove('mobile-open'); 
            controlPanel?.classList.remove('hidden');
        } else {
            panel.classList.add('desktop-closed');
        }
    } else {
        // Open it (or seamlessly swap contents if already open)
        setPanelContent(targetMode);
        if (window.innerWidth <= 768) {
            panel.classList.add('mobile-open'); 
            controlPanel?.classList.add('hidden');
        } else {
            panel.classList.remove('desktop-closed');
        }
    }
}

document.getElementById('topToggleHistoryBtn').onclick = () => togglePanelState('history');
document.getElementById('topToggleAnalyticsBtn').onclick = () => togglePanelState('analytics');

// Experimental gating fallback for matches
function updateExperimentalFeatures() {
    const isExperimental = document.getElementById('experimentalCheck')?.checked || false;
    const matchBtn = document.getElementById('openMatchModalBtn');
    const matchContent = document.getElementById('match-tab-content');

    if (isExperimental) {
        if (matchBtn) matchBtn.style.display = ''; 
        if (matchContent) matchContent.style.display = '';
    } else {
        if (matchBtn) matchBtn.style.display = 'none';
        if (matchContent) matchContent.style.display = 'none';
    }
}
// -------------------------------------------

//
// --- FIX: Dynamic trigger line with correct mallet length fallback ---

let lockedFaceZ = null;
let addressPivotX = 0;

function getDynamicFaceZ() { 
    // Uses exact posture if locked, otherwise defaults to half the mallet head length (center shaft to front face)
    return lockedFaceZ !== null ? lockedFaceZ : ((AppConfig.malletLengthCm || 27.6) / 2.0); 
}
// ---------------------------------------------------------------------

function getDynamicBallZ() { return getDynamicFaceZ() + 4.6; }

function getActiveTargetDistM(cast) {
    if (cast && cast.targetDistM !== undefined && cast.targetDistM !== null && !isNaN(cast.targetDistM)) {
        return cast.targetDistM;
    }
    return inGameMode
        ? (parseFloat(document.getElementById('matchDistSetup')?.value) || 10.0)
        : (parseFloat(document.getElementById('trainerDistSetup')?.value) || 5.0);
}

function getTargetDistanceLabel(cast) {
    let distM = getActiveTargetDistM(cast);
    let formatted = Number.isInteger(distM) ? `${distM}` : `${parseFloat(distM.toFixed(1))}`;
    return `TARGET: ${formatted}m`;
}

function isTargetBallHit(cast) {
    if (!cast || cast.isWhiff) return false;
    let launchRads = cast.trueLaunchRads;
    if (launchRads === undefined || launchRads === null || isNaN(launchRads)) {
        if (cast.trueLaunchDeg !== undefined && cast.trueLaunchDeg !== null && !isNaN(cast.trueLaunchDeg)) {
            launchRads = THREE.MathUtils.degToRad(cast.trueLaunchDeg);
        } else {
            return false;
        }
    }
    let targetDistM = getActiveTargetDistM(cast);
    let lateralCm = Math.abs((targetDistM * 100.0) * Math.sin(launchRads));
    let estDistM = cast.estDist ?? 0;
    return lateralCm <= 9.2 && estDistM >= targetDistM;
}

function formatTargetHitMissHTML(cast) {
    if (!cast || cast.isWhiff) return `Mishit`;
    let launchRads = cast.trueLaunchRads;
    if (launchRads === undefined || launchRads === null || isNaN(launchRads)) {
        if (cast.trueLaunchDeg !== undefined && cast.trueLaunchDeg !== null && !isNaN(cast.trueLaunchDeg)) {
            launchRads = THREE.MathUtils.degToRad(cast.trueLaunchDeg);
        } else {
            return `N/A`;
        }
    }
    let targetDistM = getActiveTargetDistM(cast);
    let lateralCm = (targetDistM * 100.0) * Math.sin(launchRads);
    let centerDistCm = Math.abs(lateralCm);
    const BALL_DIAMETER_CM = 9.2; // 46mm + 46mm combined radii of both balls

    if (centerDistCm <= BALL_DIAMETER_CM) {
        let strikePointOffsetCm = centerDistCm * 0.5;
        let side = strikePointOffsetCm < 0.25 ? '' : (lateralCm > 0 ? ' L' : ' R');
        let distStr = strikePointOffsetCm < 0.25
            ? '0cm'
            : (strikePointOffsetCm < 1.0 ? `${strikePointOffsetCm.toFixed(1)}cm${side}` : `${Math.round(strikePointOffsetCm)}cm${side}`);
        return `<span class="text-success">Hit ${distStr}</span>`;
    } else {
        let missEdgeCm = centerDistCm - BALL_DIAMETER_CM;
        let side = lateralCm > 0 ? ' L' : ' R';
        let distStr = missEdgeCm < 1.0 ? `${missEdgeCm.toFixed(1)}cm${side}` : `${Math.round(missEdgeCm)}cm${side}`;
        return `<span class="text-danger">Miss ${distStr}</span>`;
    }
}

function computeFallbackPreImpactAccelPct(trailIndex, traceArr = rawTracePoints) {
    if (!traceArr || traceArr.length < 3) return null;
    let endIdx = Math.min(Math.max(0, trailIndex ?? (traceArr.length - 1)), traceArr.length - 1);
    let forwardPts = [];
    for (let i = endIdx; i >= 0 && forwardPts.length < 6; i--) {
        let pt = traceArr[i];
        if (!pt) continue;
        if (!pt.isForward && forwardPts.length > 0) break;
        if (pt.isForward) forwardPts.unshift(pt);
    }
    if (forwardPts.length < 3) return null;

    // Require at least 1 buffer sample after turnaround so zero-speed apex reversal is excluded
    let usable = forwardPts.length >= 4 ? forwardPts.slice(-3) : null;
    if (!usable) return null;

    let p0 = usable[0], pM = usable[1], p1 = usable[2];
    let dt1Sec = ((pM.time ?? 0) - (p0.time ?? 0)) / 1000.0;
    let dt2Sec = ((p1.time ?? 0) - (pM.time ?? 0)) / 1000.0;
    if (dt1Sec < 0.015 || dt1Sec > 0.15 || dt2Sec < 0.015 || dt2Sec > 0.15) return null;

    let radiusM = (loadedRadius || 127) / 100.0;
    let v1 = (p0.rot.angleTo(pM.rot) * radiusM) / dt1Sec;
    let v2 = (pM.rot.angleTo(p1.rot) * radiusM) / dt2Sec;
    let vRef = 0.5 * (v1 + v2);
    if (v1 < 0.25 || vRef < 0.25) return null;

    // In Three.js YXZ Euler, pitch (x) is positive before bottom of arc and negative on upswing
    let midPitchX = new THREE.Euler().setFromQuaternion(pM.rot, 'YXZ').x;
    let dtMidSec = 0.5 * (dt1Sec + dt2Sec);
    let dvGravity = 9.81 * Math.sin(midPitchX) * dtMidSec;
    let dvPlayer = (v2 - v1) - dvGravity;

    return Math.round(Math.max(-50, Math.min(60, (dvPlayer / vRef) * 100.0)));
}

function getFrontFaceBackswingMetricsCm(trailIndex, minSearchIndex = 0) {
    if (!rawTracePoints || rawTracePoints.length === 0) return { arcLengthCm: 0, heightCm: 0 };
    let centerIdx = Math.min(Math.max(0, trailIndex || 0), rawTracePoints.length - 1);
    let startIdx = Math.max(0, minSearchIndex);
    let halfLength = (AppConfig.malletLengthCm || 27.6) / 2.0;
    let pivotOrigin = new THREE.Vector3(0, pivotBaseY, 0);
    let ghostInvQuat = ghostPivot.quaternion.clone().invert();
    let maxHeightCm = 0;
    let minSwingAngleRad = 0;
    let enteredBackswing = false;

    for (let i = centerIdx; i >= startIdx; i--) {
        let pt = rawTracePoints[i];
        if (!pt) continue;

        let localShaft = new THREE.Vector3(0, -1, 0)
            .applyQuaternion(pt.rot)
            .applyQuaternion(ghostInvQuat);
        let swingAngleRad = Math.atan2(localShaft.z, -localShaft.y);
        let swingAngleDeg = THREE.MathUtils.radToDeg(swingAngleRad);

        if (swingAngleDeg < -2.0) {
            enteredBackswing = true;
        } else if (enteredBackswing && swingAngleDeg > 2.0) {
            // Crossed back into the previous pass's forward follow-through
            break;
        }

        if (swingAngleRad < minSwingAngleRad) {
            minSwingAngleRad = swingAngleRad;
        }

        let forward = new THREE.Vector3(0, 0, 1).applyQuaternion(pt.rot);
        let faceWorld = new THREE.Vector3(
            pt.pos.x,
            pt.pos.y - (pt.driftShiftY || 0),
            pt.pos.z
        ).addScaledVector(forward, halfLength);

        let localFace = faceWorld.sub(pivotOrigin).applyQuaternion(ghostInvQuat);
        let heightCm = localFace.y + loadedRadius;

        if (heightCm > maxHeightCm) maxHeightCm = heightCm;
    }

    let arcLengthCm = Math.abs(minSwingAngleRad) * loadedRadius;
    return {
        arcLengthCm: Math.max(0, arcLengthCm),
        heightCm: Math.max(0, maxHeightCm)
    };
}

let globalHwTime = 0;

let appState = 0; let armedUiStartTime = 0; let state4UiStartTime = 0; let state4StartTime = 0; let goTimeout; let ignoreSpeedUntilTime = 0; let isReviewingLog = false; 
let recordTicks = 0; let postImpactTicks = 0;
let calibrationPhase = 'NONE'; let redStartTime = 0; let calibrationHoldTimeMs = 0; let lastJsTime = 0; let orangeStartTime = 0; 
let lastRawQuat = new THREE.Quaternion(); let lastStableQuat = new THREE.Quaternion();
let targetQuaternion = new THREE.Quaternion(); let prevTargetQuaternion = new THREE.Quaternion(); let currentQuaternion = new THREE.Quaternion();
let finalReviewPivotQuat = new THREE.Quaternion(); let finalReviewPivotPos = new THREE.Vector3(); let finalReviewExtension = 0; 

let hardwareMountOffset = new THREE.Quaternion(); let isWizardActive = false; let wizardStep = 0; let capturing = false;
window.currentlyViewedCast = null;
let currentRawBLEQuat = new THREE.Quaternion(); let prevRawBLEQuat = new THREE.Quaternion();
let zeroRawBLEQuat = new THREE.Quaternion(); window.tuningFrozenFrame = null;
let isDynamicCalibrationActive = false; let dynamicCalibrationBuffer = [];

let devHudEnabled = false;

let hasLiftedOff = false; // <-- NEW: Tracks the start of the backswing

let wizardBuffer = []; const WIZARD_BUFFER_SIZE = 15; const WIZARD_VARIANCE_THRESH = 0.02; let vectors = { bottomN: null, bottomS: null, topN: null, topS: null, front: null, back: null, left: null, right: null };

let preRollBuffer = []; let prevMagnitude = 1.0; let posHistory = []; let currentAbsoluteSpeed = 0; 
let prevFaceZ = 0; let prevZ = 0; 
let prevSwingAngle = 0;
let isForwardSwing = true; let lastForwardPassTime = 0; 
let rewindStartTime = 0; let rewindStartQuat = new THREE.Quaternion(); let rewindStartPos = new THREE.Vector3(); let rewindStartExt = 0;

let swingCount = 0; let currentSwingMaxSpeed = 0; let currentSwingMaxG = 0; let currentSwingDeviation = 0; let currentSwingDist = 0;
let lastComputedTempo = 0; let maxTwist = 0; let currentSwingDwell = 0; let currentSwingAoA = 0;
window.lastEdgeData = { zVel: 0, pushForce: 0, appliedForce: 0, downwardSwingTime: 0, decelFactor: 0 }; 

let castData = []; let idealPlane = null;
let impactDetected = false; let impactThreshold = 1.5; let audioThreshold = 2.0; let nextMetronomeTime = 0;
let isLive = true; let recordedFrames = []; let swingDatabase = []; let playbackMode = false; let playbackIndex = 0;
let isPaused = false; let isSlowMo = false; let autoSlowMoActive = false; let lastPlaybackTime = 0;

function setAutoSlowMo(active) {
    if (active && !autoSlowMoActive) {
        autoSlowMoActive = true;
    } else if (!active && autoSlowMoActive) {
        autoSlowMoActive = false;
    }
}

function getEffectiveSlowMo() {
    return !!(isSlowMo || autoSlowMoActive);
}
let playbackElapsedMs = 0; let lastAnimFrameTime = 0; let lastRenderedTrailIdx = -1;

let inGameMode = false;
let gmStrokeCount = 0;
window.matchAligned = false;
window.matchSwinging = false;

let downloadedHistory = [];
let isGhostEnabled = true;
let isBallEnabled = true;
let isViewFlipped = false;

const playerSettingsElements = [
    'playerNameInput', 'playerCountryInput', 'radiusInput', 'difficultySelect', 'subscribedCheck', 'faultSensitivityInput',
    'lawnSpeedInput', 'impactInput', 'timeoutInput', 'durationInput', 'flatMagInput',
    'ledGuidanceCheck', 'showTraceCheck', 'twistToleranceInput',
    'darkThemeCheck', 'soundCheck', 'flipViewCheck', 'floorGridToggle', 'verticalGridToggle',
    'optimumArcToggle', 'hideBackswingCheck', 'metronomeCheck', 'metronomeBpm',
    'audioThreshInput', 'practiceInput', 'trainerDistSetup', 'trainerTwistSetup', 'singleSwingCheck',
    'matchLedToggle', 'matchAudioToggle', 'matchDistSetup', 'matchTwistSetup', 'matchLawnSetup',
    'experimentalCheck', 'showCloudDataCheck'
];

const malletSpecElements = [
    'malletNameInput', 'handleLengthInput', 'malletLengthInput', 'malletWidthInput',
    'massInput', 'offsetYInput', 'offsetZInput', 'sweetSpotInput', 'allowSharingCheck'
];

document.getElementById('openDisplayBtn').onclick = () => { document.getElementById('display-modal').showModal(); document.getElementById('menu-drawer').classList.remove('open'); };
document.getElementById('closeDisplayBtn').onclick = () => { document.getElementById('display-modal').close(); };

async function sendBleCommand(cmdArray, withResponse = false) {
    return await window.bleManager.sendCommand(cmdArray, withResponse);
}

async function resetSystemState(silent = false, wipeHistory = false) {
    clearTimeout(goTimeout); 
    clearTimeout(window.finalizeTimerId);
    window.finalizeTimerId = null;
    appState = 1; 
    calibrationPhase = 'NONE'; 
    isReviewingLog = false;
    impactDetected = false; 
    isLive = true; 
    playbackMode = false; 
    setAutoSlowMo(false);
    recordedFrames = [];
    isDynamicCalibrationActive = false;

    hasLiftedOff = false;
    lockedFaceZ = null;
    addressPivotX = 0;
    window._smoothedDynExtCm = 0;
    window.pendingStrikePacket = null;
    window.pristineImpactQuat = null;
    window.pristineImpactQuat_m8 = null;
    window.pristineStep8ms = null;
    window.impactHwTime = 0;
    window.lastCompletedSwingIdx = null;
    window.followThroughComplete = false;
    window.peakFollowThroughTheta = -Infinity;
    window.peakFollowThroughIdx = -1;
    window.followThroughLastMoveTime = 0;


    window.matchAligned = false;
    window.matchSwinging = false;

    if (!silent) { await sendBleCommand([79]); }

    document.getElementById('cancelArmBtn').classList.add('hidden'); 
    document.getElementById('ready-group').classList.remove('hidden');
    document.getElementById('calibration-container').classList.add('hidden');
    document.getElementById('live-tracking-card').classList.add('hidden');
    document.getElementById('playback-panel').classList.add('hidden');
    
    let swingStateTxt = document.getElementById('swing-state'); 
    if(swingStateTxt) { 
        swingStateTxt.innerHTML = "MALLET CONNECTED<br><span class='small-help text-muted' style='font-size: 0.75rem; font-weight: normal;'>Select an activity to begin.</span>"; 
        swingStateTxt.className = "text-accent text-center font-bold mb-4"; 
    }
    
    resetBallRollAnimation();
    virtualBall.visible = false; 
    rebuildArcPts(loadedRadius, getOptimumArcHalfAngleDeg(loadedRadius));
    let arcToggle = document.getElementById('optimumArcToggle');
    ghostRail.visible = arcToggle ? arcToggle.checked : false;
    preRollBuffer = []; 
    castData = []; 
    clearImpactLasers(); 
    rawTracePoints.length = 0; 
    updateSmoothTrail(0);
    
    masterPivot.quaternion.identity(); 
    resetGhostHeadToPivot();
    if (typeof ghostPivot !== 'undefined' && ghostPivot) ghostPivot.quaternion.identity();
    updateSystemGeometry();

    masterPivot.position.set(0, pivotBaseY, 0); 
    masterBlock.position.set(0, -loadedRadius, 0); 
    headJoint.quaternion.identity(); 
    finalReviewExtension = 0;
    isForwardSwing = true; 
    lastForwardPassTime = 0;

    if (wipeHistory) {
        swingCount = 0; 
        posHistory = []; 
        currentSwingDeviation = 0; 
        swingDatabase = []; 
        window.fullSwingTraceBuffer = [];
        document.getElementById('history-list').innerHTML = '<div class="text-muted italic text-center mt-5" style="font-size: 0.85rem;">No swings recorded yet. Arm and swing!</div>';
        document.getElementById('menu-drawer').classList.remove('open');
    }
}

const authModal = document.getElementById('auth-modal');
document.getElementById('openAuthBtn').onclick = () => { authModal.showModal(); document.getElementById('menu-drawer').classList.remove('open'); };
document.getElementById('btnCloseAuth').onclick = () => { authModal.close(); };

document.getElementById('btnLogin').onclick = async () => {
    const email = document.getElementById('authEmail').value;
    const password = document.getElementById('authPassword').value;
    if(!email || !password) return showToast("Enter email and password.");
    
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) showToast("Login failed: " + error.message);
    else { showToast("Logged into Cloud."); authModal.close(); }
};

// --- NEW ROUTING BUTTONS ---
document.getElementById('btnOpenSignup').onclick = () => { 
    document.getElementById('auth-modal').close();
    document.getElementById('signup-modal').showModal();
};

document.getElementById('btnBackToLogin').onclick = () => { 
    document.getElementById('signup-modal').close();
    document.getElementById('auth-modal').showModal();
};

// --- THE ACTUAL SIGNUP ACTION ---
document.getElementById('btnConfirmSignup').onclick = async () => {
    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    const displayName = document.getElementById('signupDisplayName').value;
    const country = document.getElementById('signupCountry').value;
    
    if(!email || !password) return showToast("Enter email and password.");
    if(!displayName) return showToast("Please enter a Player Name to create an account.");
    if(!country) return showToast("Please enter your Country.");
    
    document.getElementById('btnConfirmSignup').innerText = "CREATING...";
    document.getElementById('btnConfirmSignup').disabled = true;

    // Pass the display name and country into Supabase's user_metadata
    const { data, error } = await supabaseClient.auth.signUp({ 
        email, 
        password,
        options: {
            data: {
                display_name: displayName,
                country: country
            }
        }
    });
    
    document.getElementById('btnConfirmSignup').innerText = "SIGN UP";
    document.getElementById('btnConfirmSignup').disabled = false;

    if (error) {
        showToast("Error: " + error.message);
    } else { 
        showToast("Success! Check your email to confirm."); 
        document.getElementById('signup-modal').close(); 
    }
};

document.getElementById('btnForgotPassword').onclick = async () => {
    const email = document.getElementById('authEmail').value;
    if(!email) return showToast("Enter your email address first to reset password.");
    
    const { data, error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname,
    });
    
    if (error) showToast("Error: " + error.message);
    else { 
        showToast("Password reset email sent! Check your inbox."); 
        authModal.close(); 
    }
};

let hasLoadedCloudProfile = false;

supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
        document.getElementById('update-password-modal').showModal();
    }

    if (session && session.user) {
        setCurrentUser(session.user);
        
        // Extract the name from Supabase metadata
        let playerName = session.user.user_metadata?.display_name || "Player";
        
        // --- NEW: Populate the Email field ---
        let emailDisplay = document.getElementById('playerEmailDisplay');
        if (emailDisplay) emailDisplay.value = session.user.email;
        
        document.getElementById('openAuthBtn').innerHTML = `Sign Out ${playerName} <span>👋</span>`;
        document.getElementById('openAuthBtn').onclick = async () => { 
            await supabaseClient.auth.signOut(); 
            
            // Wipe cached LVE settings & mallet profiles on sign-out
            Object.keys(localStorage).forEach(k => {
                if (k.startsWith('LVE_')) localStorage.removeItem(k);
            });
            
            showToast("Signed out. Clearing local settings..."); 
            
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        };
        
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
            if (!hasLoadedCloudProfile) {
                hasLoadedCloudProfile = true;
                loadPlayerProfile().then(async () => {
                    if (window.bleManager?.isConnected() && window.bleManager.deviceMac) {
                        await syncConnectedMallet(
                            window.bleManager.deviceMac,
                            window.bleManager.deviceName,
                            window.bleManager.hardwareProfile
                        );
                    }
                });
            }
        }
    } else {
        setCurrentUser(null);
        hasLoadedCloudProfile = false; 
        
        // --- NEW: Clear the Email field if logged out ---
        let emailDisplay = document.getElementById('playerEmailDisplay');
        if (emailDisplay) emailDisplay.value = "";
        
        document.getElementById('openAuthBtn').innerHTML = 'Cloud Login <span>☁️</span>';
        document.getElementById('openAuthBtn').onclick = () => { 
            authModal.showModal(); 
            document.getElementById('menu-drawer').classList.remove('open'); 
        };
    }
});
document.getElementById('btnSaveNewPassword').onclick = async () => {
    const newPassword = document.getElementById('newPassword').value;
    if(!newPassword) return showToast("Please enter a new password.");
    
    document.getElementById('btnSaveNewPassword').innerText = "SAVING...";
    
    const { data, error } = await supabaseClient.auth.updateUser({ password: newPassword });
    
    document.getElementById('btnSaveNewPassword').innerText = "SAVE NEW PASSWORD";
    
    if (error) showToast("Error: " + error.message);
    else { 
        showToast("Password updated successfully!"); 
        document.getElementById('update-password-modal').close();
        document.getElementById('newPassword').value = '';
    }
};

document.getElementById('btnCloseUpdatePassword').onclick = () => { 
    document.getElementById('update-password-modal').close(); 
};


function openMatchEdit(id, loc, opp, evt, spd, notes) {
    document.getElementById('editMatchId').value = id;
    document.getElementById('editLocation').value = loc.includes('Untitled Match') ? '' : loc;
    document.getElementById('editOpponent').value = opp;
    document.getElementById('editEvent').value = evt;
    document.getElementById('editLawnSpeed').value = spd || 10.0;
    document.getElementById('editNotes').value = notes;
    document.getElementById('match-edit-modal').showModal();
}

document.getElementById('btnCloseMatchEdit').onclick = () => { document.getElementById('match-edit-modal').close(); };

document.getElementById('btnSaveMatchEdit').onclick = async () => {
    let id = document.getElementById('editMatchId').value;
    let loc = document.getElementById('editLocation').value;
    let opp = document.getElementById('editOpponent').value;
    let evt = document.getElementById('editEvent').value;
    let spd = parseFloat(document.getElementById('editLawnSpeed').value) || 10.0;
    let notes = document.getElementById('editNotes').value;

    document.getElementById('btnSaveMatchEdit').innerText = "SAVING...";
    document.getElementById('btnSaveMatchEdit').disabled = true;

    const { error } = await supabaseClient.from('matches').update({
        location: loc, opponent: opp, event_type: evt, lawn_speed: spd, notes: notes
    }).eq('id', id);

    document.getElementById('btnSaveMatchEdit').innerText = "SAVE DETAILS";
    document.getElementById('btnSaveMatchEdit').disabled = false;

    if (error) { showToast("Update Failed: " + error.message); } 
    else { 
        showToast("Match updated."); 
        document.getElementById('match-edit-modal').close(); 
        fetchCloudMatches(); 
    }
};

document.getElementById('btnDeleteMatch').onclick = async () => {
    let id = document.getElementById('editMatchId').value;
    
    if (confirm("Are you sure you want to permanently delete this match and all its recorded strokes? This cannot be undone.")) {
        document.getElementById('btnDeleteMatch').innerText = "DELETING...";
        document.getElementById('btnDeleteMatch').disabled = true;

        const { error } = await supabaseClient.from('matches').delete().eq('id', id);

        document.getElementById('btnDeleteMatch').innerText = "DELETE MATCH";
        document.getElementById('btnDeleteMatch').disabled = false;

        if (error) { 
            showToast("Delete Failed: " + error.message); 
        } else { 
            showToast("Match deleted."); 
            document.getElementById('match-edit-modal').close(); 
            fetchCloudMatches(); 
        }
    }
};

document.getElementById('toggleDiagnosticHudBtn').addEventListener('click', toggleDeveloperHUD);

document.getElementById('devResetCalibrationBtn').onclick = async () => {
    if (confirm("Reset calibration matrix to perfect zero (Identity)?")) {
        hardwareMountOffset.set(0, 0, 0, 1);
        await saveActiveMalletCalibration(hardwareMountOffset, false);
        showToast("Calibration wiped on mallet & cloud.");
        document.getElementById('dev-options-modal').close();
    }
};

let activeFirmwareRelease = null;

function isNewerVersion(latest, current) {
    if (!current || current === 'Not Connected') return true;
    const a = latest.split('.').map(n => parseInt(n, 10) || 0);
    const b = current.split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if ((a[i] || 0) > (b[i] || 0)) return true;
        if ((a[i] || 0) < (b[i] || 0)) return false;
    }
    return false;
}

function fwLog(msg) {
    const el = document.getElementById('fwModalLog');
    if (!el) return;
    el.textContent += `\n[${new Date().toLocaleTimeString()}] ${msg}`;
    el.scrollTop = el.scrollHeight;
}

function setFwProgress(pct, label) {
    document.getElementById('fwModalProgressWrap')?.classList.remove('hidden');
    const bar = document.getElementById('fwModalBar');
    const pctEl = document.getElementById('fwModalPct');
    const stageEl = document.getElementById('fwModalStage');
    if (bar) bar.style.width = `${pct}%`;
    if (pctEl) pctEl.innerText = `${Math.round(pct)}%`;
    if (stageEl && label) stageEl.innerText = label;
}

async function computeSha256Hex(arrayBuffer) {
    const hashBuf = await crypto.subtle.digest('SHA-256', arrayBuffer);
    return Array.from(new Uint8Array(hashBuf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

document.getElementById('openAboutBtn').onclick = () => {
    const statusEl = document.getElementById('update-check-status');
    if (statusEl) statusEl.innerText = '';
    const aboutFw = document.getElementById('about-fw-display');
    if (aboutFw) {
        aboutFw.innerText = window.bleManager?.firmwareVersion || (window.bleManager?.isConnected() ? 'Connected' : 'Not Connected');
    }
    document.getElementById('about-modal').showModal();
    document.getElementById('menu-drawer').classList.remove('open');
};

document.getElementById('closeAboutBtn').onclick = () => {
    document.getElementById('about-modal').close();
};

const XIAO_VID = 0x2886;
const XIAO_DFU_PIDS = [0x0045, 0x0044];
const XIAO_APP_PIDS = [0x8045, 0x8044];
let pendingUpdateMalletId = null;

async function findAuthorizedDfuPort() {
    const ports = await navigator.serial.getPorts();
    return ports.find(p => {
        const info = p.getInfo();
        return info.usbVendorId === XIAO_VID && XIAO_DFU_PIDS.includes(info.usbProductId);
    }) || null;
}

async function waitForDfuPort(timeoutMs = 3500) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const port = await findAuthorizedDfuPort();
        if (port) return port;
        await new Promise(r => setTimeout(r, 250));
    }
    return null;
}

async function refreshBootloaderStatus() {
    const statusEl = document.getElementById('fwBootloaderStatus');
    const flashBtn = document.getElementById('btnModalStartFlash');
    if (!statusEl || !flashBtn) return;

    if (!('serial' in navigator)) {
        statusEl.innerText = "● USB Unsupported";
        statusEl.className = "font-mono text-danger";
        flashBtn.disabled = true;
        return;
    }

    const ports = await navigator.serial.getPorts();
    const dfuPort = ports.find(p => {
        const info = p.getInfo();
        return info.usbVendorId === XIAO_VID && XIAO_DFU_PIDS.includes(info.usbProductId);
    });
    const appPort = ports.find(p => {
        const info = p.getInfo();
        return info.usbVendorId === XIAO_VID && XIAO_APP_PIDS.includes(info.usbProductId);
    });

    if (dfuPort) {
        statusEl.innerText = "● Bootloader Ready";
        statusEl.className = "font-mono text-success font-bold";
        flashBtn.disabled = false;
        flashBtn.innerText = "⚡ UPDATE FIRMWARE";
    } else if (appPort && !window.bleManager?.isConnected()) {
        statusEl.innerText = "● Not in Bootloader";
        statusEl.className = "font-mono text-warning font-bold";
        flashBtn.disabled = false;
        flashBtn.innerText = "⚡ UPDATE FIRMWARE";
    } else {
        statusEl.innerText = "● Ready";
        statusEl.className = "font-mono text-muted";
        flashBtn.disabled = false;
        flashBtn.innerText = "⚡ UPDATE FIRMWARE";
    }
}

if ('serial' in navigator) {
    navigator.serial.addEventListener('connect', () => {
        if (document.getElementById('firmware-modal')?.open) refreshBootloaderStatus();
    });
    navigator.serial.addEventListener('disconnect', () => {
        if (document.getElementById('firmware-modal')?.open) refreshBootloaderStatus();
    });
}

const FACTORY_DEFAULT_FW_VERSION = '9.9.01';
let pendingTargetRelease = null;
let pendingIsFactoryReset = false;
let factoryResetArmed = false;
let factoryResetArmTimer = null;

function resetFactoryResetConfirmState() {
    clearTimeout(factoryResetArmTimer);
    factoryResetArmed = false;
    const resetBtn = document.getElementById('btnModalFactoryReset');
    if (resetBtn) {
        resetBtn.innerText = `↺ FACTORY RESET (v${FACTORY_DEFAULT_FW_VERSION})`;
        resetBtn.disabled = false;
    }
}

document.getElementById('closeFirmwareModalBtn').onclick = () => {
    pendingTargetRelease = null;
    pendingIsFactoryReset = false;
    resetFactoryResetConfirmState();
    document.getElementById('firmware-modal').close();
};

document.getElementById('checkUpdatesBtn').onclick = async () => {
    const btn = document.getElementById('checkUpdatesBtn');
    const statusEl = document.getElementById('update-check-status');

    if (!currentUser) {
        statusEl.innerText = "Please log in to your LevelEdge Cloud account first.";
        statusEl.className = "font-mono text-warning";
        showToast("Log in to check for firmware updates.");
        return;
    }

    btn.disabled = true;
    btn.innerText = "CHECKING...";
    statusEl.innerText = "Verifying subscription & release server...";
    statusEl.className = "font-mono text-muted";

    try {
        const { data: profile, error: profErr } = await supabaseClient
            .from('player_profiles')
            .select('is_subscribed')
            .eq('user_id', currentUser.id)
            .single();

        if (profErr || !profile?.is_subscribed) {
            statusEl.innerHTML = "Active <strong class='text-accent'>PRO Subscription</strong> required for firmware updates.";
            statusEl.className = "font-mono text-danger";
            return;
        }

        const { data: latestRel, error: relErr } = await supabaseClient
            .from('firmware_releases')
            .select('*')
            .eq('is_latest', true)
            .maybeSingle();

        if (relErr || !latestRel) {
            statusEl.innerText = "Unable to fetch release catalog.";
            statusEl.className = "font-mono text-danger";
            return;
        }

        activeFirmwareRelease = latestRel;
        pendingUpdateMalletId = window.bleManager?.isConnected() ? (activeMallet?.id || null) : null;

        const currentFw = window.bleManager?.firmwareVersion || 'Not Connected';
        const isUpToDate = currentFw !== 'Not Connected' && !isNewerVersion(latestRel.version, currentFw);

        document.getElementById('fwModalCurrent').innerText = currentFw;
        document.getElementById('fwModalLatest').innerText = `v${latestRel.version}${isUpToDate ? ' (Up to date)' : ''}`;
        document.getElementById('fwModalNotes').innerText = latestRel.release_notes;
        document.getElementById('fwModalProgressWrap').classList.add('hidden');
        document.getElementById('fwModalLog').textContent = `Ready to install v${latestRel.version}.`;

        if (currentFw === '9.8.05') {
            fwLog("v9.8.05 detected: plug in USB-C and double-tap Reset on the XIAO, then click Update Firmware.");
        }

        resetFactoryResetConfirmState();
        document.getElementById('about-modal').close();
        document.getElementById('firmware-modal').showModal();
        refreshBootloaderStatus();
    } finally {
        btn.disabled = false;
        btn.innerText = "CHECK FOR FIRMWARE UPDATES";
    }
};

async function resolveConnectedMalletIdentity(timeoutMs = 3000) {
    if (!window.bleManager?.isConnected()) return { malletId: null, version: null };

    // Explicitly request config/version ('C') if firmwareVersion hasn't arrived yet
    if (!window.bleManager.firmwareVersion && typeof syncConfigurationToMallet === 'function') {
        syncConfigurationToMallet().catch(() => {});
    }

    const connectedMac = window.bleManager.deviceMac;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const hasMatchingMallet = Boolean(
            activeMallet?.id && (!connectedMac || activeMallet.ble_mac === connectedMac)
        );
        const hasVersion = Boolean(window.bleManager.firmwareVersion);

        if (hasMatchingMallet && hasVersion) break;
        await new Promise(r => setTimeout(r, 100));
    }

    const malletId = (activeMallet?.id && (!connectedMac || activeMallet.ble_mac === connectedMac))
        ? activeMallet.id
        : null;
    const version = window.bleManager.firmwareVersion || activeMallet?.firmware_version || null;

    if (version) {
        const modalFw = document.getElementById('fwModalCurrent');
        if (modalFw) modalFw.innerText = version;
    }

    return { malletId, version };
}

async function executeFirmwareInstall(targetRelease, isFactoryReset = false) {
    if (!targetRelease) return;

    const flashBtn = document.getElementById('btnModalStartFlash');
    const resetBtn = document.getElementById('btnModalFactoryReset');
    if (flashBtn) flashBtn.disabled = true;
    if (resetBtn) resetBtn.disabled = true;

    const prevVersionRaw = document.getElementById('fwModalCurrent')?.innerText || '';
    let previousVersion = (prevVersionRaw && prevVersionRaw !== 'Not Connected' && prevVersionRaw !== '--')
        ? prevVersionRaw
        : null;

    let updateSucceeded = false;
    let awaitingUsbPairGesture = false;

    try {
        if (!('serial' in navigator)) {
            showToast("Web Serial API requires desktop Chrome or Edge.");
            throw new Error("navigator.serial is unavailable in this browser.");
        }
        if (!window.WebSerialDFU) {
            throw new Error("nrfSerialDfu.js is not loaded.");
        }

        if (isFactoryReset) {
            fwLog(`Starting factory reset to v${targetRelease.version}...`);
        }

        // 1. Check if already in bootloader mode; if not, try connecting over BLE first
        let port = await findAuthorizedDfuPort();

        if (!port && !window.bleManager?.isConnected() && navigator.bluetooth) {
            setFwProgress(5, "Connecting via Bluetooth...");
            fwLog("Bluetooth not connected — attempting to connect (or double-tap the Reset button on the mallet to enter bootloader mode manually)...");
            try {
                await window.bleManager.connect();
            } catch (bleErr) {
                fwLog("Bluetooth skipped or unavailable. Alternatively, double-tap the Reset button on the mallet.");
            }
        }

        // 2. Wait for BLE mallet ID + firmware version to resolve BEFORE sending 'U'
        if (window.bleManager?.isConnected()) {
            const resolved = await resolveConnectedMalletIdentity(3000);
            if (resolved.malletId) pendingUpdateMalletId = resolved.malletId;
            if (resolved.version) previousVersion = resolved.version;
        } else if (!pendingUpdateMalletId && Array.isArray(playerMallets) && playerMallets.length === 1) {
            // Single-mallet account fallback when flashed via manual double-tap Reset without BLE
            const soleMallet = playerMallets[0]?.mallet;
            if (soleMallet?.id) {
                pendingUpdateMalletId = soleMallet.id;
                if (!previousVersion && soleMallet.firmware_version) {
                    previousVersion = soleMallet.firmware_version;
                }
            }
        }

        // 3. If connected over BLE, send 'U' to reboot into bootloader mode
        if (!port && window.bleManager?.isConnected()) {
            if (previousVersion === '9.8.05') {
                fwLog("v9.8.05 requires a manual reset: double-tap the Reset button on the XIAO now.");
            } else {
                setFwProgress(8, "Rebooting mallet into bootloader...");
                fwLog(`Sending update command ('U') to ${window.bleManager.deviceName}...`);
                const sent = await window.bleManager.sendCommand([0x55], true);
                if (!sent) throw new Error("Failed to send DFU command over BLE.");

                fwLog("Waiting for USB bootloader...");
                port = await waitForDfuPort(3500);
                refreshBootloaderStatus();
            }
        }

        // 3. Prompt to select USB port if this is a new board or first-time browser
        if (!port) {
            setFwProgress(10, "Select XIAO nRF52840 in popup...");
            try {
                port = await navigator.serial.requestPort({
                    filters: XIAO_DFU_PIDS.map(pid => ({ usbVendorId: XIAO_VID, usbProductId: pid }))
                });
                refreshBootloaderStatus();
            } catch (portErr) {
                if (portErr.name === 'SecurityError') {
                    awaitingUsbPairGesture = true;
                    pendingTargetRelease = targetRelease;
                    pendingIsFactoryReset = isFactoryReset;
                    fwLog("Click 'Select USB Port to Flash' above to choose XIAO nRF52840 (ensure the mallet rebooted via Bluetooth or double-tap Reset).");
                    return;
                }
                if (portErr.name === 'NotFoundError') {
                    throw new Error("No bootloader port selected. Connect via Bluetooth or double-tap the Reset button on the mallet, then try again.");
                }
                throw portErr;
            }
        }

        // 4. Download & verify firmware package
        setFwProgress(20, "Downloading firmware package...");
        fwLog(`Downloading ${targetRelease.storage_path}...`);

        const { data: fileBlob, error: dlErr } = await supabaseClient.storage
            .from('firmware-binaries')
            .download(targetRelease.storage_path);

        if (dlErr || !fileBlob) {
            throw new Error(`Storage error (${targetRelease.storage_path}): ${dlErr?.message || 'Download failed'}`);
        }
        const zipBuffer = await fileBlob.arrayBuffer();

        setFwProgress(30, "Verifying SHA-256 checksum...");
        const actualHash = await computeSha256Hex(zipBuffer);
        if (actualHash !== targetRelease.sha256.toLowerCase()) {
            throw new Error("SHA-256 mismatch! Aborting flash to protect hardware.");
        }
        fwLog("SHA-256 verified OK.");

        // 5. Flash over Web Serial DFU
        const dfu = new window.WebSerialDFU(port, {
            baudRate: 115200,
            onProgress: (sent, total) => {
                const pct = 30 + (sent / total) * 70;
                setFwProgress(pct, isFactoryReset ? `Restoring v${targetRelease.version}...` : "Flashing nRF52840...");
            },
            onLog: (line) => fwLog(line)
        });

        await dfu.flashZip(zipBuffer);

        updateSucceeded = true;
        setFwProgress(100, isFactoryReset ? "Factory Reset Complete!" : "Update Complete!");
        if (isFactoryReset) {
            fwLog(`Successfully restored factory firmware v${targetRelease.version}! Unplug USB-C now to exit charging mode and reconnect Bluetooth.`);
            showToast(`Factory reset to v${targetRelease.version} complete!`);
        } else {
            fwLog(`Successfully flashed v${targetRelease.version}! Mallet is rebooting and will auto-reconnect.`);
            showToast(`Firmware updated to v${targetRelease.version}!`);
        }
    } catch (err) {
        fwLog(`${isFactoryReset ? 'FACTORY RESET' : 'UPDATE'} FAILED: ${err.message}`);
        showToast(isFactoryReset ? "Factory reset failed. Check log." : "Firmware update failed. Check log.");
    } finally {
        if (!awaitingUsbPairGesture) {
            pendingTargetRelease = null;
            pendingIsFactoryReset = false;

            if (currentUser) {
                const fullLogText = document.getElementById('fwModalLog')?.textContent || '';

                const { error: logErr } = await supabaseClient
                    .from('mallet_update_logs')
                    .insert([{
                        mallet_id: pendingUpdateMalletId,
                        user_id: currentUser.id,
                        version: targetRelease.version,
                        previous_version: previousVersion,
                        status: updateSucceeded ? 'success' : 'failed',
                        log_output: fullLogText
                    }]);

                if (logErr) {
                    fwLog(`Cloud audit log warning: ${logErr.message}`);
                }

                if (updateSucceeded && pendingUpdateMalletId) {
                    await supabaseClient
                        .from('mallets')
                        .update({ firmware_version: targetRelease.version })
                        .eq('id', pendingUpdateMalletId);
                }
            }
        }

        if (flashBtn) {
            flashBtn.disabled = false;
            flashBtn.innerText = awaitingUsbPairGesture
                ? "🔌 SELECT USB PORT TO FLASH"
                : "⚡ UPDATE FIRMWARE";
        }
        if (resetBtn) {
            resetBtn.disabled = awaitingUsbPairGesture;
        }
    }
}

const modalStartFlashBtn = document.getElementById('btnModalStartFlash');
if (modalStartFlashBtn) {
    modalStartFlashBtn.onclick = async () => {
        resetFactoryResetConfirmState();
        if (pendingTargetRelease) {
            await executeFirmwareInstall(pendingTargetRelease, pendingIsFactoryReset);
        } else {
            await executeFirmwareInstall(activeFirmwareRelease, false);
        }
    };
}

const modalFactoryResetBtn = document.getElementById('btnModalFactoryReset');
if (modalFactoryResetBtn) {
    modalFactoryResetBtn.onclick = async () => {
        if (!factoryResetArmed) {
            factoryResetArmed = true;
            modalFactoryResetBtn.innerText = `⚠️ CLICK AGAIN TO CONFIRM RESET (v${FACTORY_DEFAULT_FW_VERSION})`;
            fwLog(`Click Factory Reset again within 5 seconds to restore v${FACTORY_DEFAULT_FW_VERSION}.`);
            clearTimeout(factoryResetArmTimer);
            factoryResetArmTimer = setTimeout(() => {
                resetFactoryResetConfirmState();
            }, 5000);
            return;
        }

        resetFactoryResetConfirmState();
        modalFactoryResetBtn.disabled = true;

        try {
            fwLog(`Fetching factory firmware release v${FACTORY_DEFAULT_FW_VERSION}...`);
            const { data: factoryRel, error: relErr } = await supabaseClient
                .from('firmware_releases')
                .select('*')
                .eq('version', FACTORY_DEFAULT_FW_VERSION)
                .maybeSingle();

            if (relErr || !factoryRel) {
                fwLog(`Error: Factory firmware v${FACTORY_DEFAULT_FW_VERSION} not found in release catalog.`);
                showToast(`Factory firmware v${FACTORY_DEFAULT_FW_VERSION} unavailable.`);
                return;
            }

            await executeFirmwareInstall(factoryRel, true);
        } finally {
            if (!pendingTargetRelease) modalFactoryResetBtn.disabled = false;
        }
    };
}

document.getElementById('openMalletBtn').onclick = () => { document.getElementById('mallet-modal').showModal(); document.getElementById('menu-drawer').classList.remove('open'); };
document.getElementById('closeMalletBtn').onclick = () => { document.getElementById('mallet-modal').close(); };

document.getElementById('openPlayerBtn').onclick = () => { document.getElementById('player-modal').showModal(); document.getElementById('menu-drawer').classList.remove('open'); };
document.getElementById('closePlayerBtn').onclick = () => { document.getElementById('player-modal').close(); };

document.getElementById('openSystemBtn').onclick = () => { document.getElementById('system-modal').showModal(); document.getElementById('menu-drawer').classList.remove('open'); };
document.getElementById('closeSystemBtn').onclick = () => { document.getElementById('system-modal').close(); };

document.getElementById('closeDevOptionsBtn').onclick = () => { document.getElementById('dev-options-modal').close(); };


let versionTapCount = 0;
let versionTapTimer;
document.getElementById('version-text').onclick = () => {
    versionTapCount++;
    clearTimeout(versionTapTimer);
    if (versionTapCount >= 3) {
        versionTapCount = 0;
        document.getElementById('about-modal').close();
        document.getElementById('dev-options-modal').showModal();
    } else {
        versionTapTimer = setTimeout(() => { versionTapCount = 0; }, 500);
    }
};

function updateLawnSpeedLabel() {
    let el = document.getElementById('lawnSpeedInput'); let lbl = document.getElementById('lawnSpeedLabel');
    if (el && lbl) {
        let plummers = parseFloat(el.value); let txt = plummers.toFixed(1);
        if (plummers < 8) txt += " (Very Slow)"; else if (plummers < 9.5) txt += " (Slow)"; else if (plummers <= 11.5) txt += " (Medium)"; else if (plummers <= 13) txt += " (Fast)"; else txt += " (Very Fast)";
        lbl.innerText = txt;
    }
}

function updateFaultSensitivityLabel() {
    let el = document.getElementById('faultSensitivityInput');
    let lbl = document.getElementById('faultSensitivityLabel');
    if (!el || !lbl) return;
    const labels = ["Off", "Conservative", "Standard", "Sensitive"];
    const idx = Math.max(0, Math.min(3, parseInt(el.value, 10) || 0));
    lbl.innerText = labels[idx];
}

let faultSensInput = document.getElementById('faultSensitivityInput');
if (faultSensInput) {
    faultSensInput.addEventListener('input', () => {
        updateFaultSensitivityLabel();
        syncAppConfig();
    });
    faultSensInput.addEventListener('change', () => {
        if (window.bleManager?.isConnected()) syncConfigurationToMallet();
    });
}

function getOptimumArcHalfAngleDeg(radiusCm) {
    let targetDist = inGameMode
        ? (parseFloat(document.getElementById('matchDistSetup')?.value) || 10.0)
        : (parseFloat(document.getElementById('trainerDistSetup')?.value) || 5.0);
    let lawnSpd = inGameMode
        ? (parseFloat(document.getElementById('matchLawnSetup')?.value) || AppConfig.lawnSpeed || 10.0)
        : (AppConfig.lawnSpeed || 10.0);
    let massKg = AppConfig.massKg || 1.0;
    let radiusM = (radiusCm || loadedRadius || 127) / 100.0;

    let lawnMult = Math.max(0.1, 0.50 + (lawnSpd - 10.0) * 0.075);
    let reqBallSpeed = Math.sqrt(Math.max(0.1, targetDist) / lawnMult);
    let reqMalletSpeed = reqBallSpeed * (massKg + 0.454) / (1.8 * massKg);

    let oneMinusCos = (reqMalletSpeed * reqMalletSpeed) / (2.0 * 9.81 * radiusM);
    let baseThetaRad = oneMinusCos >= 1.0
        ? (Math.PI / 2.0)
        : Math.acos(Math.max(-1.0, 1.0 - oneMinusCos));

    let arcLengthM = (baseThetaRad * radiusM) * 1.25;
    let arcAngleDeg = THREE.MathUtils.radToDeg(arcLengthM / radiusM);
    return Math.max(15, Math.min(110, arcAngleDeg));
}

let lawnInput = document.getElementById('lawnSpeedInput');
if (lawnInput) lawnInput.addEventListener('input', () => {
    updateLawnSpeedLabel();
    rebuildArcPts(loadedRadius, getOptimumArcHalfAngleDeg(loadedRadius));
});

function updateMatchLawnSpeedLabel() {
    let el = document.getElementById('matchLawnSetup'); 
    let lbl = document.getElementById('matchLawnLabel');
    if (el && lbl) {
        let plummers = parseFloat(el.value); let txt = plummers.toFixed(1);
        if (plummers < 8) txt += " (Very Slow)"; else if (plummers < 9.5) txt += " (Slow)"; else if (plummers <= 11.5) txt += " (Medium)"; else if (plummers <= 13) txt += " (Fast)"; else txt += " (Very Fast)";
        lbl.innerText = txt;
    }
}
let matchLawnInput = document.getElementById('matchLawnSetup');
if (matchLawnInput) matchLawnInput.addEventListener('input', () => {
    updateMatchLawnSpeedLabel();
    rebuildArcPts(loadedRadius, getOptimumArcHalfAngleDeg(loadedRadius));
});

let matchDistInput = document.getElementById('matchDistSetup');
if (matchDistInput) matchDistInput.addEventListener('input', (e) => {
    let lbl = document.getElementById('matchDistLabel');
    if (lbl) lbl.innerText = parseFloat(e.target.value).toFixed(1);
    rebuildArcPts(loadedRadius, getOptimumArcHalfAngleDeg(loadedRadius));
});

let trainerDistInput = document.getElementById('trainerDistSetup');
if (trainerDistInput) trainerDistInput.addEventListener('input', (e) => {
    let lbl = document.getElementById('trainerDistLabel');
    if (lbl) lbl.innerText = parseFloat(e.target.value).toFixed(1);
    rebuildArcPts(loadedRadius, getOptimumArcHalfAngleDeg(loadedRadius));
});

window.addEventListener('beforeunload', () => { window.bleManager.disconnect(); });

function updateSystemGeometry() {
    let bZ = getDynamicBallZ(); 
    if (virtualBall) {
        let ballLocalPos = new THREE.Vector3(0, -loadedRadius, bZ);
        if (typeof ghostPivot !== 'undefined' && ghostPivot) {
            ballLocalPos.applyQuaternion(ghostPivot.quaternion);
        }
        ballLocalPos.y += pivotBaseY;
        virtualBall.position.copy(ballLocalPos);
    }
    if(typeof masterPivot !== 'undefined' && masterPivot) masterPivot.position.set(0, pivotBaseY, 0); 
    if(typeof ghostPivot !== 'undefined' && ghostPivot) ghostPivot.position.set(0, pivotBaseY, 0);
    if(typeof masterBlock !== 'undefined' && masterBlock) masterBlock.position.set(0, -loadedRadius, 0); 
    if(typeof ghostBlock !== 'undefined' && ghostBlock) ghostBlock.position.set(0, -loadedRadius, 0);
    
    if(typeof targetEnvironmentGroup !== 'undefined' && targetEnvironmentGroup) {
        targetEnvironmentGroup.position.set(addressPivotX || 0, pivotBaseY, 0);
        if (typeof ghostPivot !== 'undefined' && ghostPivot) {
            targetEnvironmentGroup.quaternion.copy(ghostPivot.quaternion);
        }
        
        if(typeof floorGrid !== 'undefined') floorGrid.position.y = -loadedRadius;
        if(typeof targetArrow !== 'undefined') targetArrow.position.y = -loadedRadius + 0.1;
        
        // Offset by +37.5 so the bottom edge of the 75cm grid touches the floor (-loadedRadius)
        if(typeof verticalGrid !== 'undefined') verticalGrid.position.y = -loadedRadius + 75;
    }
}

function updateMalletScale() {
    if (!mainMalletMesh || !ghostMalletMesh) return;
    let len = AppConfig.malletLengthCm; 
    let wid = AppConfig.malletWidthCm;
    let halfLen = len / 2.0;

    if (typeof setActiveOffsetZ === 'function') setActiveOffsetZ(halfLen);
    
    setMalletHalfWidth(wid / 2.0);
    if (typeof setMalletDimensions === 'function') setMalletDimensions(len, wid); 

    let scaleX = len / baseStlSize.x; 
    let scaleY = wid / baseStlSize.y; 
    let scaleZ = wid / baseStlSize.z; 
    
    mainMalletMesh.scale.set(scaleX, scaleY, scaleZ); 
    ghostMalletMesh.scale.set(scaleX, scaleY, scaleZ);
    
    // Center shaft sits at the midpoint of the mallet head (Z = 0)
    mainMalletMesh.position.z = 0; 
    ghostMalletMesh.position.z = 0; 

    if (handleMesh) handleMesh.position.z = 0;
    if (ghostHandleMesh) ghostHandleMesh.position.z = 0;
    
    // Pin the face tracker at the physical front striking face (Head Length / 2)
    faceTrackerNode.position.set(0, 0, halfLen);
    
    updateSystemGeometry(); 
    rebuildArcPts(loadedRadius, getOptimumArcHalfAngleDeg(loadedRadius));
}

window.applyMalletToUI = function(mallet, isConnectedToThisMallet = false) {
    if (!mallet) return;
    document.getElementById('malletNameInput').value = mallet.name || 'Primary Mallet';
    document.getElementById('handleLengthInput').value = mallet.handle_length_cm ?? 91.4;
    document.getElementById('malletLengthInput').value = mallet.head_length_cm ?? 27.6;
    document.getElementById('malletWidthInput').value = mallet.face_width_cm ?? 6.0;
    document.getElementById('massInput').value = mallet.mass_g ?? 1000;
    document.getElementById('offsetYInput').value = mallet.offset_y_cm ?? 5.5;
    document.getElementById('offsetZInput').value = mallet.offset_z_cm ?? 10.0;
    document.getElementById('sweetSpotInput').value = mallet.sweet_spot_cm ?? 1.5;

    const shareCheck = document.getElementById('allowSharingCheck');
    if (shareCheck) {
        shareCheck.checked = mallet.allow_sharing ?? true;
        const isOwner = !currentUser || !mallet.owner_id || mallet.owner_id === currentUser.id;
        shareCheck.disabled = !isOwner;
    }

    hardwareMountOffset.set(
        mallet.matrix_x ?? 0.0,
        mallet.matrix_y ?? 0.0,
        mallet.matrix_z ?? 0.0,
        mallet.matrix_w ?? 1.0
    );

    const macDisp = document.getElementById('malletMacDisplay');
    if (macDisp) {
        const macLabel = mallet.ble_mac && !mallet.ble_mac.startsWith('LEGACY-') && mallet.ble_mac !== 'OFFLINE-DEFAULT'
            ? mallet.ble_mac : 'Unbound / Offline';
        macDisp.innerText = `HW ID: ${macLabel}${isConnectedToThisMallet ? ' (Connected)' : ''}`;
    }

    const badge = document.getElementById('malletCalibBadge');
    if (badge) {
        if (mallet.is_calibrated) {
            badge.innerText = '● CALIBRATED';
            badge.className = 'font-mono font-bold text-success';
        } else {
            badge.innerText = '● UNCALIBRATED';
            badge.className = 'font-mono font-bold text-warning';
        }
    }

    const sharedBox = document.getElementById('sharedMalletActions');
    if (sharedBox) {
        const isShared = currentUser && mallet.owner_id && mallet.owner_id !== currentUser.id;
        sharedBox.classList.toggle('hidden', !isShared);
    }

    const ownerBox = document.getElementById('ownerMalletActions');
    if (ownerBox) {
        const isOwnerRecord = Boolean(currentUser && mallet.id && mallet.owner_id === currentUser.id);
        ownerBox.classList.toggle('hidden', !isOwnerRecord);
    }

    syncAppConfig();
    updateMalletScale();
    if (window.renderMalletSelector) window.renderMalletSelector();
};

window.renderMalletSelector = function() {
    const sel = document.getElementById('activeMalletSelect');
    if (!sel) return;
    sel.innerHTML = '';

    const connectedMac = window.bleManager?.isConnected() ? window.bleManager.deviceMac : null;

    if (!playerMallets || playerMallets.length === 0) {
        const opt = document.createElement('option');
        opt.value = activeMallet?.id || '';
        opt.textContent = activeMallet
            ? `${activeMallet.name}${connectedMac ? ' • Connected' : ''}`
            : '-- Connect Mallet or Log In --';
        sel.appendChild(opt);
        return;
    }

    playerMallets.forEach(entry => {
        const m = entry.mallet;
        if (!m) return;
        const opt = document.createElement('option');
        opt.value = m.id;
        const isConn = connectedMac && m.ble_mac === connectedMac;
        const roleTag = entry.role === 'shared' ? ' [Shared]' : '';
        const calTag = m.is_calibrated ? ' ✓' : ' (Uncalibrated)';
        opt.textContent = `${m.name}${roleTag}${calTag}${isConn ? ' • Connected' : ''}`;
        if (activeMallet && activeMallet.id === m.id) opt.selected = true;
        sel.appendChild(opt);
    });
};

window.onPlayerPreferencesApplied = function() {
    let audioEl = document.getElementById('audioThreshInput');
    let impactEl = document.getElementById('impactInput');
    if (audioEl) audioThreshold = parseFloat(audioEl.value);
    if (impactEl) impactThreshold = parseFloat(impactEl.value);

    updateLawnSpeedLabel();
    updateFaultSensitivityLabel();
    if (typeof updateMatchLawnSpeedLabel === 'function') updateMatchLawnSpeedLabel();

    let matchDistEl = document.getElementById('matchDistSetup');
    let matchDistLbl = document.getElementById('matchDistLabel');
    if (matchDistEl) {
        let d = Math.max(0.1, parseFloat(matchDistEl.value) || 10.0);
        if (matchDistLbl) matchDistLbl.innerText = d.toFixed(1);
        let matchTwistEl = document.getElementById('matchTwistSetup');
        if (matchTwistEl) matchTwistEl.value = (Math.atan(0.092 / d) * (180 / Math.PI)).toFixed(2);
    }

    let trainerDistEl = document.getElementById('trainerDistSetup');
    let trainerDistLbl = document.getElementById('trainerDistLabel');
    if (trainerDistEl) {
        let d = Math.max(0.1, parseFloat(trainerDistEl.value) || 5.0);
        if (trainerDistLbl) trainerDistLbl.innerText = d.toFixed(1);
        let trainerTwistEl = document.getElementById('trainerTwistSetup');
        if (trainerTwistEl) trainerTwistEl.value = (Math.atan(0.092 / d) * (180 / Math.PI)).toFixed(2);
    }

    syncAppConfig();
    updateExperimentalFeatures();

    ['darkThemeCheck', 'soundCheck', 'flipViewCheck', 'floorGridToggle', 'verticalGridToggle', 'optimumArcToggle', 'hideBackswingCheck'].forEach(id => {
        let el = document.getElementById(id);
        if (el) el.dispatchEvent(new Event('change'));
    });
};

function saveLocalPlayerPrefs() {
    try {
        const prefs = {};
        playerSettingsElements.forEach(id => {
            const el = document.getElementById(id);
            if (el) prefs[id] = (el.type === 'checkbox') ? el.checked : el.value;
        });
        localStorage.setItem('LVE_PlayerPrefs', JSON.stringify(prefs));
    } catch (e) {}
    if (currentUser) savePlayerProfile();
}

function loadLocalPlayerPrefs() {
    try {
        const saved = localStorage.getItem('LVE_PlayerPrefs');
        if (saved) {
            const prefs = JSON.parse(saved);
            playerSettingsElements.forEach(id => {
                if (prefs[id] !== undefined) {
                    const el = document.getElementById(id);
                    if (el) {
                        if (el.type === 'checkbox') el.checked = prefs[id];
                        else {
                            if (id === 'lawnSpeedInput' || id === 'matchLawnSetup') {
                                let val = parseFloat(prefs[id]);
                                if (val < 4.0) val = 10 + (val - 0.50) / 0.075;
                                el.value = val.toFixed(1);
                            } else el.value = prefs[id];
                        }
                    }
                }
            });
        }
    } catch (e) {}
    loadOfflineMalletFallback();
    window.onPlayerPreferencesApplied();
    updateMalletScale();
}

playerSettingsElements.forEach(id => {
    let el = document.getElementById(id);
    if (el) el.addEventListener('change', () => {
        saveLocalPlayerPrefs();
        if (id === 'lawnSpeedInput') updateLawnSpeedLabel();
        if (id === 'subscribedCheck' && activePanelMode === 'analytics') setPanelContent('analytics');
    });
});

malletSpecElements.forEach(id => {
    let el = document.getElementById(id);
    if (el) el.addEventListener('change', () => {
        syncAppConfig();
        updateMalletScale();
        saveActiveMalletSpecs();
    });
});

document.getElementById('activeMalletSelect')?.addEventListener('change', async (e) => {
    const chosenId = e.target.value;
    if (!chosenId) return;
    if (window.bleManager?.isConnected() && activeMallet && activeMallet.id !== chosenId) {
        showToast("Disconnect current mallet before switching to another mallet.");
        window.renderMalletSelector();
        return;
    }
    await selectMalletFromBag(chosenId);
});

document.getElementById('removeMalletFromBagBtn')?.addEventListener('click', async () => {
    if (!activeMallet?.id) return;
    if (confirm(`Remove "${activeMallet.name}" from your mallet bag?`)) {
        await removeMalletFromBag(activeMallet.id);
    }
});

document.getElementById('releaseMalletBtn')?.addEventListener('click', async () => {
    if (!activeMallet?.id) return;
    if (confirm(`Release ownership of "${activeMallet.name}"? It will be removed from your bag, and the next player who connects over Bluetooth will become its new owner. Your past swing history will remain intact.`)) {
        const releasedMac = activeMallet.ble_mac;
        const ok = await releaseMalletOwnership(activeMallet.id);
        if (ok && window.bleManager?.isConnected() && window.bleManager.deviceMac === releasedMac) {
            window.bleManager.disconnect();
        }
    }
});

let expCheck = document.getElementById('experimentalCheck');
if (expCheck) {
    expCheck.addEventListener('change', updateExperimentalFeatures);
}

let cloudDataCheck = document.getElementById('showCloudDataCheck');
if (cloudDataCheck) {
    cloudDataCheck.addEventListener('change', () => {
        if (currentUser && !document.getElementById('cloud-training-tab-content').classList.contains('hidden')) {
            fetchCloudTraining();
        }
    });
}

document.getElementById('exportProfileBtn').onclick = () => {
    let profile = { hwMatrixX: hardwareMountOffset.x, hwMatrixY: hardwareMountOffset.y, hwMatrixZ: hardwareMountOffset.z, hwMatrixW: hardwareMountOffset.w };
    [...playerSettingsElements, ...malletSpecElements].forEach(id => {
        let el = document.getElementById(id);
        if (el) profile[id] = el.type === 'checkbox' ? el.checked : el.value;
    });
    let dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(profile));
    let dlAnchorElem = document.createElement('a'); dlAnchorElem.setAttribute("href", dataStr);
    let safeName = (profile.malletNameInput || "mallet").replace(/[^a-z0-9]/gi, '_').toLowerCase();
    dlAnchorElem.setAttribute("download", safeName + "_profile.lve"); document.body.appendChild(dlAnchorElem); dlAnchorElem.click(); document.body.removeChild(dlAnchorElem);
    showToast("Hardware Profile Exported as .LVE"); document.getElementById('mallet-modal').close();
};

document.getElementById('importProfileBtn').onclick = () => { document.getElementById('importFileInput').click(); };
document.getElementById('importFileInput').addEventListener('change', (event) => {
    let file = event.target.files[0]; if (!file) return; let reader = new FileReader();
    reader.onload = async function(e) {
        try {
            let profile = JSON.parse(e.target.result);
            if (profile.hwMatrixW !== undefined) hardwareMountOffset.set(profile.hwMatrixX, profile.hwMatrixY, profile.hwMatrixZ, profile.hwMatrixW);
            [...playerSettingsElements, ...malletSpecElements].forEach(id => { 
                if (profile[id] !== undefined) { 
                    let el = document.getElementById(id); 
                    if (el) { 
                        if (el.type === 'checkbox') el.checked = profile[id]; 
                        else {
                            if (id === 'lawnSpeedInput') { let val = parseFloat(profile[id]); if (val < 4.0) val = 10 + (val - 0.50) / 0.075; el.value = val.toFixed(1); } 
                            else el.value = profile[id]; 
                        }
                    } 
                } 
            });
            saveLocalPlayerPrefs();
            await saveActiveMalletSpecs();
            await saveActiveMalletCalibration(hardwareMountOffset, profile.hwMatrixW !== undefined);
            updateMalletScale(); updateLawnSpeedLabel(); updateFaultSensitivityLabel(); syncAppConfig(); showToast("Hardware Profile Loaded Successfully."); document.getElementById('importFileInput').value = '';
        } catch(err) { showToast("Error parsing .LVE file."); }
    }; reader.readAsText(file);
});
document.getElementById('darkThemeCheck').addEventListener('change', (e) => {
    const newTheme = e.target.checked ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    if (newTheme === 'light') { scene.background = new THREE.Color(0xe2e8f0); hemiLight.intensity = 1.2; } 
    else { scene.background = null; hemiLight.intensity = 1.0; }
});

document.getElementById('soundCheck').addEventListener('change', (e) => { 
    toggleSoundState(e.target.checked);
});

document.getElementById('flipViewCheck').addEventListener('change', (e) => {
    isViewFlipped = e.target.checked; 
    let radiusOffset = AppConfig.radiusInput;
    let camX = isViewFlipped ? -100 : 100; 
    camera.position.set(camX, pivotBaseY - radiusOffset, 0); 
    controls.target.set(0, pivotBaseY - radiusOffset, 0); 
    controls.update();
});

document.getElementById('floorGridToggle').addEventListener('change', (e) => {
    if(typeof floorGrid !== 'undefined') floorGrid.visible = e.target.checked;
    document.querySelectorAll('.toggleFloorGrid-clone').forEach(el => {
        el.classList.toggle('active', e.target.checked);
        el.style.color = e.target.checked ? 'var(--accent-primary)' : '';
    });
});

document.getElementById('verticalGridToggle').addEventListener('change', (e) => {
    if(typeof verticalGrid !== 'undefined') verticalGrid.visible = e.target.checked;
    document.querySelectorAll('.togglePlaneGrid-clone').forEach(el => {
        el.classList.toggle('active', e.target.checked);
        el.style.color = e.target.checked ? 'var(--accent-primary)' : '';
    });
});

document.getElementById('optimumArcToggle').addEventListener('change', (e) => {
    if(typeof ghostRail !== 'undefined') ghostRail.visible = e.target.checked;
    document.querySelectorAll('.toggleOptimumArc-clone').forEach(el => {
        el.classList.toggle('active', e.target.checked);
        el.style.color = e.target.checked ? 'var(--accent-primary)' : '';
    });
});

document.getElementById('hideBackswingCheck').addEventListener('change', (e) => {
    syncAppConfig();
    let isShown = !e.target.checked;
    document.getElementById('toggleBackswing')?.classList.toggle('active', isShown);
    document.querySelectorAll('.toggleBackswing-clone').forEach(el => {
        el.classList.toggle('active', isShown);
        el.style.color = isShown ? 'var(--accent-primary)' : '';
    });
    if (rawTracePoints.length > 0) updateSmoothTrail(); // Instantly redraws the line
});

function syncDroneCamUI(enabled) {
    const chk = document.getElementById('droneCamCheck');
    const btn = document.getElementById('droneReplayBtn');
    if (chk) chk.checked = !!enabled;
    if (btn) {
        btn.classList.toggle('active', !!enabled);
        btn.innerText = enabled ? "🛸 DRONE: ON" : "🛸 DRONE";
    }
    setDroneCamEnabled(!!enabled);
}

document.getElementById('droneCamCheck')?.addEventListener('change', (e) => {
    syncDroneCamUI(e.target.checked);
});

document.getElementById('droneReplayBtn')?.addEventListener('click', () => {
    const nextState = !document.getElementById('droneCamCheck')?.checked;
    syncDroneCamUI(nextState);
    showToast(nextState ? "Drone camera enabled for ball roll" : "Drone camera off");
});

function resetCameraToSwingView() {
    let camX = isViewFlipped ? -100 : 100;
    camera.position.set(camX, pivotBaseY - loadedRadius, 0);
    controls.target.set(0, pivotBaseY - loadedRadius, 0);
    controls.update();
}

function exitWizardUI() {
    isWizardActive = false;
    capturing = false;
    sendBleCommand([79]); // Return firmware from full-speed calibration to 1 Hz IDLE
    document.getElementById('wizard-modal').close();
    document.getElementById('control-panel')?.classList.remove('hidden');

    if (handleMesh) handleMesh.scale.y = 1.0;
    if (tableMesh) tableMesh.material.opacity = 0.2;
    if (wizardTableGroup) wizardTableGroup.visible = false;
    masterBlock.position.set(0, -loadedRadius, 0);
    masterPivot.position.set(0, pivotBaseY, 0);

    let traceCheck = document.getElementById('showTraceCheck');
    trailLine.visible = traceCheck ? traceCheck.checked : true;
    resetCameraToSwingView();
}

document.getElementById('launchWizardBtn').onclick = async () => {
    if (!window.bleManager.device || !window.bleManager.device.gatt.connected) {
        showToast("Connect sensor first before calibrating!");
        return;
    }
    await sendBleCommand([90]); // Tell firmware to enter STATE_CALIBRATING (40ms / 25Hz full speed)
    document.getElementById('mallet-modal').close();
    document.getElementById('control-panel')?.classList.add('hidden');
    document.getElementById('menu-drawer')?.classList.remove('open');

    const historyPanel = document.getElementById('history-panel');
    if (historyPanel) {
        historyPanel.classList.remove('mobile-open');
        historyPanel.classList.add('desktop-closed');
    }

    const wizardModal = document.getElementById('wizard-modal');
    const isMobile = window.innerWidth <= 768;

    wizardModal.style.position = 'fixed';
    wizardModal.style.margin = '0';
    wizardModal.style.padding = '0';
    wizardModal.style.border = 'none';
    wizardModal.style.background = 'transparent';
    wizardModal.style.zIndex = '100';
    if (isMobile) {
        wizardModal.style.top = 'auto';
        wizardModal.style.bottom = '12px';
        wizardModal.style.left = '50%';
        wizardModal.style.right = 'auto';
        wizardModal.style.transform = 'translateX(-50%)';
        wizardModal.style.width = 'calc(100% - 24px)';
        wizardModal.style.maxWidth = '420px';
    } else {
        wizardModal.style.top = '80px';
        wizardModal.style.right = '20px';
        wizardModal.style.left = 'auto';
        wizardModal.style.bottom = 'auto';
        wizardModal.style.transform = 'none';
        wizardModal.style.width = '320px';
    }

    if (!wizardModal.open) wizardModal.show();

    isWizardActive = true;
    wizardStep = 0;
    updateWizardUI();

    if (wizardTableGroup) wizardTableGroup.visible = true;
    if (tableMesh) tableMesh.material.opacity = 0.45;

    let tableY = pivotBaseY - loadedRadius - 1.5;
    let targetOffsetY = isMobile ? -5 : 3;
    let targetOffsetX = isMobile ? 0 : 4;
    controls.target.set(targetOffsetX, tableY + targetOffsetY, 0);
    camera.position.set(24, tableY + 22, 26);
    controls.update();
};

document.getElementById('closeWizardBtn').onclick = () => {
    exitWizardUI();
};

const wizardInstructions = [
    { title: "Step 1: Bottom (Front North)", desc: "Remove the shaft and pick a 'True North' heading line on a flat table. Place the BOTTOM sole flat on the table with the Front striking face pointing NORTH.", btn: "CAPTURE BOTTOM N" },
    { title: "Step 2: Bottom (Front South)", desc: "Spin the head 180° on the exact same spot so the BOTTOM sole stays flat and the Front striking face points SOUTH (cancels table slope).", btn: "CAPTURE BOTTOM S" },
    { title: "Step 3: Top (Front North)", desc: "Flip the head upside down onto its TOP face (rest on two equal books so the sensor clears the table) with the Front striking face pointing NORTH.", btn: "CAPTURE TOP N" },
    { title: "Step 4: Top (Front South)", desc: "Spin the upside-down head 180° on the books so the Front striking face points SOUTH.", btn: "CAPTURE TOP S" },
    { title: "Step 5: Front Face", desc: "Stand the head vertically on its FRONT striking face with the Top face (shaft hole) pointing NORTH.", btn: "CAPTURE FRONT" },
    { title: "Step 6: Back Face", desc: "Flip the head onto its BACK striking face with the Top face (shaft hole) pointing SOUTH (opposite 'True North').", btn: "CAPTURE BACK" },
    { title: "Step 7: Left Side", desc: "Lay the head on its LEFT side: Front striking face pointing NORTH, and shaft hole (Top face) pointing to your LEFT (matching the 3D view).", btn: "CAPTURE LEFT" },
    { title: "Step 8: Right Side", desc: "Roll it 180° onto its RIGHT side: Front striking face pointing NORTH, and shaft hole (Top face) pointing to your RIGHT (matching the 3D view).", btn: "CAPTURE RIGHT" }
];

function updateWizardUI() {
    let config = wizardInstructions[wizardStep];
    document.getElementById('wizard-step-title').innerText = config.title;
    document.getElementById('wizard-instruction').innerText = config.desc;
    document.getElementById('wizard-progress').innerText = `Step ${wizardStep + 1} of 8`;
    let btn = document.getElementById('wizardCaptureBtn');
    btn.innerText = config.btn;
    btn.disabled = false;
}

document.getElementById('wizardCaptureBtn').onclick = () => {
    let btn = document.getElementById('wizardCaptureBtn');
    btn.innerText = "WAITING FOR SETTLE... (HANDS OFF)";
    btn.disabled = true;
    wizardBuffer = [];
    capturing = true;
};

function calculateRotationMatrix() {
    // 1. Average 0°/180° spins on Bottom and Top to cancel 100% of table pitch & roll slope,
    //    then subtract opposite faces to cancel 100% of IMU accelerometer zero-G bias on Z.
    let botAvg = new THREE.Vector3().addVectors(vectors.bottomN, vectors.bottomS).multiplyScalar(0.5);
    let topAvg = new THREE.Vector3().addVectors(vectors.topN, vectors.topS).multiplyScalar(0.5);
    let zAxis  = new THREE.Vector3().subVectors(topAvg, botAvg).normalize();

    // 2. Opposite-face pairs for X (Front/Back) and Y (Right/Left).
    //    Residual table slope lies strictly along zAxis and is eliminated by projecting perpendicular to zAxis.
    let xRaw = new THREE.Vector3().subVectors(vectors.front, vectors.back);
    xRaw.addScaledVector(zAxis, -xRaw.dot(zAxis)).normalize();

    let yRaw = new THREE.Vector3().subVectors(vectors.right, vectors.left);
    yRaw.addScaledVector(zAxis, -yRaw.dot(zAxis)).normalize();

    let handedness = new THREE.Vector3().crossVectors(xRaw, yRaw).dot(zAxis);
    if (isNaN(handedness) || handedness < 0.80 ||
        vectors.bottomN.dot(vectors.bottomS) < 0.80 ||
        vectors.topN.dot(vectors.topS) < 0.80 ||
        topAvg.clone().normalize().dot(botAvg.clone().normalize()) > -0.80 ||
        vectors.front.dot(vectors.back) > -0.80 ||
        vectors.left.dot(vectors.right) > -0.80) {
        console.error("Calibration vectors:", vectors, "handedness:", handedness);
        exitWizardUI();
        showToast("Calibration rejected: check face orientation and retry.");
        return;
    }

    // 3. Jointly average X and Y headings in the exact horizontal plane perpendicular to zAxis
    let xAxis = xRaw.clone().add(new THREE.Vector3().crossVectors(yRaw, zAxis)).normalize();
    let yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();

    let basisMat = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    hardwareMountOffset.setFromRotationMatrix(basisMat); // Do NOT invert
    saveActiveMalletCalibration(hardwareMountOffset, true);
    exitWizardUI();
    showToast("Lab Calibration Complete! Saved to Mallet & Cloud.");
}

window.addEventListener('modelLoaded', () => {
    updateMalletScale();
});

loadLocalPlayerPrefs(); let rInput = document.getElementById('radiusInput'); if(rInput && rInput.value) { setLoadedRadius(parseFloat(rInput.value)); if (loadedRadius < 50) setLoadedRadius(50); }

if (localStorage.getItem('LVE_DevHudEnabled') === 'true') toggleDeveloperHUD(true);

updateSystemGeometry(); controls.target.set(0, pivotBaseY - loadedRadius, 0); controls.update();

if(tableMesh) tableMesh.position.y = pivotBaseY - loadedRadius - 1.5;
if(headingArrow) headingArrow.position.y = pivotBaseY - loadedRadius - 1;

if (rInput) { rInput.addEventListener('change', (e) => { let newRadius = parseFloat(e.target.value); if (newRadius < 50) { newRadius = 50; e.target.value = 50; } setLoadedRadius(newRadius); updateSystemGeometry(); controls.target.set(0, pivotBaseY - loadedRadius, 0); controls.update(); rebuildArcPts(newRadius, getOptimumArcHalfAngleDeg(newRadius)); if(tableMesh) tableMesh.position.y = pivotBaseY - loadedRadius - 1.5; if(headingArrow) headingArrow.position.y = pivotBaseY - loadedRadius - 1; }); }

const scrubberInput = document.getElementById('replayScrubber');
if (scrubberInput) {
    scrubberInput.oninput = (e) => {
        if (!playbackMode || recordedFrames.length === 0) return;
        isPaused = true; document.getElementById('pauseBtn').innerText = "▶ PLAY"; playbackIndex = parseInt(e.target.value); let frame = recordedFrames[playbackIndex];
        let t0 = recordedFrames[0].time ?? 0;
        playbackElapsedMs = Math.max(0, (frame.time ?? (playbackIndex * 40)) - t0);
        lastAnimFrameTime = performance.now();
        lastRenderedTrailIdx = frame.rawPtIndex;
        masterPivot.quaternion.copy(frame.rotation); masterPivot.position.copy(frame.pivotPos); masterBlock.position.set(0, -(loadedRadius + frame.extension), 0); headJoint.quaternion.identity(); updateSmoothTrail(frame.rawPtIndex); document.getElementById('scrubberLabel').innerText = `Frame: ${playbackIndex + 1} / ${recordedFrames.length}`;
        if (window._replayTargetCast) {
            if (frame.rawPtIndex < (window._replayTargetCast.trailIndex || 0)) {
                window._replayBallLaunched = false;
                updateSystemGeometry();
                resetBallRollAnimation(true);
            } else if (!window._replayBallLaunched) {
                window._replayBallLaunched = true;
                updateSystemGeometry();
                startBallRollAnimation(window._replayTargetCast, () => playBombSound(isSlowMo));
            }
        }
    };
}

const impactInput = document.getElementById('impactInput'); if(impactInput) impactInput.addEventListener('input', (e) => { impactThreshold = parseFloat(e.target.value); });
const audioThreshInput = document.getElementById('audioThreshInput'); if(audioThreshInput) audioThreshInput.addEventListener('input', (e) => { audioThreshold = parseFloat(e.target.value); });


// --- NEW: Visualizer Visibility States ---
// --- NEW: Visualizer Visibility States ---
let visBase = true; 
let visWobble = false; 
let visTwist = false;

window.updateMeshVisibility = function() {
    const isMasterTraceOn = document.getElementById('showTraceCheck')?.checked ?? true;
    trailLine.visible = isMasterTraceOn && visBase;
    if(typeof ribbonMesh !== 'undefined') ribbonMesh.visible = isMasterTraceOn && visWobble;
    
    // Updated: Toggle the Comb Mesh
    if(typeof twistRibbonMesh !== 'undefined') twistRibbonMesh.visible = isMasterTraceOn && visTwist;
};

const showTraceCheck = document.getElementById('showTraceCheck'); 
if(showTraceCheck) showTraceCheck.addEventListener('change', (e) => { 
    window.updateMeshVisibility(); 
});
    
document.getElementById('btnUpdateFW').addEventListener('click', async () => {
    await syncConfigurationToMallet();
    showToast("Sync Complete");
});

document.getElementById('btnResetFW').addEventListener('click', async () => { 
    if(confirm("Force a hardware-level reboot?")) { 
        let success = await sendBleCommand([82]); 
        if (success) showToast("Reboot Command Sent."); 
    } 
});

document.getElementById('btnWipeData').addEventListener('click', async () => {
    if(confirm("Wipe ALL saved strikes and calibration matrix directly from the mallet memory?")) {
        let success = await sendBleCommand([87]); 
        if (success) {
            hardwareMountOffset.set(0, 0, 0, 1);
            await saveActiveMalletCalibration(hardwareMountOffset, false);
            showToast("Mallet flash memory wiped.");
        } else {
            showToast("Bluetooth Error.");
        }
    }
});

document.getElementById('endGameModeBtn').onclick = async () => {
    let success = await sendBleCommand([76]);
    if (success) {
        inGameMode = false;
        document.getElementById('game-mode-dashboard').classList.add('hidden');
        document.getElementById('ready-group').classList.remove('hidden');
        showToast("On-Course Match Ended.");
    }
};

document.getElementById('pauseBtn').onclick = () => { 
    if (!playbackMode) return; 
    // Auto-rewind if they hit play while parked at the end of the swing
    if (isPaused && playbackIndex >= recordedFrames.length - 1) {
        playbackIndex = 0;
        playbackElapsedMs = 0;
        lastRenderedTrailIdx = -1;
        setAutoSlowMo(false);
        window._replayBallLaunched = false;
        updateSystemGeometry();
        resetBallRollAnimation(!!window._replayTargetCast);
    }
    isPaused = !isPaused; 
    lastAnimFrameTime = performance.now();
    document.getElementById('pauseBtn').innerText = isPaused ? "▶ PLAY" : "⏸ PAUSE"; 
};
document.getElementById('slowMoBtn').onclick = () => { isSlowMo = !isSlowMo; document.getElementById('slowMoBtn').innerText = isSlowMo ? "🐌 SLOW: ON" : "🐌 SLOW: OFF"; };

document.getElementById('exitReplayBtn').onclick = () => {
    playbackMode = false; isPaused = false; isReviewingLog = false; document.getElementById('playback-panel').classList.add('hidden');
    setAutoSlowMo(false);
    releaseDroneCamera(true);
    resetBallRollAnimation();
    let swingStateTxt = document.getElementById('swing-state'); if(swingStateTxt) { swingStateTxt.innerText = "SWING REVIEW. DRAG CAMERA."; swingStateTxt.className = "text-warning text-center font-bold mb-4"; }
    if (recordedFrames.length > 0) updateSmoothTrail(recordedFrames[recordedFrames.length-1].rawPtIndex); 
    if (mainMalletMesh) { mainMalletMesh.visible = true; ghostMalletMesh.visible = isGhostEnabled; }
    masterPivot.quaternion.copy(finalReviewPivotQuat); masterPivot.position.copy(finalReviewPivotPos); masterBlock.position.set(0, -(loadedRadius + finalReviewExtension), 0); headJoint.quaternion.identity();
    
    // Bring the history panel back into view
    const panel = document.getElementById('history-panel');
    if (window.innerWidth <= 768) {
        panel.classList.add('mobile-open');
        document.getElementById('control-panel')?.classList.add('hidden');
    } else {
        panel.classList.remove('desktop-closed');
    }
};

window.currentReviewSwingIdx = -1;
window.currentReviewCastIdx = -1;

// Function to cleanly exit the trace review
window.stopSwingReview = function() {
    if (typeof targetEnvironmentGroup !== 'undefined') {
        if (typeof floorGrid !== 'undefined') floorGrid.visible = false;
        if (typeof targetArrow !== 'undefined') targetArrow.visible = false;
    }

    isReviewingLog = false; window.currentlyViewedCast = null;

    const togglePanel = document.getElementById('trace-toggles-panel');
    if (togglePanel) togglePanel.classList.add('hidden');

    let swingStateTxt = document.getElementById('swing-state'); if(swingStateTxt) { swingStateTxt.innerText = "SWING REVIEW. DRAG CAMERA."; swingStateTxt.className = "text-warning text-center font-bold mb-4"; }
    
    // Hide advanced meshes on STOP, show base trace of all casts
    visBase = true; visWobble = false; visTwist = false;
    let tb = document.getElementById('toggleBase'); if (tb) tb.classList.add('active');
    let tw = document.getElementById('toggleWobble'); if (tw) tw.classList.remove('active');
    let tt = document.getElementById('toggleTwist'); if (tt) tt.classList.remove('active');
    window.updateMeshVisibility();
    
    // Clear list highlight and collapse all details
    document.querySelectorAll('.active-cast-row').forEach(el => el.classList.remove('active-cast-row'));
    document.querySelectorAll('.cast-details').forEach(el => {
        el.style.display = 'none';
        el.classList.remove('flex-col');
    });
    document.querySelectorAll('.expand-icon').forEach(el => el.innerText = '▼');

    if (window.fullSwingTraceBuffer && window.fullSwingTraceBuffer.length > 0) {
        rawTracePoints.length = 0;
        rawTracePoints.push(...window.fullSwingTraceBuffer);
    }

    if (recordedFrames.length > 0) updateSmoothTrail(recordedFrames[recordedFrames.length-1].rawPtIndex); 
    else updateSmoothTrail();

    if (mainMalletMesh) { mainMalletMesh.visible = true; ghostMalletMesh.visible = isGhostEnabled; }
    clearImpactLasers();
    masterPivot.quaternion.copy(finalReviewPivotQuat); masterPivot.position.copy(finalReviewPivotPos); masterBlock.position.set(0, -(loadedRadius + finalReviewExtension), 0); headJoint.quaternion.identity();

    // Bring the history panel back into view
    const panel = document.getElementById('history-panel');
    if (window.innerWidth <= 768) {
        panel.classList.add('mobile-open');
        document.getElementById('control-panel')?.classList.add('hidden');
    } else {
        panel.classList.remove('desktop-closed');
    }

};

document.getElementById('toggleBase').onclick = (e) => { visBase = !visBase; e.currentTarget.classList.toggle('active'); window.updateMeshVisibility(); };
document.getElementById('toggleWobble').onclick = (e) => { visWobble = !visWobble; e.currentTarget.classList.toggle('active'); window.updateMeshVisibility(); };
document.getElementById('toggleTwist').onclick = (e) => { visTwist = !visTwist; e.currentTarget.classList.toggle('active'); window.updateMeshVisibility(); };

// Ensure advanced traces are hidden by default when resetting
const oldResetSystemState = resetSystemState;
resetSystemState = async (silent = false, wipeHistory = false) => {
    visBase = true; visWobble = false; visTwist = false; window.updateMeshVisibility();
    let togBase = document.getElementById('toggleBase');
    if (togBase) {
        togBase.classList.add('active');
        document.getElementById('toggleWobble').classList.remove('active');
        document.getElementById('toggleTwist').classList.remove('active');
    }
    await oldResetSystemState(silent, wipeHistory);
};

let _lastSceneAnimPerf = performance.now();

function animate() {
    requestAnimationFrame(animate); controls.update();
    let _nowScenePerf = performance.now();
    let _rawSceneDt = Math.min(0.05, Math.max(0.001, (_nowScenePerf - _lastSceneAnimPerf) / 1000.0));
    _lastSceneAnimPerf = _nowScenePerf;
    let _ballCanTick = !playbackMode || !isPaused || (recordedFrames.length > 0 && playbackIndex >= recordedFrames.length - 1);
    let _sceneSpeedMult = _ballCanTick ? ((playbackMode || autoSlowMoActive) && getEffectiveSlowMo() ? 0.25 : 1.0) : 0.0;
    if (_sceneSpeedMult > 0) {
        updateBallAndExplosionAnimation(_rawSceneDt * _sceneSpeedMult, () => setAutoSlowMo(false));
    }
    
    let metronomeCheck = document.getElementById('metronomeCheck');
    if (isAudioInitialized && metronomeCheck && metronomeCheck.checked && (appState === 3 || appState === 4)) {
        let nowAudio = audioCtx.currentTime; 
        if (nextMetronomeTime === 0) nextMetronomeTime = nowAudio + 0.1; 
        if (nowAudio >= nextMetronomeTime) { 
            playTick(900, 0.04); 
            let bpm = parseFloat(document.getElementById('metronomeBpm').value) || 60; 
            nextMetronomeTime += (60.0 / bpm); 
        }
    } else { 
        nextMetronomeTime = 0; 
    }

    let countdownEl = DisplayElements.countdown;
    if (appState === 3) {
        let remain = Math.max(0, 30.0 - (Date.now() - armedUiStartTime) / 1000.0);
        let newText = Math.ceil(remain) + "s";
        let newClass = remain <= 5.0 ? "gm-score text-danger" : "gm-score text-accent";
        if (LastRendered.countdownText !== newText) { countdownEl.innerText = newText; LastRendered.countdownText = newText; }
        if (LastRendered.countdownClass !== newClass) { countdownEl.className = newClass; LastRendered.countdownClass = newClass; }
        countdownEl.classList.remove('hidden');
    } else if (appState === 4) {
        let limit = AppConfig.practiceLimitSec; let remain = Math.max(0, limit - (Date.now() - state4UiStartTime) / 1000.0);
        let newText = Math.ceil(remain) + "s";
        let newClass = "gm-score text-danger";
        if (LastRendered.countdownText !== newText) { countdownEl.innerText = newText; LastRendered.countdownText = newText; }
        if (LastRendered.countdownClass !== newClass) { countdownEl.className = newClass; LastRendered.countdownClass = newClass; }
        countdownEl.classList.remove('hidden');
    } else { 
        countdownEl.classList.add('hidden'); 
    }

    if (isLive && !playbackMode && !isReviewingLog && (appState >= 3 || (appState === 2 && calibrationPhase === 'ORANGE')) && appState < 4.5 && (!inGameMode || window.matchAligned)) {
        let angleDiff = currentQuaternion.angleTo(targetQuaternion); let slerpSpeed = 1.0; 
        if (angleDiff < 0.02) slerpSpeed = 0.02; else if (angleDiff < 0.1) slerpSpeed = 0.15; else slerpSpeed = 0.8; 
        currentQuaternion.slerp(targetQuaternion, slerpSpeed); masterPivot.quaternion.copy(currentQuaternion); headJoint.quaternion.identity(); 
    }

    if (mainMalletMesh) {
        if (isWizardActive) {
            wizardTableGroup.visible = true;
            mainMalletMesh.visible = true;
            ghostMalletMesh.visible = false;
            virtualBall.visible = false;
            ghostRail.visible = false;
            trailLine.visible = false;

            let tx = 0, ty = 0, tz = 0;
            switch(wizardStep) {
                case 0: tx = 0; ty = Math.PI; tz = 0; break;               // Step 1: Bottom (Front North)
                case 1: tx = 0; ty = 0; tz = 0; break;                     // Step 2: Bottom (Front South)
                case 2: tx = Math.PI; ty = 0; tz = 0; break;               // Step 3: Top (Front North)
                case 3: tx = Math.PI; ty = Math.PI; tz = 0; break;         // Step 4: Top (Front South)
                case 4: tx = Math.PI / 2; ty = Math.PI; tz = 0; break;     // Step 5: Front Face (Shaft North)
                case 5: tx = -Math.PI / 2; ty = Math.PI; tz = 0; break;    // Step 6: Back Face (Shaft South)
                case 6: tx = 0; ty = Math.PI; tz = -Math.PI / 2; break;    // Step 7: Left Side (Front North)
                case 7: tx = 0; ty = Math.PI; tz = Math.PI / 2; break;     // Step 8: Right Side (Front North)
            }

            let qTarget = new THREE.Quaternion().setFromEuler(new THREE.Euler(tx, ty, tz, 'YXZ'));
            masterPivot.quaternion.slerp(qTarget, 0.1);

            let len = AppConfig.malletLengthCm;
            let wid = AppConfig.malletWidthCm;

            let yOffset = (wid / 2.0); // Default for bottom/top/left/right
            if (wizardStep === 4 || wizardStep === 5) yOffset = len / 2.0; // Front/Back face
            let tableY = pivotBaseY - loadedRadius - 1.5; 
            
            masterPivot.position.set(0, tableY + yOffset, 0); 
            masterBlock.position.set(0, 0, 0); 
        } 
        else if (inGameMode) { 
            mainMalletMesh.visible = window.matchAligned; 
            ghostMalletMesh.visible = window.matchAligned && isGhostEnabled; 
        }
        else if (appState === 6) { mainMalletMesh.visible = true; ghostMalletMesh.visible = isGhostEnabled; }
        else if (isReviewingLog) { mainMalletMesh.visible = true; ghostMalletMesh.visible = isGhostEnabled; } 
        else if (appState === 4.5) {
            let t = (Date.now() - rewindStartTime) / 500.0; if (t >= 1.0) { t = 1.0; appState = 5; }
            masterPivot.quaternion.copy(rewindStartQuat).slerp(finalReviewPivotQuat, t); masterPivot.position.lerpVectors(rewindStartPos, finalReviewPivotPos, t);
            let smoothExt = rewindStartExt + (finalReviewExtension - rewindStartExt) * t; masterBlock.position.set(0, -(loadedRadius + smoothExt), 0);
            headJoint.quaternion.identity(); mainMalletMesh.visible = true; ghostMalletMesh.visible = isGhostEnabled;
            if (isGhostEnabled) positionGhostReferenceBehindBall(smoothExt, getDynamicFaceZ());
            else resetGhostHeadToPivot();
        }
        else if (appState === 5 && !playbackMode) {
            masterPivot.quaternion.copy(finalReviewPivotQuat); masterPivot.position.copy(finalReviewPivotPos); masterBlock.position.set(0, -(loadedRadius + finalReviewExtension), 0);
            headJoint.quaternion.identity(); mainMalletMesh.visible = true; ghostMalletMesh.visible = isGhostEnabled;
            if (isGhostEnabled) positionGhostReferenceBehindBall(finalReviewExtension, getDynamicFaceZ());
            else resetGhostHeadToPivot();
            if (typeof targetEnvironmentGroup !== 'undefined') {
                targetEnvironmentGroup.position.set(0, pivotBaseY, 0);
                targetEnvironmentGroup.quaternion.identity();
            }
        }
        else if (playbackMode) {
            if (isPaused && recordedFrames.length > 0 && playbackIndex >= recordedFrames.length - 1 && isGhostEnabled) {
                positionGhostReferenceBehindBall(finalReviewExtension, getDynamicFaceZ());
            } else {
                resetGhostHeadToPivot();
            }
            mainMalletMesh.visible = true;
            ghostMalletMesh.visible = isGhostEnabled;
        }
        else {
            if (appState === 3 && !hasLiftedOff && isGhostEnabled) {
                positionGhostReferenceBehindBall(0, getDynamicFaceZ());
            } else {
                resetGhostHeadToPivot();
            }
            mainMalletMesh.visible = (appState !== 0);
            ghostMalletMesh.visible = (isGhostEnabled && appState !== 0 && appState >= 3);
        }
    }

    if (playbackMode && !isPaused && recordedFrames.length > 0) {
        let nowPerf = performance.now();
        let dtMs = lastAnimFrameTime > 0 ? Math.min(nowPerf - lastAnimFrameTime, 100) : 16.67;
        lastAnimFrameTime = nowPerf;

        let tStart = recordedFrames[0].time ?? 0;
        let tEnd = recordedFrames[recordedFrames.length - 1].time ?? ((recordedFrames.length - 1) * 40);
        let totalDurationMs = Math.max(40, tEnd - tStart);
        let speedMult = isSlowMo ? 0.25 : 1.0;

        playbackElapsedMs = Math.min(totalDurationMs, playbackElapsedMs + (dtMs * speedMult));
        let targetTime = tStart + playbackElapsedMs;

        while (playbackIndex < recordedFrames.length - 2 && (recordedFrames[playbackIndex + 1].time ?? ((playbackIndex + 1) * 40)) <= targetTime) {
            playbackIndex++;
        }

        let f1 = recordedFrames[playbackIndex];
        let f2 = recordedFrames[Math.min(recordedFrames.length - 1, playbackIndex + 1)];
        let t1 = f1.time ?? (playbackIndex * 40);
        let t2 = f2.time ?? ((playbackIndex + 1) * 40);
        let alpha = (t2 > t1) ? Math.max(0, Math.min(1, (targetTime - t1) / (t2 - t1))) : 0;

        masterPivot.quaternion.copy(f1.rotation).slerp(f2.rotation, alpha);
        masterPivot.position.lerpVectors(f1.pivotPos, f2.pivotPos, alpha);
        let interpExt = (f1.extension || 0) + ((f2.extension || 0) - (f1.extension || 0)) * alpha;
        masterBlock.position.set(0, -(loadedRadius + interpExt), 0);
        headJoint.quaternion.identity();

        if (f1.rawPtIndex !== lastRenderedTrailIdx) {
            lastRenderedTrailIdx = f1.rawPtIndex;
            updateSmoothTrail(f1.rawPtIndex);
        }
        if (window._replayTargetCast && !autoSlowMoActive && rawTracePoints.length > 0) {
            let strikeIdx = window._replayTargetCast.trailIndex || 0;
            let curPt = rawTracePoints[Math.min(f1.rawPtIndex, rawTracePoints.length - 1)];
            let strikePt = rawTracePoints[Math.min(strikeIdx, rawTracePoints.length - 1)];
            if (curPt && strikePt && f1.rawPtIndex <= strikeIdx) {
                let pathDistCm = curPt.pos.distanceTo(strikePt.pos);
                if (pathDistCm <= 50.0) {
                    setAutoSlowMo(true);
                }
            }
        }
        if (window._replayTargetCast && !window._replayBallLaunched && f1.rawPtIndex >= (window._replayTargetCast.trailIndex || 0)) {
            setAutoSlowMo(true);
            window._replayBallLaunched = true;
            updateSystemGeometry();
            startBallRollAnimation(window._replayTargetCast, () => playBombSound(getEffectiveSlowMo()));
        }
        if (scrubberInput) scrubberInput.value = playbackIndex;
        if (scrubberLabelEl) scrubberLabelEl.innerText = `Frame: ${playbackIndex + 1} / ${recordedFrames.length}`;

        if (playbackElapsedMs >= totalDurationMs) {
            playbackIndex = recordedFrames.length - 1;
            isPaused = true;
            document.getElementById('pauseBtn').innerText = "▶ PLAY";
            updateSmoothTrail();
            masterPivot.quaternion.copy(finalReviewPivotQuat);
            masterPivot.position.copy(finalReviewPivotPos);
            masterBlock.position.set(0, -(loadedRadius + finalReviewExtension), 0);
        }
    }

    if (!isWizardActive) {
        let canShowGuides = inGameMode ? window.matchAligned : (appState >= 3 || isReviewingLog || playbackMode);
        if (typeof ghostRail !== 'undefined') ghostRail.visible = canShowGuides && !!document.getElementById('optimumArcToggle')?.checked;
        if (typeof floorGrid !== 'undefined') floorGrid.visible = canShowGuides && !!document.getElementById('floorGridToggle')?.checked;
        if (typeof verticalGrid !== 'undefined') verticalGrid.visible = canShowGuides && !!document.getElementById('verticalGridToggle')?.checked;
    }

    // --- FORCE HANDLES TO SYNC WITH MALLET VISIBILITY (SHORT STUB IN WIZARD) ---
    if (handleMesh) {
        handleMesh.visible = mainMalletMesh.visible;
        handleMesh.scale.y = isWizardActive ? 0.25 : 1.0;
    }
    if (ghostHandleMesh) ghostHandleMesh.visible = ghostMalletMesh.visible && !isWizardActive;
    renderer.render(scene, camera);
}


animate();

function renderLiveCasts() {
    let liveList = document.getElementById('live-tracking-list'); if (!liveList) return; liveList.innerHTML = '';
    
    // 1. Generate the HTML using the clean utility
    castData.forEach((c, i) => {
        liveList.innerHTML += buildCastRowHTML(c, i, swingCount - 1, false);
    });

    // 2. Attach click listeners to the live rows so they expand when tapped!
    let liveRows = liveList.querySelectorAll('.highlight-pass-btn');
    liveRows.forEach(row => {
        row.onclick = () => {
            let swingIdx = parseInt(row.getAttribute('data-swing-index'), 10);
            let castIdx = parseInt(row.getAttribute('data-cast-index'), 10);
            if (!isNaN(swingIdx) && !isNaN(castIdx)) {
                highlightPass(swingIdx, castIdx);
            }
        };
    });
}

function triggerReplay(index) {
    if (!swingDatabase[index]) return;
    let data = swingDatabase[index]; recordedFrames = data.frames; finalReviewPivotQuat.copy(data.finalReviewPivotQuat); finalReviewPivotPos.copy(data.finalReviewPivotPos); finalReviewExtension = data.finalReviewExtension;
    rawTracePoints.length = 0; 
    rawTracePoints.push(...data.rawTracePoints); 
    updateSmoothTrail();
    playbackMode = true; isPaused = false; setAutoSlowMo(false); playbackIndex = 0; playbackElapsedMs = 0; lastAnimFrameTime = performance.now(); lastRenderedTrailIdx = -1; isReviewingLog = true; ghostMalletMesh.visible = isGhostEnabled; lastPlaybackTime = Date.now();    
    if (isBallEnabled) { 
        ghostPivot.quaternion.copy(data.setupQuat || new THREE.Quaternion());
        updateSystemGeometry(); 
        virtualBall.visible = true; 
    }
    
    if (scrubberInput) {
        scrubberInput.min = 0;
        scrubberInput.max = Math.max(0, recordedFrames.length - 1);
        scrubberInput.value = 0;
    }
    if (scrubberLabelEl) scrubberLabelEl.innerText = `Frame: ${playbackIndex + 1} / ${recordedFrames.length}`;

    window._replayTargetCast = null;
    window._replayBallLaunched = false;
    if (data.casts && data.casts.length > 0) {
        let targetCast = data.casts.find(c => c.isStrike) || data.casts[data.casts.length - 1];
        window._replayTargetCast = (targetCast && !targetCast.isWhiff) ? targetCast : null;
        drawStrikeLaser(targetCast);
        resetBallRollAnimation(!!window._replayTargetCast);
    } else { clearImpactLasers(); }
    document.getElementById('pauseBtn').innerText = "⏸ PAUSE"; let swingStateTxt = document.getElementById('swing-state'); if(swingStateTxt) { swingStateTxt.innerText = `REPLAYING SWING #${index + 1}...`; swingStateTxt.className = "text-accent text-center font-bold mb-4"; }
    document.getElementById('playback-panel').classList.remove('hidden');
    
    // --- 1. FORCE ADVANCED RIBBONS OFF ---
    visWobble = false; 
    visTwist = false;
    window.updateMeshVisibility();
    document.getElementById('toggleWobble')?.classList.remove('active');
    document.getElementById('toggleTwist')?.classList.remove('active');

    // --- 2. HIDE HISTORY PANEL FOR CLEAN VIEW ---
    const panel = document.getElementById('history-panel');
    if (window.innerWidth <= 768) {
        panel.classList.remove('mobile-open');
        document.getElementById('control-panel')?.classList.remove('hidden'); 
    } else {
        panel.classList.add('desktop-closed');
    }
}

function highlightPass(swingIdx, castIdx) {
    if (!swingDatabase[swingIdx]) return; 
    let swing = swingDatabase[swingIdx]; 
    let cast = swing.casts[castIdx];
    
    window.currentlyViewedCast = cast;
    window.currentReviewSwingIdx = swingIdx;
    window.currentReviewCastIdx = castIdx;
    
    playbackMode = false; isPaused = false; isReviewingLog = true; 
    let pbPanel = document.getElementById('playback-panel');
    if (pbPanel) pbPanel.classList.add('hidden');
    
    // Collapse any old details just in case, and remove highlight from all rows
    document.querySelectorAll('.active-cast-row').forEach(el => el.classList.remove('active-cast-row'));
    document.querySelectorAll('.cast-details').forEach(el => {
        el.style.display = 'none';
        el.classList.remove('flex-col');
    });
    // Hide the arrow icons completely so it just looks like a clickable button
    document.querySelectorAll('.expand-icon').forEach(el => el.style.display = 'none');
    
    // Highlight the clicked row, but DO NOT expand it
    let activeRow = document.querySelector(`.cast-row[data-swing-index="${swingIdx}"][data-cast-index="${castIdx}"]`);
    if (activeRow) {
        activeRow.classList.add('active-cast-row');
        
        // NEW: Update the header block dynamically for this specific cast
        let headerDiv = document.getElementById(`swing-header-${swingIdx}`);
        if (headerDiv) {
            let fmtSignedDeg = (v) => {
                if (v === undefined || v === null || isNaN(v)) return `N/A`;
                let clean = Math.abs(v) < 0.05 ? 0 : v;
                return `${clean > 0 ? '+' : ''}${clean.toFixed(1)}°`;
            };
            let fmtSignedPct = (v) => {
                if (v === undefined || v === null || isNaN(v)) return `N/A`;
                let rounded = Math.round(v);
                return `${rounded > 0 ? '+' : ''}${rounded}%`;
            };

            let leanStr = cast.lean !== undefined ? `${cast.lean.toFixed(1)}° ${cast.leanDir}`.trim() : `N/A`;
            let faceDeg = cast.planeTwist !== undefined ? cast.planeTwist : cast.faceAngle;
            let faceAngleStr = fmtSignedDeg(faceDeg);
            let pathDeg = (cast.pathAngleRads || 0) * (180.0 / Math.PI);
            let hitMissStr = formatTargetHitMissHTML(cast);
            let pathTwistStr = faceDeg !== undefined && faceDeg !== null ? fmtSignedDeg(faceDeg - pathDeg) : `N/A`;
            let devSigmaStr = (!cast.isWhiff && cast.trueLaunchDeg !== undefined && cast.trueLaunchDeg !== null)
                ? fmtSignedDeg(cast.trueLaunchDeg)
                : (cast.isWhiff ? `Mishit` : `N/A`);

            let locStr = cast.isStrike ? 
                (cast.dev < 0.2 ? `Center` : `${(cast.dev * 10).toFixed(0)}mm ${cast.dir}`) : 
                (cast.isWhiff ? `${cast.dev.toFixed(1)}cm M` : `${cast.dev.toFixed(1)}cm ${cast.dir}`);
            let velStr = cast.passSpeed ? `${(cast.passSpeed * 3.6).toFixed(1)} kph` : `--`;
            let strikeForceStr = cast.isStrike ? `${(calculateImpactForce(cast.passSpeed || 0, AppConfig.massKg) / 1000).toFixed(2)} kN` : `N/A`;
            let accelVal = cast.isStrike
                ? ((cast.decelFactor !== undefined && cast.decelFactor !== null) ? cast.decelFactor : null)
                : ((cast.decelFactor !== undefined && cast.decelFactor !== null)
                    ? cast.decelFactor
                    : computeFallbackPreImpactAccelPct(cast.trailIndex, swing.rawTracePoints));
            let accelStr = fmtSignedPct(accelVal);
            
            let pDeltaStr = cast.pDelta !== null && cast.pDelta !== undefined ? formatOffset(cast.pDelta) : `N/A`;
            let tempoStr = cast.tempo > 0 ? `${Math.round(cast.tempo)} BPM` : `--`;
            let deflStr = (cast.isStrike && cast.deflectionDeg !== undefined && cast.deflectionDeg !== null) ? fmtSignedDeg(cast.deflectionDeg) : `N/A`;
            let hasAoa = cast.aoaDeg !== undefined && cast.aoaDeg !== null;
            let cAoa = hasAoa ? cast.aoaDeg : 0;
            let cAoaDir = Math.abs(cAoa) < 0.2 ? 'Level' : (cAoa > 0 ? 'Up' : 'Dn');
            let aoaStr = hasAoa ? `${Math.abs(cAoa).toFixed(1)}° ${cAoaDir}` : `N/A`;
            let arcVal = cast.backArcLength ?? cast.backArc ?? cast.backLength;
            let backArcStr = (arcVal !== undefined && arcVal !== null) ? `${Math.round(arcVal)} cm` : `--`;
            let backLiftStr = (cast.backHeight !== undefined && cast.backHeight !== null) ? `${Math.round(cast.backHeight)} cm` : `--`;

            let targetLabelStr = getTargetDistanceLabel(cast);
            let proBadge = `<span class="text-accent">PRO</span>`;
            let dispFace     = AppConfig.isSubscribed ? faceAngleStr  : proBadge;
            let dispDevSigma = AppConfig.isSubscribed ? devSigmaStr   : proBadge;
            let dispTwist    = AppConfig.isSubscribed ? pathTwistStr  : proBadge;
            let dispAoa      = AppConfig.isSubscribed ? aoaStr        : proBadge;
            let dispLean     = AppConfig.isSubscribed ? leanStr       : proBadge;
            let dispDefl     = AppConfig.isSubscribed ? deflStr       : proBadge;
            let dispAccel    = AppConfig.isSubscribed ? accelStr      : proBadge;
            let dispPDel     = AppConfig.isSubscribed ? pDeltaStr     : proBadge;
            let dispTempo    = AppConfig.isSubscribed ? tempoStr      : proBadge;

            let wasOpen = headerDiv.querySelector('details.more-metrics')?.open ? 'open' : '';
            let faultBanner = (cast.isStrike && cast.faultDetected)
                ? `<div class="text-danger font-bold text-center mb-2" style="font-size: 0.78rem;">⚠️</div>`
                : ``;

            headerDiv.innerHTML = `
                ${faultBanner}
                <div class="card-basic-stats" style="margin-bottom: 4px;">
                    <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Mallet head speed through the bottom of the swing (kph).">Speed</span><span class="stat-val">${velStr}</span></div>
                    <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Projected lateral miss or hit at the target distance (cm Left/Right of target center).">${targetLabelStr}</span><span class="stat-val">${hitMissStr}</span></div>
                    <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Strike location on the mallet face relative to center (mm Left/Right).">Impact</span><span class="adv-val text-warning">${locStr}</span></div>
                </div>
                <details class="more-metrics" ${wasOpen}>
                    <summary>More</summary>
                    <div class="card-basic-stats">
                        <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Angle of the mallet face relative to the target line at impact (+ Left / - Right).">Face Angle</span><span class="stat-val">${dispFace}</span></div>
                        <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Total horizontal ball launch angle (σ) off the target line, combining face angle, swing path, and collision deflection.">Deviation (σ)</span><span class="stat-val">${dispDevSigma}</span></div>
                        <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Angle of the mallet face relative to the swing path (+ Left / - Right).">Twist</span><span class="stat-val">${dispTwist}</span></div><div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Vertical angle of attack of the mallet head into the ball (+ Up / - Down).">Strike Angle</span><span class="stat-val text-accent">${dispAoa}</span></div>
                        <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Sideways tilt (roll) of the mallet head at impact (Left / Right).">Lean Angle</span><span class="stat-val text-warning">${dispLean}</span></div>
                        <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Degrees the mallet face twisted left (+) or right (-) during ball contact.">Deflection</span><span class="stat-val text-warning">${dispDefl}</span></div>
                        <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Average impact force transferred to the ball during collision (kilonewtons).">Strike Force</span><span class="stat-val">${strikeForceStr}</span></div>
                        <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Change in mallet head speed entering impact (+ accelerating through the ball / - decelerating).">Accel</span><span class="stat-val">${dispAccel}</span></div>
                        <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Overall cadence of the full swing cycle in beats per minute (BPM).">Tempo</span><span class="stat-val">${dispTempo}</span></div>
                        <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Distance the mallet travels along the swing arc during the backswing (cm).">Backswing Arc</span><span class="stat-val">${backArcStr}</span></div>
                        <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Maximum vertical height the mallet face lifts above the lawn in the backswing (cm).">Backswing Lift</span><span class="stat-val">${backLiftStr}</span></div>
                        <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Difference between your swing period and an ideal gravity pendulum of your handle length (cm).">Swing PΔ</span><span class="stat-val">${dispPDel}</span></div>
                    </div>
                </details>
            `;
        }
    }
    
    window.fullSwingTraceBuffer = swing.rawTracePoints || [];
    rawTracePoints.length = 0;

    if (swing.rawTracePoints && swing.rawTracePoints.length > 0) {
        let centerFrame = Math.min(Math.max(0, cast.trailIndex || 0), swing.rawTracePoints.length - 1);
        let ghostInvQuat = ghostPivot.quaternion.clone().invert();
        const getSwingAngleDeg = (pt) => {
            let localShaft = new THREE.Vector3(0, -1, 0)
                .applyQuaternion(pt.rot)
                .applyQuaternion(ghostInvQuat);
            return THREE.MathUtils.radToDeg(Math.atan2(localShaft.z, -localShaft.y));
        };
        
        // 1. SMART SCAN BACKWARD: Require sustained (>3 deg) forward arc before cutting prior waggle
        let startFrame = centerFrame;
        let inBackswing = false;
        let fwdRunCount = 0;
        let fwdRunEndIdx = -1;
        let fwdRunEndAngle = 0;
        for (let i = centerFrame; i >= 0; i--) {
            let pt = swing.rawTracePoints[i];
            if (!pt) continue;
            startFrame = i;
            let angleDeg = getSwingAngleDeg(pt);
            if (!pt.isForward) {
                if (angleDeg < -2.0) inBackswing = true;
                fwdRunCount = 0;
            } else if (inBackswing) {
                if (fwdRunCount === 0) {
                    fwdRunEndIdx = i;
                    fwdRunEndAngle = angleDeg;
                }
                fwdRunCount++;
                let forwardArcSpan = fwdRunEndAngle - angleDeg;
                if (fwdRunCount >= 3 && forwardArcSpan > 3.0) {
                    startFrame = fwdRunEndIdx + 1;
                    break;
                }
            }
        }
        
        // 2. SMART SCAN FORWARD: Require sustained (>3 deg) backward drop before cropping follow-through
        let endFrame = centerFrame;
        let backRunCount = 0;
        let backRunStartIdx = -1;
        let backRunStartAngle = 0;
        for (let i = centerFrame; i < swing.rawTracePoints.length; i++) {
            let pt = swing.rawTracePoints[i];
            if (!pt) continue;
            endFrame = i;
            if (i > centerFrame + 4 && !pt.isForward) {
                let angleDeg = getSwingAngleDeg(pt);
                if (backRunCount === 0) {
                    backRunStartIdx = i;
                    backRunStartAngle = angleDeg;
                }
                backRunCount++;
                let dropDeg = backRunStartAngle - angleDeg;
                if (backRunCount >= 3 && dropDeg > 3.0) {
                    endFrame = Math.max(centerFrame, backRunStartIdx - 1);
                    break;
                }
            } else {
                backRunCount = 0;
            }
        }
        
        // 3. DRAW THE PERFECTLY CROPPED SWING
        rawTracePoints.push(...swing.rawTracePoints.slice(startFrame, endFrame + 1));
    }
    updateSmoothTrail();
    
    masterPivot.quaternion.copy(cast.pivotQuat); masterPivot.position.copy(cast.pivotPos); masterBlock.position.set(0, -(loadedRadius + cast.extension), 0);
    headJoint.quaternion.identity(); ghostMalletMesh.visible = isGhostEnabled; if (mainMalletMesh) mainMalletMesh.visible = true; drawStrikeLaser(cast);
    if (isGhostEnabled) positionGhostReferenceBehindBall(cast.extension || 0, getDynamicFaceZ());
    else resetGhostHeadToPivot();
    
    let swingStateTxt = document.getElementById('swing-state'); 
    if (swingStateTxt) { 
        swingStateTxt.innerText = `VIEWING PASS #${castIdx + 1}. DRAG CAMERA.`; 
        swingStateTxt.className = "text-warning text-center font-bold mb-4"; 
    }
}

document.getElementById('cancelArmBtn').onclick = () => resetSystemState(false, false);
document.getElementById('resetMaxBtn').onclick = async () => await resetSystemState(false, true);

// AI Coach Button Logic
document.getElementById('askAiCoachBtn').onclick = async () => {
    // 1. Ensure we have data to analyze
    if (!castData || castData.length === 0) {
        showToast("No swings recorded yet. Take a few swings first!");
        return;
    }

    // 2. Open the modal in a loading state
    const modal = document.getElementById('ai-coach-modal');
    const content = document.getElementById('ai-coach-content');
    content.innerHTML = '<div class="text-center p-5 text-accent font-bold syncing">🤖 Analyzing swing kinematics...</div>';
    modal.showModal();

    // 3. Grab the current target distance from the settings
    let targetDist = inGameMode ? 
        (parseFloat(document.getElementById('matchDistSetup').value) || 10.0) : 
        (parseFloat(document.getElementById('trainerDistSetup').value) || 10.0);

    // 4. Send the recent cast array & croquet context to the Gemini Edge Function
    const coachContext = {
        lawnSpeedPlummers: AppConfig.lawnSpeed,
        malletMassG: Math.round(AppConfig.massKg * 1000),
        handleLengthCm: AppConfig.handleLengthCm,
        sweetSpotCm: AppConfig.sweetSpot,
        twistToleranceDeg: parseFloat(document.getElementById('twistToleranceInput')?.value) || 1.0,
        skillTier: document.getElementById('difficultySelect')?.value || 'intermediate'
    };
    const advice = await getAiCoachFeedback(castData, targetDist, coachContext);

    // 5. Display the result
    content.innerHTML = `<div class="p-2" style="line-height: 1.6; font-size: 0.95rem; white-space: pre-wrap;">${advice}</div>`;
};

// Close AI Coach Modal
document.getElementById('closeAiCoachBtn').onclick = () => {
    document.getElementById('ai-coach-modal').close();
};

function handleHistoricalStrike(s) {
    downloadedHistory.push({ 
        matchID: s.matchID, 
        secondsIntoMatch: s.secondsIntoMatch, 
        exactTime: new Date((s.matchID + s.secondsIntoMatch) * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), 
        peakG: s.peakG, peakTwist: s.peakTwist, dwell: s.dwell, zVel: s.zVel, dynRadius: s.dynRadius, 
        q0: s.q0, q1: s.q1, q2: s.q2, q3: s.q3, timestamp: s.timestamp,
        downwardSwingTime: s.downwardSwingTime, decelFactor: s.decelFactor
    }); 
}

function handleLiveStrike(s) {
    let rawDwell = (s.dwell !== undefined && s.dwell !== null && s.dwell > 0) ? s.dwell : calculateTrueDwell(s.zVel, s.peakG, AppConfig.massKg);
    
    // PHYSICS FIX: Sensor clipping on hard strikes artificially inflates the math.
    // We cap it dynamically: faster swings create harder compression and shorter dwell times.
    if (rawDwell > 3.0) {
        rawDwell = Math.max(1.2, 2.5 - (s.zVel * 0.15));
    }
    
    s.dwell = parseFloat(rawDwell.toFixed(2)); 

    currentSwingMaxG = s.peakG; maxTwist = s.peakTwist; currentSwingDwell = s.dwell;
    let pristineVel = s.zVel; let dynRadiusM = s.dynRadius;
    let downTime = s.downwardSwingTime; let decelFact = s.decelFactor;
    
    if (inGameMode) {
        gmStrokeCount++; document.getElementById('gm-stroke-count').innerText = gmStrokeCount;
        let estDist = calculateEstimatedDistance(pristineVel, AppConfig.massKg, AppConfig.lawnSpeed);
        let twistStr = (s.faceAngle > 0 ? '+' : '') + (s.faceAngle || 0).toFixed(1) + '°';
        let faultBadge = s.faultDetected ? `<div class="text-danger font-800 mt-2">⚠️</div>` : ``;
        document.getElementById('gm-latest-stats').innerHTML = `<div class="text-muted mb-2 uppercase" style="font-size:0.85rem;">LATEST STRIKE</div><div>Speed: <span class="text-main font-800">${(pristineVel * 3.6).toFixed(1)}</span> kph</div><div>Face: <span class="text-warning font-800">${twistStr}</span></div><div>Est Dist: <span class="text-accent font-800">${estDist.toFixed(0)}</span> m</div>${faultBadge}<div class="mt-2 text-muted" style="font-size:0.75rem;">Quickly twist clockwise to arm next shot.</div>`;
        return; 
    }

    let iQuat = mapFirmwareQuatToThree(s.q0, s.q1, s.q2, s.q3);
    window.pristineImpactQuat_m8 = iQuat.clone();

    let locTwist = getShaftTwist(iQuat);
    window.pristinePathAngleRads = THREE.MathUtils.degToRad(s.pathAngle || 0);
    window.pristineAoARads = THREE.MathUtils.degToRad(s.aoaAngle || 0);
    currentSwingAoA = s.aoaAngle || 0;
    
    window.lastEdgeData = { zVel: pristineVel, dynRadius: dynRadiusM, downwardSwingTime: downTime, decelFactor: decelFact, impactTwist: locTwist, backArc: s.backArc, backswingTime: s.backswingTime, hwPathDeg: s.pathAngle, hwAoaDeg: s.aoaAngle, faultDetected: !!s.faultDetected };
    window.pristineImpactQuat = iQuat;

    // If the face already crossed dynamicFaceZ just before impact, upgrade that cast in-place
    let recentCast = castData.length > 0 ? castData[castData.length - 1] : null;
    if (recentCast && !recentCast.isStrike && Math.abs(globalHwTime - recentCast.time) < 250) {
        recentCast.isStrike = true;
        recentCast.faceAngle = locTwist;
        recentCast.planeTwist = locTwist;
        recentCast.impactTwist = locTwist;
        recentCast.passSpeed = pristineVel;
        recentCast.dynRadius = dynRadiusM;
        if (dynRadiusM && dynRadiusM > 0.1) {
            recentCast.extension = Math.max(-40.0, Math.min(40.0, (dynRadiusM * 100.0) - loadedRadius));
        }
        recentCast.decelFactor = decelFact;
        recentCast.aoaDeg = s.aoaAngle || 0;
        recentCast.backArc = s.backArc;
        recentCast.backswingTime = s.backswingTime;
        recentCast.faultDetected = !!s.faultDetected;

        let lawnMult = 0.50 + (AppConfig.lawnSpeed - 10) * 0.075;
        let ballSpeedMPS = pristineVel * (AppConfig.massKg * 1.8) / (AppConfig.massKg + 0.454);
        recentCast.estDist = (ballSpeedMPS * ballSpeedMPS) * lawnMult;
        currentSwingDist = recentCast.estDist;

        let rawMm = calculateOffCenterImpact(Math.abs(maxTwist), pristineVel);
        recentCast.offCenterMm = Math.abs(rawMm);
        recentCast.offCenterLabel = "Center";
        if (recentCast.offCenterMm >= 2.0) {
            recentCast.offCenterLabel = maxTwist > 0 ? "R" : "L";
        }
        let liveTargetX_cm = recentCast.offCenterLabel === 'Center'
            ? 0
            : (recentCast.offCenterLabel === 'L' ? -(recentCast.offCenterMm / 10.0) : (recentCast.offCenterMm / 10.0));
        recentCast.rawDev = liveTargetX_cm;
        recentCast.dev = Math.abs(liveTargetX_cm);
        recentCast.dir = liveTargetX_cm > 0.1 ? 'R' : (liveTargetX_cm < -0.1 ? 'L' : 'C');
        recentCast.pathAngleRads = window.pristinePathAngleRads;
        let accData = calcAccuracyData(liveTargetX_cm, locTwist, window.pristinePathAngleRads, maxTwist, currentSwingDwell);
        accData.isWhiff = false;
        let passRating = getStarRating(liveTargetX_cm, accData.trueLaunchDeg, true);

        recentCast.deflectionDeg = accData.collisionDeflection;
        recentCast.trueLaunchDeg = accData.trueLaunchDeg;
        recentCast.trueLaunchRads = accData.trueLaunchRads;
        recentCast.estAccRange = accData.estAccRange;
        recentCast.trueAccRange = accData.trueAccRange;
        recentCast.isWhiff = false;
        recentCast.stars = passRating.string;
        recentCast.starColor = passRating.color;

        let currentTwistTol = parseFloat(document.getElementById('twistToleranceInput').value) || 1.0;
        let targetDist = inGameMode ? (parseFloat(document.getElementById('matchDistSetup').value) || 10.0) : (parseFloat(document.getElementById('trainerDistSetup').value) || 5.0);
        recentCast.targetDistM = targetDist;
recentCast.isHit = (Math.abs(liveTargetX_cm) <= AppConfig.sweetSpot) && (Math.abs(accData.trueLaunchDeg) <= currentTwistTol) && (recentCast.estDist >= targetDist);

        window.strikeCastGenerated = true;
        window.pendingStrikePacket = null;
        if (!isDynamicCalibrationActive && !inGameMode) renderLiveCasts();

        // If swing already finalized before this StrikePacket arrived, re-anchor trace & update cloud
        if (appState === 4.5 || appState === 5) {
            let t0Euler = new THREE.Euler().setFromQuaternion(iQuat, 'YXZ');
            let strikePoseEuler = new THREE.Euler().setFromQuaternion(recentCast.pivotQuat, 'YXZ');
            strikePoseEuler.y = t0Euler.y;
            strikePoseEuler.z = t0Euler.z;
            strikePoseEuler.x = -THREE.MathUtils.degToRad(recentCast.aoaDeg);
            recentCast.pivotQuat.setFromEuler(strikePoseEuler, 'YXZ');

            solveStrikeAnchoredPose(recentCast);
            let doneIdx = window.lastCompletedSwingIdx;
            let activeCasts = (doneIdx !== null && doneIdx !== undefined && swingDatabase[doneIdx])
                ? swingDatabase[doneIdx].casts
                : castData;
            smoothImpactTraceJoin(recentCast.trailIndex, recentCast.pivotQuat, recentCast.extension, recentCast.pivotPos, activeCasts);
            finalReviewPivotQuat.copy(recentCast.pivotQuat);
            finalReviewPivotPos.copy(recentCast.pivotPos);
            drawStrikeLaser(recentCast);
            updateSmoothTrail();

            if (doneIdx !== null && doneIdx !== undefined && swingDatabase[doneIdx]) {
                swingDatabase[doneIdx].rawTracePoints = [...rawTracePoints];
                swingDatabase[doneIdx].frames = [...recordedFrames];
                swingDatabase[doneIdx].finalReviewPivotQuat.copy(recentCast.pivotQuat);
                swingDatabase[doneIdx].finalReviewPivotPos.copy(recentCast.pivotPos);
                let castIdx = swingDatabase[doneIdx].casts.indexOf(recentCast);
                if (castIdx >= 0 && swingDatabase[doneIdx].cloudSwingId) {
                    updatePracticeStrikeInCloud(swingDatabase[doneIdx].cloudSwingId, castIdx, recentCast, lastComputedTempo, {
                        massKg: AppConfig.massKg,
                        lawnSpeed: AppConfig.lawnSpeed,
                        sweetSpotCm: AppConfig.sweetSpot,
                        twistToleranceDeg: currentTwistTol,
                        targetDistM: targetDist,
                        peakG: currentSwingMaxG,
                        peakTwistDps: maxTwist,
                        dwellMs: currentSwingDwell,
                        downwardSwingTimeMs: downTime || null,
                        backswingTimeMs: s.backswingTime || null
                    });
                }
                let castContainer = document.getElementById(`cast-container-${doneIdx}`);
                if (castContainer && castIdx >= 0) {
                    castContainer.innerHTML = swingDatabase[doneIdx].casts
                        .map((c, idx) => buildCastRowHTML(c, idx, doneIdx, false))
                        .join('');
                    highlightPass(doneIdx, castIdx);
                }
            }
        }
    } else {
        window.pendingStrikePacket = {
            zVel: pristineVel, dynRadius: dynRadiusM, decelFactor: decelFact, locTwist: locTwist, backArc: s.backArc, backswingTime: s.backswingTime,
            downTime: downTime, faultDetected: !!s.faultDetected
        };
    }

    let swingStateTxt = document.getElementById('swing-state');
    if (swingStateTxt) {
        swingStateTxt.innerHTML = "STRIKE PACKET RECEIVED <span style='color: var(--success); font-weight: 900;'>(WAITING FOR TELEMETRY...)</span>";
        swingStateTxt.className = "text-center font-bold mb-4";
    }

    if (appState === 4 || appState === 3 || (inGameMode && window.matchSwinging)) { 
        impactDetected = true; 
        window.impactHwTime = globalHwTime;
        window.followThroughComplete = false;
        window.peakFollowThroughTheta = -Infinity;
        window.peakFollowThroughIdx = -1;
        window.followThroughLastMoveTime = globalHwTime;
        clearTimeout(goTimeout); 
        clearTimeout(window.finalizeTimerId);
        let configuredMs = Math.round((parseFloat(document.getElementById('durationInput')?.value) || 1.0) * 1000);
        let maxFollowThruMs = Math.max(2500, configuredMs * 2);
        window.finalizeTimerId = setTimeout(() => { finalizeSwingData(globalHwTime); }, maxFollowThruMs); 
    }
}

function handleParsedTelemetry(t) {
    const hwTimestamp = t.hwTimestamp; globalHwTime = hwTimestamp; let jsNow = Date.now();
    
    prevRawBLEQuat.copy(currentRawBLEQuat);
    currentRawBLEQuat.set(t.q1, t.q2, t.q3, t.q0);
    lastRawQuat = mapFirmwareQuatToThree(t.q0, t.q1, t.q2, t.q3);

    prevTargetQuaternion.copy(targetQuaternion);

    let rawForce = new THREE.Vector3(t.ax, t.ay, t.az); let magnitude = rawForce.length(); let deltaG = Math.abs(magnitude - prevMagnitude);
    
    if (isWizardActive && capturing) {
        wizardBuffer.push(rawForce.clone());
        if (wizardBuffer.length > WIZARD_BUFFER_SIZE) wizardBuffer.shift();
        if (wizardBuffer.length === WIZARD_BUFFER_SIZE) {
            let minX = 999, maxX = -999, minY = 999, maxY = -999, minZ = 999, maxZ = -999;
            wizardBuffer.forEach(v => {
                if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
                if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
                if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
            });
            let maxAxisSpread = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
            if (maxAxisSpread < WIZARD_VARIANCE_THRESH) {
                capturing = false;
                let avgX = 0, avgY = 0, avgZ = 0;
                wizardBuffer.forEach(v => { avgX += v.x; avgY += v.y; avgZ += v.z; });
                let avgVec = new THREE.Vector3(avgX / WIZARD_BUFFER_SIZE, avgY / WIZARD_BUFFER_SIZE, avgZ / WIZARD_BUFFER_SIZE).normalize();
                if (wizardStep === 0) vectors.bottomN = avgVec;
                else if (wizardStep === 1) vectors.bottomS = avgVec;
                else if (wizardStep === 2) vectors.topN = avgVec;
                else if (wizardStep === 3) vectors.topS = avgVec;
                else if (wizardStep === 4) vectors.front = avgVec;
                else if (wizardStep === 5) vectors.back = avgVec;
                else if (wizardStep === 6) vectors.left = avgVec;
                else if (wizardStep === 7) vectors.right = avgVec;
                wizardStep++;
                if (wizardStep < 8) {
                    showToast("Face captured! Position next face.");
                    updateWizardUI();
                } else {
                    calculateRotationMatrix();
                }
            }
        }
    }

    let extension = 0;
    if (appState >= 3 && t.dynRadius && t.dynRadius > 0.1) {
        let rawDynExtCm = (t.dynRadius * 100.0) - loadedRadius;
        rawDynExtCm = Math.max(-40.0, Math.min(40.0, rawDynExtCm));
        window._smoothedDynExtCm = (window._smoothedDynExtCm === undefined)
            ? rawDynExtCm
            : (0.75 * window._smoothedDynExtCm + 0.25 * rawDynExtCm);
        extension = window._smoothedDynExtCm;
    } else if (appState < 3) {
        window._smoothedDynExtCm = 0;
    }
    let currentDynamicRadius = loadedRadius + extension;
    let currentPivotLift = extension;

    if (inGameMode) {
        if (t.gameSubState >= 3 && !window.matchAligned) {
            window.matchAligned = true;
            showToast("Match Target Locked!");
            playBeep(1000, 0.3); // Plays a quick, pleasant beep when aligned
        } else if (t.gameSubState < 3 && window.matchAligned) {
            window.matchAligned = false;
            window.matchSwinging = false;
            clearImpactLasers();
            rawTracePoints.length = 0;
            updateSmoothTrail(0);
        }

        if (!window.matchAligned && !window.matchSwinging && castData.length === 0) {
            let statsEl = document.getElementById('gm-latest-stats');
            
            // SubState 2 is GAME_READY_PULSE (The 3-second alignment window)
            if (t.gameSubState === 2) {
                statsEl.innerHTML = "<span class='text-danger font-800' style='font-size:1.1rem; text-transform:uppercase;'>Armed (Pulsing Red)</span><br><span style='font-size:0.85rem; color:var(--text-muted);'>Hold flat behind ball for 3 seconds...</span>";
            } 
            // SubState 0 is GAME_DORMANT (Asleep)
            else if (t.gameSubState === 0) {
                // If they twist to disarm, or the timer fails, reset the text
                if (statsEl.innerHTML.includes("Armed")) {
                    statsEl.innerHTML = "Awaiting Next Strike...<br><span style='font-size:0.75rem; color:var(--text-muted); font-weight:normal;'>Quickly twist shaft clockwise to arm mallet.</span>";
                }
            }
        }
    }

    if (appState === 2) {
        let dtMs = jsNow - lastJsTime; lastJsTime = jsNow; let calibBar = document.getElementById('calibration-bar'); let swingStateTxt = document.getElementById('swing-state');
        if (calibrationPhase === 'RED') {
            let elapsed = jsNow - redStartTime; let pct = (elapsed / 600.0) * 66.0; 
            if(calibBar) { calibBar.style.width = Math.min(pct, 66) + "%"; calibBar.style.background = "var(--danger)"; }
            if (elapsed >= 250 && t.appState === 6) {
                calibrationPhase = 'ORANGE'; calibrationHoldTimeMs = 0; orangeStartTime = jsNow; lastStableQuat.copy(lastRawQuat);
                targetQuaternion.copy(lastRawQuat);
                currentQuaternion.copy(targetQuaternion);
                if(swingStateTxt) { swingStateTxt.innerText = "STEADYING..."; swingStateTxt.className = "text-warning text-center font-bold mb-4"; }
                
                // --- FIX: Respect the user's database setting! ---
                let arcToggle = document.getElementById('optimumArcToggle');
                ghostRail.visible = arcToggle ? arcToggle.checked : false; 
            }
        } else if (calibrationPhase === 'ORANGE') {
            if (orangeStartTime === 0) orangeStartTime = jsNow;
            targetQuaternion.copy(lastRawQuat);
            let angleDiff = lastRawQuat.angleTo(lastStableQuat); let gDiff = Math.abs(magnitude - 1.0);
            if (angleDiff > 0.05 || gDiff > 0.10) { 
                calibrationHoldTimeMs = 0; lastStableQuat.copy(lastRawQuat);
                currentQuaternion.copy(targetQuaternion);
                if(calibBar) { calibBar.style.width = "66%"; calibBar.style.background = "var(--warning)"; } 
            } else { 
                calibrationHoldTimeMs += dtMs; let orangePct = (calibrationHoldTimeMs / 400.0) * 34.0; let totalPct = 66.0 + orangePct; 
                if(calibBar) { calibBar.style.width = Math.min(totalPct, 100) + "%"; calibBar.style.background = "var(--warning)"; }
            }
            if (jsNow - orangeStartTime > 20000) { resetSystemState(true, false).then(() => { let txt = document.getElementById('swing-state'); if(txt) { txt.innerHTML = "STEADYING FAILED - TOO MUCH MOVEMENT. TRY AGAIN."; txt.className = "text-danger text-center font-bold mb-4"; } }); return; }
            let visualDiff = currentQuaternion.angleTo(targetQuaternion);
            if (calibrationHoldTimeMs >= 400 && visualDiff < 0.02) { 

                calibrationPhase = 'NONE'; 
                document.getElementById('calibration-container').classList.add('hidden');

                // Send 'G' so firmware v0.9.10.01+ captures the single authoritative ENU yaw tare
                sendBleCommand([71]); // 'G'

                // Pre-align local visual quaternion to zero-yaw posture until the first tared packet arrives
                let finalEuler = new THREE.Euler().setFromQuaternion(lastRawQuat, 'YXZ');
                let preTareInv = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, finalEuler.y, 0, 'YXZ')).invert();
                targetQuaternion.copy(preTareInv).multiply(lastRawQuat); 
                currentQuaternion.copy(targetQuaternion); 
                masterPivot.quaternion.copy(currentQuaternion);



                // --- THE FIX: ALWAYS PLUMB ENVIRONMENT ---
                // The ghost rail, ball, and target line remain at absolute zero pitch/roll
                ghostPivot.quaternion.identity(); 
                // -----------------------------------------
                
                // Anchor head center at the exact address pose before measuring the front striking face
                let lockHeadOffset = new THREE.Vector3(0, -loadedRadius, 0).applyQuaternion(masterPivot.quaternion);
                let lockIdealHead = new THREE.Vector3(0, pivotBaseY - loadedRadius, 0);
                masterPivot.position.copy(lockIdealHead).sub(lockHeadOffset);
                masterBlock.position.set(0, -loadedRadius, 0);
                masterPivot.updateMatrixWorld(true);
                faceTrackerNode.updateMatrixWorld(true);
                let lockPos = new THREE.Vector3();
                faceTrackerNode.getWorldPosition(lockPos);
                lockedFaceZ = lockPos.z;

                updateSystemGeometry(); 
                if (isGhostEnabled) positionGhostReferenceBehindBall(0, getDynamicFaceZ());
                rebuildArcPts(loadedRadius, getOptimumArcHalfAngleDeg(loadedRadius), getDynamicFaceZ());

                let plumbNormal = new THREE.Vector3(1, 0, 0);
                let plumbCentroid = new THREE.Vector3(0, pivotBaseY - loadedRadius, 0);
                idealPlane = { centroid: plumbCentroid, normal: plumbNormal };

                ignoreSpeedUntilTime = Date.now() + 500; currentAbsoluteSpeed = 0; prevZ = 0; prevFaceZ = 0; isForwardSwing = true; lastForwardPassTime = 0; impactDetected = false; isLive = true; 
                playbackMode = false; posHistory = []; currentSwingDeviation = 0; lastComputedTempo = 0; maxTwist = 0; currentSwingDwell = 0; currentSwingAoA = 0;
                
                window.pristineImpactQuat = null;
                window.pristineImpactQuat_m8 = null;
                window.pristineStep8ms = null;
                window.strikeCastGenerated = false;
                
                window.pristinePathAngleRads = null;
                window.pristineAoARads = null;

                window.lastEdgeData = { zVel: 0, appliedForce: 0, downwardSwingTime: 0, decelFactor: 0 }; preRollBuffer = []; recordedFrames = []; rawTracePoints.length = 0; castData = [];
                
                appState = 3;

                hasLiftedOff = false; // <-- NEW: Reset for the new swing

                armedUiStartTime = Date.now(); 
                document.getElementById('playback-panel').classList.add('hidden'); 
                document.getElementById('live-tracking-card').classList.remove('hidden');
                if (DisplayElements.liveTempo) DisplayElements.liveTempo.innerText = '-- BPM'; 
                if (DisplayElements.liveSpeed) DisplayElements.liveSpeed.innerText = `${(currentAbsoluteSpeed * 3.6).toFixed(1)} kph`; 
                if (DisplayElements.liveForce) DisplayElements.liveForce.innerText = '0 N'; 
                if (DisplayElements.liveDev) DisplayElements.liveDev.innerText = '-- cm'; 
                if (DisplayElements.liveApplied) DisplayElements.liveApplied.innerText = '-- N';
                
                addressPivotX = 0;

                masterPivot.position.set(0, pivotBaseY, 0); masterBlock.position.set(0, -loadedRadius, 0); headJoint.quaternion.identity(); finalReviewExtension = 0; playBeep(1000, 0.3);

                if(swingStateTxt && !isDynamicCalibrationActive) { swingStateTxt.innerHTML = "TARGET LOCKED. LIFT AND SWING.<br><span class='small-help text-muted' style='font-size: 0.75rem; font-weight: normal;'>Trace will activate on lift-off.</span>"; swingStateTxt.className = "text-accent text-center font-bold mb-4"; }
                goTimeout = setTimeout(() => { if (appState === 3) { resetSystemState(true, false); showToast("Shot clock expired."); } }, 30000);
            }
        }
        if (appState === 2) targetQuaternion.copy(lastRawQuat);
    } else if (appState >= 3) { targetQuaternion.copy(lastRawQuat); }

    if (isLive && !isReviewingLog && !isWizardActive) { 
        
        /// --- REVISED LIFT-OFF DETECTION ---
        // We must calculate speed using raw rotation, because the 3D head is currently pinned!
        let angleChange = targetQuaternion.angleTo(prevTargetQuaternion);
        // Angle (rad) / 0.04s (Bluetooth tick) * Handle Radius = m/s
        let rotSpeed = (angleChange / 0.04) * (AppConfig.handleLengthCm / 100.0);
        
        if (appState === 3 && !hasLiftedOff && jsNow >= ignoreSpeedUntilTime) {
            if (rotSpeed > 0.15 || Math.abs(deltaG) > 0.10) {
                hasLiftedOff = true;
            }
        }
        // ----------------------------------

        if (appState === 2 && calibrationPhase === 'RED') { 
            masterPivot.quaternion.identity();
            currentDynamicRadius = loadedRadius; 
            currentPivotLift = 0; 
        } else { 
            masterPivot.quaternion.copy(targetQuaternion); 
        }

        // --- NEW: EXTENDED DYNAMIC ANCHORING (Bottom Pivot) ---
        // Pins the head during Setup (2) and Addressing (3 before lift-off)
        if (appState === 2 || (appState === 3 && !hasLiftedOff)) {
            let headLocalOffset = new THREE.Vector3(0, -currentDynamicRadius, 0);
            let rotatedOffset = headLocalOffset.clone().applyQuaternion(masterPivot.quaternion);
            let idealHeadPos = new THREE.Vector3(0, pivotBaseY - currentDynamicRadius, 0);
            
            masterPivot.position.copy(idealHeadPos).sub(rotatedOffset);
        } else {
            // Top Pivot preserves the tared address offset so lifting off does not jump laterally
            masterPivot.position.set(addressPivotX, pivotBaseY + currentPivotLift, 0);
        }
        // ------------------------------------------------------

        masterBlock.position.set(0, -currentDynamicRadius, 0);
        masterPivot.updateMatrixWorld(true); 
        faceTrackerNode.updateMatrixWorld(true); 
        physicsTrackingNode.updateMatrixWorld(true);
    }
    
    // Center of the physical mallet head sits on the shaft centerline (Z = 0)
    let centerOffset = new THREE.Vector3(0, -currentDynamicRadius, 0).applyQuaternion(targetQuaternion);
    let centerPosition = masterPivot.position.clone().add(centerOffset);
    let facePosition = new THREE.Vector3(); faceTrackerNode.getWorldPosition(facePosition);
    let currentZ = centerPosition.z;
    let localShaftDir = new THREE.Vector3(0, -1, 0)
        .applyQuaternion(targetQuaternion)
        .applyQuaternion(ghostPivot.quaternion.clone().invert());
    let currentSwingAngle = Math.atan2(localShaftDir.z, -localShaftDir.y);
    let deltaAngle = currentSwingAngle - prevSwingAngle;
    if (deltaAngle > 0.002) isForwardSwing = true;
    else if (deltaAngle < -0.002) isForwardSwing = false;
    prevSwingAngle = currentSwingAngle;
    let nowTime = hwTimestamp; 

    if (jsNow < ignoreSpeedUntilTime) { currentAbsoluteSpeed = 0; posHistory = []; preRollBuffer = []; rawTracePoints.length = 0; updateSmoothTrail(0); }
    else {
        posHistory.push({ pos: centerPosition.clone(), time: nowTime }); if (posHistory.length > 5) posHistory.shift(); currentAbsoluteSpeed = 0;
        if (posHistory.length === 5) { let dt = (posHistory[4].time - posHistory[0].time) / 1000.0; if (dt > 0.01) currentAbsoluteSpeed = (posHistory[4].pos.distanceTo(posHistory[0].pos) / 100.0) / dt; }
    }
    
    let isArmedForTracking = (appState === 3) || (inGameMode && window.matchAligned && !window.matchSwinging);
    let isTrackingSwing = (appState === 4) || (inGameMode && window.matchSwinging);

    if (isArmedForTracking || isTrackingSwing) {
        let massKg = AppConfig.massKg;
        let liveForceN = magnitude * massKg * 9.81;
        if (DisplayElements.liveSpeed) DisplayElements.liveSpeed.innerText = `${(currentAbsoluteSpeed * 3.6).toFixed(1)} kph`;
        if (DisplayElements.liveForce) DisplayElements.liveForce.innerText = `${liveForceN.toFixed(0)} N`; 
    }

    if (isArmedForTracking && (appState !== 3 || hasLiftedOff) && jsNow >= ignoreSpeedUntilTime) {
        preRollBuffer.push({ rotation: targetQuaternion.clone(), forceMag: magnitude, pos: centerPosition.clone(), time: nowTime, isForward: isForwardSwing, pivotPos: masterPivot.position.clone(), extension: extension, rawBLE: currentRawBLEQuat.clone() });
        while (preRollBuffer.length > 0 && nowTime - preRollBuffer[0].time > 2000) preRollBuffer.shift();

        let triggeredNormal = (currentAbsoluteSpeed > 0.45); let triggeredImpact = (deltaG > impactThreshold);

        if (triggeredNormal || triggeredImpact) {
            if (inGameMode) window.matchSwinging = true;
            else appState = 4;
            
            state4UiStartTime = Date.now(); clearTimeout(goTimeout);
            state4StartTime = nowTime; recordTicks = 0; postImpactTicks = 0;
            if (!impactDetected) {
                recordedFrames = [];
                currentSwingMaxSpeed = 0; currentSwingMaxG = 0; currentSwingDeviation = 0; maxTwist = 0; currentSwingDwell = 0; currentSwingAoA = 0;
                window.lastEdgeData = { zVel: 0, appliedForce: 0, downwardSwingTime: 0, decelFactor: 0 };
                window.lastBurstFinalRecord = null;
                rawTracePoints.length = 0;
            }
            let cutoffTime = nowTime - 2000;
            let existingFirstTime = rawTracePoints.length > 0 ? rawTracePoints[0].time : Infinity;
            let prependedPts = [];
            let prependedFrames = [];
            preRollBuffer.forEach(f => {
                if (f.time >= nowTime || f.time >= existingFirstTime) return;
                if (f.time >= cutoffTime && rawTracePoints.length < MAX_TRAIL_POINTS) {
                    let r = 0.0, g = 1.0, b = 0.0; 
                    if (!f.isForward) { r = 1.0; g = 1.0; b = 0.0; } 
                    else {
                        if (idealPlane) {
                            let ballWorldPos = virtualBall.position.clone(); let trackingInvMat = new THREE.Matrix4().copy(physicsTrackingNode.matrixWorld).invert();
                            let localBall = ballWorldPos.applyMatrix4(trackingInvMat); let t = Math.min(Math.abs(localBall.x) / (AppConfig.malletWidthCm || 6.0), 1.0);
                            if(isNaN(t)) t = 0; r = t; g = 1.0 - t; b = 0.0;
                        } else { r = 0.0; g = 1.0; b = 0.8; }
                    }
                    if(isNaN(r)) r = 0; if(isNaN(g)) g = 1; if(isNaN(b)) b = 0;
                    prependedPts.push({ pos: f.pos.clone(), rot: f.rotation.clone(), color: {r: r, g: g, b: b}, isForward: f.isForward, time: f.time });
                    prependedFrames.push({ rotation: f.rotation.clone(), forceMag: f.forceMag, rawPtIndex: 0, pivotPos: f.pivotPos.clone(), extension: f.extension, rawBLE: f.rawBLE, time: f.time });
                }
            });
            if (prependedPts.length > 0) {
                rawTracePoints.unshift(...prependedPts);
                recordedFrames.unshift(...prependedFrames);
                for (let i = 0; i < recordedFrames.length; i++) recordedFrames[i].rawPtIndex = i + 1;
            }
            updateSmoothTrail();
            let listDiv = document.getElementById('history-list'); if (listDiv && listDiv.innerHTML.includes("No swings recorded yet")) listDiv.innerHTML = '';
            let liveList = document.getElementById('live-tracking-list'); if (liveList) liveList.innerHTML = '';
            let swingStateTxt = document.getElementById('swing-state'); if(swingStateTxt && !isDynamicCalibrationActive && !inGameMode) { swingStateTxt.innerText = "RECORDING SWING..."; swingStateTxt.className = "text-danger text-center font-bold mb-4"; }
        }
    }

    let currentFaceZ = facePosition.z;
    if (isTrackingSwing && !window.strikeCastGenerated) {
        let distToStrikeCm = getDynamicFaceZ() - currentFaceZ;
        if (isForwardSwing && distToStrikeCm >= 0 && distToStrikeCm <= 50.0) {
            setAutoSlowMo(true);
        }
    }

    if (isTrackingSwing && jsNow >= ignoreSpeedUntilTime) {
        let dynamicFaceZ = getDynamicFaceZ();
        // --- FIX: Only let the 3D engine draw a cast if the hardware hasn't already built the perfect one!
        if (idealPlane && prevFaceZ <= dynamicFaceZ && currentFaceZ > dynamicFaceZ && isForwardSwing && !window.strikeCastGenerated) {
            let tm = (dynamicFaceZ - prevFaceZ) / (currentFaceZ - prevFaceZ); if (isNaN(tm) || tm < 0 || tm > 1) tm = 1.0; 
            let iQuat = prevTargetQuaternion.clone().slerp(targetQuaternion, tm);
            
            let iRawBLE = prevRawBLEQuat.clone().slerp(currentRawBLEQuat, tm);
            
            let tempPivot = new THREE.Group(); let tempBlock = new THREE.Group(); let tempFace = new THREE.Group();
            tempPivot.position.set(addressPivotX, pivotBaseY + currentPivotLift, 0); tempBlock.position.set(0, -currentDynamicRadius, 0); tempFace.position.set(0, 0, dynamicFaceZ); 
            tempPivot.add(tempBlock); tempBlock.add(tempFace); tempPivot.quaternion.copy(iQuat); scene.add(tempPivot); tempPivot.updateMatrixWorld(true);
            let exactFacePos = new THREE.Vector3(); tempFace.getWorldPosition(exactFacePos); scene.remove(tempPivot);

            ghostBlock.updateMatrixWorld(true);
            let ghostInvMat = new THREE.Matrix4().copy(ghostBlock.matrixWorld).invert();
            let localFaceAtImpact = exactFacePos.clone().applyMatrix4(ghostInvMat);

            let strikeX = localFaceAtImpact.x; 
            let strikeY = localFaceAtImpact.y; 

            // Keep practice casts unclamped so true miss distance is reported; label >= half face as 'M' (Mishit)
            let halfWidth = AppConfig.malletWidthCm / 2.0;
            let devCM = Math.abs(strikeX); if (devCM < (AppConfig.sweetSpot * 0.15)) devCM = 0.0;
            let dir = (devCM >= halfWidth) ? 'M' : (strikeX > 0.1 ? 'R' : (strikeX < -0.1 ? 'L' : 'C'));

            // Calculate horizontal Swing Path and AoA from the active downswing points in rawTracePoints
            let pathAngleRads = 0;
            let aoaAngleRads = 0;
            if (rawTracePoints.length >= 1) {
                let startIdx = rawTracePoints.length - 1;
                while (startIdx > 0 && (rawTracePoints.length - startIdx) < 3 && rawTracePoints[startIdx - 1]?.isForward) {
                    startIdx--;
                }
                if (rawTracePoints[startIdx]?.isForward) {
                    let pastLocal1 = rawTracePoints[startIdx].pos.clone().applyMatrix4(ghostInvMat);
                    let pastLocal2 = centerPosition.clone().applyMatrix4(ghostInvMat);
                    let dx = pastLocal2.x - pastLocal1.x;
                    let dy = pastLocal2.y - pastLocal1.y;
                    let dz = pastLocal2.z - pastLocal1.z;
                    if (dz > 1.0) {
                        pathAngleRads = Math.atan2(dx, dz);
                        aoaAngleRads = Math.atan2(dy, dz);
                    }
                }
            }

            // --- FIX: OVERRIDE WITH PRISTINE HARDWARE PATH IF AVAILABLE ---
            if (window.pristinePathAngleRads !== undefined && window.pristinePathAngleRads !== null) {
                pathAngleRads = window.pristinePathAngleRads;
            }
            let castEuler = new THREE.Euler().setFromQuaternion(iQuat, 'YXZ');
            currentSwingAoA = -THREE.MathUtils.radToDeg(castEuler.x);
            // --------------------------------------------------------------

            let leanEulerNode = new THREE.Euler().setFromQuaternion(iQuat, 'YXZ');
            let rawLeanDeg = THREE.MathUtils.radToDeg(leanEulerNode.z);
            let leanDeg = Math.abs(rawLeanDeg);
            if (leanDeg < 0.1) leanDeg = 0.0;
            let leanDir = rawLeanDeg > 0.1 ? 'L' : (rawLeanDeg < -0.1 ? 'R' : '');

            let locTwist = getShaftTwist(iQuat); 
            let passForce = calculateImpactForce(currentAbsoluteSpeed);
            let snapshotPos = new THREE.Vector3(addressPivotX, pivotBaseY + currentPivotLift, 0);

            let estDist = calculateEstimatedDistance(currentAbsoluteSpeed, AppConfig.massKg, AppConfig.lawnSpeed);
            
            let isTrueStrike = false;
            let dynRadiusM = t.dynRadius || (loadedRadius / 100.0);
            let decelFact = computeFallbackPreImpactAccelPct(rawTracePoints.length - 1, rawTracePoints);
            let passSpeed = currentAbsoluteSpeed;
            let backArc = 0;
            let backswingTime = 0;
            let faultDetected = false;

            // Calculate basic P-Delta and Tempo
            if (lastForwardPassTime > 0) { let fullCycleSeconds = (nowTime - lastForwardPassTime) / 1000.0; if (fullCycleSeconds > 0.4 && fullCycleSeconds < 5.0) lastComputedTempo = 60.0 / fullCycleSeconds; }
            lastForwardPassTime = nowTime;
            let p_delta = null; if (lastComputedTempo > 0) { p_delta = calculatePendulumDelta(60.0 / lastComputedTempo, AppConfig.handleLengthCm); }

            // --- THE MASTER FIX: MAP THE EARLY PACKET TO THE 3D CAST ---
            if (window.pendingStrikePacket) {
                isTrueStrike = true;
                window.strikeCastGenerated = true; // <--- THIS LOCKS OUT GHOST SWINGS
                locTwist = window.pendingStrikePacket.locTwist;
                
                dynRadiusM = window.pendingStrikePacket.dynRadius;
                decelFact = window.pendingStrikePacket.decelFactor;
                passSpeed = window.pendingStrikePacket.zVel;
                backArc = window.pendingStrikePacket.backArc;
                backswingTime = window.pendingStrikePacket.backswingTime;
                faultDetected = !!window.pendingStrikePacket.faultDetected;

                if (dynRadiusM && dynRadiusM > 0.1) {
                    extension = Math.max(-40.0, Math.min(40.0, (dynRadiusM * 100.0) - loadedRadius));
                    snapshotPos.y = pivotBaseY + extension;
                }

                let massKg = AppConfig.massKg; let lawnMult = 0.50 + (AppConfig.lawnSpeed - 10) * 0.075;
                let ballSpeedMPS = passSpeed * (massKg * 1.8) / (massKg + 0.454); 
                estDist = (ballSpeedMPS * ballSpeedMPS) * lawnMult;
                currentSwingDist = estDist;
                
                window.pendingStrikePacket = null; // Consume the packet
                
                let swingStateTxt = document.getElementById('swing-state');
                if (swingStateTxt) {
                    swingStateTxt.innerHTML = "STRIKE PACKET RECEIVED <span style='color: var(--success); font-weight: 900;'>(MAPPED TO CAST)</span>";
                }
            }

            // Calculate accuracy AFTER mapping the hardware twist!
            let liveTargetX_cm = 0;
            if (isTrueStrike) {
                // Real strike uses physical recoil math (+ = Right, - = Left)
                let rawMm = calculateOffCenterImpact(Math.abs(maxTwist), passSpeed);
                liveTargetX_cm = maxTwist > 0 ? (rawMm / 10.0) : -(rawMm / 10.0);
                devCM = Math.abs(liveTargetX_cm);
                dir = liveTargetX_cm > 0.1 ? 'R' : (liveTargetX_cm < -0.1 ? 'L' : 'C');
            } else {
                // Virtual cast uses visual 3D math
                liveTargetX_cm = strikeX;
            }

            // Only apply collision recoil when an actual ball strike occurred
            let simulatedRecoil = isTrueStrike ? maxTwist : 0;
            let accData = calcAccuracyData(liveTargetX_cm, locTwist, pathAngleRads, simulatedRecoil, isTrueStrike ? currentSwingDwell : 2.0);
            if (isTrueStrike) accData.isWhiff = false;

            let passRating = getStarRating(liveTargetX_cm, accData.trueLaunchDeg, isTrueStrike);

            let isHit = false;
            let currentTwistTol = parseFloat(document.getElementById('twistToleranceInput').value) || 1.0;
            let targetDist = inGameMode ? (parseFloat(document.getElementById('matchDistSetup').value) || 10.0) : (parseFloat(document.getElementById('trainerDistSetup').value) || 10.0);
            let inContactZone = isTrueStrike ? (Math.abs(liveTargetX_cm) <= AppConfig.sweetSpot) : !accData.isWhiff;
            
            isHit = !accData.isWhiff && inContactZone && (Math.abs(accData.trueLaunchDeg) <= currentTwistTol) && (estDist >= targetDist);

            // Practice casts keep the original live hit tone; real strikes resolve in finalizeSwingData()
            if (!isTrueStrike && isHit && !inGameMode && AppConfig.ledGuidance) {
                playSuccessSound();
            }

            let strikeCast = {
                rawDev: strikeX, unclampedRawDev: localFaceAtImpact.x, dev: devCM, dir: dir, lean: leanDeg, leanDir: leanDir, deflectionDeg: accData.collisionDeflection,
                isStrike: isTrueStrike, pos: exactFacePos.clone(), rot: tempFace.getWorldQuaternion(new THREE.Quaternion()),
                localX: strikeX, localY: strikeY, faceAngle: locTwist, planeTwist: locTwist, impactTwist: locTwist,
                pathAngleRads: pathAngleRads, aoaDeg: isTrueStrike ? currentSwingAoA : null, passSpeed: passSpeed, passForce: passForce, dynRadius: dynRadiusM,
                stars: passRating.string, starColor: passRating.color, trailIndex: Math.max(0, rawTracePoints.length - 1), pivotQuat: iQuat.clone(), pivotPos: snapshotPos, extension: extension, time: nowTime,
                isWhiff: accData.isWhiff, estAccRange: accData.estAccRange, trueAccRange: accData.trueAccRange, trueLaunchDeg: accData.trueLaunchDeg, 
                estLaunchRads: accData.estLaunchRads, trueLaunchRads: accData.trueLaunchRads, maxAccRange: accData.trueAccRange, estDist: estDist, pDelta: p_delta,
                rawBLE: iRawBLE, isHit: isHit, targetDistM: targetDist, decelFactor: decelFact, backArc: backArc, backswingTime: backswingTime, tempo: lastComputedTempo, faultDetected: faultDetected
            };
            castData.push(strikeCast);
            
            if(!isDynamicCalibrationActive && !inGameMode) {
                if (DisplayElements.liveDev) DisplayElements.liveDev.innerText = `${devCM.toFixed(1)} cm${dir}`;
                if (DisplayElements.liveLean) DisplayElements.liveLean.innerText = `${leanDeg.toFixed(1)}°${leanDir}`.trim();
                if (DisplayElements.liveTempo) DisplayElements.liveTempo.innerText = lastComputedTempo > 0 ? `${Math.round(lastComputedTempo)} BPM` : `--`;
                renderLiveCasts();
            }

            let ss = AppConfig.sweetSpot; 
            let ledCmd = 72; if (devCM > ss) ledCmd = 74; 
            if (AppConfig.ledGuidance && !inGameMode) { sendBleCommand([ledCmd]); }
            if (AppConfig.singleSwing && !impactDetected) { clearTimeout(goTimeout); setTimeout(() => { finalizeSwingData(globalHwTime); }, 800); }
        }

        let canRecordFrame = !impactDetected;
        let frameIsForward = isForwardSwing;

        if (impactDetected && !window.followThroughComplete) {
            let strikeCast = castData.find(c => c.isStrike);
            let postFrames = strikeCast ? (rawTracePoints.length - 1 - strikeCast.trailIndex) : 0;

            let ghostInvQuat = ghostPivot.quaternion.clone().invert();
            let localShaft = new THREE.Vector3(0, -1, 0).applyQuaternion(targetQuaternion).applyQuaternion(ghostInvQuat);
            let thetaSwing = Math.atan2(localShaft.z, -localShaft.y);

            if (window.peakFollowThroughTheta === -Infinity) {
                let startQuat = strikeCast ? strikeCast.pivotQuat : targetQuaternion;
                let startShaft = new THREE.Vector3(0, -1, 0).applyQuaternion(startQuat).applyQuaternion(ghostInvQuat);
                window.peakFollowThroughTheta = Math.max(thetaSwing, Math.atan2(startShaft.z, -startShaft.y));
                window.peakFollowThroughIdx = rawTracePoints.length - 1;
                window.followThroughLastMoveTime = nowTime;
            }

            let dropFromPeakDeg = THREE.MathUtils.radToDeg(window.peakFollowThroughTheta - thetaSwing);
            let idleAtApexMs = nowTime - (window.followThroughLastMoveTime || nowTime);

            // Continue recording until the mallet reaches the end of the forward follow-through (>= 2.0° drop or > 400ms pause at apex)
            if (postFrames >= 3 && (dropFromPeakDeg >= 2.0 || idleAtApexMs > 400)) {
                window.followThroughComplete = true;
                if (window.peakFollowThroughIdx >= 0 && window.peakFollowThroughIdx < rawTracePoints.length - 1) {
                    rawTracePoints.length = window.peakFollowThroughIdx + 1;
                    recordedFrames.length = window.peakFollowThroughIdx + 1;
                }
                clearTimeout(window.finalizeTimerId);
                setTimeout(() => { finalizeSwingData(nowTime); }, 0);
            } else if (dropFromPeakDeg < 2.0) {
                canRecordFrame = true;
                frameIsForward = true; // Keep the entire follow-through arc marked as forward so it renders continuously
            }
        }

        if (canRecordFrame && rawTracePoints.length < MAX_TRAIL_POINTS) {
            // Bridge the 150ms firmware impact gap with curved SLERP arc points
            if (impactDetected && rawTracePoints.length > 0 && recordedFrames.length > 0) {
                let prevPt = rawTracePoints[rawTracePoints.length - 1];
                let prevFrame = recordedFrames[recordedFrames.length - 1];
                let gapAngleDeg = THREE.MathUtils.radToDeg(prevPt.rot.angleTo(targetQuaternion));

                if (gapAngleDeg > 6.0) {
                    let bridgeSteps = Math.min(10, Math.floor(gapAngleDeg / 4.0));

                    for (let s = 1; s < bridgeSteps; s++) {
                        if (rawTracePoints.length >= MAX_TRAIL_POINTS - 1) break;
                        let alpha = s / bridgeSteps;
                        let qStep = prevPt.rot.clone().slerp(targetQuaternion, alpha);
                        let pStep = prevFrame.pivotPos.clone().lerp(masterPivot.position, alpha);
                        let extStep = prevFrame.extension + (extension - prevFrame.extension) * alpha;
                        let headOffset = new THREE.Vector3(0, -(loadedRadius + extStep), 0).applyQuaternion(qStep);
                        let posStep = pStep.clone().add(headOffset);
                        let tStep = (prevPt.time || nowTime) + ((nowTime - (prevPt.time || nowTime)) * alpha);

                        rawTracePoints.push({ pos: posStep, rot: qStep, color: { r: 0.0, g: 1.0, b: 0.0 }, isForward: true, time: tStep });
                        recordedFrames.push({ rotation: qStep, forceMag: magnitude, rawPtIndex: rawTracePoints.length, pivotPos: pStep, extension: extStep, rawBLE: currentRawBLEQuat.clone(), time: tStep });
                    }
                }
            }

            if (magnitude > currentSwingMaxG) currentSwingMaxG = magnitude;
            let r = 0.0, g = 1.0, b = 0.0; 
            if (!frameIsForward) { r = 1.0; g = 1.0; b = 0.0; } 
            else {
                if (idealPlane) {
                    let ballWorldPos = virtualBall.position.clone(); let trackingInvMat = new THREE.Matrix4().copy(physicsTrackingNode.matrixWorld).invert();
                    let localBall = ballWorldPos.applyMatrix4(trackingInvMat); let tm = Math.min(Math.abs(localBall.x) / 6.0, 1.0); 
                    if(isNaN(tm)) tm = 0; r = tm; g = 1.0 - tm; b = 0.0;
                } else { r = 0.0; g = 1.0; b = 0.8; }
            }
            if(isNaN(r)) r = 0; if(isNaN(g)) g = 1; if(isNaN(b)) b = 0;
            rawTracePoints.push({ pos: centerPosition.clone(), rot: targetQuaternion.clone(), color: {r: r, g: g, b: b}, isForward: frameIsForward, time: nowTime });
            recordedFrames.push({ rotation: targetQuaternion.clone(), forceMag: magnitude, rawPtIndex: rawTracePoints.length, pivotPos: masterPivot.position.clone(), extension: extension, rawBLE: currentRawBLEQuat.clone(), time: nowTime });

            if (impactDetected && !window.followThroughComplete) {
                let ghostInvQuat = ghostPivot.quaternion.clone().invert();
                let localShaft = new THREE.Vector3(0, -1, 0).applyQuaternion(targetQuaternion).applyQuaternion(ghostInvQuat);
                let thetaSwing = Math.atan2(localShaft.z, -localShaft.y);
                if (thetaSwing >= window.peakFollowThroughTheta) {
                    window.peakFollowThroughTheta = thetaSwing;
                    window.peakFollowThroughIdx = rawTracePoints.length - 1;
                    window.followThroughLastMoveTime = nowTime;
                }
                updateSmoothTrail();
            }
        }

        if (!impactDetected && deltaG > impactThreshold) { impactDetected = true; window.impactHwTime = nowTime; window.followThroughComplete = false; let swingStateTxt = document.getElementById('swing-state'); if(swingStateTxt && !isDynamicCalibrationActive && !inGameMode) { swingStateTxt.innerText = "IMPACT DETECTED! WAITING FOR EDGE PACKET..."; swingStateTxt.className = "text-danger text-center font-bold mb-4"; } }
        if (!impactDetected && (!AppConfig.singleSwing)) { let practiceTimeLimitMs = AppConfig.practiceLimitSec * 1000; if ((nowTime - state4StartTime) >= practiceTimeLimitMs) { finalizeSwingData(nowTime); } }
    }

    prevFaceZ = currentFaceZ; prevZ = currentZ; prevMagnitude = magnitude;
}

function solveStrikeAnchoredPose(cast) {
    if (!cast || !cast.pivotQuat) return;

    let safeExt = Number.isFinite(cast.extension) ? cast.extension : 0;
    let halfHeadLen = (AppConfig.malletLengthCm || 27.6) / 2.0;
    // rawDev: - = Left ('L'), + = Right ('R'). In Three.js mallet local coords, +X is Left, -X is Right.
    let impactLocalX_cm = -(cast.rawDev || 0);
    cast.localX = cast.rawDev || 0;

    let localFaceOffset = new THREE.Vector3(0, -(loadedRadius + safeExt), halfHeadLen).applyQuaternion(cast.pivotQuat);
    let localImpactOffset = new THREE.Vector3(impactLocalX_cm, -(loadedRadius + safeExt), halfHeadLen).applyQuaternion(cast.pivotQuat);

    // Undisputed reference: stationary croquet ball centered at X = 0, front face plane at getDynamicFaceZ()
    let contactPlaneZ = getDynamicFaceZ();
    let contactPivotX = Math.max(-25, Math.min(25, -localImpactOffset.x));
    let contactPivotZ = Math.max(-25, Math.min(25, contactPlaneZ - localImpactOffset.z));

    cast.pivotPos.set(contactPivotX, pivotBaseY + safeExt, contactPivotZ);
    cast.pos.copy(cast.pivotPos).add(localFaceOffset);
    if (cast.rot) cast.rot.copy(cast.pivotQuat);
}

function smoothImpactTraceJoin(impactIdx, anchorQuat, anchorExt, anchorPivotPos = null, castsList = castData) {
    if (!anchorQuat || !rawTracePoints || impactIdx < 0 || impactIdx >= rawTracePoints.length) return;

    // Snapshot unmodified sample poses once so re-running after late packets never double-shifts
    for (let i = 0; i < rawTracePoints.length; i++) {
        let pt = rawTracePoints[i];
        if (!pt) continue;
        if (!pt._baseRot) pt._baseRot = pt.rot.clone();
        if (!pt._basePivotPos) {
            pt._basePivotPos = (recordedFrames[i]?.pivotPos)
                ? recordedFrames[i].pivotPos.clone()
                : new THREE.Vector3(addressPivotX, pivotBaseY, 0);
        }
        if (pt._baseExt === undefined) {
            pt._baseExt = (recordedFrames[i] && Number.isFinite(recordedFrames[i].extension))
                ? recordedFrames[i].extension
                : 0;
        }
    }

    let safeExt = Number.isFinite(anchorExt) ? anchorExt : 0;
    let targetPivotX = anchorPivotPos ? anchorPivotPos.x : 0;
    let targetPivotY = anchorPivotPos ? anchorPivotPos.y : (pivotBaseY + safeExt);
    let targetPivotZ = anchorPivotPos ? anchorPivotPos.z : 0;
    let anchoredEuler = new THREE.Euler().setFromQuaternion(anchorQuat, 'YXZ');

    // Time bounds from start of recording (address) to ball impact
    let tStart = rawTracePoints[0]?.time;
    let tImpact = rawTracePoints[impactIdx]?.time;
    let hasValidTimeSpan = (tStart !== undefined && tImpact !== undefined && tImpact > tStart);

    const getTimeAlpha = (idx) => {
        if (idx <= 0) return 0;
        if (idx >= impactIdx) return 1;
        if (hasValidTimeSpan && rawTracePoints[idx]?.time !== undefined) {
            return Math.max(0, Math.min(1, (rawTracePoints[idx].time - tStart) / (tImpact - tStart)));
        }
        return impactIdx > 0 ? (idx / impactIdx) : 1;
    };

    // Angular drift/offset between raw live telemetry at impact and the undisputed hardware impact orientation
    let rawImpactEuler = new THREE.Euler().setFromQuaternion(rawTracePoints[impactIdx]._baseRot, 'YXZ');
    let deltaYaw = anchoredEuler.y - rawImpactEuler.y;
    let deltaRoll = anchoredEuler.z - rawImpactEuler.z;

    // Only blend dynamic shaft extension over the final strike downswing so earlier casts are not stretched
    let downswingStartIdx = impactIdx;
    for (let i = impactIdx - 1; i >= 0; i--) {
        if (!rawTracePoints[i] || !rawTracePoints[i].isForward) break;
        downswingStartIdx = i;
    }
    let downswingSpan = Math.max(1, impactIdx - downswingStartIdx);

    // 1. Distribute pivot shift, yaw, and roll linearly over elapsed time across ALL swings up to impact
    for (let i = 0; i < impactIdx; i++) {
        let pt = rawTracePoints[i];
        if (!pt) continue;
        let alpha = getTimeAlpha(i);

        let e = new THREE.Euler().setFromQuaternion(pt._baseRot, 'YXZ');
        e.y += deltaYaw * alpha;
        e.z += deltaRoll * alpha;
        let qStep = new THREE.Quaternion().setFromEuler(e, 'YXZ');

        let stepExt = pt._baseExt;
        if (i >= downswingStartIdx) {
            let extAlpha = (i - downswingStartIdx) / downswingSpan;
            stepExt = pt._baseExt + (safeExt - pt._baseExt) * extAlpha;
        }

        let basePivotX = pt._basePivotPos.x;
        let basePivotZ = pt._basePivotPos.z;
        let stepPivotX = basePivotX + (targetPivotX - basePivotX) * alpha;
        let stepPivotY = pivotBaseY + stepExt;
        let stepPivotZ = basePivotZ + (targetPivotZ - basePivotZ) * alpha;
        let headOffset = new THREE.Vector3(0, -(loadedRadius + stepExt), 0).applyQuaternion(qStep);

        pt.rot.copy(qStep);
        pt.pos.set(stepPivotX, stepPivotY, stepPivotZ).add(headOffset);
        if (recordedFrames[i]) {
            recordedFrames[i].rotation.copy(qStep);
            recordedFrames[i].pivotPos.set(stepPivotX, stepPivotY, stepPivotZ);
            recordedFrames[i].extension = stepExt;
        }
    }

    // 2. Lock the impact sample itself to the single undisputed ball-contact pose
    let eImpact = anchoredEuler.clone();
    if (impactIdx > downswingStartIdx && rawTracePoints[impactIdx - 1]) {
        let prevE = new THREE.Euler().setFromQuaternion(rawTracePoints[impactIdx - 1].rot, 'YXZ');
        if (eImpact.x > prevE.x) eImpact.x = prevE.x;
    }
    let impactLockedQuat = new THREE.Quaternion().setFromEuler(eImpact, 'YXZ');
    let impactHeadOffset = new THREE.Vector3(0, -(loadedRadius + safeExt), 0).applyQuaternion(impactLockedQuat);

    rawTracePoints[impactIdx].rot.copy(impactLockedQuat);
    rawTracePoints[impactIdx].pos.set(targetPivotX, targetPivotY, targetPivotZ).add(impactHeadOffset);
    if (recordedFrames[impactIdx]) {
        recordedFrames[impactIdx].rotation.copy(impactLockedQuat);
        recordedFrames[impactIdx].pivotPos.set(targetPivotX, targetPivotY, targetPivotZ);
        recordedFrames[impactIdx].extension = safeExt;
    }

    // 3. Project follow-through cleanly from the contact pivot with monotonic forward pitch
    let prevPitchX = eImpact.x;
    for (let i = impactIdx + 1; i < rawTracePoints.length; i++) {
        let pt = rawTracePoints[i];
        if (!pt) continue;
        let ePost = new THREE.Euler().setFromQuaternion(pt._baseRot, 'YXZ');
        ePost.y += deltaYaw;
        ePost.z += deltaRoll;
        if (ePost.x > prevPitchX) ePost.x = prevPitchX;
        prevPitchX = ePost.x;

        let qPost = new THREE.Quaternion().setFromEuler(ePost, 'YXZ');
        let postOffset = new THREE.Vector3(0, -(loadedRadius + safeExt), 0).applyQuaternion(qPost);

        pt.rot.copy(qPost);
        pt.pos.set(targetPivotX, targetPivotY, targetPivotZ).add(postOffset);
        if (recordedFrames[i]) {
            recordedFrames[i].rotation.copy(qPost);
            recordedFrames[i].pivotPos.set(targetPivotX, targetPivotY, targetPivotZ);
            recordedFrames[i].extension = safeExt;
        }
    }

    // 4. Update all earlier practice casting swings (3D pose, Face/Lean angles, Impact, Deviation σ & Target Hit/Miss)
    if (Array.isArray(castsList)) {
        let halfHeadLen = (AppConfig.malletLengthCm || 27.6) / 2.0;
        let halfWidth = (AppConfig.malletWidthCm || 6.0) / 2.0;
        let currentTwistTol = parseFloat(document.getElementById('twistToleranceInput')?.value) || 1.0;

        castsList.forEach(c => {
            if (!c || c.isStrike) return;
            if (!c._basePivotPos) c._basePivotPos = c.pivotPos.clone();
            if (!c._basePivotQuat) c._basePivotQuat = c.pivotQuat.clone();
            if (c._baseRawDev === undefined) {
                c._baseRawDev = (c.unclampedRawDev !== undefined && c.unclampedRawDev !== null) ? c.unclampedRawDev : (c.rawDev || 0);
            }

            let cIdx = Math.min(Math.max(0, c.trailIndex || 0), rawTracePoints.length - 1);
            let castAlpha = getTimeAlpha(cIdx);

            // Apply time-proportional yaw & roll adjustment to the practice cast orientation
            let ce = new THREE.Euler().setFromQuaternion(c._basePivotQuat, 'YXZ');
            ce.y += deltaYaw * castAlpha;
            ce.z += deltaRoll * castAlpha;
            c.pivotQuat.setFromEuler(ce, 'YXZ');
            if (c.rot) c.rot.copy(c.pivotQuat);

            let updatedTwist = getShaftTwist(c.pivotQuat);
            c.faceAngle = updatedTwist;
            c.planeTwist = updatedTwist;
            c.impactTwist = updatedTwist;

            let rawLeanDeg = THREE.MathUtils.radToDeg(ce.z);
            let leanDeg = Math.abs(rawLeanDeg);
            if (leanDeg < 0.1) leanDeg = 0.0;
            c.lean = leanDeg;
            c.leanDir = rawLeanDeg > 0.1 ? 'L' : (rawLeanDeg < -0.1 ? 'R' : '');

            let deltaX = (targetPivotX - c._basePivotPos.x) * castAlpha;
            let deltaZ = (targetPivotZ - c._basePivotPos.z) * castAlpha;

            c.pivotPos.set(c._basePivotPos.x + deltaX, c._basePivotPos.y, c._basePivotPos.z + deltaZ);
            let faceOffset = new THREE.Vector3(0, -(loadedRadius + (c.extension || 0)), halfHeadLen).applyQuaternion(c.pivotQuat);
            c.pos.copy(c.pivotPos).add(faceOffset);

            let shiftedRawDev = c._baseRawDev - deltaX;
            c.rawDev = shiftedRawDev;
            c.localX = shiftedRawDev;

            let devCM = Math.abs(shiftedRawDev);
            if (devCM < (AppConfig.sweetSpot * 0.15)) devCM = 0.0;
            c.dev = devCM;
            c.dir = (devCM >= halfWidth) ? 'M' : (shiftedRawDev > 0.1 ? 'R' : (shiftedRawDev < -0.1 ? 'L' : 'C'));

            let accData = calcAccuracyData(shiftedRawDev, updatedTwist, c.pathAngleRads || 0, 0, 2.0);
            let passRating = getStarRating(shiftedRawDev, accData.trueLaunchDeg, false);
            let targetDist = getActiveTargetDistM(c);
            let castDist = c.estDist ?? 0;

            c.deflectionDeg = accData.collisionDeflection;
            c.trueLaunchDeg = accData.trueLaunchDeg;
            c.trueLaunchRads = accData.trueLaunchRads;
            c.estAccRange = accData.estAccRange;
            c.trueAccRange = accData.trueAccRange;
            c.maxAccRange = accData.trueAccRange;
            c.isWhiff = accData.isWhiff;
            c.stars = passRating.string;
            c.starColor = passRating.color;
            c.isHit = !accData.isWhiff && (Math.abs(accData.trueLaunchDeg) <= currentTwistTol) && (castDist >= targetDist);
        });
    }
}

async function finalizeSwingData(nowTime) {
    if (appState !== 4 && !window.matchSwinging) return;

    if (impactDetected && !window.followThroughComplete && window.peakFollowThroughIdx >= 0 && window.peakFollowThroughIdx < rawTracePoints.length - 1) {
        rawTracePoints.length = window.peakFollowThroughIdx + 1;
        recordedFrames.length = window.peakFollowThroughIdx + 1;
    }
    window.followThroughComplete = true;
    if (inGameMode) {
        window.matchSwinging = false;
        if (!impactDetected && castData.length > 0) {
            let displayPass = castData[castData.length - 1];
            let twistStr = (displayPass.faceAngle > 0 ? '+' : '') + (displayPass.faceAngle || 0).toFixed(1) + '°';
            let hitColor = displayPass.isHit ? 'var(--success)' : 'var(--danger)';
            
            document.getElementById('gm-latest-stats').innerHTML = `<div class="text-muted mb-2 uppercase" style="font-size:0.85rem;">PRACTICE CAST</div><div>Face Angle: <span style="color:${hitColor}; font-weight:800;">${twistStr}</span></div><div>Est. Dist: <span class="text-main font-800">${Math.round(displayPass.estDist)}</span> m</div><div class="mt-2 text-muted" style="font-size:0.75rem;">Quickly twist clockwise to arm next shot.</div>`;
        }
        return; 
    }

    isLive = false;
    setAutoSlowMo(false);
    const sendIdlePromise = sendBleCommand([79]); // 'O' — don't block audio/pose on BLE ACK

    // Ignore wiggles or false triggers that never crossed the ball plane or struck the ball
    if (!impactDetected && castData.length === 0) {
        playDoubleBeep();
        await sendIdlePromise;
        await resetSystemState(true, false);
        showToast("No swing detected.");
        return;
    }

    // THE NEW FIX: Hide incomplete final swings caused by the timer decapitation
    if (!impactDetected && castData.length > 1) {
        let lastCast = castData[castData.length - 1];
        // If the final cast has fewer than 5 frames of follow-through, it was chopped off by the timer. Delete it.
        if (rawTracePoints.length - lastCast.trailIndex < 5) {
            castData.pop(); 
        }
    }

    // 1. Identify the target cast data (synthesize from pendingStrikePacket if a crush/stall never crossed dynamicFaceZ)
    if (impactDetected && window.pendingStrikePacket && !castData.some(c => c.isStrike)) {
        const pkt = window.pendingStrikePacket;
        const synthQuat = (window.pristineImpactQuat || targetQuaternion).clone();
        const synthExt = (pkt.dynRadius && pkt.dynRadius > 0.1)
            ? Math.max(-40.0, Math.min(40.0, (pkt.dynRadius * 100.0) - loadedRadius))
            : 0;
        const leanEuler = new THREE.Euler().setFromQuaternion(synthQuat, 'YXZ');
        const rawLeanDeg = THREE.MathUtils.radToDeg(leanEuler.z);
        const leanDeg = Math.abs(rawLeanDeg) < 0.1 ? 0.0 : Math.abs(rawLeanDeg);
        const leanDir = rawLeanDeg > 0.1 ? 'L' : (rawLeanDeg < -0.1 ? 'R' : '');
        const synthTrailIdx = (window.peakFollowThroughIdx >= 0 && window.peakFollowThroughIdx < rawTracePoints.length)
            ? window.peakFollowThroughIdx
            : Math.max(0, rawTracePoints.length - 1);
        const targetDist = inGameMode
            ? (parseFloat(document.getElementById('matchDistSetup')?.value) || 10.0)
            : (parseFloat(document.getElementById('trainerDistSetup')?.value) || 5.0);

        castData.push({
            rawDev: 0, unclampedRawDev: 0, dev: 0, dir: 'C', lean: leanDeg, leanDir: leanDir, deflectionDeg: 0,
            isStrike: true, pos: new THREE.Vector3(0, pivotBaseY - loadedRadius, getDynamicFaceZ()), rot: synthQuat.clone(),
            localX: 0, localY: 0, faceAngle: pkt.locTwist, planeTwist: pkt.locTwist, impactTwist: pkt.locTwist,
            pathAngleRads: window.pristinePathAngleRads || 0, aoaDeg: currentSwingAoA,
            passSpeed: pkt.zVel, passForce: calculateImpactForce(pkt.zVel, AppConfig.massKg), dynRadius: pkt.dynRadius,
            stars: "", starColor: "var(--text-muted)", trailIndex: synthTrailIdx,
            pivotQuat: synthQuat, pivotPos: new THREE.Vector3(addressPivotX, pivotBaseY + synthExt, 0),
            extension: synthExt, time: window.impactHwTime || nowTime || globalHwTime,
            isWhiff: false, estAccRange: 0, trueAccRange: 0, trueLaunchDeg: pkt.locTwist,
            estLaunchRads: 0, trueLaunchRads: 0, maxAccRange: 0,
            estDist: calculateEstimatedDistance(pkt.zVel, AppConfig.massKg, AppConfig.lawnSpeed),
            pDelta: lastComputedTempo > 0 ? calculatePendulumDelta(60.0 / lastComputedTempo, AppConfig.handleLengthCm) : null,
            rawBLE: currentRawBLEQuat.clone(), isHit: false, targetDistM: targetDist,
            decelFactor: pkt.decelFactor, backArc: pkt.backArc, backswingTime: pkt.backswingTime,
            tempo: lastComputedTempo, faultDetected: !!pkt.faultDetected
        });
        window.pendingStrikePacket = null;
        window.strikeCastGenerated = true;
    }

    let displayPass = null;
    let appliedDriftY = 0;
    if (impactDetected) { displayPass = castData.find(c => c.isStrike) || castData[castData.length - 1]; } 
    else if (castData.length > 0) { displayPass = castData[castData.length - 1]; }

    // 2. --- SIMPLE IMPACT PINNING (YAW DRIFT + TRANSLATION) ---
        if (impactDetected && displayPass && displayPass.isStrike) {
        // Strip post-collision recoil twist/roll from displayPass BEFORE measuring drift
        if (window.pristineImpactQuat) {
            let pristineEuler = new THREE.Euler().setFromQuaternion(window.pristineImpactQuat, 'YXZ');
            let cleanImpactEuler = new THREE.Euler().setFromQuaternion(displayPass.pivotQuat, 'YXZ');
            cleanImpactEuler.y = pristineEuler.y;
            cleanImpactEuler.z = pristineEuler.z;
            displayPass.pivotQuat.setFromEuler(cleanImpactEuler, 'YXZ');

            let halfHeadLen = (AppConfig.malletLengthCm || 27.6) / 2.0;
            let cleanFaceOffset = new THREE.Vector3(0, -loadedRadius - displayPass.extension, halfHeadLen).applyQuaternion(displayPass.pivotQuat);
            displayPass.pos.copy(displayPass.pivotPos).add(cleanFaceOffset);
        }

        let hardwareTwist = getShaftTwist(displayPass.pivotQuat);
        let hardwareSpeed = window.lastEdgeData.zVel || displayPass.passSpeed || 0;

        // Calculate off-center impact location from recoil torque without warping the 3D trace path
        let rawMm = calculateOffCenterImpact(Math.abs(maxTwist), hardwareSpeed);
        displayPass.offCenterMm = Math.abs(rawMm);

        displayPass.offCenterLabel = "Center";
        if (displayPass.offCenterMm >= 2.0) {
            displayPass.offCenterLabel = maxTwist > 0 ? "R" : "L";
        }
        
        let hwTargetX_cm = displayPass.offCenterMm / 10.0;
        if (displayPass.offCenterLabel === 'L') hwTargetX_cm = -hwTargetX_cm;
        else if (displayPass.offCenterLabel === 'Center') hwTargetX_cm = 0;

        appliedDriftY = 0;

        // C. METRICS RECALCULATION
        displayPass.rawDev = hwTargetX_cm;
        displayPass.dev = Math.abs(hwTargetX_cm);
        displayPass.dir = hwTargetX_cm > 0.1 ? 'R' : (hwTargetX_cm < -0.1 ? 'L' : 'C');
        displayPass.estDist = calculateEstimatedDistance(hardwareSpeed, AppConfig.massKg, AppConfig.lawnSpeed);
        if ((!displayPass.decelFactor) && window.lastEdgeData.decelFactor) {
            displayPass.decelFactor = window.lastEdgeData.decelFactor;
        }
        if (window.pristinePathAngleRads !== undefined && window.pristinePathAngleRads !== null) {
            displayPass.pathAngleRads = window.pristinePathAngleRads;
        }

        // Calculate total ball launch deviation angle (σ) from Face Angle, Collision Deflection, and Swing Path
        let accData = calcAccuracyData(hwTargetX_cm, hardwareTwist, displayPass.pathAngleRads || 0, maxTwist, currentSwingDwell);
        let passRating = getStarRating(hwTargetX_cm, accData.trueLaunchDeg, true);
        
        displayPass.deflectionDeg = accData.collisionDeflection;
        displayPass.trueLaunchDeg = accData.trueLaunchDeg;
        displayPass.trueLaunchRads = accData.trueLaunchRads;
        displayPass.estAccRange = accData.estAccRange;
        displayPass.trueAccRange = accData.trueAccRange;
        displayPass.isWhiff = accData.isWhiff;
        displayPass.stars = passRating.string;
        displayPass.starColor = passRating.color;

        let currentTwistTol = parseFloat(document.getElementById('twistToleranceInput').value) || 1.0;
        let targetDist = inGameMode ? (parseFloat(document.getElementById('matchDistSetup').value) || 10.0) : (parseFloat(document.getElementById('trainerDistSetup').value) || 10.0);
        
        displayPass.isHit = !accData.isWhiff && (Math.abs(hwTargetX_cm) <= AppConfig.sweetSpot) && (Math.abs(accData.trueLaunchDeg) <= currentTwistTol) && (displayPass.estDist >= targetDist);
    }    

    // 3. --- RESOLVE STRIKE ANGLE & STATIC 3D MALLET IMPACT POSE ---
    if (impactDetected && displayPass) {
        if (window.pristineAoARads !== undefined && window.pristineAoARads !== null) {
            displayPass.aoaDeg = THREE.MathUtils.radToDeg(window.pristineAoARads);
        } else if (displayPass.pivotQuat) {
            let crossingEuler = new THREE.Euler().setFromQuaternion(displayPass.pivotQuat, 'YXZ');
            displayPass.aoaDeg = -THREE.MathUtils.radToDeg(crossingEuler.x);
        } else if (window.pristineImpactQuat) {
            let impEuler = new THREE.Euler().setFromQuaternion(window.pristineImpactQuat, 'YXZ');
            displayPass.aoaDeg = -THREE.MathUtils.radToDeg(impEuler.x);
        }
        currentSwingAoA = displayPass.aoaDeg;

        let poseEuler = new THREE.Euler().setFromQuaternion(displayPass.pivotQuat, 'YXZ');
        if (window.pristineImpactQuat) {
            let pristineEuler = new THREE.Euler().setFromQuaternion(window.pristineImpactQuat, 'YXZ');
            poseEuler.y = pristineEuler.y;
            poseEuler.z = pristineEuler.z;
        }
        if (displayPass.aoaDeg !== undefined && displayPass.aoaDeg !== null && !isNaN(displayPass.aoaDeg)) {
            poseEuler.x = -THREE.MathUtils.degToRad(displayPass.aoaDeg);
        }
        displayPass.pivotQuat.setFromEuler(poseEuler, 'YXZ');

        solveStrikeAnchoredPose(displayPass);
        smoothImpactTraceJoin(displayPass.trailIndex, displayPass.pivotQuat, displayPass.extension, displayPass.pivotPos, castData);
    }

    castData.forEach((c, idx) => {
        let prevIdx = idx > 0 ? castData[idx - 1].trailIndex : 0;
        let backMetrics = getFrontFaceBackswingMetricsCm(c.trailIndex, prevIdx);
        c.backArcLength = backMetrics.arcLengthCm > 0 ? backMetrics.arcLengthCm : (c.backArc || 0);
        c.backHeight = backMetrics.heightCm;
    });

    // 4. --- FINALIZE AND DRAW ---
    updateSmoothTrail();
    
    visBase = true; visWobble = false; visTwist = false; window.updateMeshVisibility();
    
    let togBase = document.getElementById('toggleBase'); if (togBase) togBase.classList.add('active');
    let togWobble = document.getElementById('toggleWobble'); if (togWobble) togWobble.classList.remove('active');
    let togTwist = document.getElementById('toggleTwist'); if (togTwist) togTwist.classList.remove('active');
    
    document.getElementById('live-tracking-card').classList.add('hidden'); 
    DisplayElements.countdown.classList.add('hidden');
    document.getElementById('cancelArmBtn').classList.add('hidden'); 
    document.getElementById('ready-group').classList.remove('hidden');

    let lastFrame = recordedFrames.length > 0 ? recordedFrames[recordedFrames.length - 1] : null;
    if (lastFrame) { rewindStartQuat.copy(lastFrame.rotation); rewindStartPos.copy(lastFrame.pivotPos); rewindStartExt = lastFrame.extension; } else { rewindStartQuat.copy(masterPivot.quaternion); rewindStartPos.copy(masterPivot.position); rewindStartExt = 0; }

    if (displayPass) {
        drawStrikeLaser(displayPass);
    }

    if (impactDetected && displayPass && isTargetBallHit(displayPass)) {
        playBombSound();
    } else {
        playDoubleBeep();
    }

    if (displayPass) { finalReviewPivotQuat.copy(displayPass.pivotQuat); finalReviewPivotPos.copy(displayPass.pivotPos); finalReviewExtension = displayPass.extension; currentSwingDeviation = displayPass.dev; } 
    else if (lastFrame) { finalReviewPivotQuat.copy(lastFrame.rotation); finalReviewPivotPos.copy(lastFrame.pivotPos); finalReviewExtension = lastFrame.extension; }

    // Snap directly to final resting position (no 500ms rewind or auto ball-roll)
    masterPivot.quaternion.copy(finalReviewPivotQuat);
    masterPivot.position.copy(finalReviewPivotPos);
    masterBlock.position.set(0, -(loadedRadius + finalReviewExtension), 0);
    headJoint.quaternion.identity();
    appState = 5;
    await sendIdlePromise;

    let effectiveMalletMass = AppConfig.massKg;

    let offCenterHtml = (impactDetected && displayPass && displayPass.offCenterMm !== undefined) ? 
        (displayPass.offCenterMm < 2.0 ? `Center` : `${displayPass.offCenterMm.toFixed(0)}mm ${displayPass.offCenterLabel}`.trim()) : `N/A`;

    let hwAppliedForce = window.lastEdgeData.appliedForce || 0; 
    let afColor = 'var(--text-main)'; 
    if (hwAppliedForce > 2) afColor = 'var(--success)'; 
    else if (hwAppliedForce < -2) afColor = 'var(--danger)'; 

    swingDatabase.push({ frames: [...recordedFrames], rawTracePoints: [...rawTracePoints], casts: [...castData], finalReviewPivotQuat: finalReviewPivotQuat.clone(), finalReviewPivotPos: finalReviewPivotPos.clone(), finalReviewExtension: finalReviewExtension, setupQuat: ghostPivot.quaternion.clone() });

    
    let swingIndex = swingCount; swingCount++;
    window.lastCompletedSwingIdx = swingIndex;
    
    // --- NEW: Upload practice casts to the cloud! ---
    // --- Upload complete practice casts & strike metrics to the cloud ---
    if (castData.length > 0) {
        const swingCloudCtx = {
            massKg: AppConfig.massKg,
            lawnSpeed: AppConfig.lawnSpeed,
            sweetSpotCm: AppConfig.sweetSpot,
            twistToleranceDeg: parseFloat(document.getElementById('twistToleranceInput')?.value) || 1.0,
            targetDistM: getActiveTargetDistM(displayPass),
            peakG: impactDetected ? currentSwingMaxG : null,
            peakTwistDps: impactDetected ? maxTwist : null,
            dwellMs: impactDetected ? currentSwingDwell : null,
            downwardSwingTimeMs: impactDetected ? (window.lastEdgeData.downwardSwingTime || null) : null,
            backswingTimeMs: impactDetected ? (window.lastEdgeData.backswingTime || null) : null
        };
        savePracticeCastsToCloud(castData, lastComputedTempo, swingCloudCtx).then((cloudSwingId) => {
            if (cloudSwingId && swingDatabase[swingIndex]) {
                swingDatabase[swingIndex].cloudSwingId = cloudSwingId;
            }
        });
    }
    
    let ssRad = AppConfig.sweetSpot; let devColor = 'var(--danger)';
    if (impactDetected || displayPass) { 
        if (currentSwingDeviation <= (ssRad / 2.0)) devColor = 'var(--success)'; 
        else if (currentSwingDeviation <= ssRad) devColor = 'var(--warning)'; 
    } else { 
        devColor = 'var(--text-muted)'; 
    }

    let hwBackArc = window.lastEdgeData.backArc || 0;
    let backArcHtml = impactDetected ? `${Math.round(hwBackArc)} cm` : `N/A`;
    let hwBackswingTime = window.lastEdgeData.backswingTime || 0;
    let backswingTimeHtml = impactDetected ? `${hwBackswingTime} ms` : `N/A`;

    // 1. PURE MOMENTUM: Immune to sensor clipping and variable dwell times
    let strikeMomentum = displayPass ? (effectiveMalletMass * displayPass.passSpeed) : 0;
    let momentumHtml = impactDetected ? `${strikeMomentum.toFixed(1)} kg·m/s` : `N/A`;

    // 2. TRANSFERRED IMPACT FORCE: Impulse transferred to the 0.454kg ball over Hertzian dwell time
    let forceN = displayPass ? calculateImpactForce(displayPass.passSpeed, effectiveMalletMass) : 0;
    let forceHtml = impactDetected ? `${(forceN / 1000).toFixed(2)} kN` : `N/A`;

    let devHtml   = (impactDetected || castData.length > 0) && displayPass
        ? (displayPass.isWhiff ? `${currentSwingDeviation.toFixed(1)}cm M` : `${currentSwingDeviation.toFixed(1)}cm ${displayPass.dir}`)
        : `N/A`;
    
    // THE FIX: Dynamically interchange the Impact Location display!
    let impactLocationHtml = impactDetected ? offCenterHtml : devHtml;

    let leanHtml  = (impactDetected || castData.length > 0) && displayPass && displayPass.lean !== undefined ? `${displayPass.lean.toFixed(1)}° ${displayPass.leanDir}`.trim() : `N/A`;
    let velHtml   = displayPass ? `${displayPass.passSpeed.toFixed(1)} m/s` : `--`;
    let tempoHtml = lastComputedTempo > 0 ? `${Math.round(lastComputedTempo)} BPM` : `--`;
    
    let dwellHtml = impactDetected ? `${currentSwingDwell} ms` : `N/A`;
    let finalAoa = (displayPass && displayPass.aoaDeg !== undefined) ? displayPass.aoaDeg : (impactDetected ? currentSwingAoA : null);

    let aoaDir = (finalAoa !== null) ? (Math.abs(finalAoa) < 0.2 ? 'Level' : (finalAoa > 0 ? 'Up' : 'Dn')) : '';
    let aoaHtml = (impactDetected && finalAoa !== null) ? `${Math.abs(finalAoa).toFixed(1)}° ${aoaDir}` : `N/A`;

    let fmtSignedDeg = (v) => {
        if (v === undefined || v === null || isNaN(v)) return `N/A`;
        let clean = Math.abs(v) < 0.05 ? 0 : v;
        return `${clean > 0 ? '+' : ''}${clean.toFixed(1)}°`;
    };
    let distHtml = (impactDetected && displayPass && displayPass.estDist !== undefined) ? `${displayPass.estDist.toFixed(0)}m` : `-`;
    let planeTwistHtml = (displayPass && displayPass.planeTwist !== undefined) ? fmtSignedDeg(displayPass.planeTwist) : `N/A`;
    // Twist = Face-to-Path (Face Angle relative to Swing Path)
    let approachDeg = displayPass ? ((displayPass.pathAngleRads || 0) * (180.0 / Math.PI)) : 0;
    let hitMissHtml = displayPass ? formatTargetHitMissHTML(displayPass) : `N/A`;
    let pathTwistHtml = (displayPass && displayPass.planeTwist !== undefined) ? fmtSignedDeg(displayPass.planeTwist - approachDeg) : `N/A`;
    let devSigmaHtml = (displayPass && !displayPass.isWhiff && displayPass.trueLaunchDeg !== undefined && displayPass.trueLaunchDeg !== null)
        ? fmtSignedDeg(displayPass.trueLaunchDeg)
        : (displayPass && displayPass.isWhiff ? `Mishit` : `N/A`);
    let impactTwistHtml = (displayPass && !displayPass.isWhiff) ? `${(approachDeg > 0 ? '+' : '')}${approachDeg.toFixed(1)}°` : `--`;
    let twistDeflectionVal = displayPass ? calculateCollisionDeflection(maxTwist, currentSwingDwell, displayPass.rawDev) : 0;
    let twistDeflection = (impactDetected && displayPass && displayPass.deflectionDeg !== undefined) ? fmtSignedDeg(displayPass.deflectionDeg) : `N/A`;
    
    let finalStars = displayPass ? displayPass.stars : ""; let finalStarColor = displayPass ? displayPass.starColor : "var(--text-muted)";
    let starHtml  = finalStars !== "" ? `<span style="color: ${finalStarColor};" class="font-bold">${finalStars}</span>` : `<span class="text-muted">-</span>`;
    let trueDir = displayPass && displayPass.trueLaunchRads > 0 ? 'L' : (displayPass && displayPass.trueLaunchRads < 0 ? 'R' : '');
    let estAccHtml = displayPass ? (displayPass.isWhiff ? `-` : `${(displayPass.estAccRange >= 35 ? 'Max' : displayPass.estAccRange.toFixed(0) + 'm')}`) : `N/A`;
    let trueAccHtml = (impactDetected && displayPass) ? (displayPass.isWhiff ? `-` : `${(displayPass.trueAccRange >= 35 ? 'Max' : displayPass.trueAccRange.toFixed(0) + 'm ' + trueDir)}`) : `<span class="text-muted">-</span>`;
    
    let pDeltaHtml = displayPass ? `${formatOffset(displayPass.pDelta)}` : `N/A`;

    let downTime = window.lastEdgeData.downwardSwingTime || 0;
    let rawDecel = impactDetected
        ? ((displayPass && displayPass.decelFactor !== undefined && displayPass.decelFactor !== null)
            ? displayPass.decelFactor
            : window.lastEdgeData.decelFactor)
        : ((displayPass && displayPass.decelFactor !== undefined && displayPass.decelFactor !== null && displayPass.decelFactor !== 0)
            ? displayPass.decelFactor
            : computeFallbackPreImpactAccelPct(displayPass?.trailIndex));
    if (displayPass && rawDecel !== null && rawDecel !== undefined) {
        displayPass.decelFactor = rawDecel;
    }
    let accelHtml = (rawDecel !== null && rawDecel !== undefined && !isNaN(rawDecel))
        ? `${Math.round(rawDecel) > 0 ? '+' : ''}${Math.round(rawDecel)}%`
        : `N/A`;
    let downTimeHtml = impactDetected ? `${downTime} ms` : `N/A`;

    let dsPDelta = downTime > 0 ? calculatePendulumDelta(4.0 * (downTime / 1000.0), AppConfig.handleLengthCm) : null;
    let dsPDeltaHtml = (impactDetected && dsPDelta !== null) ? formatOffset(dsPDelta) : `N/A`;

    // Extract the hardcoded HTML template values into variables
    let edgeVelHtml = `${window.lastEdgeData.zVel.toFixed(2)} m/s`;
    let extHtml = `<span>${hwAppliedForce > 0 ? '+' : ''}${hwAppliedForce.toFixed(0)} N</span>`;
    let advMsgHtml = "";

    let targetLabelHtml = getTargetDistanceLabel(displayPass);

    // MASK THE DATA IF NOT SUBSCRIBED
    if (!AppConfig.isSubscribed) {
        let proBadge = `<span class="text-accent">PRO</span>`;
        planeTwistHtml = proBadge;
        devSigmaHtml = proBadge;
        pathTwistHtml = proBadge;
        aoaHtml = proBadge;
        leanHtml = proBadge;
        twistDeflection = proBadge;
        accelHtml = proBadge;
        pDeltaHtml = proBadge;
        tempoHtml = proBadge; 
        advMsgHtml = `<div class="mt-3 text-center" style="color: var(--danger); font-size: 0.85rem; font-weight: bold;">Please subscribe to see Advanced Metrics</div>`;
    }

    // 1. Render the Casts directly into the card body (No Dropdown)
    let castsHtml = '';
    if (castData.length > 0) {
        let listItems = castData.map((c, i) => {
            return buildCastRowHTML(c, i, swingCount - 1, false);
        }).join('');
        
        castsHtml = `
        <div id="cast-container-${swingIndex}" class="mt-3">
            ${listItems}
        </div>`;
    }

    // 2. ONLY build the Advanced Dropdown if there was a physical strike
    
    // 3. Assemble the perfectly clean History Card with the new permanent toolbar
    let defaultVel = displayPass ? `${(displayPass.passSpeed * 3.6).toFixed(1)} kph` : `--`;
    let arcVal = displayPass ? (displayPass.backArcLength ?? displayPass.backArc) : undefined;
    let backArcMetricHtml = (arcVal !== undefined && arcVal !== null) ? `${Math.round(arcVal)} cm` : `--`;
    let backHeightMetricHtml = (displayPass && displayPass.backHeight !== undefined && displayPass.backHeight !== null) ? `${Math.round(displayPass.backHeight)} cm` : `--`; 
    
 // HELPER: Safely trigger the hidden master toggles from the generated HTML
    if (!window.clickMasterToggle) {
        window.clickMasterToggle = function(type) {
            const checkboxMap = {
                toggleBackswing: 'hideBackswingCheck',
                toggleOptimumArc: 'optimumArcToggle',
                togglePlaneGrid: 'verticalGridToggle',
                toggleFloorGrid: 'floorGridToggle'
            };
            if (checkboxMap[type]) {
                let chk = document.getElementById(checkboxMap[type]);
                if (chk) {
                    chk.checked = !chk.checked;
                    chk.dispatchEvent(new Event('change'));
                }
                return;
            }
            let master = document.getElementById(type);
            if (master) {
                master.click(); // Fires the original logic and updates the variables
                let isActive = master.classList.contains('active');
                // Keep all generated toolbar buttons in sync
                document.querySelectorAll('.' + type + '-clone').forEach(el => {
                    isActive ? el.classList.add('active') : el.classList.remove('active');
                });
            }
        };
    }

    // Capture the current visual state for the new buttons so they spawn correctly
    let baseActive = document.getElementById('toggleBase')?.classList.contains('active') ? 'active' : '';
    let wobbleActive = document.getElementById('toggleWobble')?.classList.contains('active') ? 'active' : '';
    let twistActive = document.getElementById('toggleTwist')?.classList.contains('active') ? 'active' : '';
    let backswingActive = !document.getElementById('hideBackswingCheck')?.checked ? 'active' : '';
    let optimumArcActive = document.getElementById('optimumArcToggle')?.checked ? 'active' : '';
    let planeGridActive = document.getElementById('verticalGridToggle')?.checked ? 'active' : '';
    let floorGridActive = document.getElementById('floorGridToggle')?.checked ? 'active' : '';

    let logHtml = `
        <div class="history-card">
            <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;">
                <div class="flex items-center gap-2">
                    <!-- Clickable Title to Show All Casts -->
                    <span class="swing-title" style="cursor: pointer; text-decoration: underline; text-underline-offset: 4px; white-space: nowrap;" onclick="window.stopSwingReview()" title="Click to view all casts">SWING ${swingCount}</span>
                    
                    <!-- Permanent Icon Toolbar beside the Swing Number -->
                    <div class="trace-toolbar flex items-center" style="gap: 2px; background: var(--bg-secondary); padding: 2px 3px; border-radius: 6px; border: 1px solid var(--border-color);">
                        <!-- Base Trace Icon -->
                        <button class="trace-toggle toggleBase-clone icon-btn ${baseActive}" onclick="window.clickMasterToggle('toggleBase')" title="Toggle Base Trace" style="padding: 3px; border: none; background: transparent; cursor: pointer;">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="20" y2="12"></line></svg>
                        </button>
                        <!-- Wobble Ribbon Icon -->
                        <button class="trace-toggle toggleWobble-clone icon-btn ${wobbleActive}" onclick="window.clickMasterToggle('toggleWobble')" title="Toggle Wobble Ribbon" style="padding: 3px; border: none; background: transparent; cursor: pointer;">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
                        </button>
                        <!-- Twist Ribbon Icon -->
                        <button class="trace-toggle toggleTwist-clone icon-btn ${twistActive}" onclick="window.clickMasterToggle('toggleTwist')" title="Toggle Twist Ribbon" style="padding: 3px; border: none; background: transparent; cursor: pointer;">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><polyline points="3 3 3 8 8 8"></polyline></svg>
                        </button>
                        <!-- Backswing Arc Icon (Ball + Backward Pull-Up Arrow) -->
                        <button class="trace-toggle toggleBackswing-clone icon-btn ${backswingActive}" onclick="window.clickMasterToggle('toggleBackswing')" title="Toggle Backswing Trace" style="color: ${backswingActive ? 'var(--accent-primary)' : 'inherit'}; padding: 3px; border: none; background: transparent; cursor: pointer;">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18.5" cy="18.5" r="2.5" fill="currentColor" stroke="none"></circle><path d="M14.5 18.5Q6.5 18 6 7"></path><polyline points="2.5 11 6 6.5 10 10.5"></polyline></svg>
                        </button>
                        <!-- Optimum Swing Arc Icon -->
                        <button class="trace-toggle toggleOptimumArc-clone icon-btn ${optimumArcActive}" onclick="window.clickMasterToggle('toggleOptimumArc')" title="Toggle Optimum Swing Arc" style="color: ${optimumArcActive ? 'var(--accent-primary)' : 'inherit'}; padding: 3px; border: none; background: transparent; cursor: pointer;">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9a10 10 0 0 0 16 0"></path></svg>
                        </button>
                        <!-- Swing Plane Grid Icon (Upright Grid) -->
                        <button class="trace-toggle togglePlaneGrid-clone icon-btn ${planeGridActive}" onclick="window.clickMasterToggle('togglePlaneGrid')" title="Toggle Swing Plane Grid" style="color: ${planeGridActive ? 'var(--accent-primary)' : 'inherit'}; padding: 3px; border: none; background: transparent; cursor: pointer;">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg>
                        </button>
                        <!-- Floor Grid Icon (Flat Perspective Grid) -->
                        <button class="trace-toggle toggleFloorGrid-clone icon-btn ${floorGridActive}" onclick="window.clickMasterToggle('toggleFloorGrid')" title="Toggle Floor Grid" style="color: ${floorGridActive ? 'var(--accent-primary)' : 'inherit'}; padding: 3px; border: none; background: transparent; cursor: pointer;">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 12 19 12 22 20 2 20"></polygon><line x1="3.5" y1="16" x2="20.5" y2="16"></line><line x1="9.5" y1="12" x2="8.5" y2="20"></line><line x1="14.5" y1="12" x2="15.5" y2="20"></line></svg>
                        </button>
                        
                        <div style="width: 1px; height: 15px; background: var(--border-color); margin: 0 3px;"></div>
                        
                        <!-- Play Button -->
                        <button class="icon-btn replay-btn" data-swing-index="${swingIndex}" title="Replay Trace" style="color: var(--text-main); padding: 3px; border: none; background: transparent; cursor: pointer;">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                        </button>
                    </div>
                </div>
                
                <!-- Timestamp restored to the top line -->
                <div class="flex items-center gap-2">
                    <span class="swing-time" style="white-space: nowrap;">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                </div>
            </div>
            
            ${castsHtml}

            <div id="swing-header-${swingIndex}" class="mt-3">
                ${(impactDetected && displayPass && (displayPass.faultDetected || window.lastEdgeData.faultDetected))
                    ? `<div class="text-danger font-bold text-center mb-2" style="font-size: 0.78rem;">⚠️</div>`
                    : ``}
                <div class="card-basic-stats" style="margin-bottom: 4px;">
                    <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Mallet head speed through the bottom of the swing (kph).">Speed</span><span class="stat-val">${defaultVel}</span></div>
                    <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Projected lateral miss or hit at the target distance (cm Left/Right of target center).">${targetLabelHtml}</span><span class="stat-val">${hitMissHtml}</span></div>
                    <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Strike location on the mallet face relative to center (mm Left/Right).">Impact</span><span class="adv-val text-warning">${impactLocationHtml}</span></div>
                </div>
                <details class="more-metrics">
                    <summary>More</summary>
                    <div class="card-basic-stats">
                        <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Angle of the mallet face relative to the target line at impact (+ Left / - Right).">Face Angle</span><span class="stat-val">${planeTwistHtml}</span></div>
                        <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Total horizontal ball launch angle (σ) off the target line, combining face angle, swing path, and collision deflection.">Deviation (σ)</span><span class="stat-val">${devSigmaHtml}</span></div>
                        <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Angle of the mallet face relative to the swing path (+ Left / - Right).">Twist</span><span class="stat-val">${pathTwistHtml}</span></div><div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Vertical angle of attack of the mallet head into the ball (+ Up / - Down).">Strike Angle</span><span class="stat-val text-accent">${aoaHtml}</span></div>
                        <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Sideways tilt (roll) of the mallet head at impact (Left / Right).">Lean Angle</span><span class="stat-val text-warning">${leanHtml}</span></div>
                        <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Degrees the mallet face twisted left (+) or right (-) during ball contact.">Deflection</span><span class="stat-val text-warning">${twistDeflection}</span></div>
                        <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Average impact force transferred to the ball during collision (kilonewtons).">Strike Force</span><span class="stat-val">${forceHtml}</span></div>
                        <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Change in mallet head speed entering impact (+ accelerating through the ball / - decelerating).">Accel</span><span class="stat-val">${accelHtml}</span></div>
                        <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Overall cadence of the full swing cycle in beats per minute (BPM).">Tempo</span><span class="stat-val">${tempoHtml}</span></div>
                        <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Distance the mallet travels along the swing arc during the backswing (cm).">Backswing Arc</span><span class="stat-val">${backArcMetricHtml}</span></div>
                        <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Maximum vertical height the mallet face lifts above the lawn in the backswing (cm).">Backswing Lift</span><span class="stat-val">${backHeightMetricHtml}</span></div>
                        <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Difference between your swing period and an ideal gravity pendulum of your handle length (cm).">Swing PΔ</span><span class="stat-val">${pDeltaHtml}</span></div>
                    </div>
                </details>
            </div>
        </div>
    `;

    // 4. OVERWRITE THE DOM ONCE
    let listDiv = document.getElementById('history-list');
    if (listDiv) { 
        if (swingCount === 1) listDiv.innerHTML = ''; 
        listDiv.insertAdjacentHTML('afterbegin', logHtml); 
    }

    if (window.innerWidth <= 768) { 
        document.getElementById('history-panel').classList.add('mobile-open'); 
        document.getElementById('control-panel')?.classList.add('hidden');
    } else { 
        document.getElementById('history-panel').classList.remove('desktop-closed'); 
    }
    
    let swingStateTxt = document.getElementById('swing-state');
    if(swingStateTxt) { 
        swingStateTxt.innerHTML = "MALLET CONNECTED<br><span class='small-help text-muted' style='font-size: 0.75rem; font-weight: normal;'>Select an activity to begin.</span>"; 
        swingStateTxt.className = "text-accent text-center font-bold mb-4"; 
    }
}    

let wakeLockSentinel = null;

async function setScreenWakeLock(enable) {
    if (!('wakeLock' in navigator)) return;
    try {
        if (enable && !wakeLockSentinel) {
            wakeLockSentinel = await navigator.wakeLock.request('screen');
            wakeLockSentinel.addEventListener('release', () => { wakeLockSentinel = null; });
        } else if (!enable && wakeLockSentinel) {
            await wakeLockSentinel.release();
            wakeLockSentinel = null;
        }
    } catch (e) {}
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && window.bleManager?.isConnected()) {
        setScreenWakeLock(true);
    }
});

window.bleManager.onStateChange = async (isConnected, name, mac, flashProfile) => {
    if (!isConnected) {
        setScreenWakeLock(false);
        const btToggleBtn = document.getElementById('btToggleBtn'); btToggleBtn.className = "icon-btn bt-disconnected";
        
        document.getElementById('swing-state').innerHTML = "MALLET DISCONNECTED<br><span class='small-help text-muted' style='font-size: 0.75rem; font-weight: normal;'>Ensure Bluetooth is on.</span>"; 
        document.getElementById('swing-state').className = "text-accent text-center font-bold mb-4";
        
        let connectGrp = document.getElementById('connect-group');
        if (connectGrp) connectGrp.classList.remove('hidden');
        document.getElementById('ready-group').classList.add('hidden');
        
        document.getElementById('cancelArmBtn').classList.add('hidden');
        document.getElementById('powerOffBtn').classList.add('hidden');
        document.getElementById('battery-display').classList.add('hidden'); 
        document.getElementById('device-name-display').classList.add('hidden');
        document.getElementById('calibration-container').classList.add('hidden'); 
        appState = 0; 
        if (activeMallet && window.applyMalletToUI) window.applyMalletToUI(activeMallet, false);
        showToast("Mallet disconnected");
        if (inGameMode) { showToast("Mallet disconnected, but match tracking continues offline."); }
    } else {
        setScreenWakeLock(true);
        const bleName = name || window.bleManager.deviceName || "LVE Mallet";
        const btToggleBtn = document.getElementById('btToggleBtn'); btToggleBtn.className = "icon-btn bt-connected";
        appState = 1; initAudio(); 
        
        window.lveLastActiveTime = Date.now();
        window.lveLastMag = 1.0;
      
        let connectGrp = document.getElementById('connect-group');
        if (connectGrp) connectGrp.classList.add('hidden');
        document.getElementById('ready-group').classList.remove('hidden');
        
        document.getElementById('powerOffBtn').classList.remove('hidden');
        document.getElementById('battery-display').classList.remove('hidden'); 
        let nameDisp = document.getElementById('device-name-display'); nameDisp.classList.remove('hidden'); nameDisp.innerText = bleName;

        // Reconcile calibration & physical specs between Xiao Flash, Supabase Cloud & Local Cache
        const resolved = await syncConnectedMallet(mac, bleName, flashProfile);
        const displayTitle = resolved?.name || bleName;

        let swingStateTxt = document.getElementById('swing-state');
        if (swingStateTxt) { 
            const calWarning = (resolved && !resolved.is_calibrated)
                ? "<br><span class='small-help text-warning' style='font-size: 0.75rem; font-weight: bold;'>Mallet uncalibrated — open Mallet menu to calibrate.</span>"
                : "<br><span class='small-help text-muted' style='font-size: 0.75rem; font-weight: normal; text-decoration: none;'>Select an activity to begin.</span>";
            swingStateTxt.innerHTML = `${displayTitle.toUpperCase()} CONNECTED${calWarning}`; 
            swingStateTxt.className = "text-accent text-center font-bold mb-4"; 
        }

        await syncConfigurationToMallet();
        if (inGameMode) {
            await window.bleManager.sendCommand([75]);
        } else {
            await window.bleManager.sendCommand([76]);
        }
        showToast(`Connected to ${displayTitle} (${mac})`);
    }
};

window.lveLastActiveTime = Date.now();
window.lveLastMag = 1.0;

window.bleManager.onBatteryUpdate = (voltage_mV, isCharging, availStrikes) => {
    let adjusted_mV = voltage_mV;
    if (isCharging && voltage_mV < 4150) {
        adjusted_mV -= 150;
    }

    let calculatedPct = 0;
    if (adjusted_mV >= 4050) {
        calculatedPct = 100;
    } else if (adjusted_mV >= 3950) {
        calculatedPct = 80 + ((adjusted_mV - 3950) / 100) * 20;
    } else if (adjusted_mV >= 3750) {
        calculatedPct = 40 + ((adjusted_mV - 3750) / 200) * 40;
    } else if (adjusted_mV >= 3500) {
        calculatedPct = 10 + ((adjusted_mV - 3500) / 250) * 30;
    } else if (adjusted_mV >= 3300) {
        calculatedPct = ((adjusted_mV - 3300) / 200) * 10;
    }

    calculatedPct = Math.max(0, Math.min(100, Math.round(calculatedPct)));

    window.lveBatteryVolts = (voltage_mV / 1000).toFixed(2) + "V";
    window.lveBatteryPct = calculatedPct + "%";
    window.lveIsCharging = isCharging ? "YES" : "NO";

    const batteryDisplay = document.getElementById('battery-display');
    batteryDisplay.classList.remove('hidden');

    if (isCharging) {
        batteryDisplay.innerHTML = `<span class="syncing">⚡</span> Charging`;
        batteryDisplay.style.color = "var(--warning)";
    } else {
        batteryDisplay.innerText = `🔋 ${calculatedPct}%`;
        batteryDisplay.style.color = calculatedPct <= 20 ? "var(--danger)" : "var(--text-main)";
    }
};

window.bleManager.onFirmwareVersion = (ver) => {
    let aboutFw = document.getElementById('about-fw-display');
    if (aboutFw) aboutFw.innerText = ver;
    let modalFw = document.getElementById('fwModalCurrent');
    if (modalFw && ver) modalFw.innerText = ver;
};

window.bleManager.onTelemetryData = (t) => {
    handleParsedTelemetry(t);

    if (devHudEnabled) {
        let debugDiv = document.getElementById('lve-diagnostic-hud-content');
        if (debugDiv) {
            let cleanNumber = (num, dec = 2) => {
                if (num === undefined || num === null || isNaN(num)) return "+" + (0).toFixed(dec);
                let val = Number(num).toFixed(dec);
                if (Number(val) === 0) return "+" + (0).toFixed(dec);
                return Number(val) > 0 ? "+" + val : val;
            };

            let mag = Math.sqrt(t.ax * t.ax + t.ay * t.ay + t.az * t.az);

            let calMat = typeof hardwareMountOffset !== 'undefined' ? hardwareMountOffset : { w: 1, x: 0, y: 0, z: 0 };

            let taredQ = typeof targetQuaternion !== 'undefined' ? targetQuaternion : new THREE.Quaternion();
            let euler = new THREE.Euler().setFromQuaternion(taredQ, 'YXZ');
            let pitchDeg = THREE.MathUtils.radToDeg(euler.x);
            let yawDeg = THREE.MathUtils.radToDeg(euler.y);
            let rollDeg = THREE.MathUtils.radToDeg(euler.z);

            debugDiv.innerHTML = `
                <strong style="color:#ef4444;">POWER MANAGEMENT:</strong><br>
                Voltage: ${window.lveBatteryVolts} (${window.lveBatteryPct}) | Charging: ${window.lveIsCharging}<br><br>

                <strong style="color:#32cd32;">RAW ACCELEROMETER:</strong><br>
                X: ${cleanNumber(t.ax)} | Y: ${cleanNumber(t.ay)} | Z: ${cleanNumber(t.az)}<br>
                Mag: ${cleanNumber(mag)} G<br><br>
                
                <strong style="color:#32cd32;">QUATERNION:</strong><br>
                W: ${cleanNumber(t.q0)} | X: ${cleanNumber(t.q1)}<br>
                Y: ${cleanNumber(t.q2)} | Z: ${cleanNumber(t.q3)}<br><br>

                <strong style="color:#f59e0b;">CALIBRATION MATRIX:</strong><br>
                W: ${cleanNumber(calMat.w, 4)} | X: ${cleanNumber(calMat.x, 4)}<br>
                Y: ${cleanNumber(calMat.y, 4)} | Z: ${cleanNumber(calMat.z, 4)}<br><br>
                
                <strong style="color:#a855f7;">TARED ORIENTATION (DEG):</strong><br>
                Pitch (X): ${cleanNumber(pitchDeg)}°<br>
                Yaw (Y): ${cleanNumber(yawDeg)}°<br>
                Roll (Z): ${cleanNumber(rollDeg)}°
            `;
        }
    }
};
window.bleManager.onHistoricalStrike = handleHistoricalStrike;
window.bleManager.onLiveStrike = handleLiveStrike;
window.bleManager.onError = showToast;

document.getElementById('btToggleBtn').addEventListener('click', () => window.bleManager.connect());
document.getElementById('connectMalletBtn').addEventListener('click', () => window.bleManager.connect());

setInterval(() => {
    if (window.bleManager && window.bleManager.device && window.bleManager.device.gatt.connected) {
        if (appState === 1) { 
            sendBleCommand([80]); // 'P'
        }
    }
}, 10000);

window.lveBatteryVolts = "WAIT...";
window.lveBatteryPct = "WAIT...";
window.lveIsCharging = "WAIT...";

/// --- HUD TOGGLE LOGIC ---
function toggleDeveloperHUD(forceState) {
    // If a specific boolean is passed (like on page load), use it. 
    // Otherwise, toggle the current state (like on a button click).
    if (typeof forceState === 'boolean') {
        if (devHudEnabled === forceState) return;
        devHudEnabled = forceState;
    } else {
        devHudEnabled = !devHudEnabled;
    }

    // Save the new state to the browser's memory
    localStorage.setItem('LVE_DevHudEnabled', devHudEnabled);

    let existingDiv = document.getElementById('lve-diagnostic-hud');
    
    if (devHudEnabled) {
        if (!existingDiv) {
            const debugDiv = document.createElement('div');
            debugDiv.id = 'lve-diagnostic-hud';
            
            debugDiv.style.cssText = 'position: fixed; top: 70px; left: 10px; background: rgba(0,0,0,0.85); padding: 15px; border-radius: 8px; z-index: 9999; pointer-events: auto; min-width: 280px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); cursor: grab;';
            
            const closeBtn = document.createElement('button');
            closeBtn.innerHTML = '✕';
            closeBtn.style.cssText = 'position:absolute; top:0px; right:5px; padding:10px; background:none; border:none; color:var(--danger); font-size:16px; font-weight:bold; cursor:pointer; pointer-events:auto;';
            
            closeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation(); 
                toggleDeveloperHUD();
            });
            
            const contentDiv = document.createElement('div');
            contentDiv.id = 'lve-diagnostic-hud-content';
            contentDiv.style.color = '#ffffff';
            
            debugDiv.appendChild(closeBtn);
            debugDiv.appendChild(contentDiv);
            document.body.appendChild(debugDiv);

            let isDragging = false, dragOffsetX = 0, dragOffsetY = 0;
            
            const startDrag = (clientX, clientY, target) => {
                if (target === closeBtn) return; 
                isDragging = true;
                debugDiv.style.cursor = 'grabbing';
                const rect = debugDiv.getBoundingClientRect();
                dragOffsetX = clientX - rect.left;
                dragOffsetY = clientY - rect.top;
            };

            const doDrag = (clientX, clientY) => {
                if (!isDragging) return;
                debugDiv.style.left = (clientX - dragOffsetX) + 'px';
                debugDiv.style.top = (clientY - dragOffsetY) + 'px';
                debugDiv.style.right = 'auto';  
                debugDiv.style.bottom = 'auto';
            };

            const stopDrag = () => {
                isDragging = false;
                debugDiv.style.cursor = 'grab';
            };

            debugDiv.addEventListener('mousedown', (e) => startDrag(e.clientX, e.clientY, e.target));
            document.addEventListener('mousemove', (e) => doDrag(e.clientX, e.clientY));
            document.addEventListener('mouseup', stopDrag);

            debugDiv.addEventListener('touchstart', (e) => startDrag(e.touches[0].clientX, e.touches[0].clientY, e.target), {passive: true});
            document.addEventListener('touchmove', (e) => { 
                if(isDragging) {
                    e.preventDefault(); 
                    doDrag(e.touches[0].clientX, e.touches[0].clientY); 
                }
            }, {passive: false});
            document.addEventListener('touchend', stopDrag);
        } else {
            existingDiv.style.display = 'block';
        }
        if(typeof showToast === "function") showToast("DIAGNOSTIC HUD ENABLED");
    } else {
        if (existingDiv) existingDiv.style.display = 'none';
        if(typeof showToast === "function") showToast("DIAGNOSTIC HUD DISABLED");
    }
}

window.fetchCloudMatches = fetchCloudMatches;
window.fetchCloudStrikes = fetchCloudStrikes;
window.openMatchEdit = openMatchEdit;
window.deleteCloudSession = deleteCloudSession; 

document.getElementById('training-tab-content').addEventListener('click', (e) => {
    const replayBtn = e.target.closest('.replay-btn');
    if (replayBtn) {
        const swingIndex = parseInt(replayBtn.getAttribute('data-swing-index'), 10);
        if (!isNaN(swingIndex)) triggerReplay(swingIndex);
        return; 
    }

    const castRow = e.target.closest('.highlight-pass-btn');
    if (castRow) {
        // If the row is ALREADY active, tapping it again stops the review!
        if (castRow.classList.contains('active-cast-row')) {
            window.stopSwingReview();
            return;
        }

        const swingIdx = parseInt(castRow.getAttribute('data-swing-index'), 10);
        const castIdx = parseInt(castRow.getAttribute('data-cast-index'), 10);
        if (!isNaN(swingIdx) && !isNaN(castIdx)) {
            highlightPass(swingIdx, castIdx);
        }
    }
});

// Trigger the Stop logic if the user manually collapses the "View Casting Traces" accordion
document.getElementById('training-tab-content').addEventListener('toggle', (e) => {
    if (e.target.tagName === 'DETAILS' && e.target.classList.contains('advanced-metrics')) {
        if (!e.target.open) window.stopSwingReview();
    }
}, true); // 'true' forces the event to capture since <details> toggle events don't bubble naturally

document.getElementById('powerOffBtn').addEventListener('click', async () => {
    if (confirm("Are you sure you want to power off the mallet?")) {
        showToast("Powering off mallet...");
        
        window.bleManager.intentionalDisconnect = true;

        // 1. Force writeValueWithResponse by passing 'true' as the second argument
        // This guarantees delivery at the BLE protocol level
        await sendBleCommand([88], true); 
        
        // 2. Safety Retry Loop: Check if the connection is still alive after 2 seconds
        setTimeout(async () => {
            if (window.bleManager && window.bleManager.device && window.bleManager.device.gatt.connected) {
                console.warn("Power off ACK missed or dropped. Retrying 'X' command...");
                await sendBleCommand([88], true);
            }
        }, 2000);
    }
});
