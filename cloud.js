// cloud.js
import { showToast, formatOffset } from './utils.js';
import { difficultyMatrix, getStarRating, getShaftTwist } from './kinematics.js';

const SUPABASE_URL = 'https://ymqqthvgfsrdmairukfi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InltcXF0aHZnZnNyZG1haXJ1a2ZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NjIxMjQsImV4cCI6MjA5OTMzODEyNH0.IXf5VkCCVgBBRzmfD4BLOq_xNEcyhcySmDySq677E-E';
export const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export let currentUser = null;

export function setCurrentUser(user) {
    currentUser = user;
}

export async function loadCloudProfile() {
    if(!currentUser) return;
    const { data, error } = await supabaseClient.from('mallet_profiles').select('*').eq('user_id', currentUser.id).limit(1);
    if(data && data.length > 0) {
        let p = data[0];
        document.getElementById('malletNameInput').value = p.name;
        document.getElementById('malletLengthInput').value = p.head_length;
        document.getElementById('malletWidthInput').value = p.face_width;
        document.getElementById('massInput').value = p.mass;
        document.getElementById('offsetYInput').value = p.offset_y;
        document.getElementById('radiusInput').value = p.radius;
        document.getElementById('difficultySelect').value = p.skill_tier;
        document.getElementById('sweetSpotInput').value = p.sweet_spot;
        document.getElementById('twistToleranceInput').value = p.twist_tolerance;
        window.syncHardwareOffsetFromCloud(p.matrix_x, p.matrix_y, p.matrix_z, p.matrix_w);
        showToast("Cloud Settings Loaded.");
    } else { 
        await saveCloudProfile({w:1, x:0, y:0, z:0}); 
    }
}

export async function saveCloudProfile(hardwareMountOffset) {
    if(!currentUser) return;
    const payload = {
        user_id: currentUser.id, name: document.getElementById('malletNameInput').value,
        head_length: parseFloat(document.getElementById('malletLengthInput').value) || 27.6,
        face_width: parseFloat(document.getElementById('malletWidthInput').value) || 6.0,
        mass: parseFloat(document.getElementById('massInput').value) || 1000,
        offset_y: parseFloat(document.getElementById('offsetYInput').value) || 5.5,
        matrix_w: hardwareMountOffset.w, matrix_x: hardwareMountOffset.x, matrix_y: hardwareMountOffset.y, matrix_z: hardwareMountOffset.z,
        radius: parseFloat(document.getElementById('radiusInput').value) || 127,
        skill_tier: document.getElementById('difficultySelect').value, sweet_spot: parseFloat(document.getElementById('sweetSpotInput').value) || 1.5,
        twist_tolerance: parseFloat(document.getElementById('twistToleranceInput').value) || 1.0, updated_at: new Date().toISOString()
    };
    
    const { data, error: updateErr } = await supabaseClient.from('mallet_profiles').update(payload).eq('user_id', currentUser.id).select();
    if (!data || data.length === 0) {
        await supabaseClient.from('mallet_profiles').insert([payload]);
    }
}

export async function fetchCloudMatches() {
    let container = document.getElementById('cloud-matches-container');
    container.innerHTML = '<div class="text-muted text-center p-5">Fetching matches...</div>';
    
    const { data: matches, error } = await supabaseClient.from('matches').select('*').eq('user_id', currentUser.id).order('match_time_id', { ascending: false });
    if (error || !matches || matches.length === 0) { container.innerHTML = '<div class="text-muted text-center p-5">No cloud matches found.</div>'; return; }

    container.innerHTML = '';
    matches.forEach(m => {
        let matchDate = new Date(m.match_time_id * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        let locStr = m.location ? m.location : 'Untitled Match';
        let oppStr = m.opponent ? `<br><span class="text-muted small-help">vs. ${m.opponent}</span>` : '';
        
        let editArgs = `'${m.id}', '${(m.location||'').replace(/'/g, "\\'")}', '${(m.opponent||'').replace(/'/g, "\\'")}', '${(m.event_type||'').replace(/'/g, "\\'")}', ${m.lawn_speed}, '${(m.notes||'').replace(/'/g, "\\'")}'`;

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
        let speedStr = (s.z_vel || 0).toFixed(1) + " m/s"; 
        let forceN = massKg * (s.peak_g || 0) * 9.81;
        let forceStr = forceN.toFixed(0) + " N";
        
        let ballSpeedMPS = (s.z_vel || 0) * (massKg * 1.8) / (massKg + 0.454); let estDist = (ballSpeedMPS * ballSpeedMPS) * lawnMult;
        let deflectionVal = Math.abs(s.peak_twist || 0) * ((s.dwell || 0) / 1000.0);
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
        let impactEuler = new THREE.Euler().setFromQuaternion(impactRawQuat, 'YXZ');
        let strokeAoA = THREE.MathUtils.radToDeg(impactEuler.z);
        let locTwist = getShaftTwist(impactRawQuat);
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
                        <div class="adv-row"><span>Impact Dwell</span><span class="adv-val">${s.dwell || 0} ms</span></div>
                        <div class="adv-row"><span>Extension</span><span class="adv-val" style="color:${extColor};">${extStr}</span></div>
                        <div class="adv-row"><span>Push Force</span><span class="adv-val">${((s.push_force || 0) > 0 ? '+' : '') + (s.push_force || 0).toFixed(0)} N</span></div>
                    </div>
                </details>
            </div>`;
    });
    detailsHTML += `</div></details>`; container.innerHTML = detailsHTML;
}