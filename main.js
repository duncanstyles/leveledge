import { initAudio, audioCtx, playBeep, playDoubleBeep, playTick, isAudioInitialized, isSoundEnabled, toggleSoundState, playSuccessSound } from './audio.js';
import { difficultyMatrix, getStarRating, getShaftTwist, calcAccuracyData, calculateImpactForce } from './kinematics.js';
import { showToast, formatOffset } from './utils.js';
import { supabaseClient, currentUser, setCurrentUser, loadCloudProfile, saveCloudProfile, fetchCloudMatches, fetchCloudStrikes, savePracticeCastsToCloud, fetchCloudTraining, deleteCloudSession } from './cloud.js';
import { 
    scene, camera, renderer, controls, defaultRad, pivotBaseY, loadedRadius, setLoadedRadius,
    masterPivot, masterBlock, faceTrackerNode, physicsTrackingNode, headJoint,
    ghostPivot, ghostBlock, ghostHeadJoint,
    targetEnvironmentGroup, ghostRail, floorGrid, targetArrow, virtualBall,
    wizardTableGroup, tableMesh, headingArrow,
    mainMalletMesh, ghostMalletMesh, baseStlSize, impactLasers, clearImpactLasers,
    MAX_TRAIL_POINTS, trailPositions, trailColors, rawTracePoints, trailGeometry, trailLine,
    initScene, drawStrikeLaser, updateSmoothTrail, rebuildArcPts, hemiLight
} from './scene.js';

// --- CACHED APP CONFIG & DOM ELEMENTS FOR PERFORMANCE ---
const AppConfig = {
    metronomeEnabled: false,
    metronomeBpm: 60,
    practiceLimitSec: 10.0,
    massKg: 1.0,
    flatMag: 4.0,
    malletLengthCm: 27.6,
    malletWidthCm: 6.0,
    sweetSpot: 1.5,
    lawnSpeed: 10.0,
    ledGuidance: true,
    singleSwing: false,
    radiusInput: 127
};

const DisplayElements = {
    countdown: document.getElementById('live-countdown'),
    liveSpeed: document.getElementById('live-speed'),
    liveForce: document.getElementById('live-force'),
    liveApplied: document.getElementById('live-applied'),
    liveDev: document.getElementById('live-dev'),
    liveTempo: document.getElementById('live-tempo')
};

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
    
    let metroBpm = document.getElementById('metronomeBpm');
    AppConfig.metronomeBpm = metroBpm ? (parseFloat(metroBpm.value) || 60) : 60;
    
    let pracInp = document.getElementById('practiceInput');
    AppConfig.practiceLimitSec = pracInp ? (parseFloat(pracInp.value) || 10.0) : 10.0;
    
    let massInp = document.getElementById('massInput');
    AppConfig.massKg = massInp ? ((parseFloat(massInp.value) || 1000) / 1000.0) : 1.0;
    
    let magInp = document.getElementById('flatMagInput');
    AppConfig.flatMag = magInp ? (parseFloat(magInp.value) || 4.0) : 4.0;
    
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
}

document.body.addEventListener('input', syncAppConfig);
document.body.addEventListener('change', syncAppConfig);

window.syncHardwareOffsetFromCloud = function(x, y, z, w) {
    hardwareMountOffset.set(x, y, z, w);
    updateMalletScale();
    saveSettings();
};

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
    let impact = parseFloat(document.getElementById('impactInput').value) || 4.0;
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
    calibrationHoldTimeMs = 0; lastJsTime = Date.now(); lastStableQuat.identity(); rebuildArcPts(loadedRadius); ghostRail.visible = false;
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
        document.getElementById('gm-latest-stats').innerHTML = "Awaiting Next Strike...<br><span style='font-size:0.75rem; color:var(--text-muted); font-weight:normal;'>Double-Tap sensor to align and practice cast.</span>";
        document.getElementById('game-mode-dashboard').classList.remove('hidden');
        document.getElementById('ready-group').classList.add('hidden');
        showToast("On-Course Match Started!");
    } else { 
        showToast("BLE Error."); 
    }
}

document.getElementById('menuToggleBtn').onclick = () => { document.getElementById('menu-drawer').classList.toggle('open'); };

document.getElementById('topToggleHistoryBtn').onclick = () => { 
    const panel = document.getElementById('history-panel');
    const controlPanel = document.getElementById('control-panel');
    
    if (window.innerWidth <= 768) {
        panel.classList.toggle('mobile-open'); 
        
        // Hide the whole control panel when history is open
        if (panel.classList.contains('mobile-open')) {
            controlPanel?.classList.add('hidden');
        } else {
            controlPanel?.classList.remove('hidden');
        }
    } else {
        panel.classList.toggle('desktop-closed');
    }
};

let closeHistBtn = document.getElementById('closeHistoryBtn');
if (closeHistBtn) {
    closeHistBtn.addEventListener('click', () => {
        const panel = document.getElementById('history-panel');
        const controlPanel = document.getElementById('control-panel');
        
        if (window.innerWidth <= 768) {
            panel.classList.remove('mobile-open'); 
            controlPanel?.classList.remove('hidden'); // Bring the buttons back
        } else {
            panel.classList.add('desktop-closed');
        }
    });
}

document.getElementById('tab-training-btn').onclick = () => switchHistoryTab('training');
document.getElementById('tab-cloud-training-btn').onclick = () => switchHistoryTab('cloud'); // ADD THIS
document.getElementById('tab-match-btn').onclick = () => switchHistoryTab('match');

// --- EXPERIMENTAL FEATURE GATING ---
function updateExperimentalFeatures() {
    const isExperimental = document.getElementById('experimentalCheck')?.checked || false;
    const matchBtn = document.getElementById('openMatchModalBtn');
    const matchTab = document.getElementById('tab-match-btn');

    if (isExperimental) {
        if (matchBtn) matchBtn.style.display = ''; 
        if (matchTab) matchTab.style.display = '';
    } else {
        if (matchBtn) matchBtn.style.display = 'none';
        if (matchTab) matchTab.style.display = 'none';
        
        // If they toggle it off while on the Match tab, kick them back to Training
        if (matchTab && matchTab.classList.contains('active')) {
            switchHistoryTab('training');
        }
    }
}

function switchHistoryTab(tab) {
    // 1. Reset all buttons
    document.getElementById('tab-training-btn').classList.remove('active');
    document.getElementById('tab-match-btn').classList.remove('active');
    document.getElementById('tab-cloud-training-btn').classList.remove('active');
    
    // 2. Hide all contents
    document.getElementById('training-tab-content').classList.add('hidden');
    document.getElementById('match-tab-content').classList.add('hidden');
    document.getElementById('cloud-training-tab-content').classList.add('hidden');

    // 3. Activate the correct tab
    if (tab === 'training') {
        document.getElementById('tab-training-btn').classList.add('active');
        document.getElementById('training-tab-content').classList.remove('hidden');
    } else if (tab === 'cloud') {
        document.getElementById('tab-cloud-training-btn').classList.add('active');
        document.getElementById('cloud-training-tab-content').classList.remove('hidden');
        if (currentUser) {
            fetchCloudTraining();
        } else {
            document.getElementById('cloud-training-container').innerHTML = '<div class="text-muted text-center p-5">Please log in to view Cloud Sessions.</div>';
        }
    } else {
        document.getElementById('tab-match-btn').classList.add('active');
        document.getElementById('match-tab-content').classList.remove('hidden');
        if (currentUser) {
            fetchCloudMatches();
        } else {
            document.getElementById('cloud-matches-container').innerHTML = '<div class="text-muted text-center p-5">Please log in to view Cloud Matches.</div>';
        }
    }
}

const MIN_SUPPORTED_FW = "8.0.03";
function getDynamicFaceZ() { return AppConfig.malletLengthCm / 2.0; }
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

let wizardBuffer = []; const WIZARD_BUFFER_SIZE = 20; const WIZARD_VARIANCE_THRESH = 0.02; let vectors = { top: null, bottom: null, front: null, back: null, left: null, right: null };
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
    'audioThreshInput', 'durationInput', 'practiceInput', 'showTraceCheck', 'offsetYInput', 
    'timeoutInput', 'flatMagInput', 'ledGuidanceCheck', 'difficultySelect', 'allowRealtimeTuningCheck',
    'trainerDistSetup', 'trainerTwistSetup', 'singleSwingCheck', 
    'matchLedToggle', 'matchAudioToggle', 'matchDistSetup', 'matchTwistSetup', 'matchLawnSetup',
    'experimentalCheck'
];

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
    window.matchAligned = false;
    window.matchSwinging = false;

    if (!silent) { await sendBleCommand([79]); }

    document.getElementById('cancelArmBtn').classList.add('hidden'); 
    document.getElementById('ready-group').classList.remove('hidden');
    document.getElementById('calibration-container').classList.add('hidden');
    document.getElementById('live-tracking-card').classList.add('hidden');
    document.getElementById('playback-panel').classList.add('hidden');
    document.getElementById('tune-action-panel').classList.add('hidden');
    document.getElementById('alignment-panel').style.display = 'none';
    
    let swingStateTxt = document.getElementById('swing-state'); 
    if(swingStateTxt) { 
        swingStateTxt.innerHTML = "MALLET CONNECTED<br><span class='small-help text-muted' style='font-size: 0.75rem; font-weight: normal;'>Select an activity to begin.</span>"; 
        swingStateTxt.className = "text-accent text-center font-bold mb-4"; 
    }
    
    virtualBall.visible = false; 
    ghostRail.visible = false;
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

document.getElementById('btnSignup').onclick = async () => {
    const email = document.getElementById('authEmail').value;
    const password = document.getElementById('authPassword').value;
    if(!email || !password) return showToast("Enter email and password.");
    
    const { data, error } = await supabaseClient.auth.signUp({ email, password });
    if (error) showToast("Error: " + error.message);
    else { showToast("Success! Check your email to confirm."); authModal.close(); }
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
        document.getElementById('openAuthBtn').innerHTML = 'Sign Out <span>👋</span>';
        document.getElementById('openAuthBtn').onclick = async () => { 
            await supabaseClient.auth.signOut(); 
            showToast("Signed out."); 
        };
        
        if (window.bleManager && window.bleManager.device && window.bleManager.device.gatt.connected) {
            document.getElementById('topSyncBtn').classList.remove('hidden');
        }
        
        // --- THE FIX: Only load the profile if we haven't done it yet ---
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
            if (!hasLoadedCloudProfile) {
                loadCloudProfile();
                hasLoadedCloudProfile = true;
            }
        }
    } else {
        currentUser = null;
        hasLoadedCloudProfile = false; // Reset the flag if they sign out
        document.getElementById('openAuthBtn').innerHTML = 'Cloud Login <span>👤</span>';
        document.getElementById('openAuthBtn').onclick = () => { 
            authModal.showModal(); 
            document.getElementById('menu-drawer').classList.remove('open'); 
        };
        document.getElementById('topSyncBtn').classList.add('hidden');
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

document.getElementById('topSyncBtn').onclick = async () => {
    if(!window.bleManager.device || !window.bleManager.device.gatt.connected) return showToast("Connect to Mallet first!");
    if(!currentUser) return showToast("Please log in to Cloud.");
    
    document.getElementById('topSyncBtn').classList.add('syncing');
    showToast("Syncing strokes to Cloud...");
    downloadedHistory = []; 
    let success = await sendBleCommand([68]); // 'D'
    if (!success) { document.getElementById('topSyncBtn').classList.remove('syncing'); return showToast("Bluetooth Error."); }
    
    setTimeout(async () => {
        document.getElementById('topSyncBtn').classList.remove('syncing');
        if (downloadedHistory.length === 0) { showToast("No new strokes on mallet."); return; }
        
        let matches = {};
        downloadedHistory.forEach(s => {
            if(!matches[s.matchID]) matches[s.matchID] = [];
            matches[s.matchID].push(s);
        });
        
        let massKg = AppConfig.massKg;
        let sRad = AppConfig.radiusInput;
        let lawnSpd = AppConfig.lawnSpeed;

        for (let mID of Object.keys(matches)) {
            const { data: existingMatch } = await supabaseClient.from('matches').select('id').eq('match_time_id', mID).eq('user_id', currentUser.id).limit(1);
            let dbMatchId;
            if (existingMatch && existingMatch.length > 0) {
                dbMatchId = existingMatch[0].id;
            } else {
                let mDateStr = new Date(mID * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                let title = "Untitled Match " + mDateStr;
                const { data: newMatch, error: mErr } = await supabaseClient.from('matches').insert([{ 
                    user_id: currentUser.id, match_time_id: mID, location: title, 
                    lawn_speed: lawnSpd, mallet_mass: massKg * 1000, swing_radius: sRad 
                }]).select();
                if (mErr) { console.error(mErr); continue; }
                dbMatchId = newMatch[0].id;
            }
            
            let usedKeys = new Set();
            let strikesToInsert = [];
            for (let s of matches[mID]) {
                let uniqueSec = s.secondsIntoMatch;
                while (usedKeys.has(uniqueSec)) uniqueSec++;
                usedKeys.add(uniqueSec);
                strikesToInsert.push({
                match_id: dbMatchId, user_id: currentUser.id, seconds_into_match: uniqueSec,
                peak_g: s.peakG, peak_twist: s.peakTwist, dwell: s.dwell, z_vel: s.zVel, 
                applied_force: s.appliedForce, push_force: s.pushForce, q0: s.q0, q1: s.q1, q2: s.q2, q3: s.q3,
                downward_swing_time: s.downwardSwingTime, decel_factor: s.decelFactor,
                back_arc: s.backArc,       
                face_angle: s.faceAngle
            });
            }
            await supabaseClient.from('strikes').upsert(strikesToInsert, { onConflict: 'user_id, match_id, seconds_into_match' });
        }
        
        await sendBleCommand([87]); // 'W'
        showToast(`Synced ${downloadedHistory.length} strokes & Wiped Mallet!`);
        if (!document.getElementById('match-tab-content').classList.contains('hidden')) { fetchCloudMatches(); }
    }, 3000); 
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
    if (confirm("Reset calibration matrix to perfect zero (Identity)? This will reset both the app and the connected mallet.")) {
        
        hardwareMountOffset.set(0, 0, 0, 1);
        saveSettings();
        
        if (window.bleManager && window.bleManager.device && window.bleManager.device.gatt.connected) {
            window.bleManager.sendCalibrationMatrix(1.0, 0.0, 0.0, 0.0).then((success) => {
                if (success) {
                    showToast("Calibration wiped locally and on mallet!");
                } else {
                    showToast("Wiped locally, but hardware sync failed.");
                }
            });
        } else {
            showToast("Calibration wiped locally (Mallet not connected).");
        }
        
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
    document.getElementById('tune-action-panel').classList.add('hidden');
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

    window.bleManager.sendCalibrationMatrix(unifiedQuat.w, unifiedQuat.x, unifiedQuat.y, unifiedQuat.z).then((success) => {
        if (success) {
            showToast("Target Line Offset Saved & Burned to Mallet.");
            hardwareMountOffset.copy(unifiedQuat);
            document.getElementById('alignment-panel').style.display = 'none';
            if (typeof floorGrid !== 'undefined') floorGrid.visible = false;
            if (typeof targetArrow !== 'undefined') targetArrow.visible = false;
            saveSettings();
        } else {
            showToast("Hardware transmission failure.");
        }
    });
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

document.getElementById('themeToggleBtn').onclick = () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    if (newTheme === 'light') { scene.background = new THREE.Color(0xe2e8f0); hemiLight.intensity = 1.2; } 
    else { scene.background = null; hemiLight.intensity = 1.0; }
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
    }
}

function updateMalletScale() {
    if (!mainMalletMesh || !ghostMalletMesh) return;
    let len = AppConfig.malletLengthCm; let wid = AppConfig.malletWidthCm;
    let scaleX = len / baseStlSize.x; let scaleY = wid / baseStlSize.y; let scaleZ = wid / baseStlSize.z; 
    mainMalletMesh.scale.set(scaleX, scaleY, scaleZ); ghostMalletMesh.scale.set(scaleX, scaleY, scaleZ);
    mainMalletMesh.position.z = 0; ghostMalletMesh.position.z = 0; faceTrackerNode.position.set(0, 0, len / 2.0);
    updateSystemGeometry(); rebuildArcPts(loadedRadius);
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
}

settingsElements.forEach(id => { let el = document.getElementById(id); if(el) el.addEventListener('change', () => { saveSettings(); updateMalletScale(); if (id === 'lawnSpeedInput') updateLawnSpeedLabel(); }); });
let expCheck = document.getElementById('experimentalCheck');
if (expCheck) {
    expCheck.addEventListener('change', updateExperimentalFeatures);
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

document.getElementById('flipViewBtn').onclick = () => {
    isViewFlipped = !isViewFlipped; let radiusOffset = AppConfig.radiusInput;
    let camX = isViewFlipped ? -100 : 100; camera.position.set(camX, pivotBaseY - radiusOffset, 0); controls.target.set(0, pivotBaseY - radiusOffset, 0); controls.update();
    document.getElementById('menu-drawer').classList.remove('open');
};
document.getElementById('toggleSoundBtn').onclick = () => { 
    let newState = !isSoundEnabled;
    toggleSoundState(newState);
    document.getElementById('toggleSoundBtn').classList.toggle('active', newState); 
};

document.getElementById('launchWizardBtn').onclick = () => {
    if (!window.bleManager.device || !window.bleManager.device.gatt.connected) { showToast("Connect sensor first before calibrating!"); return; }
    document.getElementById('mallet-modal').close(); document.getElementById('wizard-modal').showModal();
    isWizardActive = true; wizardStep = 0; updateWizardUI();
};

document.getElementById('closeWizardBtn').onclick = () => { 
    isWizardActive = false; 
    capturing = false; 
    document.getElementById('wizard-modal').close(); 
    if (wizardTableGroup) wizardTableGroup.visible = false;
    masterBlock.position.set(0, -loadedRadius, 0); 
    masterPivot.position.set(0, pivotBaseY, 0);
    
    let traceCheck = document.getElementById('showTraceCheck');
    trailLine.visible = traceCheck ? traceCheck.checked : true;
};

const wizardInstructions = [
    { title: "Step 1: Preparation", desc: "Remove the mallet shaft. You will need a perfectly flat table. Set a physical 'Heading Line' (like a table edge) and note 'True North'. Use two identical books if the sensor bulge prevents the head from sitting flat.", btn: "NEXT" },
    { title: "Step 2: Top Face", desc: "Place the TOP face flat on the table. Align the Front striking face so it points exactly at 'True North' along your Heading Line.", btn: "CAPTURE TOP" },
    { title: "Step 3: Bottom Face", desc: "Roll the head 180° over. Place the BOTTOM face flat. Ensure the Front striking face STILL points exactly at 'True North'.", btn: "CAPTURE BOTTOM" },
    { title: "Step 4: Front Face", desc: "Stand the head up on its FRONT striking face. Point the Top face (shaft hole) directly at 'True North' along your Heading Line.", btn: "CAPTURE FRONT" },
    { title: "Step 5: Back Face", desc: "Flip the head 180° to stand on its BACK striking face. The Top face (shaft hole) STILL points directly at 'True North'.", btn: "CAPTURE BACK" },
    { title: "Step 6: Left Side", desc: "Lay the head resting flat on its LEFT side. Align the Front striking face so it points exactly at 'True North'.", btn: "CAPTURE LEFT" },
    { title: "Step 7: Right Side", desc: "Roll it 180°. Place the head resting flat on its RIGHT side. The Front striking face STILL points exactly at 'True North'.", btn: "CAPTURE RIGHT" }
];

function updateWizardUI() {
    let config = wizardInstructions[wizardStep]; document.getElementById('wizard-step-title').innerText = config.title; document.getElementById('wizard-instruction').innerText = config.desc;
    document.getElementById('wizard-progress').innerText = `Step ${wizardStep + 1} of 7`; let btn = document.getElementById('wizardCaptureBtn'); btn.innerText = config.btn; btn.disabled = false;
}

document.getElementById('wizardCaptureBtn').onclick = () => {
    if (wizardStep === 0) { wizardStep++; updateWizardUI(); } 
    else { let btn = document.getElementById('wizardCaptureBtn'); btn.innerText = "WAITING FOR SETTLE... (HANDS OFF)"; btn.disabled = true; wizardBuffer = []; capturing = true; }
};

function calculateRotationMatrix() {
    let zAxis = new THREE.Vector3().subVectors(vectors.top, vectors.bottom).normalize(); let xAxis = new THREE.Vector3().subVectors(vectors.front, vectors.back).normalize();
    let yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize(); xAxis.crossVectors(yAxis, zAxis).normalize();
    let basisMat = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis); hardwareMountOffset.setFromRotationMatrix(basisMat).invert(); 
    saveSettings(); isWizardActive = false; document.getElementById('wizard-modal').close(); 
    
    if (wizardTableGroup) wizardTableGroup.visible = false;
    masterBlock.position.set(0, -loadedRadius, 0);
    masterPivot.position.set(0, pivotBaseY, 0);

    let traceCheck = document.getElementById('showTraceCheck');
    trailLine.visible = traceCheck ? traceCheck.checked : true;

    window.bleManager.sendCalibrationMatrix(hardwareMountOffset.w, hardwareMountOffset.x, hardwareMountOffset.y, hardwareMountOffset.z).then((success) => {
        if(success) showToast("HARDWARE MATRIX BURNED SUCCESSFULLY TO MALLET.");
        else showToast("HARDWARE MATRIX SAVED LOCALLY.");
    });
}

window.addEventListener('modelLoaded', () => {
    updateMalletScale();
});

loadSettings(); let rInput = document.getElementById('radiusInput'); if(rInput && rInput.value) { setLoadedRadius(parseFloat(rInput.value)); if (loadedRadius < 50) setLoadedRadius(50); }

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
const showTraceCheck = document.getElementById('showTraceCheck'); if(showTraceCheck) showTraceCheck.addEventListener('change', (e) => { trailLine.visible = e.target.checked; });

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

document.getElementById('pauseBtn').onclick = () => { if (!playbackMode) return; isPaused = !isPaused; document.getElementById('pauseBtn').innerText = isPaused ? "▶ PLAY" : "⏸ PAUSE"; };
document.getElementById('slowMoBtn').onclick = () => { isSlowMo = !isSlowMo; document.getElementById('slowMoBtn').innerText = isSlowMo ? "🐌 SLOW: ON" : "🐌 SLOW: OFF"; };

document.getElementById('exitReplayBtn').onclick = () => {
    playbackMode = false; isPaused = false; isReviewingLog = false; document.getElementById('playback-panel').classList.add('hidden');
    let swingStateTxt = document.getElementById('swing-state'); if(swingStateTxt) { swingStateTxt.innerText = "SWING REVIEW. DRAG CAMERA."; swingStateTxt.className = "text-warning text-center font-bold mb-4"; }
    if (recordedFrames.length > 0) updateSmoothTrail(recordedFrames[recordedFrames.length-1].rawPtIndex); 
    if (mainMalletMesh) { mainMalletMesh.visible = true; ghostMalletMesh.visible = isGhostEnabled; }
    masterPivot.quaternion.copy(finalReviewPivotQuat); masterPivot.position.copy(finalReviewPivotPos); masterBlock.position.set(0, -(loadedRadius + finalReviewExtension), 0); headJoint.quaternion.identity();
};

document.getElementById('exitPassViewBtn').onclick = () => {

    if (typeof targetEnvironmentGroup !== 'undefined') {
        if (typeof floorGrid !== 'undefined') floorGrid.visible = false;
        if (typeof targetArrow !== 'undefined') targetArrow.visible = false;
    }

    isReviewingLog = false; window.currentlyViewedCast = null;
    document.getElementById('tune-action-panel').classList.add('hidden');
    let swingStateTxt = document.getElementById('swing-state'); if(swingStateTxt) { swingStateTxt.innerText = "SWING REVIEW. DRAG CAMERA."; swingStateTxt.className = "text-warning text-center font-bold mb-4"; }
    
    if (window.fullSwingTraceBuffer && window.fullSwingTraceBuffer.length > 0) {
        rawTracePoints.length = 0;
        rawTracePoints.push(...window.fullSwingTraceBuffer);
    }

    if (recordedFrames.length > 0) updateSmoothTrail(recordedFrames[recordedFrames.length-1].rawPtIndex); 
    else updateSmoothTrail();

    if (mainMalletMesh) { mainMalletMesh.visible = true; ghostMalletMesh.visible = isGhostEnabled; }
    clearImpactLasers();
    masterPivot.quaternion.copy(finalReviewPivotQuat); masterPivot.position.copy(finalReviewPivotPos); masterBlock.position.set(0, -(loadedRadius + finalReviewExtension), 0); headJoint.quaternion.identity();
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
                case 0: tx = 0; ty = 0; tz = 0; break;
                case 1: tx = Math.PI; ty = 0; tz = 0; break;
                case 2: tx = 0; ty = Math.PI; tz = 0; break;
                case 3: tx = Math.PI / 2; ty = Math.PI; tz = 0; break;
                case 4: tx = -Math.PI / 2; ty = 0; tz = 0; break;
                case 5: tx = 0; ty = Math.PI; tz = -Math.PI / 2; break;
                case 6: tx = 0; ty = Math.PI; tz = Math.PI / 2; break;
            }

            let qTarget = new THREE.Quaternion().setFromEuler(new THREE.Euler(tx, ty, tz, 'YXZ'));
            masterPivot.quaternion.slerp(qTarget, 0.1);

            let len = AppConfig.malletLengthCm;
            let wid = AppConfig.malletWidthCm;
            
            let yOffset = (wizardStep === 3 || wizardStep === 4) ? (len / 2.0) : (wid / 2.0);
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
                playbackMode = false; isPaused = false; document.getElementById('playback-panel').classList.add('hidden');
                updateSmoothTrail(recordedFrames[recordedFrames.length-1].rawPtIndex); 
                let swingStateTxt = document.getElementById('swing-state'); if(swingStateTxt) { swingStateTxt.innerText = "SWING REVIEW. DRAG CAMERA."; swingStateTxt.className = "text-warning text-center font-bold mb-4"; }
                if (mainMalletMesh) { mainMalletMesh.visible = true; ghostMalletMesh.visible = isGhostEnabled; }
                masterPivot.quaternion.copy(finalReviewPivotQuat); masterPivot.position.copy(finalReviewPivotPos); masterBlock.position.set(0, -(loadedRadius + finalReviewExtension), 0); headJoint.quaternion.identity();
            }
        }
    }
    renderer.render(scene, camera);
}
animate();

function renderLiveCasts() {
    let liveList = document.getElementById('live-tracking-list'); if (!liveList) return; liveList.innerHTML = '';
    castData.forEach((c, i) => {
        let twistStr = (c.faceAngle > 0 ? '+' : '') + (c.faceAngle || 0).toFixed(1) + '°';
        let speedStr = `${(c.passSpeed || 0).toFixed(1)}m/s`; 
        let forceStr = (c.appliedForce || 0) > 0 ? `+${Math.round(c.appliedForce)}N` : `${Math.round(c.appliedForce)}N`;
        let starDisplay = c.stars !== "" ? `<span style="color: ${c.starColor};" class="font-bold">${c.stars}</span>` : `<span class="text-muted">-</span>`;
        let prefix = c.isStrike ? "STRIKE" : (i+1);
        let distStr = `Est: ${Math.round(c.estDist || 0)}m`; let pDeltaStr = `PΔ: ${formatOffset(c.pDelta)}`;
        let traceAccStr = c.isWhiff ? `-` : `Acc: ${(c.estAccRange >= 35 ? 'Center' : Math.round(c.estAccRange) + 'm')}`;
        let weightClass = c.isStrike ? "font-bold" : ""; let colClass = c.isStrike ? "" : "text-muted";

        let hitStyle = c.isHit ? `background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-left: 3px solid var(--success); border-radius: 4px; padding: 8px; margin-bottom: 4px;` : ``;

        liveList.innerHTML += `
        <div class="cast-row flex-col gap-2 highlight-pass-btn ${colClass} ${weightClass}" data-swing-index="${swingCount - 1}" data-cast-index="${i}" style="${hitStyle}">
            <div class="flex justify-between">
                <span class="w-25">${prefix}: ${(c.dev || 0).toFixed(1)}cm ${c.dir || 'C'}</span>
                <span class="w-25 text-center">${twistStr}</span>
                <span class="w-25 text-center">${forceStr}</span>
                <span class="w-25 text-right">${speedStr}</span>
            </div>
            <div class="flex justify-between text-muted font-normal">
                <span class="w-25">${starDisplay}</span>
                <span class="w-25 text-center">${traceAccStr}</span>
                <span class="w-25 text-center">${distStr}</span>
                <span class="w-25 text-right">${pDeltaStr}</span>
            </div>
        </div>`;
    });
}

function triggerReplay(index) {
    if (!swingDatabase[index]) return;
    let data = swingDatabase[index]; recordedFrames = data.frames; finalReviewPivotQuat.copy(data.finalReviewPivotQuat); finalReviewPivotPos.copy(data.finalReviewPivotPos); finalReviewExtension = data.finalReviewExtension;
    rawTracePoints.length = 0; rawTracePoints.push(...data.rawTracePoints); updateSmoothTrail();
    playbackMode = true; isPaused = false; playbackIndex = 0; isReviewingLog = true; ghostMalletMesh.visible = isGhostEnabled; lastPlaybackTime = Date.now(); 
    
    if (isBallEnabled) { 
        ghostPivot.quaternion.copy(data.setupQuat || new THREE.Quaternion());
        updateSystemGeometry(); 
        virtualBall.visible = true; 
    }
    
    if(scrubberInput) { scrubberInput.max = recordedFrames.length - 1; scrubberInput.value = 0; }
    let sLabel = document.getElementById('scrubberLabel'); if(sLabel) sLabel.innerText = `Frame: 1 / ${recordedFrames.length}`;
    if(data.casts && data.casts.length > 0) drawStrikeLaser(data.casts[data.casts.length - 1]); else { clearImpactLasers(); }
    document.getElementById('pauseBtn').innerText = "⏸ PAUSE"; let swingStateTxt = document.getElementById('swing-state'); if(swingStateTxt) { swingStateTxt.innerText = `REPLAYING SWING #${index + 1}...`; swingStateTxt.className = "text-accent text-center font-bold mb-4"; }
    document.getElementById('playback-panel').classList.remove('hidden');
    document.getElementById('tune-action-panel').classList.add('hidden');
    document.getElementById('history-panel').classList.add('mobile-open');
};

function highlightPass(swingIdx, castIdx) {
    if (!swingDatabase[swingIdx]) return; let swing = swingDatabase[swingIdx]; let cast = swing.casts[castIdx];
    window.currentlyViewedCast = cast;
    playbackMode = false; isPaused = false; isReviewingLog = true; 
    document.getElementById('playback-panel').classList.add('hidden');
    
    let tunePanel = document.getElementById('tune-action-panel');
    tunePanel.classList.remove('hidden');
    tunePanel.classList.add('mt-3');
    tunePanel.style.marginBottom = '0';
    
    let container = document.getElementById('cast-container-' + swingIdx);
    if (container) {
        container.appendChild(tunePanel);
    }
    
    if (document.getElementById('allowRealtimeTuningCheck') && document.getElementById('allowRealtimeTuningCheck').checked) {
        document.getElementById('enterTuningBtn').classList.remove('hidden');
    } else {
        document.getElementById('enterTuningBtn').classList.add('hidden');
    }
    
    window.fullSwingTraceBuffer = swing.rawTracePoints;
    let centerFrame = cast.trailIndex; 
    let startFrame = Math.max(0, centerFrame - 15); 
    let endFrame = Math.min(swing.rawTracePoints.length - 1, centerFrame + 15);
    
    rawTracePoints.length = 0;
    rawTracePoints.push(...swing.rawTracePoints.slice(startFrame, endFrame + 1));
    updateSmoothTrail(); 
    
    masterPivot.quaternion.copy(cast.pivotQuat); masterPivot.position.copy(cast.pivotPos); masterBlock.position.set(0, -(loadedRadius + cast.extension), 0);
    headJoint.quaternion.identity(); ghostMalletMesh.visible = isGhostEnabled; if (mainMalletMesh) mainMalletMesh.visible = true; drawStrikeLaser(cast);
    
    let swingStateTxt = document.getElementById('swing-state'); if(swingStateTxt) { swingStateTxt.innerText = `VIEWING PASS #${castIdx + 1}. DRAG CAMERA.`; swingStateTxt.className = "text-warning text-center font-bold mb-4"; }
};

document.getElementById('cancelArmBtn').onclick = () => resetSystemState(false, false);
document.getElementById('resetMaxBtn').onclick = async () => await resetSystemState(false, true);

function handleHistoricalStrike(s) {
    downloadedHistory.push({ 
        matchID: s.matchID, 
        secondsIntoMatch: s.secondsIntoMatch, 
        exactTime: new Date((s.matchID + s.secondsIntoMatch) * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), 
        peakG: s.peakG, peakTwist: s.peakTwist, dwell: s.dwell, zVel: s.zVel, appliedForce: s.appliedForce, 
        pushForce: s.pushForce, q0: s.q0, q1: s.q1, q2: s.q2, q3: s.q3, timestamp: s.timestamp,
        downwardSwingTime: s.downwardSwingTime, decelFactor: s.decelFactor
    }); 
}

function handleLiveStrike(s) {
    currentSwingMaxG = s.peakG; maxTwist = s.peakTwist; currentSwingDwell = s.dwell;
    let pristineVel = s.zVel; let appliedF = s.appliedForce; let pF = s.pushForce;
    let downTime = s.downwardSwingTime; let decelFact = s.decelFactor;
    
    window.lastEdgeData = { zVel: pristineVel, appliedForce: appliedF, pushForce: pF, downwardSwingTime: downTime, decelFactor: decelFact };
    
    if (inGameMode) {
        gmStrokeCount++; document.getElementById('gm-stroke-count').innerText = gmStrokeCount;
        let massKg = AppConfig.massKg; let lawnMult = 0.50 + (AppConfig.lawnSpeed - 10) * 0.075;
        let ballSpeedMPS = pristineVel * (massKg * 1.8) / (massKg + 0.454); let estDist = (ballSpeedMPS * ballSpeedMPS) * lawnMult;
        let twistStr = (s.faceAngle > 0 ? '+' : '') + (s.faceAngle || 0).toFixed(1) + '°';
        document.getElementById('gm-latest-stats').innerHTML = `<div class="text-muted mb-2 uppercase" style="font-size:0.85rem;">LATEST STRIKE</div><div>Speed: <span class="text-main font-800">${pristineVel.toFixed(1)}</span> m/s</div><div>Face: <span class="text-warning font-800">${twistStr}</span></div><div>Est Dist: <span class="text-accent font-800">${estDist.toFixed(0)}</span> m</div>`;
        return; 
    }

    let pureImpactSensor = new THREE.Quaternion(s.q1, s.q2, s.q3, s.q0);
    let impactRawQuat = new THREE.Quaternion(pureImpactSensor.y, -pureImpactSensor.z, -pureImpactSensor.x, pureImpactSensor.w).normalize();
    impactRawQuat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI)); 
    let iQuat = baseQuatInverse.clone().multiply(impactRawQuat);
    let impactEuler = new THREE.Euler().setFromQuaternion(iQuat, 'YXZ'); currentSwingAoA = THREE.MathUtils.radToDeg(impactEuler.z);
    let locTwist = getShaftTwist(iQuat);

    let existingIndex = -1; if (castData.length > 0 && (globalHwTime - castData[castData.length - 1].time) < 1500) existingIndex = castData.length - 1;

    if (existingIndex !== -1) {
        let ec = castData[existingIndex]; ec.isStrike = true; ec.faceAngle = locTwist; ec.passSpeed = pristineVel; ec.passForce = pF; ec.appliedForce = appliedF;
        
        let sRad = AppConfig.radiusInput;
        if (downTime > 0) {
            ec.dsPDelta = (9.81 * Math.pow((2 * (downTime / 1000.0)) / Math.PI, 2) * 100.0) - sRad;
        }

        let massKg = AppConfig.massKg; let lawnMult = 0.50 + (AppConfig.lawnSpeed - 10) * 0.075;
        let ballSpeedMPS = pristineVel * (massKg * 1.8) / (massKg + 0.454); ec.estDist = (ballSpeedMPS * ballSpeedMPS) * lawnMult;
        let accData = calcAccuracyData(ec.rawDev, locTwist, ec.pathAngleRads, maxTwist, currentSwingDwell);
        ec.isWhiff = accData.isWhiff; ec.estAccRange = accData.estAccRange; ec.trueAccRange = accData.trueAccRange; ec.trueLaunchDeg = accData.trueLaunchDeg;
        ec.estLaunchRads = accData.estLaunchRads; ec.trueLaunchRads = accData.trueLaunchRads; ec.maxAccRange = accData.trueAccRange; 
        let freshRating = getStarRating(ec.rawDev, accData.trueLaunchDeg); ec.stars = freshRating.string; ec.starColor = freshRating.color;
    }
    if (appState === 4 || appState === 3 || (inGameMode && window.matchSwinging)) { impactDetected = true; clearTimeout(goTimeout); setTimeout(() => { finalizeSwingData(globalHwTime); }, 100); }
}

function handleParsedTelemetry(t) {
    const hwTimestamp = t.hwTimestamp; globalHwTime = hwTimestamp; let jsNow = Date.now();
    
    prevRawBLEQuat.copy(currentRawBLEQuat);
    currentRawBLEQuat.set(t.q1, t.q2, t.q3, t.q0);

    lastRawQuat = new THREE.Quaternion(currentRawBLEQuat.y, -currentRawBLEQuat.z, -currentRawBLEQuat.x, currentRawBLEQuat.w).normalize();
    lastRawQuat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI));
    prevTargetQuaternion.copy(targetQuaternion);

    let rawForce = new THREE.Vector3(t.ax, t.ay, t.az); let magnitude = rawForce.length(); let deltaG = Math.abs(magnitude - prevMagnitude);
    
    if (isWizardActive && capturing) {
        wizardBuffer.push(rawForce.clone()); if (wizardBuffer.length > WIZARD_BUFFER_SIZE) wizardBuffer.shift();
        if (wizardBuffer.length === WIZARD_BUFFER_SIZE) {
            let minMag = 999, maxMag = -999; wizardBuffer.forEach(v => { let m = v.length(); if (m < minMag) minMag = m; if (m > maxMag) maxMag = m; });
            if ((maxMag - minMag) < WIZARD_VARIANCE_THRESH) {
                capturing = false; let avgX = 0, avgY = 0, avgZ = 0; wizardBuffer.forEach(v => { avgX += v.x; avgY += v.y; avgZ += v.z; });
                avgX /= WIZARD_BUFFER_SIZE; avgY /= WIZARD_BUFFER_SIZE; avgZ /= WIZARD_BUFFER_SIZE; let avgVec = new THREE.Vector3(avgX, avgY, avgZ).normalize();
                if (wizardStep === 1) vectors.top = avgVec; else if (wizardStep === 2) vectors.bottom = avgVec; else if (wizardStep === 3) vectors.front = avgVec;
                else if (wizardStep === 4) vectors.back = avgVec; else if (wizardStep === 5) vectors.left = avgVec; else if (wizardStep === 6) vectors.right = avgVec;
                wizardStep++; if (wizardStep < 7) { updateWizardUI(); } else { calculateRotationMatrix(); }
            }
        }
    }

    let flatMag = AppConfig.flatMag; let extension = 0;
    if (appState >= 3 && t.appliedForce > 2.0) { let clampedForce = Math.min(t.appliedForce, 15.0); extension = clampedForce * (flatMag / 10.0); }
    let currentDynamicRadius = loadedRadius + extension; let currentPivotLift = extension;

    // --- NEW: MATCH MODE AUTO-TARE & ALIGNMENT ---
    if (inGameMode) {
        if (t.gameSubState >= 3 && !window.matchAligned) {
            window.matchAligned = true;
            let finalEuler = new THREE.Euler().setFromQuaternion(lastRawQuat, 'YXZ');
            let finalHeading = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, finalEuler.y, 0, 'YXZ'));
            baseQuatInverse.copy(finalHeading).invert();
            targetQuaternion.copy(baseQuatInverse).multiply(lastRawQuat);
            currentQuaternion.copy(targetQuaternion);
            masterPivot.quaternion.copy(currentQuaternion);
            
            if (typeof ghostPivot !== 'undefined' && ghostPivot) ghostPivot.quaternion.copy(currentQuaternion);
            updateSystemGeometry();
            
            let plumbNormal = new THREE.Vector3(1, 0, 0);
            let plumbCentroid = new THREE.Vector3(0, pivotBaseY - loadedRadius, 0);
            idealPlane = { centroid: plumbCentroid, normal: plumbNormal };
            
            ignoreSpeedUntilTime = Date.now() + 500; currentAbsoluteSpeed = 0; prevZ = 0; prevFaceZ = 0; isForwardSwing = true; lastForwardPassTime = 0; impactDetected = false;
            posHistory = []; currentSwingDeviation = 0; lastComputedTempo = 0; maxTwist = 0; currentSwingDwell = 0; currentSwingAoA = 0;
            window.lastEdgeData = { zVel: 0, pushForce: 0, appliedForce: 0, downwardSwingTime: 0, decelFactor: 0 }; preRollBuffer = []; recordedFrames = []; rawTracePoints.length = 0; castData = [];
            
            showToast("Match Target Locked!");
        } else if (t.gameSubState < 3 && window.matchAligned) {
            window.matchAligned = false;
            window.matchSwinging = false;
            clearImpactLasers();
            rawTracePoints.length = 0;
            updateSmoothTrail(0);
        }
    }
    // ---------------------------------------------

    if (appState === 2) {
        let dtMs = jsNow - lastJsTime; lastJsTime = jsNow; let calibBar = document.getElementById('calibration-bar'); let swingStateTxt = document.getElementById('swing-state');
        if (calibrationPhase === 'RED') {
            let elapsed = jsNow - redStartTime; let pct = (elapsed / 3000.0) * 66.0; 
            if(calibBar) { calibBar.style.width = Math.min(pct, 66) + "%"; calibBar.style.background = "var(--danger)"; }
            if (elapsed >= 3000 && t.appState === 6) {
                calibrationPhase = 'ORANGE'; calibrationHoldTimeMs = 0; orangeStartTime = jsNow; lastStableQuat.copy(lastRawQuat); 
                if(swingStateTxt) { swingStateTxt.innerText = "STEADYING..."; swingStateTxt.className = "text-warning text-center font-bold mb-4"; }
                ghostRail.visible = true; 
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
                let finalEuler = new THREE.Euler().setFromQuaternion(lastRawQuat, 'YXZ');
                let finalHeading = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, finalEuler.y, 0, 'YXZ'));
                baseQuatInverse.copy(finalHeading).invert(); 
                document.getElementById('calibration-container').classList.add('hidden');

                targetQuaternion.copy(baseQuatInverse).multiply(lastRawQuat); 
                currentQuaternion.copy(targetQuaternion); 
                masterPivot.quaternion.copy(currentQuaternion);

                ghostPivot.quaternion.copy(currentQuaternion); 
                updateSystemGeometry(); 

                let plumbNormal = new THREE.Vector3(1, 0, 0);
                let plumbCentroid = new THREE.Vector3(0, pivotBaseY - loadedRadius, 0);
                idealPlane = { centroid: plumbCentroid, normal: plumbNormal };

                ignoreSpeedUntilTime = Date.now() + 500; currentAbsoluteSpeed = 0; prevZ = 0; prevFaceZ = 0; isForwardSwing = true; lastForwardPassTime = 0; impactDetected = false; isLive = true; 
                playbackMode = false; posHistory = []; currentSwingDeviation = 0; lastComputedTempo = 0; maxTwist = 0; currentSwingDwell = 0; currentSwingAoA = 0;
                window.lastEdgeData = { zVel: 0, pushForce: 0, appliedForce: 0, downwardSwingTime: 0, decelFactor: 0 }; preRollBuffer = []; recordedFrames = []; rawTracePoints.length = 0; castData = [];
                
                sendBleCommand([71]); // 'G'
                appState = 3; armedUiStartTime = Date.now(); document.getElementById('playback-panel').classList.add('hidden'); 
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
        if (appState === 2 && calibrationPhase === 'RED') { masterPivot.quaternion.identity(); currentDynamicRadius = loadedRadius; currentPivotLift = 0; } else { masterPivot.quaternion.copy(targetQuaternion); }
        masterPivot.position.set(0, pivotBaseY + currentPivotLift, 0); masterBlock.position.set(0, -currentDynamicRadius, 0);
        masterPivot.updateMatrixWorld(true); faceTrackerNode.updateMatrixWorld(true); physicsTrackingNode.updateMatrixWorld(true);
    }
    
    let centerPosition = new THREE.Vector3(); physicsTrackingNode.getWorldPosition(centerPosition);
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

        let triggeredNormal = (currentAbsoluteSpeed > 0.8); let triggeredImpact = (deltaG > impactThreshold);

        if (triggeredNormal || triggeredImpact) {
            if (inGameMode) window.matchSwinging = true;
            else appState = 4;
            
            state4UiStartTime = Date.now(); clearTimeout(goTimeout);
            state4StartTime = nowTime; recordTicks = 0; impactDetected = false; postImpactTicks = 0; recordedFrames = []; 
            currentSwingMaxSpeed = 0; currentSwingMaxG = 0; currentSwingDeviation = 0; maxTwist = 0; currentSwingDwell = 0; currentSwingAoA = 0; window.lastEdgeData = { zVel: 0, pushForce: 0, appliedForce: 0, downwardSwingTime: 0, decelFactor: 0 }; rawTracePoints.length = 0;            
            let cutoffTime = nowTime - 2000;
            preRollBuffer.forEach(f => {
                if (f.time >= cutoffTime && rawTracePoints.length < MAX_TRAIL_POINTS) {
                    let r = 0.0, g = 1.0, b = 0.0; 
                    if (!f.isForward) { r = 1.0; g = 1.0; b = 0.0; } 
                    else {
                        if (idealPlane) {
                            let ballWorldPos = virtualBall.position.clone(); let trackingInvMat = new THREE.Matrix4().copy(physicsTrackingNode.matrixWorld).invert();
                            let localBall = ballWorldPos.applyMatrix4(trackingInvMat); let t = Math.min(Math.abs(localBall.x) / 6.0, 1.0); 
                            if(isNaN(t)) t = 0; r = t; g = 1.0 - t; b = 0.0;
                        } else { r = 0.0; g = 1.0; b = 0.8; }
                    }
                    if(isNaN(r)) r = 0; if(isNaN(g)) g = 1; if(isNaN(b)) b = 0;
                    rawTracePoints.push({ pos: f.pos.clone(), color: {r: r, g: g, b: b}, isForward: f.isForward });
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
        if (idealPlane && prevFaceZ <= dynamicFaceZ && currentFaceZ > dynamicFaceZ && isForwardSwing) {
            let tm = (dynamicFaceZ - prevFaceZ) / (currentFaceZ - prevFaceZ); if (isNaN(tm) || tm < 0 || tm > 1) tm = 1.0; 
            let iQuat = prevTargetQuaternion.clone().slerp(targetQuaternion, tm);
            let iRawBLE = prevRawBLEQuat.clone().slerp(currentRawBLEQuat, tm);
            
            let tempPivot = new THREE.Group(); let tempBlock = new THREE.Group(); let tempFace = new THREE.Group();
            tempPivot.position.set(0, pivotBaseY + currentPivotLift, 0); tempBlock.position.set(0, -currentDynamicRadius, 0); tempFace.position.set(0, 0, dynamicFaceZ); 
            tempPivot.add(tempBlock); tempBlock.add(tempFace); tempPivot.quaternion.copy(iQuat); scene.add(tempPivot); tempPivot.updateMatrixWorld(true);
            let exactFacePos = new THREE.Vector3(); tempFace.getWorldPosition(exactFacePos); scene.remove(tempPivot);

            ghostBlock.updateMatrixWorld(true);
            let ghostInvMat = new THREE.Matrix4().copy(ghostBlock.matrixWorld).invert();
            let localFaceAtImpact = exactFacePos.clone().applyMatrix4(ghostInvMat);

            let strikeX = localFaceAtImpact.x; 
            let strikeY = localFaceAtImpact.y; 
            let devCM = Math.abs(strikeX); if (devCM < 0.25) devCM = 0.0;
            let dir = strikeX > 0.1 ? 'R' : (strikeX < -0.1 ? 'L' : 'C'); 
            let locTwist = getShaftTwist(iQuat); let passForce = calculateImpactForce(currentAbsoluteSpeed);
            let floatOffset = localFaceAtImpact.y; 
            let snapshotPos = new THREE.Vector3(0, pivotBaseY + currentPivotLift, 0);

            let pathAngleRads = 0;
            if (preRollBuffer.length > 5) { 
                let pastPos = preRollBuffer[preRollBuffer.length - 5].pos; 
                let pastLocal = pastPos.clone().applyMatrix4(ghostInvMat);
                let faceLocal = exactFacePos.clone().applyMatrix4(ghostInvMat);
                let dx = faceLocal.x - pastLocal.x; 
                let dz = faceLocal.z - pastLocal.z; 
                pathAngleRads = Math.atan2(dx, Math.abs(dz)); 
            }
            
            let massKg = AppConfig.massKg; 
            let lawnVal = AppConfig.lawnSpeed;
            let lawnMult = 0.50 + (lawnVal - 10) * 0.075;
            let ballSpeedMPS = currentAbsoluteSpeed * (massKg * 1.8) / (massKg + 0.454);
            let estDist = (ballSpeedMPS * ballSpeedMPS) * lawnMult;
            let accData = calcAccuracyData(strikeX, locTwist, pathAngleRads, maxTwist, currentSwingDwell); let passRating = getStarRating(strikeX, accData.trueLaunchDeg);

            let isHit = false;
            let currentTwistTol = parseFloat(document.getElementById('twistToleranceInput').value) || 1.0;
            let targetDist = inGameMode ? 
                             (parseFloat(document.getElementById('matchDistSetup').value) || 10.0) : 
                             (parseFloat(document.getElementById('trainerDistSetup').value) || 10.0);
            
            isHit = !accData.isWhiff && 
                    (Math.abs(strikeX) <= AppConfig.sweetSpot) && 
                    (Math.abs(accData.trueLaunchDeg) <= currentTwistTol) && 
                    (estDist >= targetDist);
                    
            if (isHit) {
                let playAudio = inGameMode ? (document.getElementById('matchAudioToggle')?.checked ?? true) : true;
                if (playAudio) {
                    playSuccessSound();
                }
            }

            if (lastForwardPassTime > 0) { let fullCycleSeconds = (nowTime - lastForwardPassTime) / 1000.0; if (fullCycleSeconds > 0.4 && fullCycleSeconds < 5.0) lastComputedTempo = 60.0 / fullCycleSeconds; }
            lastForwardPassTime = nowTime;
            let p_delta = null; if (lastComputedTempo > 0) { let T_sec = 60.0 / lastComputedTempo; let r_m = (9.81 * T_sec * T_sec) / (4.0 * Math.PI * Math.PI); p_delta = (r_m * 100.0) - loadedRadius; }

            let strikeCast = { 
                rawDev: strikeX, dev: devCM, dir: dir, isStrike: false, pos: exactFacePos.clone(), rot: tempFace.getWorldQuaternion(new THREE.Quaternion()), 
                localX: strikeX, localY: strikeY, faceAngle: locTwist, pathAngleRads: pathAngleRads, passSpeed: currentAbsoluteSpeed, passForce: passForce, appliedForce: t.appliedForce, 
                stars: passRating.string, starColor: passRating.color, trailIndex: rawTracePoints.length, pivotQuat: iQuat.clone(), pivotPos: snapshotPos, extension: extension, time: nowTime,
                isWhiff: accData.isWhiff, estAccRange: accData.estAccRange, trueAccRange: accData.trueAccRange, trueLaunchDeg: accData.trueLaunchDeg, 
                estLaunchRads: accData.estLaunchRads, trueLaunchRads: accData.trueLaunchRads, maxAccRange: accData.trueAccRange, estDist: estDist, pDelta: p_delta,
                rawBLE: iRawBLE,
                isHit: isHit 
            };

            if (impactDetected) { strikeCast.isStrike = true; if (castData.length > 0 && castData[castData.length - 1].isStrike) castData[castData.length - 1] = strikeCast; else castData.push(strikeCast); } 
            else { castData.push(strikeCast); }
            
            if(!isDynamicCalibrationActive && !inGameMode) {
                if (DisplayElements.liveDev) DisplayElements.liveDev.innerText = `${devCM.toFixed(1)} cm ${dir}`;
                if (DisplayElements.liveTempo) DisplayElements.liveTempo.innerText = lastComputedTempo > 0 ? `${Math.round(lastComputedTempo)} BPM` : `--`;
                renderLiveCasts();
            }

            let ss = AppConfig.sweetSpot; 
            
            let ledCmd = 72; 
            if (devCM > ss) ledCmd = 74; 
            
            if (AppConfig.ledGuidance && !inGameMode) { 
                sendBleCommand([ledCmd]); 
            }

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
            rawTracePoints.push({ pos: centerPosition.clone(), color: {r: r, g: g, b: b}, isForward: isForwardSwing }); updateSmoothTrail();
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
            document.getElementById('gm-latest-stats').innerHTML = `<div class="text-muted mb-2 uppercase" style="font-size:0.85rem;">PRACTICE CAST</div><div>Face Angle: <span style="color:${hitColor}; font-weight:800;">${twistStr}</span></div><div>Est. Dist: <span class="text-main font-800">${Math.round(displayPass.estDist)}</span> m</div>`;
        }
        return; // Skip adding to the formal history log for empty casts in game mode
    }

    appState = 4.5; isLive = false; rewindStartTime = Date.now(); playDoubleBeep();
    await sendBleCommand([79]); // 'O'
    
    document.getElementById('live-tracking-card').classList.add('hidden'); 
    DisplayElements.countdown.classList.add('hidden');
    document.getElementById('cancelArmBtn').classList.add('hidden'); 
    document.getElementById('ready-group').classList.remove('hidden');

    let lastFrame = recordedFrames.length > 0 ? recordedFrames[recordedFrames.length - 1] : null;
    if (lastFrame) { rewindStartQuat.copy(lastFrame.rotation); rewindStartPos.copy(lastFrame.pivotPos); rewindStartExt = lastFrame.extension; } else { rewindStartQuat.copy(masterPivot.quaternion); rewindStartPos.copy(masterPivot.position); rewindStartExt = 0; }

    let displayPass = null; if (impactDetected) { displayPass = castData.find(c => c.isStrike) || castData[castData.length - 1]; } else if (castData.length > 0) { displayPass = castData[castData.length - 1]; }
    if (displayPass) drawStrikeLaser(displayPass);
    if (displayPass) { finalReviewPivotQuat.copy(displayPass.pivotQuat); finalReviewPivotPos.copy(displayPass.pivotPos); finalReviewExtension = displayPass.extension; currentSwingDeviation = displayPass.dev; } 
    else if (lastFrame) { finalReviewPivotQuat.copy(lastFrame.rotation); finalReviewPivotPos.copy(lastFrame.pivotPos); finalReviewExtension = lastFrame.extension; }

    let effectiveMalletMass = AppConfig.massKg;
    if (impactDetected && displayPass) {
        let lawnVal = AppConfig.lawnSpeed; let lawnMult = 0.50 + (lawnVal - 10) * 0.075;
        let ballSpeedMPS = displayPass.passSpeed * (effectiveMalletMass * 1.8) / (effectiveMalletMass + 0.454);
        currentSwingDist = (ballSpeedMPS * ballSpeedMPS) * lawnMult;
    } else { currentSwingDist = 0; }
    
    let hwAppliedForce = window.lastEdgeData.appliedForce; 
    swingDatabase.push({ frames: [...recordedFrames], rawTracePoints: [...rawTracePoints], casts: [...castData], finalReviewPivotQuat: finalReviewPivotQuat.clone(), finalReviewPivotPos: finalReviewPivotPos.clone(), finalReviewExtension: finalReviewExtension, setupQuat: ghostPivot.quaternion.clone() });
    let swingIndex = swingCount; swingCount++;
    
    // --- NEW: Upload practice casts to the cloud! ---
    if (castData.length > 0) {
        savePracticeCastsToCloud(castData, lastComputedTempo);
    }
    
    let ssRad = AppConfig.sweetSpot; let devColor = 'var(--danger)';
    if (impactDetected || displayPass) { if (currentSwingDeviation <= 0.75) devColor = 'var(--success)'; else if (currentSwingDeviation <= ssRad) devColor = 'var(--warning)'; } else { devColor = 'var(--text-muted)'; }
    let afColor = 'var(--text-main)'; if (hwAppliedForce > 2) afColor = 'var(--success)'; else if (hwAppliedForce < -2) afColor = 'var(--danger)'; 
    
    let forceN = currentSwingMaxG * 9.81 * effectiveMalletMass;
    let forceHtml = impactDetected ? `${forceN.toFixed(0)} N` : `N/A`;
    let devHtml   = (impactDetected || castData.length > 0) && displayPass ? `${currentSwingDeviation.toFixed(1)}cm ${displayPass.dir}` : `N/A`;
    let velHtml   = displayPass ? `${displayPass.passSpeed.toFixed(1)} m/s` : `--`;
    let tempoHtml = lastComputedTempo > 0 ? `${Math.round(lastComputedTempo)} BPM` : `--`;
    
    let dwellHtml = impactDetected ? `${currentSwingDwell} ms` : `N/A`;
    let aoaHtml = impactDetected ? currentSwingAoA.toFixed(1) + '°' : '--';
    let distHtml  = impactDetected ? `${currentSwingDist.toFixed(0)}m` : `-`;
    let faceAngleHtml = displayPass ? `${(displayPass.faceAngle > 0 ? '+' : '')}${displayPass.faceAngle.toFixed(1)}°` : `N/A`;
    let twistDeflectionVal = Math.abs(maxTwist) * (currentSwingDwell / 1000.0);
    if (displayPass && displayPass.rawDev < 0) twistDeflectionVal = -twistDeflectionVal; 
    let twistDeflection = impactDetected ? twistDeflectionVal.toFixed(2) + '°' : `N/A`;
    
    let finalStars = displayPass ? displayPass.stars : ""; let finalStarColor = displayPass ? displayPass.starColor : "var(--text-muted)";
    let starHtml  = finalStars !== "" ? `<span style="color: ${finalStarColor};" class="font-bold">${finalStars}</span>` : `<span class="text-muted">-</span>`;
    let trueDir = displayPass && displayPass.trueLaunchRads > 0 ? 'R' : (displayPass && displayPass.trueLaunchRads < 0 ? 'L' : '');
    let estAccHtml = displayPass ? (displayPass.isWhiff ? `-` : `${(displayPass.estAccRange >= 35 ? 'Center' : displayPass.estAccRange.toFixed(0) + 'm')}`) : `N/A`;
    let trueAccHtml = (impactDetected && displayPass) ? (displayPass.isWhiff ? `-` : `${(displayPass.trueAccRange >= 35 ? 'Center' : displayPass.trueAccRange.toFixed(0) + 'm ' + trueDir)}`) : `<span class="text-muted">-</span>`;
    
    let pDeltaHtml = displayPass ? `${formatOffset(displayPass.pDelta)}` : `N/A`;

    let downTime = window.lastEdgeData.downwardSwingTime || 0;
    let decel = window.lastEdgeData.decelFactor || 0;
    let decelColor = decel > 0 ? 'var(--success)' : (decel < 0 ? 'var(--danger)' : 'var(--text-main)');
    let decelHtml = impactDetected ? `<span style="color:${decelColor};">${decel > 0 ? '+' : ''}${decel}%</span>` : `N/A`;
    let downTimeHtml = impactDetected ? `${downTime} ms` : `N/A`;

    let dsPDelta = downTime > 0 ? (9.81 * Math.pow((2 * (downTime / 1000.0)) / Math.PI, 2) * 100.0) - loadedRadius : null;
    let dsPDeltaHtml = (impactDetected && dsPDelta !== null) ? formatOffset(dsPDelta) : `N/A`;

    let castsHtml = '';
    
    if (castData.length > 0) {
        let listItems = castData.map((c, i) => {
            let twistStr = (c.faceAngle > 0 ? '+' : '') + (c.faceAngle || 0).toFixed(1) + '°';
            let speedStr = `${(c.passSpeed || 0).toFixed(1)}m/s`; 
            let forceStr = (c.appliedForce || 0) > 0 ? `+${Math.round(c.appliedForce)}N` : `${Math.round(c.appliedForce)}N`;
            let starDisplay = c.stars !== "" ? `<span style="color: ${c.starColor};" class="font-bold">${c.stars}</span>` : `<span class="text-muted">-</span>`;
            let prefix = c.isStrike ? "STRIKE" : (i+1);
            let weightClass = c.isStrike ? "font-bold" : ""; let colClass = c.isStrike ? "" : "text-muted";
            let distStr = `d: ${Math.round(c.estDist || 0)}m`; let pDeltaStr = `PΔ: ${formatOffset(c.pDelta)}`;
            let traceAccStr = c.isWhiff ? `-` : `Acc: ${(c.estAccRange >= 35 ? 'Center' : Math.round(c.estAccRange) + 'm')}`;

            let hitStyle = c.isHit ? `background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-left: 3px solid var(--success); border-radius: 4px; padding: 8px; margin-bottom: 4px;` : ``;

            return `
            <div class="cast-row flex-col gap-2 highlight-pass-btn ${colClass} ${weightClass}" data-swing-index="${swingCount-1}" data-cast-index="${i}" style="${hitStyle}">
                <div class="flex justify-between">
                    <span class="w-25">${prefix}: ${(c.dev || 0).toFixed(1)}cm ${c.dir || 'C'}</span>
                    <span class="w-25 text-center">${twistStr}</span>
                    <span class="w-25 text-center">${forceStr}</span>
                    <span class="w-25 text-right">${speedStr}</span>
                </div>
                <div class="flex justify-between text-muted font-normal">
                    <span class="w-25">${starDisplay}</span>
                    <span class="w-25 text-center">${traceAccStr}</span>
                    <span class="w-25 text-center">${distStr}</span>
                    <span class="w-25 text-right">${pDeltaStr}</span>
                </div>
            </div>`;
        }).join('');
        
        castsHtml = `
        <details class="advanced-metrics mt-4">
            <summary>View Casting Traces</summary>
            <div id="cast-container-${swingIndex}">
                ${listItems}
            </div>
        </details>`;
    }

    let logHtml = `
        <div class="history-card">
            <div class="card-header">
                <div><span class="swing-title">SWING #${swingCount}</span> &nbsp;${starHtml}</div>
                <div class="flex items-center gap-2">
                    <span class="swing-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    <button class="icon-btn replay-btn" data-swing-index="${swingIndex}" title="Replay Trace" style="color: var(--accent-primary); border: 1px solid var(--border-color); border-radius: 4px; padding: 4px;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                    </button>
                </div>
            </div>
            
            <div class="card-basic-stats">
                <div class="stat-block"><span class="stat-lbl">Velocity</span><span class="stat-val">${velHtml}</span></div>
                <div class="stat-block"><span class="stat-lbl">Path Dev</span><span class="stat-val" style="color:${devColor}">${devHtml}</span></div>
                <div class="stat-block"><span class="stat-lbl">Face Angle</span><span class="stat-val">${faceAngleHtml}</span></div>
                <div class="stat-block"><span class="stat-lbl">Tempo</span><span class="stat-val text-accent">${tempoHtml}</span></div>
            </div>

            <details class="advanced-metrics">
                <summary>Advanced Kinematics</summary>
                <div class="mt-4">
                    <div class="adv-row"><span>Estimated Dist</span><span class="adv-val">${distHtml}</span></div>
                    <div class="adv-row"><span>Edge Z-Velocity</span><span class="adv-val">${window.lastEdgeData.zVel.toFixed(2)} m/s</span></div>
                    <div class="adv-row"><span>Impact Force</span><span class="adv-val">${forceHtml}</span></div>
                    <div class="adv-row"><span>Collision Deflection</span><span class="adv-val">${twistDeflection}</span></div>
                    <div class="adv-row"><span>Downswing Time</span><span class="adv-val">${downTimeHtml}</span></div>
                    <div class="adv-row"><span>Strike PΔ</span><span class="adv-val">${dsPDeltaHtml}</span></div>
                    <div class="adv-row"><span>Tempo PΔ</span><span class="adv-val">${pDeltaHtml}</span></div>
                    <div class="adv-row"><span>Boost</span><span class="adv-val">${decelHtml}</span></div>
                    <div class="adv-row"><span>Impact Dwell</span><span class="adv-val">${dwellHtml}</span></div>
                    <div class="adv-row"><span>Angle of Attack</span><span class="adv-val">${aoaHtml}</span></div>
                    <div class="adv-row"><span>Extension</span><span class="adv-val" style="color:${afColor};">${hwAppliedForce > 0 ? '+' : ''}${hwAppliedForce.toFixed(0)} N</span></div>
                    <div class="adv-row"><span>Est. Accuracy</span><span class="adv-val">${estAccHtml}</span></div>
                    <div class="adv-row"><span>True Accuracy</span><span class="adv-val">${trueAccHtml}</span></div>
                </div>
            </details>
            ${castsHtml}
        </div>
    `;

    let listDiv = document.getElementById('history-list');
    if (listDiv) { if (swingCount === 1) listDiv.innerHTML = ''; listDiv.insertAdjacentHTML('afterbegin', logHtml); }

    if (window.innerWidth <= 768) { 
        document.getElementById('history-panel').classList.add('mobile-open'); 
        document.getElementById('control-panel')?.classList.add('hidden'); // Hide the controls!
    } else { 
        document.getElementById('history-panel').classList.remove('desktop-closed'); 
    }
    
    let swingStateTxt = document.getElementById('swing-state');
    if(swingStateTxt) { swingStateTxt.innerHTML = "MALLET CONNECTED<br><span class='small-help text-muted' style='font-size: 0.75rem; font-weight: normal;'>Select an activity to begin.</span>"; swingStateTxt.className = "text-accent text-center font-bold mb-4"; }
}    

window.bleManager.onStateChange = (isConnected, name) => {
    if (!isConnected) {
        const btToggleBtn = document.getElementById('btToggleBtn'); btToggleBtn.className = "icon-btn bt-disconnected";
        document.getElementById('swing-state').innerHTML = "CONNECT BLUETOOTH MALLET<br><span class='small-help text-muted' style='font-size: 0.75rem; font-weight: normal;'>Turn on sensor and ensure Bluetooth is enabled.</span>"; 
        document.getElementById('swing-state').className = "text-center font-bold mb-4";
        
        // Removed the crashing centerConnectBtn reference here
        
        document.getElementById('ready-group').classList.add('hidden');
        document.getElementById('cancelArmBtn').classList.add('hidden');
        document.getElementById('powerOffBtn').classList.add('hidden');
        document.getElementById('battery-display').classList.add('hidden'); 
        document.getElementById('device-name-display').classList.add('hidden');
        document.getElementById('topSyncBtn').classList.add('hidden');
        document.getElementById('calibration-container').classList.add('hidden'); 
        appState = 0; 
        showToast("Mallet disconnected ");
        if (inGameMode) { showToast("Mallet disconnected, but match tracking continues offline."); }
    } else {
        savedBleName = name || "LVE Mallet"; document.getElementById('malletNameInput').value = savedBleName; saveSettings(); 
        const btToggleBtn = document.getElementById('btToggleBtn'); btToggleBtn.className = "icon-btn bt-connected";
        appState = 1; initAudio(); 
        
        let swingStateTxt = document.getElementById('swing-state'); 
        if(swingStateTxt) { swingStateTxt.innerHTML = "MALLET CONNECTED<br><span class='small-help text-muted' style='font-size: 0.75rem; font-weight: normal;'>Select an activity to begin.</span>"; swingStateTxt.className = "text-accent text-center font-bold mb-4"; }

      
        document.getElementById('ready-group').classList.remove('hidden');
        document.getElementById('powerOffBtn').classList.remove('hidden');
        document.getElementById('battery-display').classList.remove('hidden'); 
        if(currentUser) document.getElementById('topSyncBtn').classList.remove('hidden');
        let nameDisp = document.getElementById('device-name-display'); nameDisp.classList.remove('hidden'); nameDisp.innerText = savedBleName;

        let ledGuidance = AppConfig.ledGuidance ? 1 : 0;
        let radius = AppConfig.radiusInput;
        let mass = AppConfig.massKg * 1000;
        let impact = parseFloat(document.getElementById('impactInput').value) || 4.0;
        let offsetY = parseFloat(document.getElementById('offsetYInput').value) || 5.5;
        let timeout = parseInt(document.getElementById('timeoutInput').value) || 5;
        let sweetSpot = AppConfig.sweetSpot;
        let twist = parseFloat(document.getElementById('twistToleranceInput').value) || 1.0;

        let payload = [ 67, radius, mass / 10, impact * 10, offsetY * 10, timeout, sweetSpot * 10, ledGuidance, Math.round(twist * 10) ];
        
        window.bleManager.sendCommand(payload, true).then(() => {
            if(inGameMode) { window.bleManager.sendCommand([75]); } else { window.bleManager.sendCommand([76]); }
            showToast(`Connected to ${savedBleName} & Config Synced!`);
        });
    }
};

bleManager.onBatteryUpdate = (alreadyCalculatedPct, isCharging, availStrikes) => {
    const batteryDisplay = document.getElementById('battery-display');
    batteryDisplay.classList.remove('hidden');
    
    let storeDisp = document.getElementById('about-storage-display'); 
    if (storeDisp) { 
        storeDisp.innerText = availStrikes; 
    }

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

window.bleManager.onCalibrationLoaded = (w, x, y, z) => {
    hardwareMountOffset.set(x, y, z, w); 
    saveSettings(); 
    
    if (w === 1.0 && x === 0.0 && y === 0.0 && z === 0.0) {
        showToast("Mallet Matrix Confirmed Zeroed.");
    } else {
        showToast("Calibration Matrix loaded from Mallet!"); 
    }
};

window.bleManager.onTelemetryData = handleParsedTelemetry;
window.bleManager.onHistoricalStrike = handleHistoricalStrike;
window.bleManager.onLiveStrike = handleLiveStrike;
window.bleManager.onError = showToast;

document.getElementById('btToggleBtn').addEventListener('click', () => window.bleManager.connect());

setInterval(() => {
    if (window.bleManager && window.bleManager.device && window.bleManager.device.gatt.connected) {
        if (appState === 1) { 
            sendBleCommand([80]); // 'P'
        }
    }
}, 10000);

let devHudEnabled = false;

window.lveBatteryVolts = "WAIT...";
window.lveBatteryPct = "WAIT...";
window.lveIsCharging = "WAIT...";

/// --- HUD TOGGLE LOGIC ---
function toggleDeveloperHUD() {
    devHudEnabled = !devHudEnabled;
    let existingDiv = document.getElementById('lve-diagnostic-hud');
    
    if (devHudEnabled) {
        if (!existingDiv) {
            const debugDiv = document.createElement('div');
            debugDiv.id = 'lve-diagnostic-hud';
            
            // Added 'cursor: grab;' to indicate it can be moved
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

            // --- HUD DRAG LOGIC (Mouse & Touch) ---
            let isDragging = false, dragOffsetX = 0, dragOffsetY = 0;
            
            const startDrag = (clientX, clientY, target) => {
                if (target === closeBtn) return; // Don't drag if clicking the close button
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
                debugDiv.style.right = 'auto';  // Clear right/bottom bounds
                debugDiv.style.bottom = 'auto';
            };

            const stopDrag = () => {
                isDragging = false;
                debugDiv.style.cursor = 'grab';
            };

            // Mouse Events
            debugDiv.addEventListener('mousedown', (e) => startDrag(e.clientX, e.clientY, e.target));
            document.addEventListener('mousemove', (e) => doDrag(e.clientX, e.clientY));
            document.addEventListener('mouseup', stopDrag);

            // Touch Events
            debugDiv.addEventListener('touchstart', (e) => startDrag(e.touches[0].clientX, e.touches[0].clientY, e.target), {passive: true});
            document.addEventListener('touchmove', (e) => { 
                if(isDragging) {
                    e.preventDefault(); // Prevent page scrolling while dragging
                    doDrag(e.touches[0].clientX, e.touches[0].clientY); 
                }
            }, {passive: false});
            document.addEventListener('touchend', stopDrag);
            // --------------------------------------

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
            let calMat = typeof hardwareMountOffset !== 'undefined' ? hardwareMountOffset : {w:1, x:0, y:0, z:0};
            let calQ = typeof lastRawQuat !== 'undefined' ? lastRawQuat : {w:1, x:0, y:0, z:0};

            debugDiv.innerHTML = `
                <strong style="color:#fff;">--- LVE DIAGNOSTICS ---</strong><br><br>
                
                <strong style="color:#ef4444;">POWER MANAGEMENT:</strong><br>
                Voltage: ${window.lveBatteryVolts} (${window.lveBatteryPct}) | Charging: ${window.lveIsCharging}<br><br>

                <strong style="color:#32cd32;">RAW ACCELEROMETER:</strong><br>
                X: ${cleanNumber(t.ax)} | Y: ${cleanNumber(t.ay)} | Z: ${cleanNumber(t.az)}<br>
                Mag: ${cleanNumber(mag)} G<br><br>
                
                <strong style="color:#32cd32;">RAW SILICON QUATERNION:</strong><br>
                W: ${cleanNumber(t.q0)} | X: ${cleanNumber(t.q1)}<br>
                Y: ${cleanNumber(t.q2)} | Z: ${cleanNumber(t.q3)}<br><br>

                <strong style="color:#f59e0b;">HARDWARE MATRIX (BASE):</strong><br>
                W: ${cleanNumber(calMat.w)} | X: ${cleanNumber(calMat.x)}<br>
                Y: ${cleanNumber(calMat.y)} | Z: ${cleanNumber(calMat.z)}<br><br>

                <strong style="color:#38bdf8;">FINAL UI QUATERNION:</strong><br>
                W: ${cleanNumber(calQ.w)} | X: ${cleanNumber(calQ.x)}<br>
                Y: ${cleanNumber(calQ.y)} | Z: ${cleanNumber(calQ.z)}
            `;
        }
    }
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
        if (!isNaN(swingIndex)) {
            triggerReplay(swingIndex);
        }
        return; 
    }

    const castRow = e.target.closest('.highlight-pass-btn');
    if (castRow) {
        const swingIdx = parseInt(castRow.getAttribute('data-swing-index'), 10);
        const castIdx = parseInt(castRow.getAttribute('data-cast-index'), 10);
        if (!isNaN(swingIdx) && !isNaN(castIdx)) {
            highlightPass(swingIdx, castIdx);
        }
    }
});

document.getElementById('powerOffBtn').addEventListener('click', async () => {
    if (confirm("Are you sure you want to power off the mallet?")) {
        showToast("Powering off mallet...");
        await sendBleCommand([88]); 
    }
});