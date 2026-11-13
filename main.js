import { initAudio, audioCtx, playBeep, playDoubleBeep, playTick, isAudioInitialized, isSoundEnabled, toggleSoundState, playSuccessSound } from './audio.js';
import { difficultyMatrix, getStarRating, getShaftTwist, calcAccuracyData, calculateImpactForce, calculateMomentum, calculateEstimatedDistance, calculatePendulumDelta, calculateCollisionDeflection, calculateTrueDwell, calculateOffCenterImpact, anchorSwingToImpact } from './kinematics.js';
import { showToast, formatOffset, buildCastRowHTML } from './utils.js';
import { supabaseClient, currentUser, setCurrentUser, loadCloudProfile, saveCloudProfile, fetchCloudMatches, fetchCloudStrikes, savePracticeCastsToCloud, fetchCloudTraining, deleteCloudSession, getAiCoachFeedback } from './cloud.js';
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
    setActiveOffsetZ
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
    hideBackswing: true
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

    let offZInp = document.getElementById('offsetZInput');
    AppConfig.offsetZCm = offZInp ? (parseFloat(offZInp.value) || 10.0) : 10.0;

    }

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
}

document.getElementById('floorGridToggle').addEventListener('change', (e) => {
    floorGrid.visible = e.target.checked;
});

document.getElementById('verticalGridToggle').addEventListener('change', (e) => {
    verticalGrid.visible = e.target.checked;
});

document.body.addEventListener('input', syncAppConfig);
document.body.addEventListener('change', syncAppConfig);

window.syncHardwareOffsetFromCloud = function(x, y, z, w) {
    hardwareMountOffset.set(x, y, z, w);
    updateMalletScale();
    saveSettings();
};

window.pristinePathAngleRads = 0

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

    let payload = [ 67, radius, mass / 10, impact * 10, offsetY * 10, timeout, sweetSpot * 10, ledGuidance, Math.round(twist * 10) ];
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
    let success = await sendBleCommand([90]); // 'Z'
    if (!success) { showToast("BLE Error."); return; }
    
    zeroRawBLEQuat.copy(currentRawBLEQuat);
    
    if (isBallEnabled) { 
        ghostPivot.quaternion.identity(); 
        updateSystemGeometry(); 
        virtualBall.visible = true; 
    } else { virtualBall.visible = false; }

    appState = 2; calibrationPhase = 'RED'; redStartTime = Date.now(); isReviewingLog = false;
    
    let camX = isViewFlipped ? -100 : 100; camera.position.set(camX, pivotBaseY - loadedRadius, 0); controls.target.set(0, pivotBaseY - loadedRadius, 0); controls.update();
    
    let initialEuler = new THREE.Euler().setFromQuaternion(lastRawQuat, 'YXZ');
    let initialHeading = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, initialEuler.y, 0, 'YXZ'));
    baseQuatInverse.copy(initialHeading).invert(); 
    targetQuaternion.copy(baseQuatInverse).multiply(lastRawQuat); 
    currentQuaternion.copy(targetQuaternion); 
    masterPivot.quaternion.copy(currentQuaternion);

    document.getElementById('ready-group').classList.add('hidden'); document.getElementById('cancelArmBtn').classList.remove('hidden');
    let swingStateTxt = document.getElementById('swing-state'); if(swingStateTxt) { swingStateTxt.innerText = "ESTABLISHING HEADING..."; swingStateTxt.className = "text-danger text-center font-bold mb-4"; }
    DisplayElements.countdown.classList.add('hidden'); document.getElementById('calibration-container').classList.remove('hidden');
    let calibBar = document.getElementById('calibration-bar'); calibBar.style.width = "0%"; calibBar.style.background = "var(--danger)";
    preRollBuffer = []; castData = []; clearImpactLasers(); rawTracePoints.length = 0; updateSmoothTrail(0);
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
            if (AppConfig.isSubscribed) fetchCloudTraining();
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

function getDynamicFaceZ() { 
    // Uses exact posture if locked, otherwise defaults perfectly to the sensor offset
    return lockedFaceZ !== null ? lockedFaceZ : AppConfig.offsetZCm; 
}
// ---------------------------------------------------------------------

function getDynamicBallZ() { return getDynamicFaceZ() + 4.6; }

let globalHwTime = 0;

let appState = 0; let armedUiStartTime = 0; let state4UiStartTime = 0; let state4StartTime = 0; let goTimeout; let ignoreSpeedUntilTime = 0; let isReviewingLog = false; 
let recordTicks = 0; let postImpactTicks = 0;
let calibrationPhase = 'NONE'; let redStartTime = 0; let calibrationHoldTimeMs = 0; let lastJsTime = 0; let orangeStartTime = 0; 
let lastRawQuat = new THREE.Quaternion(); let baseQuatInverse = new THREE.Quaternion(); let lastStableQuat = new THREE.Quaternion();
let targetQuaternion = new THREE.Quaternion(); let prevTargetQuaternion = new THREE.Quaternion(); let currentQuaternion = new THREE.Quaternion();
let finalReviewPivotQuat = new THREE.Quaternion(); let finalReviewPivotPos = new THREE.Vector3(); let finalReviewExtension = 0; 

let hardwareMountOffset = new THREE.Quaternion(); let isWizardActive = false; let wizardStep = 0; let capturing = false;
let tuneBaseOffset = new THREE.Quaternion(); window.currentlyViewedCast = null;
let currentRawBLEQuat = new THREE.Quaternion(); let prevRawBLEQuat = new THREE.Quaternion();
let zeroRawBLEQuat = new THREE.Quaternion(); window.tuningFrozenFrame = null;
let isDynamicCalibrationActive = false; let dynamicCalibrationBuffer = [];

let devHudEnabled = false;

let hasLiftedOff = false; // <-- NEW: Tracks the start of the backswing

let wizardBuffer = []; const WIZARD_BUFFER_SIZE = 15; const WIZARD_VARIANCE_THRESH = 0.02; let vectors = { top: null, bottom: null, front: null, back: null, left: null, right: null };
let lastBatteryCheckTime = 0; let lastBatteryVal = -1; let chargeRatePerMs = 0;

let savedBleName = "Unknown Mallet";

let preRollBuffer = []; let prevMagnitude = 1.0; let posHistory = []; let currentAbsoluteSpeed = 0; 
let prevFaceZ = 0; let prevZ = 0; let isForwardSwing = true; let lastForwardPassTime = 0; 
let rewindStartTime = 0; let rewindStartQuat = new THREE.Quaternion(); let rewindStartPos = new THREE.Vector3(); let rewindStartExt = 0;

let swingCount = 0; let currentSwingMaxSpeed = 0; let currentSwingMaxG = 0; let currentSwingDeviation = 0; let currentSwingDist = 0;
let lastComputedTempo = 0; let maxTwist = 0; let currentSwingDwell = 0; let currentSwingAoA = 0;
window.lastEdgeData = { zVel: 0, pushForce: 0, appliedForce: 0, downwardSwingTime: 0, decelFactor: 0 }; 

let castData = []; let idealPlane = null;
let impactDetected = false; let impactThreshold = 4.0; let audioThreshold = 2.0; let nextMetronomeTime = 0;
let isLive = true; let recordedFrames = []; let swingDatabase = []; let playbackMode = false; let playbackIndex = 0;
let isPaused = false; let isSlowMo = false; let lastPlaybackTime = 0;

let inGameMode = false;
let gmStrokeCount = 0;
window.matchAligned = false;
window.matchSwinging = false;

let downloadedHistory = [];
let isGhostEnabled = true;
let isBallEnabled = true;
let isViewFlipped = false;

const settingsElements = [
    'malletNameInput', 'malletLengthInput', 'malletWidthInput', 'radiusInput', 'massInput', 
    'sweetSpotInput', 'lawnSpeedInput', 'impactInput', 'metronomeCheck', 'metronomeBpm', 
    'audioThreshInput', 'durationInput', 'practiceInput', 'showTraceCheck', 'offsetYInput', 'offsetZInput',
    'timeoutInput', 'flatMagInput', 'ledGuidanceCheck', 'difficultySelect', 'allowRealtimeTuningCheck',
    'trainerDistSetup', 'trainerTwistSetup', 'singleSwingCheck', 
    'matchLedToggle', 'matchAudioToggle', 'matchDistSetup', 'matchTwistSetup', 'matchLawnSetup',
    'experimentalCheck', 'showCloudDataCheck','darkThemeCheck', 'soundCheck', 'flipViewCheck', 'floorGridToggle', 'verticalGridToggle',
    'playerNameInput', 'playerCountryInput', 'optimumArcToggle', 'subscribedCheck', 'hideBackswingCheck'
];

document.getElementById('openDisplayBtn').onclick = () => { document.getElementById('display-modal').showModal(); document.getElementById('menu-drawer').classList.remove('open'); };
document.getElementById('closeDisplayBtn').onclick = () => { document.getElementById('display-modal').close(); };

async function sendBleCommand(cmdArray, withResponse = false) {
    return await window.bleManager.sendCommand(cmdArray, withResponse);
}

async function resetSystemState(silent = false, wipeHistory = false) {
    clearTimeout(goTimeout); 
    appState = 1; 
    calibrationPhase = 'NONE'; 
    isReviewingLog = false;
    impactDetected = false; 
    isLive = true; 
    playbackMode = false; 
    recordedFrames = [];
    isDynamicCalibrationActive = false;

    hasLiftedOff = false; // <-- NEW
    lockedFaceZ = null;   // <-- NEW: Clear the posture memory on reset
    window.pendingStrikePacket = null; // <-- NEW: Clear old strike packets!


    window.matchAligned = false;
    window.matchSwinging = false;

    if (!silent) { await sendBleCommand([79]); }

    document.getElementById('cancelArmBtn').classList.add('hidden'); 
    document.getElementById('ready-group').classList.remove('hidden');
    document.getElementById('calibration-container').classList.add('hidden');
    document.getElementById('live-tracking-card').classList.add('hidden');
    document.getElementById('playback-panel').classList.add('hidden');
    document.getElementById('alignment-panel').style.display = 'none';
    
    let swingStateTxt = document.getElementById('swing-state'); 
    if(swingStateTxt) { 
        swingStateTxt.innerHTML = "MALLET CONNECTED<br><span class='small-help text-muted' style='font-size: 0.75rem; font-weight: normal;'>Select an activity to begin.</span>"; 
        swingStateTxt.className = "text-accent text-center font-bold mb-4"; 
    }
    
    virtualBall.visible = false; 
    let arcToggle = document.getElementById('optimumArcToggle');
    ghostRail.visible = arcToggle ? arcToggle.checked : false;
    preRollBuffer = []; 
    castData = []; 
    clearImpactLasers(); 
    rawTracePoints.length = 0; 
    updateSmoothTrail(0);
    
    masterPivot.quaternion.identity(); 
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
            
            // --- NEW: Wipe the local browser memory ---
            localStorage.removeItem('LVE_Settings'); 
            
            showToast("Signed out. Clearing local settings..."); 
            
            // Reload the page after a brief delay to completely reset the UI
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        };
        
        
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
            if (!hasLoadedCloudProfile) {
                loadCloudProfile();
                hasLoadedCloudProfile = true;
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

document.getElementById('devResetCalibrationBtn').onclick = () => {
    if (confirm("Reset calibration matrix to perfect zero (Identity)?")) {
        hardwareMountOffset.set(0, 0, 0, 1);
        saveSettings();
        showToast("Calibration wiped locally.");
        document.getElementById('dev-options-modal').close();
    }
};

document.getElementById('openAboutBtn').onclick = () => { document.getElementById('about-modal').showModal(); document.getElementById('menu-drawer').classList.remove('open'); };
document.getElementById('closeAboutBtn').onclick = () => { document.getElementById('about-modal').close(); };

document.getElementById('openMalletBtn').onclick = () => { document.getElementById('mallet-modal').showModal(); document.getElementById('menu-drawer').classList.remove('open'); };
document.getElementById('closeMalletBtn').onclick = () => { document.getElementById('mallet-modal').close(); };

document.getElementById('openPlayerBtn').onclick = () => { document.getElementById('player-modal').showModal(); document.getElementById('menu-drawer').classList.remove('open'); };
document.getElementById('closePlayerBtn').onclick = () => { document.getElementById('player-modal').close(); };

document.getElementById('openSystemBtn').onclick = () => { document.getElementById('system-modal').showModal(); document.getElementById('menu-drawer').classList.remove('open'); };
document.getElementById('closeSystemBtn').onclick = () => { document.getElementById('system-modal').close(); };

document.getElementById('closeDevOptionsBtn').onclick = () => { document.getElementById('dev-options-modal').close(); };

document.getElementById('enterTuningBtn').onclick = () => {
    if (!window.currentlyViewedCast) return;
    document.getElementById('alignment-panel').style.display = 'block';
    tuneBaseOffset.copy(hardwareMountOffset);
    
    document.getElementById('spinY').value = 0.0;
    document.getElementById('spinYValue').innerText = "0.0°";
    
    let c = window.currentlyViewedCast;
    
    masterPivot.quaternion.copy(c.pivotQuat);
    masterPivot.position.copy(c.pivotPos);
    masterBlock.position.set(0, -(loadedRadius + c.extension), 0);
    
    ghostPivot.quaternion.copy(c.pivotQuat);
    ghostPivot.position.copy(c.pivotPos);
    ghostBlock.position.set(0, -(loadedRadius + c.extension), 0);
    
    if (mainMalletMesh) { mainMalletMesh.visible = true; ghostMalletMesh.visible = isGhostEnabled; }
    virtualBall.visible = false;
    clearImpactLasers();

    if (typeof targetEnvironmentGroup !== 'undefined') {
        targetEnvironmentGroup.rotation.y = 0; 
        if (typeof floorGrid !== 'undefined') floorGrid.visible = true;
        if (typeof targetArrow !== 'undefined') targetArrow.visible = true;
        if (typeof ghostRail !== 'undefined') ghostRail.visible = true;
    }
};

document.getElementById('spinY').addEventListener('input', (e) => { 
    let val = parseFloat(e.target.value) || 0;
    document.getElementById('spinYValue').innerText = val.toFixed(1) + "°";
    if (typeof targetEnvironmentGroup !== 'undefined') {
        targetEnvironmentGroup.rotation.y = THREE.MathUtils.degToRad(val); 
    }
});

document.getElementById('snapYawBtn').onclick = () => {
    if (!window.currentlyViewedCast) return;
    let pathRads = window.currentlyViewedCast.pathAngleRads;
    let pathDeg = THREE.MathUtils.radToDeg(pathRads);
    document.getElementById('spinY').value = pathDeg.toFixed(1);
    document.getElementById('spinYValue').innerText = pathDeg.toFixed(1) + "°";
    if (typeof targetEnvironmentGroup !== 'undefined') {
        targetEnvironmentGroup.rotation.y = pathRads;
    }
};

document.getElementById('cancelTuneBtn').onclick = () => {
    document.getElementById('alignment-panel').style.display = 'none';
    hardwareMountOffset.copy(tuneBaseOffset); 
    if (typeof floorGrid !== 'undefined') floorGrid.visible = false;
    if (typeof targetArrow !== 'undefined') targetArrow.visible = false;
    document.getElementById('exitPassViewBtn').click();
    showToast("Tuning Cancelled. Matrix restored.");
};

document.getElementById('saveTuneBtn').addEventListener('click', () => {
    let yawCorrectionDeg = -parseFloat(document.getElementById('spinY').value) || 0;
    let yawRads = yawCorrectionDeg * (Math.PI / 180);

    let baseQuat = new THREE.Quaternion(hardwareMountOffset.x, hardwareMountOffset.y, hardwareMountOffset.z, hardwareMountOffset.w);
    let tuningEuler = new THREE.Euler(0, yawRads, 0, 'YXZ'); 
    let tuningQuat = new THREE.Quaternion().setFromEuler(tuningEuler);

    let unifiedQuat = new THREE.Quaternion();
    unifiedQuat.multiplyQuaternions(tuningQuat, baseQuat).normalize(); 

    // --- RESTORED LOGIC TO SAVE LOCALLY ---
    hardwareMountOffset.copy(unifiedQuat);
    document.getElementById('alignment-panel').style.display = 'none';
    if (typeof floorGrid !== 'undefined') floorGrid.visible = false;
    if (typeof targetArrow !== 'undefined') targetArrow.visible = false;
    saveSettings();
    showToast("Target Line Offset Saved.");
});

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

let lawnInput = document.getElementById('lawnSpeedInput');
if (lawnInput) lawnInput.addEventListener('input', updateLawnSpeedLabel);

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
if (matchLawnInput) matchLawnInput.addEventListener('input', updateMatchLawnSpeedLabel);

let matchDistInput = document.getElementById('matchDistSetup');
if (matchDistInput) matchDistInput.addEventListener('input', (e) => {
    let lbl = document.getElementById('matchDistLabel');
    if (lbl) lbl.innerText = parseFloat(e.target.value).toFixed(1);
});

let trainerDistInput = document.getElementById('trainerDistSetup');
if (trainerDistInput) trainerDistInput.addEventListener('input', (e) => {
    let lbl = document.getElementById('trainerDistLabel');
    if (lbl) lbl.innerText = parseFloat(e.target.value).toFixed(1);
});

window.addEventListener('beforeunload', () => { window.bleManager.disconnect(); });

function saveSettings() {
    try {
        const settings = {};
        settingsElements.forEach(id => { const el = document.getElementById(id); if(el) settings[id] = (el.type === 'checkbox') ? el.checked : el.value; });
        settings['hwMatrixX'] = hardwareMountOffset.x; settings['hwMatrixY'] = hardwareMountOffset.y; settings['hwMatrixZ'] = hardwareMountOffset.z; settings['hwMatrixW'] = hardwareMountOffset.w;
        settings['bleName'] = savedBleName; localStorage.setItem('LVE_Settings', JSON.stringify(settings));
    } catch (e) {}
    if (currentUser) { saveCloudProfile(hardwareMountOffset); }
}

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
        targetEnvironmentGroup.position.set(0, pivotBaseY, 0);
        if (typeof ghostPivot !== 'undefined' && ghostPivot) {
            targetEnvironmentGroup.quaternion.copy(ghostPivot.quaternion);
        }
        
        if(typeof floorGrid !== 'undefined') floorGrid.position.y = -loadedRadius;
        if(typeof targetArrow !== 'undefined') targetArrow.position.y = -loadedRadius + 0.1;
        
        // Offset by +50 so the bottom edge of the 100-unit grid touches the floor (-loadedRadius)
        if(typeof verticalGrid !== 'undefined') verticalGrid.position.y = -loadedRadius+50;
    }
}

function updateMalletScale() {
    if (!mainMalletMesh || !ghostMalletMesh) return;
    let len = AppConfig.malletLengthCm; 
    let wid = AppConfig.malletWidthCm;
    let offsetZ = AppConfig.offsetZCm;

    if (typeof setActiveOffsetZ === 'function') setActiveOffsetZ(offsetZ);
    
    setMalletHalfWidth(wid / 2.0);
    if (typeof setMalletDimensions === 'function') setMalletDimensions(len, wid); 

    let scaleX = len / baseStlSize.x; 
    let scaleY = wid / baseStlSize.y; 
    let scaleZ = wid / baseStlSize.z; 
    
    mainMalletMesh.scale.set(scaleX, scaleY, scaleZ); 
    ghostMalletMesh.scale.set(scaleX, scaleY, scaleZ);
    
    // Shift the physical mallet mesh backward so the sensor sits at the true offset
    let meshShift = offsetZ - (len / 2.0); 
    mainMalletMesh.position.z = meshShift; 
    ghostMalletMesh.position.z = meshShift; 

    if (handleMesh) handleMesh.position.z = meshShift;
    if (ghostHandleMesh) ghostHandleMesh.position.z = meshShift;
    
    // Pin the face tracker exactly at the physical front face
    faceTrackerNode.position.set(0, 0, offsetZ);
    
    updateSystemGeometry(); 
    rebuildArcPts(loadedRadius);
}

function loadSettings() {
    try {
        const saved = localStorage.getItem('LVE_Settings');
        if (saved) {
            const settings = JSON.parse(saved);
            settingsElements.forEach(id => { 
                if (settings[id] !== undefined) { 
                    const el = document.getElementById(id); 
                    if (el) { 
                        if (el.type === 'checkbox') el.checked = settings[id]; 
                        else {
                            if (id === 'lawnSpeedInput' || id === 'matchLawnSetup') { 
                                let val = parseFloat(settings[id]); 
                                if (val < 4.0) val = 10 + (val - 0.50) / 0.075; 
                                el.value = val.toFixed(1); 
                            } 
                            else el.value = settings[id]; 
                        }
                    } 
                } 
            });
            if (settings['hwMatrixW'] !== undefined) hardwareMountOffset.set(settings['hwMatrixX'], settings['hwMatrixY'], settings['hwMatrixZ'], settings['hwMatrixW']);
            if (settings['bleName'] !== undefined) savedBleName = settings['bleName'];
            let audioEl = document.getElementById('audioThreshInput'); let impactEl = document.getElementById('impactInput');
            if(audioEl) audioThreshold = parseFloat(audioEl.value); if(impactEl) impactThreshold = parseFloat(impactEl.value);
        }
    } catch (e) {} 
    
    updateLawnSpeedLabel(); 
    updateMalletScale();
    
    if (typeof updateMatchLawnSpeedLabel === 'function') updateMatchLawnSpeedLabel();
    
    let matchDistEl = document.getElementById('matchDistSetup');
    let matchDistLbl = document.getElementById('matchDistLabel');
    if (matchDistEl && matchDistLbl) {
        matchDistLbl.innerText = parseFloat(matchDistEl.value).toFixed(1);
    }

    let trainerDistEl = document.getElementById('trainerDistSetup');
    let trainerDistLbl = document.getElementById('trainerDistLabel');
    if (trainerDistEl && trainerDistLbl) {
        trainerDistLbl.innerText = parseFloat(trainerDistEl.value).toFixed(1);
    }    
    
    syncAppConfig();
    updateExperimentalFeatures();

    ['darkThemeCheck', 'soundCheck', 'flipViewCheck', 'floorGridToggle', 'verticalGridToggle', 'optimumArcToggle'].forEach(id => {
        let el = document.getElementById(id);
        if(el) el.dispatchEvent(new Event('change'));
    });

}

settingsElements.forEach(id => { let el = document.getElementById(id); if(el) el.addEventListener('change', () => { saveSettings(); updateMalletScale(); if (id === 'lawnSpeedInput') updateLawnSpeedLabel(); }); });
let expCheck = document.getElementById('experimentalCheck');
if (expCheck) {
    expCheck.addEventListener('change', updateExperimentalFeatures);
}

// NEW: Refresh the cloud tab immediately when toggled
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
    settingsElements.forEach(id => { let el = document.getElementById(id); if(el) profile[id] = el.type === 'checkbox' ? el.checked : el.value; });
    let dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(profile));
    let dlAnchorElem = document.createElement('a'); dlAnchorElem.setAttribute("href", dataStr);
    let safeName = (profile.malletNameInput || "mallet").replace(/[^a-z0-9]/gi, '_').toLowerCase();
    dlAnchorElem.setAttribute("download", safeName + "_profile.lve"); document.body.appendChild(dlAnchorElem); dlAnchorElem.click(); document.body.removeChild(dlAnchorElem);
    showToast("Hardware Profile Exported as .LVE"); document.getElementById('mallet-modal').close();
};

document.getElementById('importProfileBtn').onclick = () => { document.getElementById('importFileInput').click(); };
document.getElementById('importFileInput').addEventListener('change', (event) => {
    let file = event.target.files[0]; if (!file) return; let reader = new FileReader();
    reader.onload = function(e) {
        try {
            let profile = JSON.parse(e.target.result);
            if(profile.hwMatrixW !== undefined) hardwareMountOffset.set(profile.hwMatrixX, profile.hwMatrixY, profile.hwMatrixZ, profile.hwMatrixW);
            settingsElements.forEach(id => { 
                if (profile[id] !== undefined) { 
                    let el = document.getElementById(id); 
                    if(el) { 
                        if (el.type === 'checkbox') el.checked = profile[id]; 
                        else {
                            if (id === 'lawnSpeedInput') { let val = parseFloat(profile[id]); if (val < 4.0) val = 10 + (val - 0.50) / 0.075; el.value = val.toFixed(1); } 
                            else el.value = profile[id]; 
                        }
                    } 
                } 
            });
            saveSettings(); updateMalletScale(); updateLawnSpeedLabel(); syncAppConfig(); showToast("Hardware Profile Loaded Successfully."); document.getElementById('importFileInput').value = ''; 
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
});

document.getElementById('verticalGridToggle').addEventListener('change', (e) => {
    if(typeof verticalGrid !== 'undefined') verticalGrid.visible = e.target.checked;
});

document.getElementById('optimumArcToggle').addEventListener('change', (e) => {
    if(typeof ghostRail !== 'undefined') ghostRail.visible = e.target.checked;
});

document.getElementById('hideBackswingCheck').addEventListener('change', (e) => {
    syncAppConfig();
    if (rawTracePoints.length > 0) updateSmoothTrail(); // Instantly redraws the line
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
    { title: "Step 1: Bottom Face & Setup", desc: "Remove the mallet shaft and set a 'True North' heading line on a flat table. Place the BOTTOM sole flat on the table with the Front striking face pointing at 'True North' and shaft hole pointing UP.", btn: "CAPTURE BOTTOM" },
    { title: "Step 2: Top Face", desc: "Flip the head upside down onto its TOP face (rest on two equal books so the sensor clears the table). Keep the Front striking face pointing at 'True North'.", btn: "CAPTURE TOP" },
    { title: "Step 3: Front Face", desc: "Stand the head vertically on its FRONT striking face. Point the Top face (shaft hole) directly at 'True North' along your Heading Line.", btn: "CAPTURE FRONT" },
    { title: "Step 4: Back Face", desc: "Flip the head 180° to stand vertically on its BACK striking face. The Top face (shaft hole) STILL points directly at 'True North'.", btn: "CAPTURE BACK" },
    { title: "Step 5: Left Side", desc: "Lay the head on its LEFT side: Front striking face pointing at 'True North', and shaft hole (Top face) pointing to your RIGHT (matching the 3D view).", btn: "CAPTURE LEFT" },
    { title: "Step 6: Right Side", desc: "Roll it 180° onto its RIGHT side: Front striking face pointing at 'True North', and shaft hole (Top face) pointing to your LEFT (matching the 3D view).", btn: "CAPTURE RIGHT" }
];

function updateWizardUI() {
    let config = wizardInstructions[wizardStep];
    document.getElementById('wizard-step-title').innerText = config.title;
    document.getElementById('wizard-instruction').innerText = config.desc;
    document.getElementById('wizard-progress').innerText = `Step ${wizardStep + 1} of 6`;
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
    // Anchor vertical Z axis directly to the playing sole (Step 1: Bottom face flat on level table)
    // so Pitch and Roll read exact 0.00° at address regardless of book height or curved sides.
    let zAxis = vectors.bottom.clone().negate().normalize();

    // Project Front/Back and Left/Right captures onto the horizontal plane perpendicular to zAxis
    let xRaw = new THREE.Vector3().subVectors(vectors.front, vectors.back);
    xRaw.addScaledVector(zAxis, -xRaw.dot(zAxis)).normalize();

    let yRaw = new THREE.Vector3().subVectors(vectors.left, vectors.right);
    yRaw.addScaledVector(zAxis, -yRaw.dot(zAxis)).normalize();

    let handedness = new THREE.Vector3().crossVectors(xRaw, yRaw).dot(zAxis);
    if (isNaN(handedness) || handedness < 0.80 || vectors.top.dot(vectors.bottom) > -0.80) {
        console.error("Calibration vectors:", vectors, "handedness:", handedness);
        exitWizardUI();
        showToast("Calibration rejected: check face orientation and retry.");
        return;
    }

    // Jointly average Front/Back and Left/Right headings in the horizontal plane
    let xAxis = xRaw.clone().add(new THREE.Vector3().crossVectors(yRaw, zAxis)).normalize();
    let yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();

    let basisMat = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    hardwareMountOffset.setFromRotationMatrix(basisMat); // Do NOT invert
    saveSettings();
    exitWizardUI();
    showToast("Lab Calibration Complete! Matrix Saved.");
}

window.addEventListener('modelLoaded', () => {
    updateMalletScale();
});

loadSettings(); let rInput = document.getElementById('radiusInput'); if(rInput && rInput.value) { setLoadedRadius(parseFloat(rInput.value)); if (loadedRadius < 50) setLoadedRadius(50); }

if (localStorage.getItem('LVE_DevHudEnabled') === 'true') toggleDeveloperHUD(true);

updateSystemGeometry(); controls.target.set(0, pivotBaseY - loadedRadius, 0); controls.update();

if(tableMesh) tableMesh.position.y = pivotBaseY - loadedRadius - 1.5;
if(headingArrow) headingArrow.position.y = pivotBaseY - loadedRadius - 1;

if (rInput) { rInput.addEventListener('change', (e) => { let newRadius = parseFloat(e.target.value); if (newRadius < 50) { newRadius = 50; e.target.value = 50; } setLoadedRadius(newRadius); updateSystemGeometry(); controls.target.set(0, pivotBaseY - loadedRadius, 0); controls.update(); rebuildArcPts(newRadius); if(tableMesh) tableMesh.position.y = pivotBaseY - loadedRadius - 1.5; if(headingArrow) headingArrow.position.y = pivotBaseY - loadedRadius - 1; }); }

const scrubberInput = document.getElementById('replayScrubber');
if (scrubberInput) {
    scrubberInput.oninput = (e) => {
        if (!playbackMode || recordedFrames.length === 0) return;
        isPaused = true; document.getElementById('pauseBtn').innerText = "▶ PLAY"; playbackIndex = parseInt(e.target.value); let frame = recordedFrames[playbackIndex];
        masterPivot.quaternion.copy(frame.rotation); masterPivot.position.copy(frame.pivotPos); masterBlock.position.set(0, -(loadedRadius + frame.extension), 0); headJoint.quaternion.identity(); updateSmoothTrail(frame.rawPtIndex); document.getElementById('scrubberLabel').innerText = `Frame: ${playbackIndex + 1} / ${recordedFrames.length}`;
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
        if (success) showToast("Mallet flash memory wiped."); else showToast("Bluetooth Error.");
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
    if (isPaused && playbackIndex >= recordedFrames.length - 1) playbackIndex = 0; 
    isPaused = !isPaused; 
    document.getElementById('pauseBtn').innerText = isPaused ? "▶ PLAY" : "⏸ PAUSE"; 
};
document.getElementById('slowMoBtn').onclick = () => { isSlowMo = !isSlowMo; document.getElementById('slowMoBtn').innerText = isSlowMo ? "🐌 SLOW: ON" : "🐌 SLOW: OFF"; };

document.getElementById('exitReplayBtn').onclick = () => {
    playbackMode = false; isPaused = false; isReviewingLog = false; document.getElementById('playback-panel').classList.add('hidden');
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

function animate() {
    requestAnimationFrame(animate); controls.update();
    
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
                case 0: tx = 0; ty = Math.PI; tz = 0; break;              // Step 1: Bottom Face (upright)
                case 1: tx = Math.PI; ty = 0; tz = 0; break;              // Step 2: Top Face (upside down)
                case 2: tx = Math.PI / 2; ty = Math.PI; tz = 0; break;    // Step 3: Front Face
                case 3: tx = -Math.PI / 2; ty = 0; tz = 0; break;         // Step 4: Back Face
                case 4: tx = 0; ty = Math.PI; tz = Math.PI / 2; break;    // Step 5: Left Side
                case 5: tx = 0; ty = Math.PI; tz = -Math.PI / 2; break;   // Step 6: Right Side
            }

            let qTarget = new THREE.Quaternion().setFromEuler(new THREE.Euler(tx, ty, tz, 'YXZ'));
            masterPivot.quaternion.slerp(qTarget, 0.1);

            let len = AppConfig.malletLengthCm;
            let wid = AppConfig.malletWidthCm;
            let offsetZ = AppConfig.offsetZCm;

            let yOffset = (wid / 2.0); // Default for bottom/top/left/right
            if (wizardStep === 2) yOffset = offsetZ; // Front face (Step 3)
            if (wizardStep === 3) yOffset = len - offsetZ; // Back face (Step 4)
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
        }
        else if (appState === 5 && !playbackMode) {
            masterPivot.quaternion.copy(finalReviewPivotQuat); masterPivot.position.copy(finalReviewPivotPos); masterBlock.position.set(0, -(loadedRadius + finalReviewExtension), 0);
            headJoint.quaternion.identity(); mainMalletMesh.visible = true; ghostMalletMesh.visible = isGhostEnabled;
        } 
        else if (playbackMode) { mainMalletMesh.visible = true; ghostMalletMesh.visible = isGhostEnabled; } 
        else { mainMalletMesh.visible = (appState !== 0); ghostMalletMesh.visible = (isGhostEnabled && appState !== 0 && appState >= 3); }
    }

    if (playbackMode && !isPaused && recordedFrames.length > 0) {
        let now = Date.now(); let frameDelay = isSlowMo ? 200 : 40; 
        if (now - lastPlaybackTime >= frameDelay) {
            lastPlaybackTime = now; let frame = recordedFrames[playbackIndex];
            masterPivot.quaternion.copy(frame.rotation); masterPivot.position.copy(frame.pivotPos); masterBlock.position.set(0, -(loadedRadius + frame.extension), 0); headJoint.quaternion.identity(); 
            updateSmoothTrail(frame.rawPtIndex);
            if (scrubberInput) scrubberInput.value = playbackIndex; let sLabel = document.getElementById('scrubberLabel'); if (sLabel) sLabel.innerText = `Frame: ${playbackIndex + 1} / ${recordedFrames.length}`;
            
            playbackIndex++;
            if (playbackIndex >= recordedFrames.length) {
                // Pause at the end instead of closing the panel automatically
                playbackIndex = recordedFrames.length - 1;
                isPaused = true;
                document.getElementById('pauseBtn').innerText = "▶ PLAY";
            }
        }
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
    playbackMode = true; isPaused = false; playbackIndex = 0; isReviewingLog = true; ghostMalletMesh.visible = isGhostEnabled; lastPlaybackTime = Date.now(); 
    
    if (isBallEnabled) { 
        ghostPivot.quaternion.copy(data.setupQuat || new THREE.Quaternion());
        updateSystemGeometry(); 
        virtualBall.visible = true; 
    }
    
    if (scrubberLabelEl) scrubberLabelEl.innerText = `Frame: ${playbackIndex + 1} / ${recordedFrames.length}`;
    if(data.casts && data.casts.length > 0) drawStrikeLaser(data.casts[data.casts.length - 1]); else { clearImpactLasers(); }
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
            let leanStr = cast.lean !== undefined ? `${cast.lean.toFixed(1)}° ${cast.leanDir}`.trim() : `N/A`;
            let twistStr = cast.planeTwist !== undefined ? `${(cast.planeTwist > 0 ? '+' : '')}${cast.planeTwist.toFixed(1)}°` : `N/A`;
            let locStr = cast.isStrike ? 
                (cast.dev < 0.2 ? `Center` : `${(cast.dev * 10).toFixed(0)}mm ${cast.dir}`) : 
                `${cast.dev.toFixed(1)}cm ${cast.dir}`;
            let velStr = cast.passSpeed ? `${cast.passSpeed.toFixed(1)} m/s` : `--`;
            
            let pDeltaStr = cast.pDelta !== null && cast.pDelta !== undefined ? formatOffset(cast.pDelta) : `N/A`;
            let tempoStr = cast.tempo > 0 ? `${Math.round(cast.tempo)} BPM` : `--`;
            
            headerDiv.innerHTML = `
                <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="The speed of the mallet head at the bottom of the swing (m/s).">Velocity</span><span class="stat-val">${velStr}</span></div>
                <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="The lateral tilt of the mallet shaft (Roll) at impact.">Lean</span><span class="stat-val text-warning">${leanStr}</span></div>
                <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="The angle of the mallet face relative to the target line at impact.">Face Angle</span><span class="stat-val">${twistStr}</span></div>
                <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Exactly where on the mallet face the ball was struck.">Impact Location</span><span class="adv-val text-warning">${locStr}</span></div>
                <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Compares your swing rhythm to a mathematically perfect, gravity-driven pendulum.">Swing PΔ</span><span class="stat-val">${pDeltaStr}</span></div>
                <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="The overall rhythm and cadence of your full swing cycle (BPM).">Tempo</span><span class="stat-val">${tempoStr}</span></div>
            `;
        }
    }
    
    window.fullSwingTraceBuffer = swing.rawTracePoints;
    let centerFrame = cast.trailIndex; 
    
    // 1. SMART SCAN BACKWARD: Find the start of THIS specific backswing
    let startFrame = centerFrame;
    let inBackswing = false;
    for (let i = centerFrame; i >= 0; i--) {
        startFrame = i;
        if (!swing.rawTracePoints[i].isForward) {
            inBackswing = true; // We are in the backswing
        } else if (inBackswing && swing.rawTracePoints[i].isForward) {
            // We bumped into the forward motion of the PREVIOUS waggle. Cut it here!
            startFrame = i + 1;
            break;
        }
    }
    
    // 2. SMART SCAN FORWARD: Find the end of THIS follow-through
    let endFrame = centerFrame;
    for (let i = centerFrame; i < swing.rawTracePoints.length; i++) {
        endFrame = i;
        // If we are past impact, and the mallet starts rebounding backward
        if (i > centerFrame + 4 && !swing.rawTracePoints[i].isForward) {
            endFrame = Math.max(centerFrame, i - 1); // Crop right before the rebound
            break; 
        }
    }
    
    // 3. DRAW THE PERFECTLY CROPPED SWING
    rawTracePoints.length = 0;
    rawTracePoints.push(...swing.rawTracePoints.slice(startFrame, endFrame + 1));
    updateSmoothTrail();
    
    masterPivot.quaternion.copy(cast.pivotQuat); masterPivot.position.copy(cast.pivotPos); masterBlock.position.set(0, -(loadedRadius + cast.extension), 0);
    headJoint.quaternion.identity(); ghostMalletMesh.visible = isGhostEnabled; if (mainMalletMesh) mainMalletMesh.visible = true; drawStrikeLaser(cast);
    
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

    // 4. Send the recent cast array to the Gemini Edge Function
    const advice = await getAiCoachFeedback(castData, targetDist);

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
        peakG: s.peakG, peakTwist: s.peakTwist, dwell: s.dwell, zVel: s.zVel, appliedForce: s.appliedForce, 
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
    let pristineVel = s.zVel; let appliedF = s.appliedForce;
    let downTime = s.downwardSwingTime; let decelFact = s.decelFactor;
    
    if (inGameMode) {
        gmStrokeCount++; document.getElementById('gm-stroke-count').innerText = gmStrokeCount;
        let estDist = calculateEstimatedDistance(pristineVel, AppConfig.massKg, AppConfig.lawnSpeed);
        let twistStr = (s.faceAngle > 0 ? '+' : '') + (s.faceAngle || 0).toFixed(1) + '°';
        document.getElementById('gm-latest-stats').innerHTML = `<div class="text-muted mb-2 uppercase" style="font-size:0.85rem;">LATEST STRIKE</div><div>Speed: <span class="text-main font-800">${pristineVel.toFixed(1)}</span> m/s</div><div>Face: <span class="text-warning font-800">${twistStr}</span></div><div>Est Dist: <span class="text-accent font-800">${estDist.toFixed(0)}</span> m</div><div class="mt-2 text-muted" style="font-size:0.75rem;">Quickly twist clockwise to arm next shot.</div>`;
        return; 
    }

    let pureImpactSensor = new THREE.Quaternion(s.q1, s.q2, s.q3, s.q0);

    // THE FIX: Apply the hardware calibration matrix to the pristine strike packet!
    pureImpactSensor.multiply(hardwareMountOffset);

    let impactRawQuat = new THREE.Quaternion(pureImpactSensor.y, -pureImpactSensor.z, -pureImpactSensor.x, pureImpactSensor.w).normalize();
    impactRawQuat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI)); 

    let impactEulerNode = new THREE.Euler().setFromQuaternion(impactRawQuat, 'YZX');
    impactEulerNode.y = -impactEulerNode.y; 
    impactRawQuat.setFromEuler(impactEulerNode, 'YZX');

    let iQuat = baseQuatInverse.clone().multiply(impactRawQuat);

    // THE FIX: Ignore the raw firmware faceAngle to prevent sign-mismatch explosions. 
    // Always use the pristine, properly-inverted iQuat.
    let locTwist = getShaftTwist(iQuat);
    window.lastEdgeData = { zVel: pristineVel, appliedForce: appliedF, downwardSwingTime: downTime, decelFactor: decelFact, impactTwist: locTwist, backArc: s.backArc, backswingTime: s.backswingTime };

    // --- NEW: Save the pristine hardware quaternion to override the visual recoil ---
    window.pristineImpactQuat = iQuat;

    // --- FIX: Save the pristine data for the telemetry to map to the 3D Cast! ---
    window.pendingStrikePacket = {
        zVel: pristineVel, appliedForce: appliedF, locTwist: locTwist, backArc: s.backArc, backswingTime: s.backswingTime,
        downTime: downTime // <-- Added so we can calculate the true P-Delta!
    };

    let swingStateTxt = document.getElementById('swing-state');
    if (swingStateTxt) {
        swingStateTxt.innerHTML = "STRIKE PACKET RECEIVED <span style='color: var(--success); font-weight: 900;'>(WAITING FOR TELEMETRY...)</span>";
        swingStateTxt.className = "text-center font-bold mb-4";
    }

    if (appState === 4 || appState === 3 || (inGameMode && window.matchSwinging)) { 
        impactDetected = true; 
        clearTimeout(goTimeout); 
        // Give the 3D telemetry exactly 500ms to cross the line and absorb the packet!
        setTimeout(() => { finalizeSwingData(globalHwTime); }, 1000); 
    }
}

function handleParsedTelemetry(t) {
    const hwTimestamp = t.hwTimestamp; globalHwTime = hwTimestamp; let jsNow = Date.now();
    
    prevRawBLEQuat.copy(currentRawBLEQuat);
    currentRawBLEQuat.set(t.q1, t.q2, t.q3, t.q0);

    // THE FIX: Apply the hardware calibration matrix to the raw sensor data!
    currentRawBLEQuat.multiply(hardwareMountOffset);

    // 1. Restore the perfectly stable Back-to-Front axis mapping
    lastRawQuat = new THREE.Quaternion(currentRawBLEQuat.y, -currentRawBLEQuat.z, -currentRawBLEQuat.x, currentRawBLEQuat.w).normalize();
    lastRawQuat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI));
    
    // 2. The Gimbal-Proof Twist Inversion (YZX Order)
    let liveEuler = new THREE.Euler().setFromQuaternion(lastRawQuat, 'YZX');
    liveEuler.y = -liveEuler.y; // Inverts the face angle
    lastRawQuat.setFromEuler(liveEuler, 'YZX');
    // ------------------------------------------------------------

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
                if (wizardStep === 0) vectors.bottom = avgVec;
                else if (wizardStep === 1) vectors.top = avgVec;
                else if (wizardStep === 2) vectors.front = avgVec;
                else if (wizardStep === 3) vectors.back = avgVec;
                else if (wizardStep === 4) vectors.left = avgVec;
                else if (wizardStep === 5) vectors.right = avgVec;
                wizardStep++;
                if (wizardStep < 6) {
                    showToast("Face captured! Position next face.");
                    updateWizardUI();
                } else {
                    calculateRotationMatrix();
                }
            }
        }
    }

    let flatMag = AppConfig.flatMag; let extension = 0;
    if (appState >= 3 && t.appliedForce > 2.0) { let clampedForce = Math.min(t.appliedForce, 15.0); extension = clampedForce * (flatMag / 10.0); }
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
            let elapsed = jsNow - redStartTime; let pct = (elapsed / 3000.0) * 66.0; 
            if(calibBar) { calibBar.style.width = Math.min(pct, 66) + "%"; calibBar.style.background = "var(--danger)"; }
            if (elapsed >= 3000 && t.appState === 6) {
                calibrationPhase = 'ORANGE'; calibrationHoldTimeMs = 0; orangeStartTime = jsNow; lastStableQuat.copy(lastRawQuat); 
                if(swingStateTxt) { swingStateTxt.innerText = "STEADYING..."; swingStateTxt.className = "text-warning text-center font-bold mb-4"; }
                
                // --- FIX: Respect the user's database setting! ---
                let arcToggle = document.getElementById('optimumArcToggle');
                ghostRail.visible = arcToggle ? arcToggle.checked : false; 
            }
        } else if (calibrationPhase === 'ORANGE') {
            if (orangeStartTime === 0) orangeStartTime = jsNow;
            let angleDiff = lastRawQuat.angleTo(lastStableQuat); let gDiff = Math.abs(magnitude - 1.0);
            if (angleDiff > 0.12 || gDiff > 0.25) { 
                calibrationHoldTimeMs = 0; lastStableQuat.copy(lastRawQuat); 
                if(calibBar) { calibBar.style.width = "66%"; calibBar.style.background = "var(--warning)"; } 
            } else { 
                calibrationHoldTimeMs += dtMs; let orangePct = (calibrationHoldTimeMs / 1000.0) * 34.0; let totalPct = 66.0 + orangePct; 
                if(calibBar) { calibBar.style.width = Math.min(totalPct, 100) + "%"; calibBar.style.background = "var(--warning)"; }
            }
            if (jsNow - orangeStartTime > 20000) { resetSystemState(true, false).then(() => { let txt = document.getElementById('swing-state'); if(txt) { txt.innerHTML = "STEADYING FAILED - TOO MUCH MOVEMENT. TRY AGAIN."; txt.className = "text-danger text-center font-bold mb-4"; } }); return; }
            let visualDiff = currentQuaternion.angleTo(targetQuaternion);
            if (calibrationHoldTimeMs >= 1000 && visualDiff < 0.02) { 

                calibrationPhase = 'NONE'; 
                
                // Use the safe Gimbal-Proof YZX order
                let finalEuler = new THREE.Euler().setFromQuaternion(lastRawQuat, 'YZX');
                
                // THE FIX: ONLY Tare the Yaw (Heading). 
                // Let the accelerometer use true gravity for Pitch and Roll!
                let finalHeading = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, finalEuler.y, 0, 'YZX'));
                baseQuatInverse.copy(finalHeading).invert();
                document.getElementById('calibration-container').classList.add('hidden');

                // The live mallet gets the fully twisted/tilted posture
                targetQuaternion.copy(baseQuatInverse).multiply(lastRawQuat); 
                currentQuaternion.copy(targetQuaternion); 
                masterPivot.quaternion.copy(currentQuaternion);



                // --- THE FIX: ALWAYS PLUMB ENVIRONMENT ---
                // The ghost rail, ball, and target line remain at absolute zero pitch/roll
                ghostPivot.quaternion.identity(); 
                // -----------------------------------------
                
                // --- FIX: Capture the exact depth of the mallet face when addressing the ball ---
                masterPivot.updateMatrixWorld(true);
                faceTrackerNode.updateMatrixWorld(true);
                let lockPos = new THREE.Vector3();
                faceTrackerNode.getWorldPosition(lockPos);
                lockedFaceZ = lockPos.z;
                // --------------------------------------------------------------------------------

                updateSystemGeometry(); 

                let plumbNormal = new THREE.Vector3(1, 0, 0);
                let plumbCentroid = new THREE.Vector3(0, pivotBaseY - loadedRadius, 0);
                idealPlane = { centroid: plumbCentroid, normal: plumbNormal };

                ignoreSpeedUntilTime = Date.now() + 500; currentAbsoluteSpeed = 0; prevZ = 0; prevFaceZ = 0; isForwardSwing = true; lastForwardPassTime = 0; impactDetected = false; isLive = true; 
                playbackMode = false; posHistory = []; currentSwingDeviation = 0; lastComputedTempo = 0; maxTwist = 0; currentSwingDwell = 0; currentSwingAoA = 0;
                
                window.pristineImpactQuat = null; // --- NEW: Clear it for the next swing!
                window.strikeCastGenerated = false;
                
                window.pristinePathAngleRads = null;

                window.lastEdgeData = { zVel: 0, appliedForce: 0, downwardSwingTime: 0, decelFactor: 0 }; preRollBuffer = []; recordedFrames = []; rawTracePoints.length = 0; castData = [];
                
                sendBleCommand([71]); // 'G'
                appState = 3; 

                hasLiftedOff = false; // <-- NEW: Reset for the new swing

                armedUiStartTime = Date.now(); 
                document.getElementById('playback-panel').classList.add('hidden'); 
                document.getElementById('live-tracking-card').classList.remove('hidden');
                if (DisplayElements.liveTempo) DisplayElements.liveTempo.innerText = '-- BPM'; 
                if (DisplayElements.liveSpeed) DisplayElements.liveSpeed.innerText = '0.0 m/s'; 
                if (DisplayElements.liveForce) DisplayElements.liveForce.innerText = '0 N'; 
                if (DisplayElements.liveDev) DisplayElements.liveDev.innerText = '-- cm'; 
                if (DisplayElements.liveApplied) DisplayElements.liveApplied.innerText = '-- N';
                
                masterPivot.position.set(0, pivotBaseY, 0); masterBlock.position.set(0, -loadedRadius, 0); headJoint.quaternion.identity(); finalReviewExtension = 0; playBeep(1000, 0.3); 

                if(swingStateTxt && !isDynamicCalibrationActive) { swingStateTxt.innerHTML = "TARGET LOCKED. LIFT AND SWING.<br><span class='small-help text-muted' style='font-size: 0.75rem; font-weight: normal;'>Trace will activate on lift-off.</span>"; swingStateTxt.className = "text-accent text-center font-bold mb-4"; }
                goTimeout = setTimeout(() => { if (appState === 3) { resetSystemState(true, false); showToast("Shot clock expired."); } }, 30000);
            }
        }
        targetQuaternion.copy(baseQuatInverse).multiply(lastRawQuat);
    } else if (appState >= 3) { targetQuaternion.copy(baseQuatInverse).multiply(lastRawQuat); }

    if (isLive && !isReviewingLog && !isWizardActive) { 
        
        /// --- REVISED LIFT-OFF DETECTION ---
        // We must calculate speed using raw rotation, because the 3D head is currently pinned!
        let angleChange = targetQuaternion.angleTo(prevTargetQuaternion);
        // Angle (rad) / 0.04s (Bluetooth tick) * Handle Radius = m/s
        let rotSpeed = (angleChange / 0.04) * (AppConfig.handleLengthCm / 100.0);
        
        if (appState === 3 && !hasLiftedOff) {
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
            // Top Pivot restores instantly upon takeaway, preserving your exact p delta height
            masterPivot.position.set(0, pivotBaseY + currentPivotLift, 0); 
            
            // THE PURE PHYSICS FIX: Decouple the axes using the correct config variable + Grip Offset
            let handleLen = AppConfig.handleLengthCm || 91.4; 
            let trueWristPivot = handleLen - 6.0; 
            
            let excessRadius = currentDynamicRadius - trueWristPivot;
            
            if (excessRadius > 0) {
                // Pure Vector Math: "Which way is the mallet pointing right now?"
                // shaftDirection.x extracts the exact lateral lean perfectly, immune to Euler tangles.
                let shaftDirection = new THREE.Vector3(0, -1, 0).applyQuaternion(masterPivot.quaternion);
                
                // Neutralize the excess shoulder swing by shifting the pivot opposite to the lean.
                masterPivot.position.x = -excessRadius * shaftDirection.x;
            }
        }
        // ------------------------------------------------------

        masterBlock.position.set(0, -currentDynamicRadius, 0);
        masterPivot.updateMatrixWorld(true); 
        faceTrackerNode.updateMatrixWorld(true); 
        physicsTrackingNode.updateMatrixWorld(true);
    }
    
    // THE FIX: Make the trace line perfectly track the visual center of the physical mallet mesh
    let meshShiftZ = AppConfig.offsetZCm - (AppConfig.malletLengthCm / 2.0);
    let centerOffset = new THREE.Vector3(0, -currentDynamicRadius, meshShiftZ).applyQuaternion(targetQuaternion);
    let centerPosition = masterPivot.position.clone().add(centerOffset);
    let facePosition = new THREE.Vector3(); faceTrackerNode.getWorldPosition(facePosition);
    let currentZ = centerPosition.z; let deltaZ = currentZ - prevZ;
    if (deltaZ > 0.05) isForwardSwing = true; else if (deltaZ < -0.05) isForwardSwing = false;
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
        if (DisplayElements.liveSpeed) DisplayElements.liveSpeed.innerText = `${currentAbsoluteSpeed.toFixed(1)} m/s`; 
        if (DisplayElements.liveForce) DisplayElements.liveForce.innerText = `${liveForceN.toFixed(0)} N`; 
        if (DisplayElements.liveApplied) DisplayElements.liveApplied.innerText = `${t.appliedForce.toFixed(0)} N`; 
    }

    if (isArmedForTracking && jsNow >= ignoreSpeedUntilTime) {
        preRollBuffer.push({ rotation: targetQuaternion.clone(), forceMag: magnitude, pos: centerPosition.clone(), time: nowTime, isForward: isForwardSwing, pivotPos: masterPivot.position.clone(), extension: extension, rawBLE: currentRawBLEQuat.clone() });
        while (preRollBuffer.length > 0 && nowTime - preRollBuffer[0].time > 2000) preRollBuffer.shift();

        let triggeredNormal = (currentAbsoluteSpeed > 0.25); let triggeredImpact = (deltaG > impactThreshold);

        if (triggeredNormal || triggeredImpact) {
            if (inGameMode) window.matchSwinging = true;
            else appState = 4;
            
            state4UiStartTime = Date.now(); clearTimeout(goTimeout);
            state4StartTime = nowTime; recordTicks = 0; impactDetected = false; postImpactTicks = 0; recordedFrames = []; 
            currentSwingMaxSpeed = 0; currentSwingMaxG = 0; currentSwingDeviation = 0; maxTwist = 0; currentSwingDwell = 0; currentSwingAoA = 0; window.lastEdgeData = { zVel: 0, appliedForce: 0, downwardSwingTime: 0, decelFactor: 0 }; rawTracePoints.length = 0;            
            let cutoffTime = nowTime - 2000;
            preRollBuffer.forEach(f => {
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
                    rawTracePoints.push({ pos: f.pos.clone(), rot: f.rotation.clone(), color: {r: r, g: g, b: b}, isForward: f.isForward });
                    recordedFrames.push({ rotation: f.rotation.clone(), forceMag: f.forceMag, rawPtIndex: rawTracePoints.length, pivotPos: f.pivotPos.clone(), extension: f.extension, rawBLE: f.rawBLE });
                }
            });
            updateSmoothTrail();
            let listDiv = document.getElementById('history-list'); if (listDiv && listDiv.innerHTML.includes("No swings recorded yet")) listDiv.innerHTML = '';
            let liveList = document.getElementById('live-tracking-list'); if (liveList) liveList.innerHTML = '';
            let swingStateTxt = document.getElementById('swing-state'); if(swingStateTxt && !isDynamicCalibrationActive && !inGameMode) { swingStateTxt.innerText = "RECORDING SWING..."; swingStateTxt.className = "text-danger text-center font-bold mb-4"; }
        }
    }

    let currentFaceZ = facePosition.z; 

    if (isTrackingSwing && jsNow >= ignoreSpeedUntilTime) {
        let dynamicFaceZ = getDynamicFaceZ();
        // --- FIX: Only let the 3D engine draw a cast if the hardware hasn't already built the perfect one!
        if (idealPlane && prevFaceZ <= dynamicFaceZ && currentFaceZ > dynamicFaceZ && isForwardSwing && !window.strikeCastGenerated) {
            let tm = (dynamicFaceZ - prevFaceZ) / (currentFaceZ - prevFaceZ); if (isNaN(tm) || tm < 0 || tm > 1) tm = 1.0; 
            let iQuat = prevTargetQuaternion.clone().slerp(targetQuaternion, tm);
            
            let iRawBLE = prevRawBLEQuat.clone().slerp(currentRawBLEQuat, tm);
            
            // THE FIX: Calculate the dynamic inward shift for the interpolated impact frame
            let handleLen = AppConfig.handleLengthCm || 91.4; 
            let trueWristPivot = handleLen - 6.0; 
            let excessRadius = currentDynamicRadius - trueWristPivot;
            let impactShiftX = 0;
            if (excessRadius > 0) {
                let shaftDirection = new THREE.Vector3(0, -1, 0).applyQuaternion(iQuat);
                impactShiftX = -excessRadius * shaftDirection.x;
            }
            
            let tempPivot = new THREE.Group(); let tempBlock = new THREE.Group(); let tempFace = new THREE.Group();
            tempPivot.position.set(impactShiftX, pivotBaseY + currentPivotLift, 0); tempBlock.position.set(0, -currentDynamicRadius, 0); tempFace.position.set(0, 0, dynamicFaceZ); 
            tempPivot.add(tempBlock); tempBlock.add(tempFace); tempPivot.quaternion.copy(iQuat); scene.add(tempPivot); tempPivot.updateMatrixWorld(true);
            let exactFacePos = new THREE.Vector3(); tempFace.getWorldPosition(exactFacePos); scene.remove(tempPivot);

            ghostBlock.updateMatrixWorld(true);
            let ghostInvMat = new THREE.Matrix4().copy(ghostBlock.matrixWorld).invert();
            let localFaceAtImpact = exactFacePos.clone().applyMatrix4(ghostInvMat);

            let strikeX = localFaceAtImpact.x; 
            let strikeY = localFaceAtImpact.y; 

            // Reality check: Cap deviation to the physical width of the mallet
            let halfWidth = AppConfig.malletWidthCm / 2.0;
            if (Math.abs(strikeX) > halfWidth) {
                strikeX = strikeX > 0 ? halfWidth : -halfWidth;
            }

            let devCM = Math.abs(strikeX); if (devCM < (AppConfig.sweetSpot * 0.15)) devCM = 0.0;
            let dir = strikeX > 0.1 ? 'R' : (strikeX < -0.1 ? 'L' : 'C'); 

            // Calculate the path using safe positions from BEFORE the impact shockwave hits
            let pathAngleRads = 0;
            if (preRollBuffer.length > 5) { 
                let pastPos1 = preRollBuffer[preRollBuffer.length - 5].pos; 
                let pastPos2 = preRollBuffer[preRollBuffer.length - 1].pos; 
                let pastLocal1 = pastPos1.clone().applyMatrix4(ghostInvMat);
                let pastLocal2 = pastPos2.clone().applyMatrix4(ghostInvMat);
                let dx = pastLocal2.x - pastLocal1.x; 
                let dz = pastLocal2.z - pastLocal1.z; 
                if (dz !== 0) pathAngleRads = Math.atan2(dx, Math.abs(dz)); 
            }

            // --- FIX: OVERRIDE WITH PRISTINE HARDWARE PATH IF AVAILABLE ---
            if (window.pristinePathAngleRads !== undefined && window.pristinePathAngleRads !== null) {
                pathAngleRads = window.pristinePathAngleRads;
            }
            // --------------------------------------------------------------

            let leanEulerNode = new THREE.Euler().setFromQuaternion(iQuat, 'YXZ');
            let rawLeanDeg = THREE.MathUtils.radToDeg(leanEulerNode.z);
            let leanDeg = Math.abs(rawLeanDeg);
            if (leanDeg < 0.1) leanDeg = 0.0;
            let leanDir = rawLeanDeg > 0.1 ? 'R' : (rawLeanDeg < -0.1 ? 'L' : ''); 

            let locTwist = getShaftTwist(iQuat); 
            let passForce = calculateImpactForce(currentAbsoluteSpeed);
            let snapshotPos = new THREE.Vector3(impactShiftX, pivotBaseY + currentPivotLift, 0);

            let estDist = calculateEstimatedDistance(currentAbsoluteSpeed, AppConfig.massKg, AppConfig.lawnSpeed);
            
            let isTrueStrike = false;
            let appliedF = t.appliedForce;
            let passSpeed = currentAbsoluteSpeed;
            let backArc = 0;
            let backswingTime = 0;

            // Calculate basic P-Delta and Tempo
            if (lastForwardPassTime > 0) { let fullCycleSeconds = (nowTime - lastForwardPassTime) / 1000.0; if (fullCycleSeconds > 0.4 && fullCycleSeconds < 5.0) lastComputedTempo = 60.0 / fullCycleSeconds; }
            lastForwardPassTime = nowTime;
            let p_delta = null; if (lastComputedTempo > 0) { p_delta = calculatePendulumDelta(60.0 / lastComputedTempo, AppConfig.handleLengthCm); }

            // --- THE MASTER FIX: MAP THE EARLY PACKET TO THE 3D CAST ---
            if (window.pendingStrikePacket) {
                isTrueStrike = true;
                window.strikeCastGenerated = true; // <--- THIS LOCKS OUT GHOST SWINGS
                locTwist = window.pendingStrikePacket.locTwist;
                
                appliedF = window.pendingStrikePacket.appliedForce;
                passSpeed = window.pendingStrikePacket.zVel;
                backArc = window.pendingStrikePacket.backArc;
                backswingTime = window.pendingStrikePacket.backswingTime;

                let clampedForce = Math.min(appliedF, 15.0);
                extension = clampedForce * (AppConfig.flatMag / 10.0);
                snapshotPos.y = pivotBaseY + extension; 

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
                // Real strike uses physical recoil math
                let rawMm = calculateOffCenterImpact(Math.abs(maxTwist), passSpeed);
                liveTargetX_cm = maxTwist > 0 ? (rawMm / 10.0) : -(rawMm / 10.0);
            } else {
                // Virtual cast uses visual 3D math
                liveTargetX_cm = strikeX;
            }

            // Simulate Twist Penalty for Virtual Casts
            let simulatedRecoil = maxTwist;
            if (!isTrueStrike) {
                let errorCm = Math.abs(liveTargetX_cm);
                if (errorCm > AppConfig.sweetSpot) {
                    let twistPenalty = (errorCm - AppConfig.sweetSpot) * 1.0; 
                    simulatedRecoil = liveTargetX_cm > 0 ? twistPenalty : -twistPenalty;
                }
            }

            let accData = calcAccuracyData(liveTargetX_cm, locTwist, 0, simulatedRecoil, currentSwingDwell); 
            if (isTrueStrike) accData.isWhiff = false;
            
            // If they miss the sweet spot on a virtual cast, force a complete whiff!
            if (!isTrueStrike && Math.abs(strikeX) > AppConfig.sweetSpot) {
                accData.isWhiff = true;
            }

            let passRating = getStarRating(liveTargetX_cm, accData.trueLaunchDeg);

            let isHit = false;
            let currentTwistTol = parseFloat(document.getElementById('twistToleranceInput').value) || 1.0;
            let targetDist = inGameMode ? (parseFloat(document.getElementById('matchDistSetup').value) || 10.0) : (parseFloat(document.getElementById('trainerDistSetup').value) || 10.0);
            
            isHit = !accData.isWhiff && (Math.abs(liveTargetX_cm) <= AppConfig.sweetSpot) && (Math.abs(accData.trueLaunchDeg) <= currentTwistTol) && (estDist >= targetDist);

            // Instant audio gratification based purely on your mechanics, not the visual drift!
            if (isHit && !inGameMode && AppConfig.ledGuidance) {
                playSuccessSound();
            }

            let strikeCast = {
                rawDev: strikeX, dev: devCM, dir: dir, lean: leanDeg, leanDir: leanDir,
                isStrike: isTrueStrike, pos: exactFacePos.clone(), rot: tempFace.getWorldQuaternion(new THREE.Quaternion()), 
                localX: strikeX, localY: strikeY, faceAngle: locTwist, planeTwist: locTwist, impactTwist: locTwist, pathAngleRads: pathAngleRads, passSpeed: passSpeed, passForce: passForce, appliedForce: appliedF, 
                stars: passRating.string, starColor: passRating.color, trailIndex: rawTracePoints.length, pivotQuat: iQuat.clone(), pivotPos: snapshotPos, extension: extension, time: nowTime,
                isWhiff: accData.isWhiff, estAccRange: accData.estAccRange, trueAccRange: accData.trueAccRange, trueLaunchDeg: accData.trueLaunchDeg, 
                estLaunchRads: accData.estLaunchRads, trueLaunchRads: accData.trueLaunchRads, maxAccRange: accData.trueAccRange, estDist: estDist, pDelta: p_delta,
                rawBLE: iRawBLE, isHit: isHit, backArc: backArc, backswingTime: backswingTime, tempo: lastComputedTempo
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

        if (rawTracePoints.length < MAX_TRAIL_POINTS) {
            if (magnitude > currentSwingMaxG) currentSwingMaxG = magnitude;
            let r = 0.0, g = 1.0, b = 0.0; 
            if (!isForwardSwing) { r = 1.0; g = 1.0; b = 0.0; } 
            else {
                if (idealPlane) {
                    let ballWorldPos = virtualBall.position.clone(); let trackingInvMat = new THREE.Matrix4().copy(physicsTrackingNode.matrixWorld).invert();
                    let localBall = ballWorldPos.applyMatrix4(trackingInvMat); let tm = Math.min(Math.abs(localBall.x) / 6.0, 1.0); 
                    if(isNaN(tm)) tm = 0; r = tm; g = 1.0 - tm; b = 0.0;
                } else { r = 0.0; g = 1.0; b = 0.8; }
            }
            if(isNaN(r)) r = 0; if(isNaN(g)) g = 1; if(isNaN(b)) b = 0;
            rawTracePoints.push({ pos: centerPosition.clone(), rot: targetQuaternion.clone(), color: {r: r, g: g, b: b}, isForward: isForwardSwing });
            recordedFrames.push({ rotation: targetQuaternion.clone(), forceMag: magnitude, rawPtIndex: rawTracePoints.length, pivotPos: masterPivot.position.clone(), extension: extension, rawBLE: currentRawBLEQuat.clone() });
        }

        if (!impactDetected && deltaG > impactThreshold) { impactDetected = true; let swingStateTxt = document.getElementById('swing-state'); if(swingStateTxt && !isDynamicCalibrationActive && !inGameMode) { swingStateTxt.innerText = "IMPACT DETECTED! WAITING FOR EDGE PACKET..."; swingStateTxt.className = "text-danger text-center font-bold mb-4"; } }
        if (!impactDetected && (!AppConfig.singleSwing)) { let practiceTimeLimitMs = AppConfig.practiceLimitSec * 1000; if ((nowTime - state4StartTime) >= practiceTimeLimitMs) { finalizeSwingData(nowTime); } }
    }

    prevFaceZ = currentFaceZ; prevZ = currentZ; prevMagnitude = magnitude;
}

async function finalizeSwingData(nowTime) {
    if (appState !== 4 && !window.matchSwinging) return;
    
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

    // --- FIX: Do NOT change appState to 4.5 yet! This prevents the async race condition ---
    isLive = false; 
    playDoubleBeep();
    await sendBleCommand([79]); // 'O'

    // THE NEW FIX: Hide incomplete final swings caused by the timer decapitation
    if (!impactDetected && castData.length > 1) {
        let lastCast = castData[castData.length - 1];
        // If the final cast has fewer than 5 frames of follow-through, it was chopped off by the timer. Delete it.
        if (rawTracePoints.length - lastCast.trailIndex < 5) {
            castData.pop(); 
        }
    }

    // 1. Identify the target cast data to anchor the edits
    let displayPass = null;
    if (impactDetected) { displayPass = castData.find(c => c.isStrike) || castData[castData.length - 1]; } 
    else if (castData.length > 0) { displayPass = castData[castData.length - 1]; }

    // 2. --- SIMPLE IMPACT PINNING (YAW DRIFT + TRANSLATION) ---
    if (impactDetected && displayPass) {
        let hardwareTwist = window.lastEdgeData.impactTwist || maxTwist || 0;
        let hardwareSpeed = window.lastEdgeData.zVel || displayPass.passSpeed || 0;

        // A. FIX #3: FRACTIONAL YAW DRIFT CORRECTION
        let driftedTwist = getShaftTwist(displayPass.pivotQuat);
        let totalYawDriftDeg = driftedTwist - hardwareTwist; 
        let totalYawDriftRads = THREE.MathUtils.degToRad(totalYawDriftDeg);
        let pivotCenter = new THREE.Vector3(0, pivotBaseY, 0);

        let totalPts = rawTracePoints.length;
        let impactIdx = displayPass.trailIndex; 

        // Smoothly unwind the accumulated drift over the duration of the trace
        for (let i = 0; i < totalPts; i++) {
            let timeFraction = Math.min(i / (impactIdx || 1), 1.0);
            let correctiveYawRads = -totalYawDriftRads * timeFraction;
            let correctiveQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), correctiveYawRads);
            
            rawTracePoints[i].rot.premultiply(correctiveQuat);
            if (recordedFrames[i]) recordedFrames[i].rotation.premultiply(correctiveQuat);
            
            // Orbit the mallet position around the top pivot
            let offsetPos = rawTracePoints[i].pos.clone().sub(pivotCenter);
            offsetPos.applyQuaternion(correctiveQuat);
            rawTracePoints[i].pos.copy(pivotCenter).add(offsetPos);
            
            if (recordedFrames[i]) {
                let pOffset = recordedFrames[i].pivotPos.clone().sub(pivotCenter);
                pOffset.applyQuaternion(correctiveQuat);
                recordedFrames[i].pivotPos.copy(pivotCenter).add(pOffset);
            }
        }
        
        castData.forEach(c => {
            let timeFraction = Math.min(c.trailIndex / (impactIdx || 1), 1.0);
            let correctiveYawRads = -totalYawDriftRads * timeFraction;
            let correctiveQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), correctiveYawRads);
            
            c.pivotQuat.premultiply(correctiveQuat);
            
            let offsetPos = c.pos.clone().sub(pivotCenter);
            offsetPos.applyQuaternion(correctiveQuat);
            c.pos.copy(pivotCenter).add(offsetPos);
            
            let pOffset = c.pivotPos.clone().sub(pivotCenter);
            pOffset.applyQuaternion(correctiveQuat);
            c.pivotPos.copy(pivotCenter).add(pOffset);
        });

        // B. OFF-CENTER TRANSLATION
        // THE FIX: Use maxTwist (recoil torque) for deviation, NOT hardwareTwist (face angle)!
        let rawMm = calculateOffCenterImpact(Math.abs(maxTwist), hardwareSpeed);
        displayPass.offCenterMm = Math.abs(rawMm);

        displayPass.offCenterLabel = "Center";
        let sweetSpotMm = AppConfig.sweetSpot * 10.0;
        if (displayPass.offCenterMm > sweetSpotMm) {
            // THE FIX: Evaluate maxTwist for direction, because rawMm is forced absolute!
            displayPass.offCenterLabel = maxTwist > 0 ? "R" : "L";
        }
        
        let hwTargetX_cm = displayPass.offCenterMm / 10.0;
        // THE FIX: If the ball hit the Right side (Toe), shift the Mallet to the LEFT (-X)
        if (displayPass.offCenterLabel === 'R') hwTargetX_cm = -hwTargetX_cm;
        else if (displayPass.offCenterLabel === 'Center') hwTargetX_cm = 0;

        // Measure how far off the Face is from the calculated physical impact
        ghostBlock.updateMatrixWorld(true);
        let ghostInvMat = new THREE.Matrix4().copy(ghostBlock.matrixWorld).invert();
        
        // THE FIX: Measure the deviation of the Face (displayPass.pos), not the trace line!
        let correctedImpactPos = displayPass.pos.clone().applyMatrix4(ghostInvMat);
        let newlyCorrectedDev = correctedImpactPos.x;

        let totalDriftCm = hwTargetX_cm - newlyCorrectedDev;
        let totalDriftVec = new THREE.Vector3(totalDriftCm, 0, 0).applyQuaternion(ghostPivot.quaternion);

        // Gently slide the trace to touch the ball, fading in the shift so it doesn't jerk
        for (let i = 0; i < totalPts; i++) {
            let timeFraction = Math.min(i / (impactIdx || 1), 1.0); 
            let proportionalShift = totalDriftVec.clone().multiplyScalar(timeFraction);
            
            rawTracePoints[i].pos.add(proportionalShift);
            if (recordedFrames[i]) recordedFrames[i].pivotPos.add(proportionalShift);
        }
        
        castData.forEach(c => {
            let timeFraction = Math.min(c.trailIndex / (impactIdx || 1), 1.0);
            let proportionalShift = totalDriftVec.clone().multiplyScalar(timeFraction);
            c.pos.add(proportionalShift);
            c.pivotPos.add(proportionalShift);
        });

        // C. METRICS RECALCULATION
        displayPass.rawDev = hwTargetX_cm;
        displayPass.dev = Math.abs(hwTargetX_cm);
        displayPass.dir = hwTargetX_cm > 0.1 ? 'R' : (hwTargetX_cm < -0.1 ? 'L' : 'C');
        displayPass.estDist = calculateEstimatedDistance(hardwareSpeed, AppConfig.massKg, AppConfig.lawnSpeed);

        // Calculate final accuracy (Hardcoding Approach to 0)
        // THE FIX: The 4th parameter must be maxTwist (Recoil Torque), not hardwareTwist (Face Angle)!
        let accData = calcAccuracyData(hwTargetX_cm, hardwareTwist, 0, maxTwist, currentSwingDwell);
        let passRating = getStarRating(hwTargetX_cm, accData.trueLaunchDeg);
        
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

    // 3. --- PRISTINE PATH LOCK (WIGGLE CURE) ---
    // Freeze the follow-through to ignore the physical shockwave.
    if (displayPass && window.pristineImpactQuat) {
        let impactIdx = displayPass.trailIndex;
        let pristineEuler = new THREE.Euler().setFromQuaternion(window.pristineImpactQuat, 'YXZ');

        for (let i = impactIdx; i < rawTracePoints.length; i++) {
            let corruptedEuler = new THREE.Euler().setFromQuaternion(recordedFrames[i].rotation, 'YXZ');
            
            corruptedEuler.y = pristineEuler.y;
            corruptedEuler.z = pristineEuler.z;
            
            let lockedQuat = new THREE.Quaternion().setFromEuler(corruptedEuler, 'YXZ');
            
            rawTracePoints[i].rot.copy(lockedQuat);
            recordedFrames[i].rotation.copy(lockedQuat);
            
            // THE FIX: Rebuild the trace line using the physical center of the mallet mesh
            let meshShiftZ = AppConfig.offsetZCm - (AppConfig.malletLengthCm / 2.0);
            let headOffset = new THREE.Vector3(0, -loadedRadius - recordedFrames[i].extension, meshShiftZ).applyQuaternion(lockedQuat);
            rawTracePoints[i].pos.copy(recordedFrames[i].pivotPos).add(headOffset);
            
            if (i === impactIdx) {
                let perfectEuler = new THREE.Euler().setFromQuaternion(displayPass.pivotQuat, 'YXZ');
                perfectEuler.y = pristineEuler.y;
                perfectEuler.z = pristineEuler.z;
                displayPass.pivotQuat.setFromEuler(perfectEuler, 'YXZ');
                
                // THE FIX: Correctly recalculate the Face position without overwriting it with the trace line!
                let faceOffset = new THREE.Vector3(0, -loadedRadius - displayPass.extension, getDynamicFaceZ()).applyQuaternion(lockedQuat);
                displayPass.pos.copy(displayPass.pivotPos).add(faceOffset);
            }
        }
    }

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

    if (displayPass) drawStrikeLaser(displayPass);
    if (displayPass) { finalReviewPivotQuat.copy(displayPass.pivotQuat); finalReviewPivotPos.copy(displayPass.pivotPos); finalReviewExtension = displayPass.extension; currentSwingDeviation = displayPass.dev; } 
    else if (lastFrame) { finalReviewPivotQuat.copy(lastFrame.rotation); finalReviewPivotPos.copy(lastFrame.pivotPos); finalReviewExtension = lastFrame.extension; }

    rewindStartTime = Date.now();
    appState = 4.5;

    let effectiveMalletMass = AppConfig.massKg;

    let offCenterHtml = (impactDetected && displayPass && displayPass.offCenterMm !== undefined) ? 
        (displayPass.offCenterMm < 2.0 ? `Center` : `${displayPass.offCenterMm.toFixed(0)}mm ${displayPass.offCenterLabel}`.trim()) : `N/A`;

    let hwAppliedForce = window.lastEdgeData.appliedForce || 0; 
    let afColor = 'var(--text-main)'; 
    if (hwAppliedForce > 2) afColor = 'var(--success)'; 
    else if (hwAppliedForce < -2) afColor = 'var(--danger)'; 

    swingDatabase.push({ frames: [...recordedFrames], rawTracePoints: [...rawTracePoints], casts: [...castData], finalReviewPivotQuat: finalReviewPivotQuat.clone(), finalReviewPivotPos: finalReviewPivotPos.clone(), finalReviewExtension: finalReviewExtension, setupQuat: ghostPivot.quaternion.clone() });

    
    let swingIndex = swingCount; swingCount++;
    
    // --- NEW: Upload practice casts to the cloud! ---
    if (castData.length > 0) {
        savePracticeCastsToCloud(castData, lastComputedTempo);
    }
    
    let ssRad = AppConfig.sweetSpot; let devColor = 'var(--danger)';
    if (impactDetected || displayPass) { 
        if (currentSwingDeviation <= (ssRad / 2.0)) devColor = 'var(--success)'; 
        else if (currentSwingDeviation <= ssRad) devColor = 'var(--warning)'; 
    } else { 
        devColor = 'var(--text-muted)'; 
    }

    let hwBackArc = window.lastEdgeData.backArc || 0;
    let backArcHtml = impactDetected ? `${hwBackArc.toFixed(1)} cm` : `N/A`;
    let hwBackswingTime = window.lastEdgeData.backswingTime || 0;
    let backswingTimeHtml = impactDetected ? `${hwBackswingTime} ms` : `N/A`;

    // 1. PURE MOMENTUM: Immune to sensor clipping and variable dwell times
    let strikeMomentum = displayPass ? (effectiveMalletMass * displayPass.passSpeed) : 0;
    let momentumHtml = impactDetected ? `${strikeMomentum.toFixed(1)} kg·m/s` : `N/A`;

    // 2. FIXED IMPACT FORCE: Uses unclipped velocity and an average 1.5ms collision
    let forceN = displayPass ? ((effectiveMalletMass * displayPass.passSpeed) / 0.0015) : 0;
    let forceHtml = impactDetected ? `${forceN.toFixed(0)} N` : `N/A`;

    let devHtml   = (impactDetected || castData.length > 0) && displayPass ? `${currentSwingDeviation.toFixed(1)}cm ${displayPass.dir}` : `N/A`;
    
    // THE FIX: Dynamically interchange the Impact Location display!
    let impactLocationHtml = impactDetected ? offCenterHtml : devHtml;

    let leanHtml  = (impactDetected || castData.length > 0) && displayPass && displayPass.lean !== undefined ? `${displayPass.lean.toFixed(1)}° ${displayPass.leanDir}`.trim() : `N/A`;
    let velHtml   = displayPass ? `${displayPass.passSpeed.toFixed(1)} m/s` : `--`;
    let tempoHtml = lastComputedTempo > 0 ? `${Math.round(lastComputedTempo)} BPM` : `--`;
    
    let dwellHtml = impactDetected ? `${currentSwingDwell} ms` : `N/A`;
    let aoaHtml = impactDetected ? currentSwingAoA.toFixed(1) + '°' : '--';
    let distHtml = (impactDetected && displayPass && displayPass.estDist !== undefined) ? `${displayPass.estDist.toFixed(0)}m` : `-`;
    let planeTwistHtml = (displayPass && displayPass.planeTwist !== undefined) ? `${(displayPass.planeTwist > 0 ? '+' : '')}${displayPass.planeTwist.toFixed(1)}°` : `N/A`;
    // Convert the calculated horizontal path radians to degrees for the Approach Angle display
    let approachDeg = displayPass ? (displayPass.pathAngleRads * (180.0 / Math.PI)) : 0;
    let impactTwistHtml = (displayPass && !displayPass.isWhiff) ? `${(approachDeg > 0 ? '+' : '')}${approachDeg.toFixed(1)}°` : `--`;
    let twistDeflectionVal = displayPass ? calculateCollisionDeflection(maxTwist, currentSwingDwell, displayPass.rawDev) : 0;
    let twistDeflection = impactDetected ? twistDeflectionVal.toFixed(2) + '°' : `N/A`;
    
    let finalStars = displayPass ? displayPass.stars : ""; let finalStarColor = displayPass ? displayPass.starColor : "var(--text-muted)";
    let starHtml  = finalStars !== "" ? `<span style="color: ${finalStarColor};" class="font-bold">${finalStars}</span>` : `<span class="text-muted">-</span>`;
    let trueDir = displayPass && displayPass.trueLaunchRads > 0 ? 'R' : (displayPass && displayPass.trueLaunchRads < 0 ? 'L' : '');
    let estAccHtml = displayPass ? (displayPass.isWhiff ? `-` : `${(displayPass.estAccRange >= 35 ? 'Max' : displayPass.estAccRange.toFixed(0) + 'm')}`) : `N/A`;
    let trueAccHtml = (impactDetected && displayPass) ? (displayPass.isWhiff ? `-` : `${(displayPass.trueAccRange >= 35 ? 'Max' : displayPass.trueAccRange.toFixed(0) + 'm ' + trueDir)}`) : `<span class="text-muted">-</span>`;
    
    let pDeltaHtml = displayPass ? `${formatOffset(displayPass.pDelta)}` : `N/A`;

    let downTime = window.lastEdgeData.downwardSwingTime || 0;
    let decel = window.lastEdgeData.decelFactor || 0;
    let decelColor = decel > 0 ? 'var(--success)' : (decel < 0 ? 'var(--danger)' : 'var(--text-main)');
    let decelHtml = impactDetected ? `<span style="color:${decelColor};">${decel > 0 ? '+' : ''}${decel}%</span>` : `N/A`;
    let downTimeHtml = impactDetected ? `${downTime} ms` : `N/A`;

    let dsPDelta = downTime > 0 ? calculatePendulumDelta(4.0 * (downTime / 1000.0), AppConfig.handleLengthCm) : null;
    let dsPDeltaHtml = (impactDetected && dsPDelta !== null) ? formatOffset(dsPDelta) : `N/A`;

    // Extract the hardcoded HTML template values into variables
    let edgeVelHtml = `${window.lastEdgeData.zVel.toFixed(2)} m/s`;
    let extHtml = `<span>${hwAppliedForce > 0 ? '+' : ''}${hwAppliedForce.toFixed(0)} N</span>`;
    let advMsgHtml = "";

    // MASK THE DATA IF NOT SUBSCRIBED
    if (!AppConfig.isSubscribed) {
        tempoHtml = "--";
        distHtml = "--";
        edgeVelHtml = "--";
        forceHtml = "--";
        momentumHtml = "--";
        twistDeflection = "--";
        downTimeHtml = "--";
        dsPDeltaHtml = "--";
        pDeltaHtml = "--";
        dwellHtml = "--";
        aoaHtml = "--";
        extHtml = "--";
        estAccHtml = "--";
        trueAccHtml = "--";
        
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
    let advancedKinematicsHtml = '';
    if (impactDetected) {
        advancedKinematicsHtml = `
        <details class="advanced-metrics mt-4">
            <summary>Advanced Strike Kinematics</summary>
            <div class="mt-4">
                <div class="adv-row"><span class="tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="The amount the mallet face physically twisted open or closed during the collision.">Impact Deflection</span><span class="adv-val">${twistDeflection}</span></div>
                <div class="adv-row"><span class="tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="The exact time (ms) the ball remained physically compressed against the face.">Impact Dwell</span><span class="adv-val">${dwellHtml}</span></div>
                <div class="adv-row"><span class="tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="The raw physical power transferred to the ball (kg·m/s).">Momentum</span><span class="adv-val text-accent">${momentumHtml}</span></div>
                <div class="adv-row"><span class="tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="The physical pushing force (N) applied through the shaft during and after the strike.">Extension</span><span class="adv-val">${extHtml}</span></div>
                ${advMsgHtml}
            </div>
        </details>`;
    }

    // 3. Assemble the perfectly clean History Card with the new permanent toolbar
    let defaultVel = displayPass ? `${displayPass.passSpeed.toFixed(1)} m/s` : `--`;
    
    // HELPER: Safely trigger the hidden master toggles from the generated HTML
    if (!window.clickMasterToggle) {
        window.clickMasterToggle = function(type) {
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

    let logHtml = `
        <div class="history-card">
            <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                <div class="flex items-center gap-3">
                    <!-- Clickable Title to Show All Casts -->
                    <span class="swing-title" style="cursor: pointer; text-decoration: underline; text-underline-offset: 4px;" onclick="window.stopSwingReview()" title="Click to view all casts">SWING ${swingCount}</span>
                    
                    <!-- Permanent Icon Toolbar beside the Swing Number -->
                    <div class="trace-toolbar flex items-center gap-1" style="background: var(--bg-secondary); padding: 2px 4px; border-radius: 6px; border: 1px solid var(--border-color);">
                        <!-- Base Trace Icon -->
                        <button class="trace-toggle toggleBase-clone icon-btn ${baseActive}" onclick="window.clickMasterToggle('toggleBase')" title="Toggle Base Trace" style="padding: 4px; border: none; background: transparent; cursor: pointer;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="20" y2="12"></line></svg>
                        </button>
                        <!-- Wobble Ribbon Icon -->
                        <button class="trace-toggle toggleWobble-clone icon-btn ${wobbleActive}" onclick="window.clickMasterToggle('toggleWobble')" title="Toggle Wobble Ribbon" style="padding: 4px; border: none; background: transparent; cursor: pointer;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
                        </button>
                        <!-- Twist Ribbon Icon -->
                        <button class="trace-toggle toggleTwist-clone icon-btn ${twistActive}" onclick="window.clickMasterToggle('toggleTwist')" title="Toggle Twist Ribbon" style="padding: 4px; border: none; background: transparent; cursor: pointer;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><polyline points="3 3 3 8 8 8"></polyline></svg>
                        </button>
                        
                        <div style="width: 1px; height: 16px; background: var(--border-color); margin: 0 4px;"></div>
                        
                        <!-- Play Button -->
                        <button class="icon-btn replay-btn" data-swing-index="${swingIndex}" title="Replay Trace" style="color: var(--accent-primary); padding: 4px; border: none; background: transparent; cursor: pointer;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                        </button>
                    </div>
                </div>
                
                <!-- Timestamp restored to the top line -->
                <div class="flex items-center gap-2">
                    <span class="swing-time" style="white-space: nowrap;">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                </div>
            </div>
            
            <div id="swing-header-${swingIndex}" class="card-basic-stats">
                <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="The speed of the mallet head at the bottom of the swing (m/s).">Velocity</span><span class="stat-val">${defaultVel}</span></div>
                <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="The lateral tilt of the mallet shaft (Roll) at impact.">Lean</span><span class="stat-val text-warning">${leanHtml}</span></div>
                <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="The angle of the mallet face relative to the target line at impact.">Face Angle</span><span class="stat-val">${planeTwistHtml}</span></div>
                <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Exactly where on the mallet face the ball was struck.">Impact Location</span><span class="adv-val text-warning">${impactLocationHtml}</span></div>
                <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Compares your swing rhythm to a mathematically perfect, gravity-driven pendulum.">Swing PΔ</span><span class="stat-val">${pDeltaHtml}</span></div>
                <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="The overall rhythm and cadence of your full swing cycle (BPM).">Tempo</span><span class="stat-val">${tempoHtml}</span></div>
            </div>
            
            ${castsHtml}
            ${advancedKinematicsHtml}
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

window.bleManager.onStateChange = (isConnected, name) => {
    if (!isConnected) {
        const btToggleBtn = document.getElementById('btToggleBtn'); btToggleBtn.className = "icon-btn bt-disconnected";
        
        document.getElementById('swing-state').innerHTML = "MALLET DISCONNECTED<br><span class='small-help text-muted' style='font-size: 0.75rem; font-weight: normal;'>Ensure Bluetooth is on.</span>"; 
        document.getElementById('swing-state').className = "text-accent text-center font-bold mb-4";
        
        // Show connect button, hide activity buttons
        let connectGrp = document.getElementById('connect-group');
        if (connectGrp) connectGrp.classList.remove('hidden');
        document.getElementById('ready-group').classList.add('hidden');
        
        document.getElementById('cancelArmBtn').classList.add('hidden');
        document.getElementById('powerOffBtn').classList.add('hidden');
        document.getElementById('battery-display').classList.add('hidden'); 
        document.getElementById('device-name-display').classList.add('hidden');
        document.getElementById('calibration-container').classList.add('hidden'); 
        appState = 0; 
        showToast("Mallet disconnected ");
        if (inGameMode) { showToast("Mallet disconnected, but match tracking continues offline."); }
    } else {
        savedBleName = name || "LVE Mallet"; document.getElementById('malletNameInput').value = savedBleName; saveSettings(); 
        const btToggleBtn = document.getElementById('btToggleBtn'); btToggleBtn.className = "icon-btn bt-connected";
        appState = 1; initAudio(); 
        
        window.lveLastActiveTime = Date.now();
        window.lveLastMag = 1.0;
        
        let swingStateTxt = document.getElementById('swing-state');
        if(swingStateTxt) { 
            swingStateTxt.innerHTML = "MALLET CONNECTED<br><span class='small-help text-muted' style='font-size: 0.75rem; font-weight: normal; text-decoration: none;'>Select an activity to begin.</span>"; 
            swingStateTxt.className = "text-accent text-center font-bold mb-4"; 
        }
      
        // Hide connect button, show activity buttons
        let connectGrp = document.getElementById('connect-group');
        if (connectGrp) connectGrp.classList.add('hidden');
        document.getElementById('ready-group').classList.remove('hidden');
        
        document.getElementById('powerOffBtn').classList.remove('hidden');
        // ... (rest of the connected logic remains the same)
        document.getElementById('battery-display').classList.remove('hidden'); 
        let nameDisp = document.getElementById('device-name-display'); nameDisp.classList.remove('hidden'); nameDisp.innerText = savedBleName;

        let ledGuidance = AppConfig.ledGuidance ? 1 : 0;
        let radius = AppConfig.radiusInput;
        let mass = AppConfig.massKg * 1000;
        let impact = parseFloat(document.getElementById('impactInput').value) || 1.5;
        let offsetY = parseFloat(document.getElementById('offsetYInput').value) || 5.5;
        let timeout = parseInt(document.getElementById('timeoutInput').value) || 5;
        let sweetSpot = AppConfig.sweetSpot;
        let twist = parseFloat(document.getElementById('twistToleranceInput').value) || 1.0;

        let payload = [ 67, radius, mass / 10, impact * 10, offsetY * 10, timeout, sweetSpot * 10, ledGuidance, Math.round(twist * 10) ];
        
        window.bleManager.sendCommand(payload, true).then(() => {
            if(inGameMode) { window.bleManager.sendCommand([75]); } else { window.bleManager.sendCommand([76]); }
            showToast(`Connected to ${savedBleName} & Push Synced!`);
        });
    }
};

bleManager.onBatteryUpdate = (alreadyCalculatedPct, isCharging, availStrikes) => {
    const batteryDisplay = document.getElementById('battery-display');
    batteryDisplay.classList.remove('hidden');

    if (isCharging) {
        batteryDisplay.innerHTML = `<span class="syncing">⚡</span> Charging`;
        batteryDisplay.style.color = "var(--warning)";
    } else {
        batteryDisplay.innerText = `🔋 ${alreadyCalculatedPct}%`;
        
        if (alreadyCalculatedPct <= 20) {
            batteryDisplay.style.color = "var(--danger)";
        } else {
            batteryDisplay.style.color = "var(--text-main)";
        }
    }
};

window.bleManager.onFirmwareVersion = (ver) => {
    let aboutFw = document.getElementById('about-fw-display'); if (aboutFw) aboutFw.innerText = ver;
};

window.bleManager.onTelemetryData = handleParsedTelemetry;
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
const originalBatteryUpdate = window.bleManager.onBatteryUpdate;

window.bleManager.onBatteryUpdate = function(voltage_mV, isCharging, availStrikes) {
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
    } else {
        calculatedPct = 0;
    }

    calculatedPct = Math.round(calculatedPct);
    calculatedPct = Math.max(0, Math.min(100, calculatedPct)); 

    if (originalBatteryUpdate) originalBatteryUpdate(calculatedPct, isCharging, availStrikes);
    window.lveBatteryVolts = (voltage_mV / 1000).toFixed(2) + "V";
    window.lveBatteryPct = calculatedPct + "%";
    window.lveIsCharging = isCharging ? "YES" : "NO";
};

const originalAppTelemetry = window.bleManager.onTelemetryData;

// --- NEW: Global trackers for the HUD sleep timer ---
window.lveLastActiveTime = Date.now();
window.lveLastMag = 1.0;
// ----------------------------------------------------

window.bleManager.onTelemetryData = function(t) {
    if (originalAppTelemetry) originalAppTelemetry(t);
    
    if (devHudEnabled) {
        let debugDiv = document.getElementById('lve-diagnostic-hud-content');
        if (debugDiv) {
            let cleanNumber = (num) => {
                if (num === undefined || num === null || isNaN(num)) return "+0.00";
                let val = Number(num).toFixed(2);
                if (val === "0.00" || val === "-0.00") return "+0.00"; 
                return Number(val) > 0 ? "+" + val : val;
            };
            
            let mag = Math.sqrt(t.ax*t.ax + t.ay*t.ay + t.az*t.az);
            
            // --- NEW: Calculate Time Remaining until Sleep ---
            // If the mallet experiences a 0.05G shock, reset the sleep timer
            if (Math.abs(mag - window.lveLastMag) > 0.05) {
                window.lveLastActiveTime = Date.now();
            }
            window.lveLastMag = mag;

           // Pull the user's saved timeout setting (defaulting to 5 minutes)
            let timeoutMins = parseInt(document.getElementById('timeoutInput').value) || 5;
            let secondsIdle = (Date.now() - window.lveLastActiveTime) / 1000;
            let sleepRemaining = Math.max(0, (timeoutMins * 60) - secondsIdle);
            
            // --- FIX: Force the mallet to sleep when the app's timer hits zero ---
            if (sleepRemaining <= 0 && window.bleManager && window.bleManager.device && window.bleManager.device.gatt.connected) {
                sendBleCommand([88], true); // Command 'X' forces the hardware to power off
                window.lveLastActiveTime = Date.now(); // Reset the timer so we don't spam the command
            }
            // ----------------------------------------------------------------------

            let sleepMin = Math.floor(sleepRemaining / 60);
            let sleepSec = Math.floor(sleepRemaining % 60).toString().padStart(2, '0');
            let sleepStr = `${sleepMin}m ${sleepSec}s`;
            // -------------------------------------------------

            let calMat = typeof hardwareMountOffset !== 'undefined' ? hardwareMountOffset : {w:1, x:0, y:0, z:0};
            let calQ = typeof lastRawQuat !== 'undefined' ? lastRawQuat : {w:1, x:0, y:0, z:0};

            // Calculate Euler angles from the fully tared target quaternion
            let taredQ = typeof targetQuaternion !== 'undefined' ? targetQuaternion : new THREE.Quaternion();
            let euler = new THREE.Euler().setFromQuaternion(taredQ, 'YXZ');
            let pitchDeg = THREE.MathUtils.radToDeg(euler.x);
            let yawDeg = THREE.MathUtils.radToDeg(euler.y);
            let rollDeg = THREE.MathUtils.radToDeg(euler.z);

            debugDiv.innerHTML = `
                <strong style="color:#fff;">--- LVE DIAGNOSTICS ---</strong><br><br>
                
                <strong style="color:#ef4444;">POWER MANAGEMENT:</strong><br>
                Voltage: ${window.lveBatteryVolts} (${window.lveBatteryPct}) | Charging: ${window.lveIsCharging}<br>
                Time to Sleep: ${sleepStr}<br><br>

                <strong style="color:#32cd32;">RAW ACCELEROMETER:</strong><br>
                X: ${cleanNumber(t.ax)} | Y: ${cleanNumber(t.ay)} | Z: ${cleanNumber(t.az)}<br>
                Mag: ${cleanNumber(mag)} G<br><br>
                
                <strong style="color:#32cd32;">RAW SILICON QUATERNION:</strong><br>
                W: ${cleanNumber(t.q0)} | X: ${cleanNumber(t.q1)}<br>
                Y: ${cleanNumber(t.q2)} | Z: ${cleanNumber(t.q3)}<br><br>

                <strong style="color:#f59e0b;">HARDWARE MATRIX (BASE):</strong><br>
                W: ${cleanNumber(calMat.w)} | X: ${cleanNumber(calMat.x)}<br>
                Y: ${cleanNumber(calMat.y)} | Z: ${cleanNumber(calMat.z)}<br><br>
                
                <strong style="color:#a855f7;">TARED ORIENTATION (DEG):</strong><br>
                Pitch (X): ${cleanNumber(pitchDeg)}°<br>
                Yaw (Y): ${cleanNumber(yawDeg)}°<br>
                Roll (Z): ${cleanNumber(rollDeg)}°<br><br>

                <strong style="color:#38bdf8;">FINAL UI QUATERNION:</strong><br>
                W: ${cleanNumber(calQ.w)} | X: ${cleanNumber(calQ.x)}<br>
                Y: ${cleanNumber(calQ.y)} | Z: ${cleanNumber(calQ.z)}
            `;
        }
    }
};

window.bleManager.onTraceData = (traceArray) => {
    console.log("Received pristine 160ms pre-impact hardware trace!");
    
    // 1. Remove the overlap! The burst covers the last 160ms (roughly 4 low-res BLE frames).
    // Trimming the arrays ensures the trace doesn't visually loop backward in time.
    let framesToTrim = Math.min(4, rawTracePoints.length);
    rawTracePoints.splice(-framesToTrim);
    recordedFrames.splice(-framesToTrim);

    traceArray.forEach(q => {
        if (!q) return;
        
        let pureQ = new THREE.Quaternion(q.q1, q.q2, q.q3, q.q0);

        // THE FIX: Apply the hardware calibration matrix to the high-speed trace frames!
        pureQ.multiply(hardwareMountOffset);

        let orientedQ = new THREE.Quaternion(pureQ.y, -pureQ.z, -pureQ.x, pureQ.w).normalize();
        orientedQ.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI));
        
        let euler = new THREE.Euler().setFromQuaternion(orientedQ, 'YZX');
        euler.y = -euler.y;
        orientedQ.setFromEuler(euler, 'YZX');
        
        let finalQuat = baseQuatInverse.clone().multiply(orientedQ);
        
        // THE FIX: Track the center of the physical mallet mesh, not the shaft!
        let meshShiftZ = AppConfig.offsetZCm - (AppConfig.malletLengthCm / 2.0);
        let headOffset = new THREE.Vector3(0, -loadedRadius, meshShiftZ).applyQuaternion(finalQuat);
        let trueHeadPos = new THREE.Vector3(0, pivotBaseY, 0).add(headOffset);
        
        rawTracePoints.push({
            pos: trueHeadPos,
            rot: finalQuat,
            color: { r: 0.0, g: 1.0, b: 0.8 },
            isForward: true
        });

        // 2. Keep the replay system in sync!
        recordedFrames.push({
            rotation: finalQuat,
            forceMag: currentSwingMaxG, // Fallback since trace packet lacks raw acceleration
            rawPtIndex: rawTracePoints.length,
            pivotPos: new THREE.Vector3(0, pivotBaseY, 0),
            extension: 0,
            rawBLE: pureQ
        });
    });

    // THE FIX: Sync the recorded strike cast to the newly injected pristine trace!
    if (castData.length > 0) {
        let strikeCast = castData.find(c => c.isStrike) || castData[castData.length - 1];
        if (strikeCast) {
            // 1. Shift the math index to the new end of the array
            strikeCast.trailIndex = rawTracePoints.length - 1;
            
            // 2. Sync the 3D Face Position to the pristine hardware frame so the Sweet Spot Slide is perfectly calculated
            let finalRecord = recordedFrames[recordedFrames.length - 1];
            strikeCast.pivotQuat.copy(finalRecord.rotation);
            
            let faceOffset = new THREE.Vector3(0, -loadedRadius - strikeCast.extension, getDynamicFaceZ()).applyQuaternion(strikeCast.pivotQuat);
            strikeCast.pos.copy(strikeCast.pivotPos).add(faceOffset);
        }
    }

    // --- SHOCKWAVE-PROOF APPROACH ANGLE ---
    let totalPts = rawTracePoints.length;
    // 1. Back away from the final frame to avoid the physical collision twist
    let preImpactIdx = totalPts - 3; 
    // 2. Go back far enough to get a clean, straight 10-frame baseline
    let pastIdx = totalPts - 13; 
    
    if (pastIdx >= 0 && preImpactIdx > pastIdx) {
        let pastPos = rawTracePoints[pastIdx].pos;
        let preImpactPos = rawTracePoints[preImpactIdx].pos;
        
        // Convert world positions into your local Tare alignment before doing the math!
        ghostBlock.updateMatrixWorld(true);
        let ghostInvMat = new THREE.Matrix4().copy(ghostBlock.matrixWorld).invert();
        
        let localPast = pastPos.clone().applyMatrix4(ghostInvMat);
        let localImpact = preImpactPos.clone().applyMatrix4(ghostInvMat);
        
        let dx = localImpact.x - localPast.x; 
        let dz = localImpact.z - localPast.z; 
        
        // Only calculate if the mallet physically traveled forward enough to form a stable vector
        if (Math.abs(dz) > 0.01) {
            window.pristinePathAngleRads = Math.atan2(dx, Math.abs(dz));
        }
    }

    updateSmoothTrail();
};

window.fetchCloudMatches = fetchCloudMatches;
window.fetchCloudStrikes = fetchCloudStrikes;
window.openMatchEdit = openMatchEdit;
window.deleteCloudSession = deleteCloudSession; 

window.syncHardwareOffsetFromCloud = function(x, y, z, w) {
    hardwareMountOffset.set(x, y, z, w);
    updateMalletScale();
    saveSettings();
};

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