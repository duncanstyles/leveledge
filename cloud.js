// cloud.js
import { difficultyMatrix, getStarRating, getShaftTwist, calculateTrueDwell } from './kinematics.js';
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

        let sRad = parseFloat(document.getElementById('radiusInput').value) || 127;
        let dsPDelta = downVal > 0 ? (9.81 * Math.pow((2 * (downVal / 1000.0)) / Math.PI, 2) * 100.0) - sRad : null;
        let dsPDeltaHtml = dsPDelta !== null ? formatOffset(dsPDelta) : 'N/A';

        let pureImpactSensor = new THREE.Quaternion(s.q1, s.q2, s.q3, s.q0); 
        let impactRawQuat = new THREE.Quaternion(pureImpactSensor.y, -pureImpactSensor.z, -pureImpactSensor.x, pureImpactSensor.w).normalize();
        impactRawQuat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI)); 

        // 1. Apply the Gimbal-Proof Twist Inversion (YZX Order) matching main.js
        let liveEuler = new THREE.Euler().setFromQuaternion(impactRawQuat, 'YZX');
        liveEuler.y = -liveEuler.y;
        impactRawQuat.setFromEuler(liveEuler, 'YZX');

        // 2. Calculate AoA matching main.js (YXZ Euler X-axis)
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

export async function savePracticeCastsToCloud(castsArray, currentTempo) {
    if (!currentUser || !castsArray || castsArray.length === 0) return;

    const uniqueSwingId = crypto.randomUUID(); 
    const nowRealTime = Date.now();
    const lastCastHwTime = castsArray[castsArray.length - 1].time;

    let castsToInsert = castsArray.map((c, index) => {
        let exactCastTime = nowRealTime - (lastCastHwTime - c.time);
        
        return {
            swing_id: uniqueSwingId,             
            user_id: currentUser.id,
            mallet_id: activeMallet?.id || null,
            timestamp: new Date(exactCastTime).toISOString(),
            cast_index: index,
            is_strike: c.isStrike,
            path_dev_cm: parseFloat(c.dev.toFixed(1)),
            dir: c.dir,
            shaft_lean_deg: c.lean !== undefined && c.lean !== null ? parseFloat(c.lean.toFixed(1)) : null,
            lean_dir: c.leanDir || null,
            plane_twist: c.planeTwist !== null && c.planeTwist !== undefined ? parseFloat(c.planeTwist.toFixed(1)) : null,
            impact_twist: c.impactTwist !== null && c.impactTwist !== undefined ? parseFloat(c.impactTwist.toFixed(1)) : null,
            speed_mps: parseFloat(c.passSpeed.toFixed(1)),
            est_dist_m: c.estDist,
            tempo_bpm: currentTempo > 0 ? Math.round(currentTempo) : null,
            est_acc_range: c.estAccRange,
            true_acc_range: c.trueAccRange,
            path_angle_rads: c.pathAngleRads,
            pass_force: c.passForce,
            p_delta: c.pDelta
        };
    });

    const { error } = await supabaseClient.from('practice_casts').insert(castsToInsert);
    if (error) {
        console.error("Error saving practice casts:", error.message);
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
        sessionOrder.forEach(sId => {
            let sessionCasts = sessions[sId];
            sessionCasts.sort((a, b) => a.cast_index - b.cast_index);
             
            let sessionTime = new Date(sessionCasts[0].timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            let finalStrike = sessionCasts.find(c => c.is_strike) || sessionCasts[sessionCasts.length - 1];
            
            let finalTempo = finalStrike.tempo_bpm ? `${finalStrike.tempo_bpm} BPM` : '--';
            let finalDev = finalStrike.path_dev_cm !== null ? `${finalStrike.path_dev_cm.toFixed(1)}cm ${finalStrike.dir || ''}` : '--';
            let finalSpeed = finalStrike.speed_mps !== null ? `${(finalStrike.speed_mps * 3.6).toFixed(1)} kph` : '--';
            
            let castsHtml = sessionCasts.map(c => {
                let mappedCast = {
                    planeTwist: c.plane_twist, faceAngle: c.plane_twist, pathAngleRads: c.path_angle_rads,
                    passSpeed: c.speed_mps, isStrike: c.is_strike, dev: c.path_dev_cm / 10.0, 
                    dir: c.dir, 
                    lean: c.shaft_lean_deg,
                    leanDir: c.lean_dir,
                    estDist: c.est_dist_m, pDelta: c.p_delta, estAccRange: c.est_acc_range,
                    isWhiff: c.est_acc_range === null || c.est_acc_range === undefined,
                    stars: "", isHit: false
                };
                return buildCastRowHTML(mappedCast, c.cast_index, 0, true);
            }).join('');

            container.innerHTML += `
                <div class="history-card">
                    <div class="card-header">
                        <div>
                            <span class="swing-title">SWING LOG</span>
                            <button class="icon-btn text-danger" style="display:inline-block; padding: 2px; margin-left: 5px; opacity:0.7;" onclick="deleteCloudSession('${sId}')" title="Delete Swing">🗑️</button>
                        </div>
                        <span class="swing-time">${sessionTime}</span>
                    </div>
                    <div class="card-basic-stats">
                        <div class="stat-block"><span class="stat-lbl">Final Speed</span><span class="stat-val">${finalSpeed}</span></div>
                        <div class="stat-block"><span class="stat-lbl">Final Dev</span><span class="stat-val text-warning">${finalDev}</span></div>
                        <div class="stat-block"><span class="stat-lbl">Tempo</span><span class="stat-val text-accent">${finalTempo}</span></div>
                    </div>
                    <details class="advanced-metrics mt-4">
                        <summary>View Casting Sequence (${sessionCasts.length} passes)</summary>
                        <div class="mt-2">${castsHtml}</div>
                    </details>
                </div>`;
        });
        
        let cloudRows = container.querySelectorAll('.highlight-cloud-pass-btn');
        cloudRows.forEach(row => {
            row.onclick = () => {
                let details = row.querySelector('.cast-details');
                let icon = row.querySelector('.expand-icon');
                if (!details) return;
                
                if (details.style.display === 'none' || details.style.display === '') {
                    container.querySelectorAll('.highlight-cloud-pass-btn .cast-details').forEach(el => {
                        el.style.display = 'none'; el.classList.remove('flex-col');
                    });
                    container.querySelectorAll('.highlight-cloud-pass-btn .expand-icon').forEach(el => el.innerText = '▼');
                    details.style.display = 'flex'; details.classList.add('flex-col');
                    if (icon) icon.innerText = '▲';
                } else {
                    details.style.display = 'none'; details.classList.remove('flex-col');
                    if (icon) icon.innerText = '▼';
                }
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

export async function getAiCoachFeedback(recentCasts, targetDist) {
    if (!currentUser) return "Please log in to consult the AI Coach.";
    
    const { data, error } = await supabaseClient.functions.invoke('swift-function', {
        body: { swings: recentCasts, targetDistance: targetDist }
    });

    if (error) {
        console.error("AI Coach error:", error);
        return "Unable to reach AI Coach right now.";
    }
    
    return data.advice;
}