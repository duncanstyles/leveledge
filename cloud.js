// cloud.js
import { difficultyMatrix, getStarRating, getShaftTwist } from './kinematics.js';
import { showToast, formatOffset, buildCastRowHTML } from './utils.js';

const SUPABASE_URL = 'https://ymqqthvgfsrdmairukfi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InltcXF0aHZnZnNyZG1haXJ1a2ZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NjIxMjQsImV4cCI6MjA5OTMzODEyNH0.IXf5VkCCVgBBRzmfD4BLOq_xNEcyhcySmDySq677E-E';
export const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export let currentUser = null;

let performanceChartInstance = null; // Track the chart to destroy/redraw it on refresh

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
        document.getElementById('handleLengthInput').value = p.handle_length;
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
        twist_tolerance: parseFloat(document.getElementById('twistToleranceInput').value) || 1.0, updated_at: new Date().toISOString(),
        handle_length: parseFloat(document.getElementById('handleLengthInput').value) || 91.4
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
        
        // --- THE FIX: Variables must be scoped here, BEFORE detailsHTML is appended ---
        let dbFaceAngle = parseFloat(s.face_angle);
        let locTwist = !isNaN(dbFaceAngle) ? dbFaceAngle : getShaftTwist(impactRawQuat);
        let faceAngleHtml = `${(locTwist > 0 ? '+' : '')}${locTwist.toFixed(1)}°`;

        let dbBackArc = parseFloat(s.back_arc);
        let backArcHtml = !isNaN(dbBackArc) ? `${dbBackArc.toFixed(0)} cm` : 'N/A';
        // ----------------------------------------------------------------------------

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
                        <div class="adv-row"><span>Backswing Arc</span><span class="adv-val">${backArcHtml}</span></div>
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

export async function savePracticeCastsToCloud(castsArray, currentTempo) {
    if (!currentUser || !castsArray || castsArray.length === 0) return;

    // Generate one unique ID to link this entire sequence of casts and the final strike together
    const uniqueSwingId = crypto.randomUUID(); 
    
    // Capture the real-world time right now, and the hardware time of the final cast
    const nowRealTime = Date.now();
    const lastCastHwTime = castsArray[castsArray.length - 1].time;

    let castsToInsert = castsArray.map((c, index) => {
        // Calculate the exact real-world time this specific cast happened
        let exactCastTime = nowRealTime - (lastCastHwTime - c.time);
        
        return {
            swing_id: uniqueSwingId,             
            user_id: currentUser.id,
            timestamp: new Date(exactCastTime).toISOString(),
            cast_index: index,
            is_strike: c.isStrike,
            path_dev_cm: parseFloat(c.dev.toFixed(1)),
            dir: c.dir,
            plane_twist: c.planeTwist !== null && c.planeTwist !== undefined ? parseFloat(c.planeTwist.toFixed(1)) : null,
            
            impact_twist: c.impactTwist !== null && c.impactTwist !== undefined ? parseFloat(c.impactTwist.toFixed(1)) : null,
            speed_mps: parseFloat(c.passSpeed.toFixed(1)),
            push_force: c.pushForce !== undefined ? c.pushForce : null,
            est_dist_m: c.estDist,
            
            tempo_bpm: currentTempo > 0 ? Math.round(currentTempo) : null,
            
            // Advanced Kinematics
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

    // Grab recent casts for this user. Limit to 1000 rows (covers >100 swings) to keep network fast.
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

    // --- NEW: Limit exactly to the last 100 unique swings ---
    // Extract unique swing IDs in order, keep only the first 100
    let uniqueSwingIds = [...new Set(casts.map(c => c.swing_id).filter(id => id))].slice(0, 100);
    
    // Filter the payload to only include casts from those 100 swings
    let recentCasts = casts.filter(c => uniqueSwingIds.includes(c.swing_id));

    // Group the casts by their unique swing_id
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

    // --- NEW DASHBOARD LOGIC ---
    let sumPDelta = 0, sumDev = 0, sumFace = 0;
    let countPDelta = 0, countDev = 0, countFace = 0;

    // Distances for X-axis (in meters)
    const distanceBuckets = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
    
    // Track both total attempts and successful hits PER BUCKET
    let attemptsPerBucket = {2:0, 4:0, 6:0, 8:0, 10:0, 12:0, 14:0, 16:0, 18:0, 20:0};
    let hitsPerBucket = {2:0, 4:0, 6:0, 8:0, 10:0, 12:0, 14:0, 16:0, 18:0, 20:0};

    // Calculate overall averages and chart data using ONLY the last 100 swings
    recentCasts.forEach(c => {
        // Top dashboard stats
        if (c.p_delta !== null && c.p_delta !== undefined) {
            sumPDelta += c.p_delta; countPDelta++;
        }
        if (c.path_dev_cm !== null && c.path_dev_cm !== undefined) {
            sumDev += c.path_dev_cm; countDev++;
        }
        if (c.plane_twist !== null && c.plane_twist !== undefined) {
            sumFace += Math.abs(c.plane_twist); countFace++;
        }

        // Chart Data: Evaluate hit % per distance bucket
        if (c.true_acc_range !== null && c.est_dist_m !== null) {
            distanceBuckets.forEach(d => {
                // Only include the cast in this bucket's data if the ball was hit hard enough 
                // to actually reach the target distance (Estimated Distance >= Target Distance)
                if (c.est_dist_m >= d) {
                    attemptsPerBucket[d]++;
                    
                    // It counts as a hit if it stays on the line for at least that distance
                    if (c.true_acc_range >= d) {
                        hitsPerBucket[d]++;
                    }
                }
            });
        }
    });

    // Convert raw hits to percentages per bucket
    let accuracyData = distanceBuckets.map(d => {
        return attemptsPerBucket[d] > 0 ? (hitsPerBucket[d] / attemptsPerBucket[d] * 100) : 0;
    });

    // Populate the HTML Average text
    if (countPDelta > 0) document.getElementById('dash-avg-pdelta').innerText = (sumPDelta / countPDelta).toFixed(1) + ' cm';
    if (countDev > 0) document.getElementById('dash-avg-dev').innerText = (sumDev / countDev).toFixed(1) + ' cm';
    if (countFace > 0) document.getElementById('dash-avg-face').innerText = '±' + (sumFace / countFace).toFixed(1) + '°';

    // Show the dashboard and render the Chart
    document.getElementById('performance-dashboard').classList.remove('hidden');
    
    if (window.Chart) {
        const ctx = document.getElementById('performanceChart');
        if (performanceChartInstance) performanceChartInstance.destroy(); // Clear old chart
        
        performanceChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: distanceBuckets.map(d => d + 'm'),
                datasets: [
                    {
                        label: 'Hit Percentage (%)',
                        data: accuracyData,
                        backgroundColor: 'rgba(56, 189, 248, 0.4)',
                        borderColor: '#38bdf8',
                        borderWidth: 1,
                        borderRadius: 4
                    }
                ]
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
                            // Add a tooltip to show the raw attempts vs hits when hovering
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
    // --- END DASHBOARD LOGIC ---

    // --- END DASHBOARD LOGIC ---

    container.innerHTML = '';
    
    // NEW: Check if the dev option is enabled before rendering the list
    const showRawData = document.getElementById('showCloudDataCheck')?.checked;
    
    if (showRawData) {
        // Render each swing card
        sessionOrder.forEach(sId => {
            let sessionCasts = sessions[sId];
            sessionCasts.sort((a, b) => a.cast_index - b.cast_index);
             
            let sessionTime = new Date(sessionCasts[0].timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            let finalStrike = sessionCasts.find(c => c.is_strike) || sessionCasts[sessionCasts.length - 1];
            
            let finalTempo = finalStrike.tempo_bpm ? `${finalStrike.tempo_bpm} BPM` : '--';
            let finalDev = finalStrike.path_dev_cm !== null ? `${finalStrike.path_dev_cm.toFixed(1)}cm ${finalStrike.dir || ''}` : '--';
            let finalSpeed = finalStrike.speed_mps !== null ? `${finalStrike.speed_mps.toFixed(1)} m/s` : '--';
            
            let castsHtml = sessionCasts.map(c => {
                let mappedCast = {
                    planeTwist: c.plane_twist, faceAngle: c.plane_twist, pathAngleRads: c.path_angle_rads,
                    passSpeed: c.speed_mps, isStrike: c.is_strike, dev: c.path_dev_cm / 10.0, 
                    dir: c.dir, estDist: c.est_dist_m, pDelta: c.p_delta, estAccRange: c.est_acc_range,
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
        
        // Attach click listeners to expand Stored Session rows
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
    
    // Delete all casts that share this exact swing_id
    const { error } = await supabaseClient
        .from('practice_casts')
        .delete()
        .eq('swing_id', swingId);
        
    if (error) {
        showToast("Error deleting swing: " + error.message);
    } else {
        showToast("Swing deleted.");
        fetchCloudTraining(); // Refresh the list
    }
}