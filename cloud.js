// cloud.js
import { difficultyMatrix, getStarRating, getShaftTwist, calculateImpactForce, calculateTrueDwell, calculatePendulumDelta } from './kinematics.js';
import { showToast, formatOffset, buildCastRowHTML } from './utils.js';

const SUPABASE_URL = 'https://ymqqthvgfsrdmairukfi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InltcXF0aHZnZnNyZG1haXJ1a2ZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NjIxMjQsImV4cCI6MjA5OTMzODEyNH0.IXf5VkCCVgBBRzmfD4BLOq_xNEcyhcySmDySq677E-E';
export const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export let currentUser = null;
export let playerProfile = null;
export let playerMallets = [];   // Array of { role, nickname, last_connected_at, mallet: {...} }
export let activeMallet = null;    // Currently active physical mallet record

let performanceChartInstance = null;

export function setCurrentUser(user) {
    currentUser = user;
    if (!user) {
        playerProfile = null;
        playerMallets = [];
        activeMallet = null;
    }
}

export function setActiveMalletLocal(malletObj) {
    activeMallet = malletObj;
}

function getDefaultMalletObject(mac = 'OFFLINE-DEFAULT', name = 'Primary Mallet') {
    return {
        ble_mac: mac,
        ble_name: name,
        name: name,
        head_length_cm: parseFloat(document.getElementById('malletLengthInput')?.value) || 27.6,
        face_width_cm: parseFloat(document.getElementById('malletWidthInput')?.value) || 6.0,
        handle_length_cm: parseFloat(document.getElementById('handleLengthInput')?.value) || 91.4,
        mass_g: parseFloat(document.getElementById('massInput')?.value) || 1000,
        sweet_spot_cm: parseFloat(document.getElementById('sweetSpotInput')?.value) || 1.5,
        offset_y_cm: parseFloat(document.getElementById('offsetYInput')?.value) || 5.5,
        offset_z_cm: parseFloat(document.getElementById('offsetZInput')?.value) || 10.0,
        matrix_w: 1.0,
        matrix_x: 0.0,
        matrix_y: 0.0,
        matrix_z: 0.0,
        is_calibrated: false,
        allow_sharing: true
    };
}

export function loadOfflineMalletFallback() {
    try {
        const lastMac = localStorage.getItem('LVE_LastMac') || 'OFFLINE-DEFAULT';
        const raw = localStorage.getItem(`LVE_Mallet_${lastMac}`);
        if (raw) {
            activeMallet = JSON.parse(raw);
            if (window.applyMalletToUI) window.applyMalletToUI(activeMallet, false);
        }
    } catch (e) {}
}

// ============================================================================
// 1. PLAYER PREFERENCES (player_profiles table)
// ============================================================================
function readPreferencesFromDOM() {
    return {
        darkTheme: !!document.getElementById('darkThemeCheck')?.checked,
        soundEnabled: document.getElementById('soundCheck')?.checked ?? true,
        flipView: !!document.getElementById('flipViewCheck')?.checked,
        showFloorGrid: !!document.getElementById('floorGridToggle')?.checked,
        showVerticalGrid: !!document.getElementById('verticalGridToggle')?.checked,
        showOptimumArc: !!document.getElementById('optimumArcToggle')?.checked,
        hideBackswing: document.getElementById('hideBackswingCheck')?.checked ?? true,
        showTrace: document.getElementById('showTraceCheck')?.checked ?? true,
        ledGuidance: document.getElementById('ledGuidanceCheck')?.checked ?? true,
        lawnSpeed: parseFloat(document.getElementById('lawnSpeedInput')?.value) || 10.0,
        impactThreshold: parseFloat(document.getElementById('impactInput')?.value) || 1.5,
        sleepTimeoutMins: parseInt(document.getElementById('timeoutInput')?.value) || 5,
        followThruSec: parseFloat(document.getElementById('durationInput')?.value) || 1.0,
        flatMag: parseFloat(document.getElementById('flatMagInput')?.value) || 1.0,
        twistTolerance: parseFloat(document.getElementById('twistToleranceInput')?.value) || 1.0,
        faultSensitivity: (() => {
            const v = parseInt(document.getElementById('faultSensitivityInput')?.value, 10);
            return isNaN(v) ? 1 : v;
        })(),
    };
}

function applyPreferencesToDOM(prefs) {
    if (!prefs) return;
    const setCheck = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.checked = !!val; };
    const setVal   = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };

    setCheck('darkThemeCheck', prefs.darkTheme);
    setCheck('soundCheck', prefs.soundEnabled);
    setCheck('flipViewCheck', prefs.flipView);
    setCheck('floorGridToggle', prefs.showFloorGrid);
    setCheck('verticalGridToggle', prefs.showVerticalGrid);
    setCheck('optimumArcToggle', prefs.showOptimumArc);
    setCheck('hideBackswingCheck', prefs.hideBackswing);
    setCheck('showTraceCheck', prefs.showTrace);
    setCheck('ledGuidanceCheck', prefs.ledGuidance);
    setVal('lawnSpeedInput', prefs.lawnSpeed);
    setVal('impactInput', prefs.impactThreshold);
    setVal('timeoutInput', prefs.sleepTimeoutMins);
    setVal('durationInput', prefs.followThruSec);
    setVal('flatMagInput', prefs.flatMag);
    setVal('twistToleranceInput', prefs.twistTolerance);
    setVal('faultSensitivityInput', prefs.faultSensitivity);
}

export async function loadPlayerProfile() {
    if (!currentUser) return;

    const { data } = await supabaseClient
        .from('player_profiles')
        .select('*')
        .eq('user_id', currentUser.id)
        .maybeSingle();

    const authMeta = currentUser.user_metadata || {};

    if (data) {
        playerProfile = data;
        document.getElementById('playerNameInput').value = data.display_name || authMeta.display_name || '';
        document.getElementById('playerCountryInput').value = data.country || authMeta.country || '';
        document.getElementById('radiusInput').value = data.swing_radius_cm ?? 127;
        document.getElementById('difficultySelect').value = data.skill_tier || 'intermediate';
        document.getElementById('subscribedCheck').checked = data.is_subscribed ?? true;

        applyPreferencesToDOM(data.preferences);
        if (window.onPlayerPreferencesApplied) window.onPlayerPreferencesApplied();
    } else {
        document.getElementById('playerNameInput').value = authMeta.display_name || '';
        document.getElementById('playerCountryInput').value = authMeta.country || '';
        await savePlayerProfile();
    }

    await fetchPlayerMallets();

    // If no physical mallet is currently connected via BLE, load the player's last active mallet into UI
    if (!window.bleManager?.isConnected()) {
        const targetId = playerProfile?.active_mallet_id;
        const entry = playerMallets.find(pm => pm.mallet?.id === targetId) || playerMallets[0];
        if (entry?.mallet) {
            activeMallet = entry.mallet;
            const cacheMac = activeMallet.ble_mac || 'OFFLINE-DEFAULT';
            localStorage.setItem('LVE_LastMac', cacheMac);
            localStorage.setItem(`LVE_Mallet_${cacheMac}`, JSON.stringify(activeMallet));
            if (window.applyMalletToUI) window.applyMalletToUI(activeMallet, false);
        }
    }

    showToast("Player Preferences Loaded.");
}

export async function savePlayerProfile() {
    if (!currentUser) return;

    const currentName = document.getElementById('playerNameInput')?.value || '';
    const currentCountry = document.getElementById('playerCountryInput')?.value || '';
    const prefs = readPreferencesFromDOM();

    const payload = {
        user_id: currentUser.id,
        display_name: currentName,
        country: currentCountry,
        swing_radius_cm: parseFloat(document.getElementById('radiusInput')?.value) || 127,
        skill_tier: document.getElementById('difficultySelect')?.value || 'intermediate',
        is_subscribed: document.getElementById('subscribedCheck')?.checked ?? true,
        active_mallet_id: activeMallet?.id || playerProfile?.active_mallet_id || null,
        preferences: prefs,
        updated_at: new Date().toISOString()
    };

    const { data, error } = await supabaseClient
        .from('player_profiles')
        .upsert(payload, { onConflict: 'user_id' })
        .select()
        .single();

    if (!error && data) {
        playerProfile = data;
    }

    const meta = currentUser.user_metadata || {};
    if (meta.display_name !== currentName || meta.country !== currentCountry) {
        await supabaseClient.auth.updateUser({
            data: { display_name: currentName, country: currentCountry }
        });
    }
}

// ============================================================================
// 2. MULTI-MALLET & SHARED MALLET MANAGEMENT (mallets & player_mallets)
// ============================================================================
export async function fetchPlayerMallets() {
    if (!currentUser) return [];

    const { data, error } = await supabaseClient
        .from('player_mallets')
        .select('role, nickname, last_connected_at, mallet:mallets(*)')
        .eq('user_id', currentUser.id)
        .order('last_connected_at', { ascending: false });

    if (!error && data) {
        playerMallets = data.filter(row => row.mallet !== null);
        if (window.renderMalletSelector) window.renderMalletSelector();
    }
    return playerMallets;
}

/**
 * Reconciles a newly connected BLE mallet across:
 *   1) Xiao Onboard Internal Flash (flashProfile)
 *   2) Supabase Cloud (`mallets` & `player_mallets`)
 *   3) Local Cache (`LVE_Mallet_<MAC>`)
 */
export async function syncConnectedMallet(bleMac, bleName, flashProfile) {
    if (!bleMac) return null;
    const normMac = bleMac.trim().toUpperCase();
    localStorage.setItem('LVE_LastMac', normMac);

    // --- OFFLINE / GUEST PATH ---
    if (!currentUser) {
        let localCached = null;
        try {
            const raw = localStorage.getItem(`LVE_Mallet_${normMac}`);
            if (raw) localCached = JSON.parse(raw);
        } catch (e) {}

        let resolved = null;
        if (flashProfile && flashProfile.isCalibrated) {
            resolved = {
                ble_mac: normMac,
                ble_name: bleName,
                name: localCached?.name || bleName || 'Connected Mallet',
                head_length_cm: flashProfile.headLength_cm,
                face_width_cm: flashProfile.faceWidth_cm,
                handle_length_cm: flashProfile.handleLength_cm,
                mass_g: flashProfile.mass_g,
                sweet_spot_cm: flashProfile.sweetSpot_cm,
                offset_y_cm: flashProfile.offsetY_cm,
                offset_z_cm: flashProfile.offsetZ_cm,
                matrix_w: flashProfile.w,
                matrix_x: flashProfile.x,
                matrix_y: flashProfile.y,
                matrix_z: flashProfile.z,
                is_calibrated: true,
                allow_sharing: true
            };
        } else if (localCached) {
            resolved = localCached;
            if (window.bleManager?.isConnected()) {
                await window.bleManager.writeMalletProfile({
                    isCalibrated: !!resolved.is_calibrated,
                    w: resolved.matrix_w, x: resolved.matrix_x, y: resolved.matrix_y, z: resolved.matrix_z,
                    headLength_cm: resolved.head_length_cm, faceWidth_cm: resolved.face_width_cm,
                    handleLength_cm: resolved.handle_length_cm, mass_g: resolved.mass_g,
                    offsetY_cm: resolved.offset_y_cm, offsetZ_cm: resolved.offset_z_cm,
                    sweetSpot_cm: resolved.sweet_spot_cm
                });
            }
        } else {
            resolved = {
                ble_mac: normMac,
                ble_name: bleName,
                name: bleName || 'New Mallet',
                head_length_cm: 27.6, face_width_cm: 6.0, handle_length_cm: 91.4,
                mass_g: 1000, sweet_spot_cm: 1.5, offset_y_cm: 5.5, offset_z_cm: 10.0,
                matrix_w: 1.0, matrix_x: 0.0, matrix_y: 0.0, matrix_z: 0.0,
                is_calibrated: false,
                allow_sharing: true
            };
        }

        activeMallet = resolved;
        localStorage.setItem(`LVE_Mallet_${normMac}`, JSON.stringify(resolved));
        if (window.applyMalletToUI) window.applyMalletToUI(resolved, true);
        return resolved;
    }

    // --- AUTHENTICATED CLOUD PATH ---
    let { data: cloudMallet } = await supabaseClient
        .from('mallets')
        .select('*')
        .eq('ble_mac', normMac)
        .maybeSingle();

    if (!cloudMallet) {
        await fetchPlayerMallets();
        const legacyEntry = playerMallets.find(pm => pm.mallet?.ble_mac?.startsWith('LEGACY-'));

        if (legacyEntry && legacyEntry.mallet) {
            const leg = legacyEntry.mallet;
            const useFlash = !leg.is_calibrated && flashProfile?.isCalibrated;

            const upgradePayload = {
                ble_mac: normMac,
                ble_name: bleName,
                head_length_cm: useFlash ? flashProfile.headLength_cm : leg.head_length_cm,
                face_width_cm: useFlash ? flashProfile.faceWidth_cm : leg.face_width_cm,
                handle_length_cm: useFlash ? flashProfile.handleLength_cm : leg.handle_length_cm,
                mass_g: useFlash ? flashProfile.mass_g : leg.mass_g,
                sweet_spot_cm: useFlash ? flashProfile.sweetSpot_cm : leg.sweet_spot_cm,
                offset_y_cm: useFlash ? flashProfile.offsetY_cm : leg.offset_y_cm,
                offset_z_cm: useFlash ? flashProfile.offsetZ_cm : leg.offset_z_cm,
                matrix_w: useFlash ? flashProfile.w : leg.matrix_w,
                matrix_x: useFlash ? flashProfile.x : leg.matrix_x,
                matrix_y: useFlash ? flashProfile.y : leg.matrix_y,
                matrix_z: useFlash ? flashProfile.z : leg.matrix_z,
                is_calibrated: useFlash ? true : leg.is_calibrated,
                updated_at: new Date().toISOString()
            };

            const { data: upgraded } = await supabaseClient
                .from('mallets')
                .update(upgradePayload)
                .eq('id', leg.id)
                .select()
                .single();

            cloudMallet = upgraded || { ...leg, ...upgradePayload };
        } else {
            const hasFlashCal = !!(flashProfile && flashProfile.isCalibrated);
            const insertPayload = {
                ble_mac: normMac,
                ble_name: bleName,
                owner_id: currentUser.id,
                name: bleName || 'New Mallet',
                head_length_cm: hasFlashCal ? flashProfile.headLength_cm : 27.6,
                face_width_cm: hasFlashCal ? flashProfile.faceWidth_cm : 6.0,
                handle_length_cm: hasFlashCal ? flashProfile.handleLength_cm : 91.4,
                mass_g: hasFlashCal ? flashProfile.mass_g : 1000,
                sweet_spot_cm: hasFlashCal ? flashProfile.sweetSpot_cm : 1.5,
                offset_y_cm: hasFlashCal ? flashProfile.offsetY_cm : 5.5,
                offset_z_cm: hasFlashCal ? flashProfile.offsetZ_cm : 10.0,
                matrix_w: hasFlashCal ? flashProfile.w : 1.0,
                matrix_x: hasFlashCal ? flashProfile.x : 0.0,
                matrix_y: hasFlashCal ? flashProfile.y : 0.0,
                matrix_z: hasFlashCal ? flashProfile.z : 0.0,
                is_calibrated: hasFlashCal,
                calibrated_at: hasFlashCal ? new Date().toISOString() : null,
                allow_sharing: true
            };

            const { data: created, error: insErr } = await supabaseClient
                .from('mallets')
                .insert([insertPayload])
                .select()
                .single();

            if (insErr) {
                // If owner disabled cloud sharing (23505 unique MAC collision), use onboard flash profile locally
                if (insErr.code === '23505') {
                    const privateMallet = {
                        ble_mac: normMac,
                        ble_name: bleName,
                        name: bleName || 'Private Mallet',
                        head_length_cm: flashProfile?.headLength_cm ?? 27.6,
                        face_width_cm: flashProfile?.faceWidth_cm ?? 6.0,
                        handle_length_cm: flashProfile?.handleLength_cm ?? 91.4,
                        mass_g: flashProfile?.mass_g ?? 1000,
                        sweet_spot_cm: flashProfile?.sweetSpot_cm ?? 1.5,
                        offset_y_cm: flashProfile?.offsetY_cm ?? 5.5,
                        offset_z_cm: flashProfile?.offsetZ_cm ?? 10.0,
                        matrix_w: flashProfile?.w ?? 1.0,
                        matrix_x: flashProfile?.x ?? 0.0,
                        matrix_y: flashProfile?.y ?? 0.0,
                        matrix_z: flashProfile?.z ?? 0.0,
                        is_calibrated: !!flashProfile?.isCalibrated,
                        allow_sharing: false
                    };
                    activeMallet = privateMallet;
                    if (window.applyMalletToUI) window.applyMalletToUI(privateMallet, true);
                    showToast("Mallet cloud sharing is disabled by owner — using onboard calibration.");
                    return privateMallet;
                }
                console.error("Failed registering mallet in cloud:", insErr.message);
                return null;
            }
            cloudMallet = created;
        }
    } else {
        // Auto-claim if the previous owner released this mallet
        if (!cloudMallet.owner_id) {
            const { data: claimed, error: claimErr } = await supabaseClient
                .from('mallets')
                .update({
                    owner_id: currentUser.id,
                    ble_name: bleName || cloudMallet.ble_name,
                    allow_sharing: true,
                    updated_at: new Date().toISOString()
                })
                .eq('id', cloudMallet.id)
                .is('owner_id', null)
                .select()
                .single();

            if (!claimErr && claimed) {
                cloudMallet = claimed;
                showToast(`Ownership claimed for ${cloudMallet.name}!`);
            }
        }

        if (!cloudMallet.is_calibrated && flashProfile?.isCalibrated) {
            const { data: promoted } = await supabaseClient
                .from('mallets')
                .update({
                    ble_name: bleName,
                    head_length_cm: flashProfile.headLength_cm,
                    face_width_cm: flashProfile.faceWidth_cm,
                    handle_length_cm: flashProfile.handleLength_cm,
                    mass_g: flashProfile.mass_g,
                    sweet_spot_cm: flashProfile.sweetSpot_cm,
                    offset_y_cm: flashProfile.offsetY_cm,
                    offset_z_cm: flashProfile.offsetZ_cm,
                    matrix_w: flashProfile.w,
                    matrix_x: flashProfile.x,
                    matrix_y: flashProfile.y,
                    matrix_z: flashProfile.z,
                    is_calibrated: true,
                    calibrated_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq('id', cloudMallet.id)
                .select()
                .single();

            if (promoted) cloudMallet = promoted;
        } else if (bleName && cloudMallet.ble_name !== bleName) {
            await supabaseClient.from('mallets').update({ ble_name: bleName }).eq('id', cloudMallet.id);
            cloudMallet.ble_name = bleName;
        }
    }

    // Push authoritative profile to Xiao flash so hardware & cloud always match
    if (window.bleManager?.isConnected()) {
        await window.bleManager.writeMalletProfile({
            isCalibrated: !!cloudMallet.is_calibrated,
            w: cloudMallet.matrix_w,
            x: cloudMallet.matrix_x,
            y: cloudMallet.matrix_y,
            z: cloudMallet.matrix_z,
            headLength_cm: cloudMallet.head_length_cm,
            faceWidth_cm: cloudMallet.face_width_cm,
            handleLength_cm: cloudMallet.handle_length_cm,
            mass_g: cloudMallet.mass_g,
            offsetY_cm: cloudMallet.offset_y_cm,
            offsetZ_cm: cloudMallet.offset_z_cm,
            sweetSpot_cm: cloudMallet.sweet_spot_cm
        });
    }

    const role = (cloudMallet.owner_id === currentUser.id) ? 'owner' : 'shared';
    await supabaseClient.from('player_mallets').upsert({
        user_id: currentUser.id,
        mallet_id: cloudMallet.id,
        role: role,
        last_connected_at: new Date().toISOString()
    }, { onConflict: 'user_id,mallet_id' });

    await supabaseClient
        .from('player_profiles')
        .update({ active_mallet_id: cloudMallet.id, updated_at: new Date().toISOString() })
        .eq('user_id', currentUser.id);

    activeMallet = cloudMallet;
    localStorage.setItem(`LVE_Mallet_${normMac}`, JSON.stringify(cloudMallet));

    await fetchPlayerMallets();
    if (window.applyMalletToUI) window.applyMalletToUI(cloudMallet, true);

    return cloudMallet;
}

/**
 * Saves physical mallet specs (dimensions, mass, sensor offsets, sharing) to Cloud, Local Cache & Xiao Flash.
 */
export async function saveActiveMalletSpecs() {
    const specs = {
        name: document.getElementById('malletNameInput')?.value || 'Primary Mallet',
        head_length_cm: parseFloat(document.getElementById('malletLengthInput')?.value) || 27.6,
        face_width_cm: parseFloat(document.getElementById('malletWidthInput')?.value) || 6.0,
        handle_length_cm: parseFloat(document.getElementById('handleLengthInput')?.value) || 91.4,
        mass_g: parseFloat(document.getElementById('massInput')?.value) || 1000,
        sweet_spot_cm: parseFloat(document.getElementById('sweetSpotInput')?.value) || 1.5,
        offset_y_cm: parseFloat(document.getElementById('offsetYInput')?.value) || 5.5,
        offset_z_cm: parseFloat(document.getElementById('offsetZInput')?.value) || 10.0,
        allow_sharing: document.getElementById('allowSharingCheck')?.checked ?? true,
        updated_at: new Date().toISOString()
    };

    if (!activeMallet) {
        const fallbackMac = window.bleManager?.deviceMac || localStorage.getItem('LVE_LastMac') || 'OFFLINE-DEFAULT';
        activeMallet = getDefaultMalletObject(fallbackMac, specs.name);
    }

    activeMallet = { ...activeMallet, ...specs };
    const cacheMac = activeMallet.ble_mac || 'OFFLINE-DEFAULT';
    localStorage.setItem('LVE_LastMac', cacheMac);
    localStorage.setItem(`LVE_Mallet_${cacheMac}`, JSON.stringify(activeMallet));

    if (window.bleManager?.isConnected() &&
        (!activeMallet.ble_mac || window.bleManager.deviceMac === activeMallet.ble_mac)) {
        await window.bleManager.writeMalletProfile({
            isCalibrated: !!activeMallet.is_calibrated,
            w: activeMallet.matrix_w ?? 1.0,
            x: activeMallet.matrix_x ?? 0.0,
            y: activeMallet.matrix_y ?? 0.0,
            z: activeMallet.matrix_z ?? 0.0,
            headLength_cm: specs.head_length_cm,
            faceWidth_cm: specs.face_width_cm,
            handleLength_cm: specs.handle_length_cm,
            mass_g: specs.mass_g,
            offsetY_cm: specs.offset_y_cm,
            offsetZ_cm: specs.offset_z_cm,
            sweetSpot_cm: specs.sweet_spot_cm
        });
    }

    if (currentUser && activeMallet?.id) {
        const { data, error } = await supabaseClient
            .from('mallets')
            .update(specs)
            .eq('id', activeMallet.id)
            .select()
            .single();

        if (!error && data) {
            activeMallet = data;
            await fetchPlayerMallets();
        }
    }
}

/**
 * Saves a newly computed or tuned calibration quaternion to Cloud, Local Cache & Xiao Flash.
 */
export async function saveActiveMalletCalibration(quat, isCalibrated = true) {
    const calPayload = {
        matrix_w: quat.w,
        matrix_x: quat.x,
        matrix_y: quat.y,
        matrix_z: quat.z,
        is_calibrated: isCalibrated,
        calibrated_at: isCalibrated ? new Date().toISOString() : null,
        updated_at: new Date().toISOString()
    };

    if (!activeMallet) {
        const fallbackMac = window.bleManager?.deviceMac || localStorage.getItem('LVE_LastMac') || 'OFFLINE-DEFAULT';
        activeMallet = getDefaultMalletObject(fallbackMac);
    }

    activeMallet = { ...activeMallet, ...calPayload };
    const cacheMac = activeMallet.ble_mac || 'OFFLINE-DEFAULT';
    localStorage.setItem('LVE_LastMac', cacheMac);
    localStorage.setItem(`LVE_Mallet_${cacheMac}`, JSON.stringify(activeMallet));

    if (window.bleManager?.isConnected()) {
        const m = activeMallet;
        await window.bleManager.writeMalletProfile({
            isCalibrated: isCalibrated,
            w: quat.w,
            x: quat.x,
            y: quat.y,
            z: quat.z,
            headLength_cm: m.head_length_cm ?? 27.6,
            faceWidth_cm: m.face_width_cm ?? 6.0,
            handleLength_cm: m.handle_length_cm ?? 91.4,
            mass_g: m.mass_g ?? 1000,
            offsetY_cm: m.offset_y_cm ?? 5.5,
            offsetZ_cm: m.offset_z_cm ?? 10.0,
            sweetSpot_cm: m.sweet_spot_cm ?? 1.5
        });
    }

    if (currentUser && activeMallet?.id) {
        const { data, error } = await supabaseClient
            .from('mallets')
            .update(calPayload)
            .eq('id', activeMallet.id)
            .select()
            .single();

        if (!error && data) {
            activeMallet = data;
            await fetchPlayerMallets();
        }
    }

    if (window.applyMalletToUI) {
        window.applyMalletToUI(activeMallet, window.bleManager?.isConnected() ?? false);
    }
}

export async function selectMalletFromBag(malletId) {
    const entry = playerMallets.find(pm => pm.mallet?.id === malletId);
    if (!entry || !entry.mallet) return;

    activeMallet = entry.mallet;
    const cacheMac = activeMallet.ble_mac || 'OFFLINE-DEFAULT';
    localStorage.setItem('LVE_LastMac', cacheMac);
    localStorage.setItem(`LVE_Mallet_${cacheMac}`, JSON.stringify(activeMallet));

    if (window.applyMalletToUI) window.applyMalletToUI(activeMallet, false);

    if (currentUser) {
        await supabaseClient
            .from('player_profiles')
            .update({ active_mallet_id: activeMallet.id, updated_at: new Date().toISOString() })
            .eq('user_id', currentUser.id);
    }
}

export async function removeMalletFromBag(malletId) {
    if (!currentUser || !malletId) return;
    const { error } = await supabaseClient
        .from('player_mallets')
        .delete()
        .eq('user_id', currentUser.id)
        .eq('mallet_id', malletId);

    if (error) {
        showToast("Could not remove mallet: " + error.message);
        return;
    }

    await fetchPlayerMallets();
    const fallback = playerMallets[0]?.mallet || null;
    activeMallet = fallback;
    if (fallback) {
        const cacheMac = fallback.ble_mac || 'OFFLINE-DEFAULT';
        localStorage.setItem('LVE_LastMac', cacheMac);
        localStorage.setItem(`LVE_Mallet_${cacheMac}`, JSON.stringify(fallback));
        if (window.applyMalletToUI) window.applyMalletToUI(fallback, false);
    } else {
        localStorage.removeItem('LVE_LastMac');
    }
    showToast("Mallet removed from your bag.");
}

export async function releaseMalletOwnership(malletId) {
    if (!currentUser || !malletId) return false;

    const releasedMac = activeMallet?.id === malletId ? activeMallet.ble_mac : null;

    const { error: relErr } = await supabaseClient
        .from('mallets')
        .update({
            owner_id: null,
            allow_sharing: true,
            updated_at: new Date().toISOString()
        })
        .eq('id', malletId)
        .eq('owner_id', currentUser.id);

    if (relErr) {
        showToast("Could not release mallet: " + relErr.message);
        return false;
    }

    await supabaseClient
        .from('player_mallets')
        .delete()
        .eq('user_id', currentUser.id)
        .eq('mallet_id', malletId);

    if (releasedMac) {
        localStorage.removeItem(`LVE_Mallet_${releasedMac}`);
    }

    await fetchPlayerMallets();
    const fallback = playerMallets[0]?.mallet || null;
    activeMallet = fallback;

    await supabaseClient
        .from('player_profiles')
        .update({ active_mallet_id: fallback?.id || null, updated_at: new Date().toISOString() })
        .eq('user_id', currentUser.id);

    if (fallback) {
        const cacheMac = fallback.ble_mac || 'OFFLINE-DEFAULT';
        localStorage.setItem('LVE_LastMac', cacheMac);
        localStorage.setItem(`LVE_Mallet_${cacheMac}`, JSON.stringify(fallback));
        if (window.applyMalletToUI) window.applyMalletToUI(fallback, false);
    } else {
        localStorage.removeItem('LVE_LastMac');
        document.getElementById('ownerMalletActions')?.classList.add('hidden');
        document.getElementById('sharedMalletActions')?.classList.add('hidden');
        if (window.renderMalletSelector) window.renderMalletSelector();
    }

    showToast("Mallet released. Ready for the new owner to connect.");
    return true;
}

// ============================================================================
// 3. MATCHES, TRAINING & AI COACH
// ============================================================================
export async function fetchCloudMatches() {
    let container = document.getElementById('cloud-matches-container');
    if (!currentUser) {
        container.innerHTML = '<div class="text-muted text-center p-5">Please log in to view Cloud Matches.</div>';
        return;
    }
    container.innerHTML = '<div class="text-muted text-center p-5">Fetching matches...</div>';
    
    const { data: matches, error } = await supabaseClient.from('matches').select('*').eq('user_id', currentUser.id).order('match_time_id', { ascending: false });
    if (error || !matches || matches.length === 0) { container.innerHTML = '<div class="text-muted text-center p-5">No cloud matches found.</div>'; return; }

    container.innerHTML = '';
    matches.forEach(m => {
        let matchDate = new Date(m.match_time_id * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        let locStr = m.location ? m.location : 'Untitled Match';
        let oppStr = m.opponent ? `<br><span class="text-muted small-help">vs. ${m.opponent}</span>` : '';
        
        const escAttr = (str) => String(str || '')
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/"/g, '&quot;')
            .replace(/\r?\n/g, ' ');
        let editArgs = `'${m.id}', '${escAttr(m.location)}', '${escAttr(m.opponent)}', '${escAttr(m.event_type)}', ${m.lawn_speed}, '${escAttr(m.notes)}'`;

        container.innerHTML += `
            <div class="history-card" style="cursor: pointer; transition: 0.2s;" onclick="fetchCloudStrikes('${m.id}', ${m.mallet_mass}, ${m.lawn_speed}, '${matchDate}')">
                <div class="card-header" style="border-bottom: none; margin-bottom: 0; padding-bottom: 0;">
                    <div>
                        <span class="swing-title">${locStr}</span>
                        <button class="icon-btn" style="display:inline-block; padding: 2px; margin-left: 5px; opacity:0.7;" onclick="event.stopPropagation(); openMatchEdit(${editArgs})">✏️</button>
                        ${oppStr}
                    </div>
                    <div class="text-right">
                        <span class="swing-time">${matchDate}</span><br>
                        <span class="text-accent font-bold" style="font-size: 0.8rem;">Lawn: ${m.lawn_speed}</span>
                    </div>
                </div>
            </div>`;
    });
}

export async function fetchCloudStrikes(matchUUID, mMass, mSpeed, mDate) {
    let container = document.getElementById('cloud-matches-container');
    container.innerHTML = '<div class="text-muted text-center p-5">Loading strokes...</div>';
    
    const { data: strikes, error } = await supabaseClient.from('strikes').select('*').eq('match_id', matchUUID).order('seconds_into_match', { ascending: true });
    if (error || !strikes) { container.innerHTML = '<div class="text-danger text-center p-5">Error loading strokes.</div>'; return; }

    let massKg = (mMass || 1000) / 1000.0; let lawnVal = mSpeed || 10.0; let lawnMult = 0.50 + (lawnVal - 10) * 0.075;

    let detailsHTML = `<details class="advanced-metrics active-match" open>
        <summary class="match-summary">
            <span onclick="fetchCloudMatches()" class="text-muted mr-3">← ${strikes.length} Strokes</span>
            ${mDate}
        </summary>
        <div class="match-details">`;

    strikes.forEach((s, idx) => {
        let speedStr = (s.z_vel !== null && s.z_vel !== undefined) ? `${(s.z_vel * 3.6).toFixed(1)} kph` : '--';
        let forceN = massKg * (s.peak_g || 0) * 9.81;
        let forceStr = forceN.toFixed(0) + " N";
        
        let ballSpeedMPS = (s.z_vel || 0) * (massKg * 1.8) / (massKg + 0.454); let estDist = (ballSpeedMPS * ballSpeedMPS) * lawnMult;

        let cleanDwell = calculateTrueDwell(s.z_vel || 0, s.peak_g || 0, massKg);
        let deflectionVal = Math.abs(s.peak_twist || 0) * (cleanDwell / 1000.0);
        let estAccRange = 35.0; if (deflectionVal > 0.0001) estAccRange = Math.min(35.0, 0.092 / Math.abs(Math.sin(deflectionVal * Math.PI / 180.0)));
        
        let ratingData = getStarRating(0, deflectionVal);
        let starHtml = ratingData.string !== "" ? `<span style="color: ${ratingData.color};" class="font-bold">${ratingData.string}</span>` : `<span class="text-muted">-</span>`;
        let extColor = (s.applied_force || 0) > 2 ? 'var(--success)' : ((s.applied_force || 0) < -2 ? 'var(--danger)' : 'var(--text-main)');
        let extStr = ((s.applied_force || 0) > 0 ? '+' : '') + (s.applied_force || 0).toFixed(0) + " N";
        
        let decelVal = s.decel_factor !== undefined ? s.decel_factor : 0;
        let downVal = s.downward_swing_time || 0;
        let decelColor = decelVal > 0 ? 'var(--success)' : (decelVal < 0 ? 'var(--danger)' : 'var(--text-main)');
        let decelHtml = `<span style="color:${decelColor};">${decelVal > 0 ? '+' : ''}${decelVal}%</span>`;
        let downHtml = `${downVal} ms`;

        let handleLen = parseFloat(document.getElementById('handleLengthInput')?.value) || activeMallet?.handle_length_cm || 91.4;
        let dsPDelta = downVal > 0 ? calculatePendulumDelta(4.0 * (downVal / 1000.0), handleLen) : null;
        let dsPDeltaHtml = dsPDelta !== null ? formatOffset(dsPDelta) : 'N/A';

        const qSensorToThreeOut = new THREE.Quaternion(0.5, 0.5, 0.5, -0.5);
        const qSensorToThreeIn  = new THREE.Quaternion(0.5, 0.5, -0.5, -0.5);
        let impactRawQuat = qSensorToThreeOut.clone()
            .multiply(new THREE.Quaternion(s.q1, s.q2, s.q3, s.q0).normalize())
            .multiply(qSensorToThreeIn)
            .normalize();

        // Calculate AoA matching main.js (YXZ Euler X-axis)
        let impactEuler = new THREE.Euler().setFromQuaternion(impactRawQuat, 'YXZ');
        let strokeAoA = -THREE.MathUtils.radToDeg(impactEuler.x);
        
        let dbFaceAngle = parseFloat(s.face_angle);
        let locTwist = !isNaN(dbFaceAngle) ? dbFaceAngle : getShaftTwist(impactRawQuat);
        let faceAngleHtml = `${(locTwist > 0 ? '+' : '')}${locTwist.toFixed(1)}°`;

        detailsHTML += `
            <div class="history-card flat-card">
                <div class="card-header">
                    <div><span class="swing-title">STROKE ${idx + 1}</span> &nbsp;${starHtml}</div>
                    <div class="text-right">
                        <span class="swing-time">+${s.seconds_into_match}s</span><br>
                    </div>
                </div>
                <div class="card-basic-stats">
                    <div class="stat-block"><span class="stat-lbl">Speed</span><span class="stat-val">${speedStr}</span></div>
                    <div class="stat-block"><span class="stat-lbl">Deflection</span><span class="stat-val text-warning">${deflectionVal.toFixed(1)}&deg;</span></div>
                    <div class="stat-block"><span class="stat-lbl">Est Dist</span><span class="stat-val text-accent">${estDist.toFixed(0)} m</span></div>
                    <div class="stat-block"><span class="stat-lbl">Target Acc</span><span class="stat-val">${estAccRange >= 35.0 ? "Center" : estAccRange.toFixed(0) + " m"}</span></div>
                </div>
                <details class="advanced-metrics" style="margin-bottom: 0;">
                    <summary>Advanced Kinematics</summary>
                    <div class="mt-4">
                        <div class="adv-row"><span>Impact Force</span><span class="adv-val">${forceStr}</span></div>
                        <div class="adv-row"><span>Face Angle</span><span class="adv-val">${faceAngleHtml}</span></div>
                        <div class="adv-row"><span>Angle of Attack</span><span class="adv-val">${strokeAoA.toFixed(1)}°</span></div>
                        <div class="adv-row"><span>Downswing Time</span><span class="adv-val">${downHtml}</span></div>
                        <div class="adv-row"><span>Strike PΔ</span><span class="adv-val">${dsPDeltaHtml}</span></div>
                        <div class="adv-row"><span>Boost</span><span class="adv-val">${decelHtml}</span></div>
                        <div class="adv-row"><span>Impact Dwell</span><span class="adv-val">${cleanDwell.toFixed(2)} ms</span></div>
                        <div class="adv-row"><span>Extension</span><span class="adv-val" style="color:${extColor};">${extStr}</span></div>
                    </div>
                </details>
            </div>`;
    });
    detailsHTML += `</div></details>`; container.innerHTML = detailsHTML;
}

function buildCloudCastPayload(c, index, swingId, isoTimestamp, currentTempo, ctx = {}) {
    const faceDeg = c.planeTwist ?? c.faceAngle ?? null;
    const pathDeg = (c.pathAngleRads !== undefined && c.pathAngleRads !== null)
        ? (c.pathAngleRads * (180.0 / Math.PI))
        : 0;
    const faceToPathDeg = (faceDeg !== null && faceDeg !== undefined)
        ? parseFloat((faceDeg - pathDeg).toFixed(2))
        : null;

    const massKg = ctx.massKg ?? 1.0;
    const speedMps = c.passSpeed ?? 0;
    const targetDistM = c.targetDistM ?? ctx.targetDistM ?? null;
    const launchRads = c.trueLaunchRads ?? (c.trueLaunchDeg !== undefined && c.trueLaunchDeg !== null
        ? (c.trueLaunchDeg * Math.PI / 180.0)
        : null);
    const targetLateralCm = (!c.isWhiff && targetDistM !== null && launchRads !== null)
        ? parseFloat(((targetDistM * 100.0) * Math.sin(launchRads)).toFixed(1))
        : null;

    const backArcCm = c.backArcLength ?? c.backArc ?? null;
    const backTimeMs = c.backswingTime || (c.isStrike ? (ctx.backswingTimeMs || null) : null);

    return {
        swing_id: swingId,
        user_id: currentUser.id,
        mallet_id: activeMallet?.id || null,
        timestamp: isoTimestamp,
        cast_index: index,
        is_strike: !!c.isStrike,
        raw_dev_cm: c.rawDev !== undefined && c.rawDev !== null ? parseFloat(c.rawDev.toFixed(2)) : null,
        path_dev_cm: c.dev !== undefined && c.dev !== null ? parseFloat(c.dev.toFixed(2)) : null,
        dir: c.dir || null,
        off_center_mm: c.isStrike && c.offCenterMm !== undefined && c.offCenterMm !== null
            ? parseFloat(c.offCenterMm.toFixed(1))
            : null,
        shaft_lean_deg: c.lean !== undefined && c.lean !== null ? parseFloat(c.lean.toFixed(1)) : null,
        lean_dir: c.leanDir || null,
        plane_twist: faceDeg !== null && faceDeg !== undefined ? parseFloat(faceDeg.toFixed(2)) : null,
        impact_twist: c.impactTwist !== null && c.impactTwist !== undefined ? parseFloat(c.impactTwist.toFixed(2)) : null,
        face_to_path_deg: faceToPathDeg,
        strike_angle_deg: c.aoaDeg !== undefined && c.aoaDeg !== null ? parseFloat(c.aoaDeg.toFixed(2)) : null,
        deflection_deg: c.isStrike && c.deflectionDeg !== undefined && c.deflectionDeg !== null
            ? parseFloat(c.deflectionDeg.toFixed(2))
            : null,
        true_launch_deg: c.trueLaunchDeg !== undefined && c.trueLaunchDeg !== null
            ? parseFloat(c.trueLaunchDeg.toFixed(2))
            : null,
        true_launch_rads: launchRads,
        speed_mps: parseFloat(speedMps.toFixed(2)),
        est_dist_m: c.estDist !== undefined && c.estDist !== null ? parseFloat(c.estDist.toFixed(2)) : null,
        tempo_bpm: currentTempo > 0 ? Math.round(currentTempo) : (c.tempo > 0 ? Math.round(c.tempo) : null),
        est_acc_range: c.estAccRange ?? null,
        true_acc_range: c.trueAccRange ?? null,
        path_angle_rads: c.pathAngleRads ?? null,
        pass_force: c.passForce !== undefined && c.passForce !== null ? parseFloat(c.passForce.toFixed(1)) : null,
        applied_force_n: c.appliedForce !== undefined && c.appliedForce !== null ? parseFloat(c.appliedForce.toFixed(1)) : null,
        accel_pct: c.decelFactor !== undefined && c.decelFactor !== null && !isNaN(c.decelFactor)
            ? Math.round(c.decelFactor)
            : null,
        p_delta: c.pDelta !== undefined && c.pDelta !== null ? parseFloat(c.pDelta.toFixed(2)) : null,
        backswing_arc_cm: backArcCm !== null && backArcCm !== undefined ? parseFloat(backArcCm.toFixed(1)) : null,
        backswing_lift_cm: c.backHeight !== undefined && c.backHeight !== null ? parseFloat(c.backHeight.toFixed(1)) : null,
        backswing_time_ms: backTimeMs ? Math.round(backTimeMs) : null,
        downswing_time_ms: c.isStrike && ctx.downwardSwingTimeMs ? Math.round(ctx.downwardSwingTimeMs) : null,
        peak_g: c.isStrike && ctx.peakG ? parseFloat(ctx.peakG.toFixed(2)) : null,
        peak_twist_dps: c.isStrike && ctx.peakTwistDps !== undefined && ctx.peakTwistDps !== null
            ? parseFloat(ctx.peakTwistDps.toFixed(1))
            : null,
        dwell_ms: c.isStrike && ctx.dwellMs ? parseFloat(ctx.dwellMs.toFixed(2)) : null,
        momentum_kgms: parseFloat((massKg * speedMps).toFixed(2)),
        target_dist_m: targetDistM,
        target_lateral_cm: targetLateralCm,
        is_hit: !!c.isHit,
        is_whiff: !!c.isWhiff,
        star_rating: c.stars || null,
        lawn_speed: ctx.lawnSpeed ?? null,
        sweet_spot_cm: ctx.sweetSpotCm ?? null,
        twist_tolerance_deg: ctx.twistToleranceDeg ?? null,
        pivot_quat: c.pivotQuat ? {
            x: parseFloat(c.pivotQuat.x.toFixed(5)),
            y: parseFloat(c.pivotQuat.y.toFixed(5)),
            z: parseFloat(c.pivotQuat.z.toFixed(5)),
            w: parseFloat(c.pivotQuat.w.toFixed(5))
        } : null
    };
}

export async function savePracticeCastsToCloud(castsArray, currentTempo, ctx = {}) {
    if (!currentUser || !castsArray || castsArray.length === 0) return null;

    const uniqueSwingId = crypto.randomUUID();
    const nowRealTime = Date.now();
    const lastCastHwTime = castsArray[castsArray.length - 1].time;

    const castsToInsert = castsArray.map((c, index) => {
        const exactCastTime = nowRealTime - (lastCastHwTime - c.time);
        const isoTimestamp = new Date(exactCastTime).toISOString();
        return buildCloudCastPayload(c, index, uniqueSwingId, isoTimestamp, currentTempo, ctx);
    });

    const { error } = await supabaseClient.from('practice_casts').insert(castsToInsert);
    if (error) {
        console.error("Error saving practice casts:", error.message);
        return null;
    }
    return uniqueSwingId;
}

export async function updatePracticeStrikeInCloud(swingId, castIndex, strikeCast, currentTempo, ctx = {}) {
    if (!currentUser || !swingId || !strikeCast) return;

    const fullRow = buildCloudCastPayload(strikeCast, castIndex, swingId, new Date().toISOString(), currentTempo, ctx);
    delete fullRow.swing_id;
    delete fullRow.user_id;
    delete fullRow.timestamp;
    delete fullRow.cast_index;

    const { error } = await supabaseClient
        .from('practice_casts')
        .update(fullRow)
        .eq('swing_id', swingId)
        .eq('cast_index', castIndex);

    if (error) {
        console.error("Error updating practice strike in cloud:", error.message);
    }
}

export async function fetchCloudTraining() {
    let container = document.getElementById('cloud-training-container');
    if (!container) return;
    
    container.innerHTML = '<div class="text-muted text-center p-5">Fetching cloud swings...</div>';
    
    if (!currentUser) {
        container.innerHTML = '<div class="text-muted text-center p-5">Please log in to view Cloud Swings.</div>';
        return;
    }

    const { data: casts, error } = await supabaseClient
        .from('practice_casts')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('timestamp', { ascending: false })
        .limit(1000);

    if (error || !casts || casts.length === 0) { 
        container.innerHTML = '<div class="text-muted text-center p-5">No cloud swings found.</div>'; 
        return; 
    }

    let uniqueSwingIds = [...new Set(casts.map(c => c.swing_id).filter(id => id))].slice(0, 100);
    let recentCasts = casts.filter(c => uniqueSwingIds.includes(c.swing_id));

    let sessions = {};
    let sessionOrder = [];
    
    recentCasts.forEach(c => {
        let sId = c.swing_id || 'unknown';
        if (!sessions[sId]) {
            sessions[sId] = [];
            sessionOrder.push(sId);
        }
        sessions[sId].push(c);
    });

    let sumPDelta = 0, sumDev = 0, sumFace = 0;
    let countPDelta = 0, countDev = 0, countFace = 0;

    const distanceBuckets = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
    let attemptsPerBucket = {2:0, 4:0, 6:0, 8:0, 10:0, 12:0, 14:0, 16:0, 18:0, 20:0};
    let hitsPerBucket = {2:0, 4:0, 6:0, 8:0, 10:0, 12:0, 14:0, 16:0, 18:0, 20:0};

    recentCasts.forEach(c => {
        if (c.p_delta !== null && c.p_delta !== undefined) {
            sumPDelta += c.p_delta; countPDelta++;
        }
        if (c.path_dev_cm !== null && c.path_dev_cm !== undefined) {
            sumDev += c.path_dev_cm; countDev++;
        }
        if (c.plane_twist !== null && c.plane_twist !== undefined) {
            sumFace += Math.abs(c.plane_twist); countFace++;
        }

        if (c.true_acc_range !== null && c.est_dist_m !== null) {
            distanceBuckets.forEach(d => {
                if (c.est_dist_m >= d) {
                    attemptsPerBucket[d]++;
                    if (c.true_acc_range >= d) {
                        hitsPerBucket[d]++;
                    }
                }
            });
        }
    });

    let accuracyData = distanceBuckets.map(d => {
        return attemptsPerBucket[d] > 0 ? (hitsPerBucket[d] / attemptsPerBucket[d] * 100) : 0;
    });

    if (countPDelta > 0) document.getElementById('dash-avg-pdelta').innerText = (sumPDelta / countPDelta).toFixed(1) + ' cm';
    if (countDev > 0) document.getElementById('dash-avg-dev').innerText = (sumDev / countDev).toFixed(1) + ' cm';
    if (countFace > 0) document.getElementById('dash-avg-face').innerText = '±' + (sumFace / countFace).toFixed(1) + '°';

    document.getElementById('performance-dashboard').classList.remove('hidden');
    
    if (window.Chart) {
        const ctx = document.getElementById('performanceChart');
        if (performanceChartInstance) performanceChartInstance.destroy();
        
        performanceChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: distanceBuckets.map(d => d + 'm'),
                datasets: [{
                    label: 'Hit Percentage (%)',
                    data: accuracyData,
                    backgroundColor: 'rgba(56, 189, 248, 0.4)',
                    borderColor: '#38bdf8',
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        min: 0,
                        max: 100,
                        title: { display: true, text: 'Accuracy (%)', color: '#94a3b8' },
                        grid: { color: 'rgba(200,200,200,0.1)' }
                    },
                    x: {
                        title: { display: true, text: 'Target Distance', color: '#94a3b8' },
                        grid: { display: false }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                let d = distanceBuckets[context.dataIndex];
                                return `${hitsPerBucket[d]} hits / ${attemptsPerBucket[d]} attempts (${context.parsed.y.toFixed(0)}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    container.innerHTML = '';
    const showRawData = document.getElementById('showCloudDataCheck')?.checked;
    
    if (showRawData) {
        const isSubscribed = document.getElementById('subscribedCheck')?.checked ?? true;
        const defaultTargetDistM = parseFloat(document.getElementById('trainerDistSetup')?.value) || 5.0;
        const massKg = (parseFloat(document.getElementById('massInput')?.value) || 1000) / 1000.0;

        const fmtSignedDeg = (v) => {
            if (v === undefined || v === null || isNaN(v)) return `N/A`;
            let clean = Math.abs(v) < 0.05 ? 0 : v;
            return `${clean > 0 ? '+' : ''}${clean.toFixed(1)}°`;
        };
        const fmtSignedPct = (v) => {
            if (v === undefined || v === null || isNaN(v)) return `N/A`;
            let rounded = Math.round(v);
            return `${rounded > 0 ? '+' : ''}${rounded}%`;
        };

        const buildCloudMetricsHeaderHTML = (cast, wasOpen = false) => {
            const distM = (cast.targetDistM !== undefined && cast.targetDistM !== null && !isNaN(cast.targetDistM))
                ? cast.targetDistM
                : defaultTargetDistM;
            const formattedDist = Number.isInteger(distM) ? `${distM}` : `${parseFloat(distM.toFixed(1))}`;
            const targetLabelStr = `TARGET: ${formattedDist}m`;

            let hitMissStr = `N/A`;
            if (cast.isWhiff) {
                hitMissStr = `Mishit`;
            } else {
                let launchRads = cast.trueLaunchRads;
                if ((launchRads === undefined || launchRads === null || isNaN(launchRads)) &&
                    cast.trueLaunchDeg !== undefined && cast.trueLaunchDeg !== null && !isNaN(cast.trueLaunchDeg)) {
                    launchRads = cast.trueLaunchDeg * (Math.PI / 180.0);
                }
                if (launchRads !== undefined && launchRads !== null && !isNaN(launchRads)) {
                    let lateralCm = (distM * 100.0) * Math.sin(launchRads);
                    let centerDistCm = Math.abs(lateralCm);
                    const BALL_DIAMETER_CM = 9.2;
                    if (centerDistCm <= BALL_DIAMETER_CM) {
                        let side = centerDistCm < 0.5 ? '' : (lateralCm > 0 ? ' L' : ' R');
                        let distStr = centerDistCm < 0.5 ? '0cm' : `${Math.round(centerDistCm)}cm${side}`;
                        hitMissStr = `<span class="text-success">Hit ${distStr}</span>`;
                    } else {
                        let missEdgeCm = centerDistCm - BALL_DIAMETER_CM;
                        let side = lateralCm > 0 ? ' L' : ' R';
                        let distStr = missEdgeCm < 1.0 ? `${missEdgeCm.toFixed(1)}cm${side}` : `${Math.round(missEdgeCm)}cm${side}`;
                        hitMissStr = `<span class="text-danger">Miss ${distStr}</span>`;
                    }
                }
            }

            let velStr = cast.passSpeed ? `${(cast.passSpeed * 3.6).toFixed(1)} kph` : `--`;
            let locStr = `N/A`;
            if (cast.isStrike) {
                if (cast.offCenterMm !== undefined && cast.offCenterMm !== null) {
                    locStr = cast.offCenterMm < 2.0 ? `Center` : `${Math.round(cast.offCenterMm)}mm ${cast.dir || ''}`.trim();
                } else {
                    locStr = cast.dev < 0.2 ? `Center` : `${(cast.dev * 10).toFixed(0)}mm ${cast.dir || ''}`.trim();
                }
            } else if (cast.dev !== undefined && cast.dev !== null) {
                locStr = cast.isWhiff ? `${cast.dev.toFixed(1)}cm M` : `${cast.dev.toFixed(1)}cm ${cast.dir || ''}`.trim();
            }

            let faceDeg = cast.planeTwist !== undefined ? cast.planeTwist : cast.faceAngle;
            let faceAngleStr = fmtSignedDeg(faceDeg);
            let pathDeg = (cast.pathAngleRads || 0) * (180.0 / Math.PI);
            let pathTwistStr = (cast.faceToPathDeg !== undefined && cast.faceToPathDeg !== null)
                ? fmtSignedDeg(cast.faceToPathDeg)
                : (faceDeg !== undefined && faceDeg !== null ? fmtSignedDeg(faceDeg - pathDeg) : `N/A`);
            let devSigmaStr = (!cast.isWhiff && cast.trueLaunchDeg !== undefined && cast.trueLaunchDeg !== null)
                ? fmtSignedDeg(cast.trueLaunchDeg)
                : (cast.isWhiff ? `Mishit` : `N/A`);

            let hasAoa = cast.isStrike && cast.aoaDeg !== undefined && cast.aoaDeg !== null;
            let cAoa = hasAoa ? cast.aoaDeg : 0;
            let cAoaDir = Math.abs(cAoa) < 0.2 ? 'Level' : (cAoa > 0 ? 'Up' : 'Dn');
            let aoaStr = hasAoa ? `${Math.abs(cAoa).toFixed(1)}° ${cAoaDir}` : `N/A`;

            let leanStr = (cast.lean !== undefined && cast.lean !== null)
                ? `${cast.lean.toFixed(1)}° ${cast.leanDir || ''}`.trim()
                : `N/A`;
            let deflStr = (cast.isStrike && cast.deflectionDeg !== undefined && cast.deflectionDeg !== null)
                ? fmtSignedDeg(cast.deflectionDeg)
                : `N/A`;
            let strikeForceStr = cast.isStrike
                ? `${((cast.passForce || calculateImpactForce(cast.passSpeed || 0, massKg)) / 1000).toFixed(2)} kN`
                : `N/A`;
            let accelStr = fmtSignedPct(cast.decelFactor);
            let tempoStr = cast.tempo > 0 ? `${Math.round(cast.tempo)} BPM` : `--`;
            let backArcStr = (cast.backArcLength !== undefined && cast.backArcLength !== null)
                ? `${Math.round(cast.backArcLength)} cm`
                : `--`;
            let backLiftStr = (cast.backHeight !== undefined && cast.backHeight !== null)
                ? `${Math.round(cast.backHeight)} cm`
                : `--`;
            let pDeltaStr = (cast.pDelta !== null && cast.pDelta !== undefined)
                ? formatOffset(cast.pDelta)
                : `N/A`;

            let proBadge = `<span class="text-accent">PRO</span>`;
            let dispFace     = isSubscribed ? faceAngleStr : proBadge;
            let dispDevSigma = isSubscribed ? devSigmaStr  : proBadge;
            let dispTwist    = isSubscribed ? pathTwistStr : proBadge;
            let dispAoa      = isSubscribed ? aoaStr       : proBadge;
            let dispLean     = isSubscribed ? leanStr      : proBadge;
            let dispDefl     = isSubscribed ? deflStr      : proBadge;
            let dispAccel    = isSubscribed ? accelStr     : proBadge;
            let dispTempo    = isSubscribed ? tempoStr     : proBadge;
            let dispPDel     = isSubscribed ? pDeltaStr    : proBadge;

            return `
                <div class="card-basic-stats" style="margin-bottom: 4px;">
                    <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Mallet head speed through the bottom of the swing (kph).">Speed</span><span class="stat-val">${velStr}</span></div>
                    <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Projected lateral miss or hit at the target distance (cm Left/Right of target center).">${targetLabelStr}</span><span class="stat-val">${hitMissStr}</span></div>
                    <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Strike location on the mallet face relative to center (mm Left/Right).">Impact</span><span class="adv-val text-warning">${locStr}</span></div>
                </div>
                <details class="more-metrics" ${wasOpen ? 'open' : ''}>
                    <summary>More</summary>
                    <div class="card-basic-stats">
                        <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Angle of the mallet face relative to the target line at impact (+ Left / - Right).">Face Angle</span><span class="stat-val">${dispFace}</span></div>
                        <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Total horizontal ball launch angle (σ) off the target line, combining face angle, swing path, and collision deflection.">Deviation (σ)</span><span class="stat-val">${dispDevSigma}</span></div>
                        <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Angle of the mallet face relative to the swing path (+ Left / - Right).">Twist</span><span class="stat-val">${dispTwist}</span></div>
                        <div class="stat-block"><span class="stat-lbl tooltip-trigger" onclick="this.classList.toggle('active-tooltip')" data-tooltip="Vertical angle of attack of the mallet head into the ball (+ Up / - Down).">Strike Angle</span><span class="stat-val text-accent">${dispAoa}</span></div>
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
        };

        const mappedSessions = {};

        sessionOrder.forEach((sId, sIdx) => {
            let sessionCasts = sessions[sId];
            sessionCasts.sort((a, b) => a.cast_index - b.cast_index);

            let swingNum = sessionOrder.length - sIdx;
            let sessionTime = new Date(sessionCasts[0].timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            let sessionDate = new Date(sessionCasts[0].timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });

            let mappedList = sessionCasts.map(c => {
                let isWhiff = c.is_whiff ?? (c.est_acc_range === null || c.est_acc_range === undefined);
                let trueLaunchDeg = c.true_launch_deg;
                let trueLaunchRads = c.true_launch_rads;

                // Backfill launch angle for legacy rows saved prior to schema expansion
                if (!isWhiff && (trueLaunchDeg === undefined || trueLaunchDeg === null) &&
                    c.plane_twist !== undefined && c.plane_twist !== null) {
                    let faceRads = c.plane_twist * (Math.PI / 180.0);
                    let pathRads = c.path_angle_rads || 0;
                    trueLaunchRads = (0.80 * faceRads) + (0.20 * pathRads);
                    trueLaunchDeg = trueLaunchRads * (180.0 / Math.PI);
                }

                return {
                    rawDev: c.raw_dev_cm ?? 0,
                    planeTwist: c.plane_twist,
                    faceAngle: c.plane_twist,
                    faceToPathDeg: c.face_to_path_deg,
                    pathAngleRads: c.path_angle_rads,
                    aoaDeg: c.strike_angle_deg,
                    deflectionDeg: c.deflection_deg,
                    trueLaunchDeg: trueLaunchDeg,
                    trueLaunchRads: trueLaunchRads,
                    passSpeed: c.speed_mps,
                    passForce: c.pass_force,
                    appliedForce: c.applied_force_n,
                    decelFactor: c.accel_pct,
                    isStrike: !!c.is_strike,
                    dev: c.path_dev_cm ?? 0,
                    dir: c.dir,
                    offCenterMm: c.off_center_mm,
                    lean: c.shaft_lean_deg,
                    leanDir: c.lean_dir,
                    estDist: c.est_dist_m,
                    pDelta: c.p_delta,
                    estAccRange: c.est_acc_range,
                    trueAccRange: c.true_acc_range,
                    backArcLength: c.backswing_arc_cm,
                    backHeight: c.backswing_lift_cm,
                    backswingTime: c.backswing_time_ms,
                    tempo: c.tempo_bpm,
                    targetDistM: c.target_dist_m,
                    isWhiff: isWhiff,
                    stars: c.star_rating || "",
                    isHit: !!c.is_hit
                };
            });

            let displayCast = mappedList.find(c => c.isStrike) || mappedList[mappedList.length - 1];
            mappedSessions[sId] = { list: mappedList, defaultCast: displayCast };

            let castsHtml = mappedList.map((mc, idx) => {
                return buildCastRowHTML(mc, idx, sIdx, false)
                    .replace('highlight-pass-btn', 'cloud-cast-row')
                    .replace(`data-swing-index="${sIdx}"`, `data-cloud-swing-id="${sId}"`);
            }).join('');

            container.innerHTML += `
                <div class="history-card">
                    <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;">
                        <div class="flex items-center gap-2">
                            <span class="swing-title" data-reset-cloud-swing="${sId}" style="cursor: pointer; text-decoration: underline; text-underline-offset: 4px; white-space: nowrap;" title="Click to show final pass metrics">SWING ${swingNum}</span>
                            <button class="icon-btn text-danger" style="display:inline-block; padding: 2px; opacity:0.7;" onclick="deleteCloudSession('${sId}')" title="Delete Swing">🗑️</button>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="swing-time" style="white-space: nowrap;">${sessionDate} ${sessionTime}</span>
                        </div>
                    </div>

                    <div id="cloud-cast-container-${sId}" class="mt-3">
                        ${castsHtml}
                    </div>

                    <div id="cloud-swing-header-${sId}" class="mt-3">
                        ${buildCloudMetricsHeaderHTML(displayCast, false)}
                    </div>
                </div>`;
        });

        container.querySelectorAll('.expand-icon').forEach(el => el.style.display = 'none');
        container.querySelectorAll('.cast-details').forEach(el => {
            el.style.display = 'none';
            el.classList.remove('flex-col');
        });

        container.querySelectorAll('.cloud-cast-row').forEach(row => {
            row.onclick = () => {
                const sId = row.getAttribute('data-cloud-swing-id');
                const castIdx = parseInt(row.getAttribute('data-cast-index'), 10);
                const sess = mappedSessions[sId];
                if (!sess || isNaN(castIdx) || !sess.list[castIdx]) return;

                const headerDiv = document.getElementById(`cloud-swing-header-${sId}`);
                const wasOpen = !!headerDiv?.querySelector('details.more-metrics')?.open;
                const isAlreadyActive = row.classList.contains('active-cast-row');

                container.querySelectorAll('.cloud-cast-row.active-cast-row').forEach(el => el.classList.remove('active-cast-row'));

                if (isAlreadyActive) {
                    if (headerDiv) headerDiv.innerHTML = buildCloudMetricsHeaderHTML(sess.defaultCast, wasOpen);
                } else {
                    row.classList.add('active-cast-row');
                    if (headerDiv) headerDiv.innerHTML = buildCloudMetricsHeaderHTML(sess.list[castIdx], wasOpen);
                }
            };
        });

        container.querySelectorAll('[data-reset-cloud-swing]').forEach(titleEl => {
            titleEl.onclick = () => {
                const sId = titleEl.getAttribute('data-reset-cloud-swing');
                const sess = mappedSessions[sId];
                if (!sess) return;
                container.querySelectorAll('.cloud-cast-row.active-cast-row').forEach(el => el.classList.remove('active-cast-row'));
                const headerDiv = document.getElementById(`cloud-swing-header-${sId}`);
                const wasOpen = !!headerDiv?.querySelector('details.more-metrics')?.open;
                if (headerDiv) headerDiv.innerHTML = buildCloudMetricsHeaderHTML(sess.defaultCast, wasOpen);
            };
        });
    }
}

export async function deleteCloudSession(swingId) {
    if (!confirm("Are you sure you want to delete this swing?")) return;
    
    const { error } = await supabaseClient
        .from('practice_casts')
        .delete()
        .eq('swing_id', swingId);
        
    if (error) {
        showToast("Error deleting swing: " + error.message);
    } else {
        showToast("Swing deleted.");
        fetchCloudTraining();
    }
}

export async function getAiCoachFeedback(recentCasts, targetDist, context = {}) {
    if (!currentUser) return "Please log in to consult the AI Coach.";

    const cleanPasses = (recentCasts || []).map((c, idx) => {
        const faceDeg = c.planeTwist ?? c.faceAngle ?? null;
        const pathDeg = (c.pathAngleRads || 0) * (180.0 / Math.PI);
        const launchRads = c.trueLaunchRads ?? (c.trueLaunchDeg !== undefined && c.trueLaunchDeg !== null
            ? (c.trueLaunchDeg * Math.PI / 180.0)
            : null);
        const lateralCm = (!c.isWhiff && launchRads !== null)
            ? parseFloat(((targetDist * 100.0) * Math.sin(launchRads)).toFixed(1))
            : null;
        const impactLoc = c.isStrike
            ? (c.dev < 0.2 ? "Center" : `${Math.round(c.dev * 10)}mm ${c.dir || ""}`.trim())
            : (c.isWhiff ? `${(c.dev || 0).toFixed(1)}cm Mishit` : (c.dev < 0.2 ? "Center" : `${c.dev.toFixed(1)}cm ${c.dir || ""}`.trim()));

        return {
            pass: c.isStrike ? "Ball Strike" : `Practice Cast #${idx + 1}`,
            isStrike: !!c.isStrike,
            isWhiff: !!c.isWhiff,
            isHit: !!c.isHit,
            speedKph: c.passSpeed ? parseFloat((c.passSpeed * 3.6).toFixed(1)) : null,
            estDistM: c.estDist !== undefined && c.estDist !== null ? parseFloat(c.estDist.toFixed(1)) : null,
            impactLocation: impactLoc,
            faceAngleDeg: faceDeg !== null ? parseFloat(faceDeg.toFixed(1)) : null,
            swingPathDeg: parseFloat(pathDeg.toFixed(1)),
            faceToPathDeg: faceDeg !== null ? parseFloat((faceDeg - pathDeg).toFixed(1)) : null,
            launchDeviationDeg: (!c.isWhiff && c.trueLaunchDeg !== undefined && c.trueLaunchDeg !== null) ? parseFloat(c.trueLaunchDeg.toFixed(1)) : null,
            targetLateralErrorCm: lateralCm,
            strikeAngleAoaDeg: (c.isStrike && c.aoaDeg !== undefined && c.aoaDeg !== null) ? parseFloat(c.aoaDeg.toFixed(1)) : null,
            shaftLean: (c.lean !== undefined && c.lean !== null) ? `${c.lean.toFixed(1)}° ${c.leanDir || ""}`.trim() : null,
            collisionDeflectionDeg: (c.isStrike && c.deflectionDeg !== undefined && c.deflectionDeg !== null) ? parseFloat(c.deflectionDeg.toFixed(1)) : null,
            preImpactAccelPct: (c.decelFactor !== undefined && c.decelFactor !== null && !isNaN(c.decelFactor)) ? Math.round(c.decelFactor) : null,
            tempoBpm: c.tempo > 0 ? Math.round(c.tempo) : null,
            pendulumDeltaCm: (c.pDelta !== undefined && c.pDelta !== null && !isNaN(c.pDelta)) ? Math.round(c.pDelta) : null,
            backswingArcCm: (c.backArcLength ?? c.backArc) ? Math.round(c.backArcLength ?? c.backArc) : null,
            backswingLiftCm: (c.backHeight !== undefined && c.backHeight !== null) ? Math.round(c.backHeight) : null,
            faultDetected: !!c.faultDetected
        };
    });

    const { data, error } = await supabaseClient.functions.invoke('swift-function', {
        body: { swings: cleanPasses, targetDistance: targetDist, context }
    });

    if (error) {
        console.error("AI Coach error:", error);
        return "Unable to reach AI Coach right now.";
    }
    
    return data.advice;
}