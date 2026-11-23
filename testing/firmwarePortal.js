import { showToast } from './utils.js';

const SUPABASE_URL = 'https://ymqqthvgfsrdmairukfi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InltcXF0aHZnZnNyZG1haXJ1a2ZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NjIxMjQsImV4cCI6MjA5OTMzODEyNH0.IXf5VkCCVgBBRzmfD4BLOq_xNEcyhcySmDySq677E-E';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const SERVICE_UUID = "19b30000-e8f2-537e-4f6c-d104768a1214";
const COMMAND_UUID = "19b30002-e8f2-537e-4f6c-d104768a1214";

let activeRelease = null;

function log(msg) {
    const el = document.getElementById('portalLog');
    el.textContent += `\n[${new Date().toLocaleTimeString()}] ${msg}`;
    el.scrollTop = el.scrollHeight;
}

function setProgress(pct, label) {
    document.getElementById('flashProgressWrap').classList.remove('hidden');
    document.getElementById('flashProgressBar').style.width = `${pct}%`;
    document.getElementById('flashPctLabel').innerText = `${Math.round(pct)}%`;
    if (label) document.getElementById('flashStageLabel').innerText = label;
}

async function computeSha256Hex(arrayBuffer) {
    const hashBuf = await crypto.subtle.digest('SHA-256', arrayBuffer);
    return Array.from(new Uint8Array(hashBuf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

async function initPortal() {
    try {
        const prefs = JSON.parse(localStorage.getItem('LVE_PlayerPrefs') || '{}');
        if (prefs.darkThemeCheck) document.documentElement.setAttribute('data-theme', 'dark');
    } catch (_) {}

    const ctx = JSON.parse(sessionStorage.getItem('LVE_UpdateContext') || '{}');
    document.getElementById('portalCurrentFw').innerText = ctx.currentFw || 'Not Connected';

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
        showToast("Authentication required.");
        window.location.href = 'index.html';
        return;
    }

    const { data: profile } = await supabase
        .from('player_profiles')
        .select('is_subscribed')
        .eq('user_id', session.user.id)
        .single();

    const pill = document.getElementById('subStatusPill');
    if (!profile?.is_subscribed) {
        pill.innerText = "● SUBSCRIPTION INACTIVE";
        pill.className = "font-mono text-danger font-bold";
        log("Access denied: Active Pro subscription required.");
        return;
    }

    pill.innerText = "● PRO ACTIVE";
    pill.className = "font-mono text-success font-bold";

    const { data: release, error } = await supabase
        .from('firmware_releases')
        .select('*')
        .eq('is_latest', true)
        .single();

    if (error || !release) {
        log("Failed to load release info from Supabase.");
        return;
    }

    activeRelease = release;
    document.getElementById('portalLatestFw').innerText = `v${release.version}`;
    document.getElementById('portalReleaseNotes').innerText = release.release_notes;
    document.getElementById('btnStartFlash').disabled = false;
    log(`Loaded release v${release.version}. Ready.`);
}

document.getElementById('btnEnterDfuBle').onclick = async () => {
    if (!navigator.bluetooth) {
        showToast("Web Bluetooth not supported in this browser.");
        return;
    }
    try {
        log("Requesting Bluetooth device...");
        const device = await navigator.bluetooth.requestDevice({
            filters: [{ namePrefix: 'LVE' }, { namePrefix: 'Phan' }],
            optionalServices: [SERVICE_UUID]
        });
        const server = await device.gatt.connect();
        const service = await server.getPrimaryService(SERVICE_UUID);
        const cmdChar = await service.getCharacteristic(COMMAND_UUID);

        log(`Connected to ${device.name}. Sending DFU reboot command ('U')...`);
        await cmdChar.writeValueWithoutResponse(new Uint8Array([0x55]));
        log("Mallet is rebooting into Serial DFU mode.");
        showToast("Mallet rebooted into DFU mode!");
    } catch (err) {
        if (err.name !== 'NotFoundError') log(`BLE DFU trigger error: ${err.message}`);
    }
};

document.getElementById('btnStartFlash').onclick = async () => {
    if (!activeRelease) return;
    if (!('serial' in navigator)) {
        showToast("Web Serial API requires desktop Chrome or Edge.");
        log("Error: navigator.serial is unavailable in this browser.");
        return;
    }

    const flashBtn = document.getElementById('btnStartFlash');
    flashBtn.disabled = true;

    try {
        setProgress(15, "Downloading firmware package...");
        const { data: fileBlob, error: dlErr } = await supabase.storage
            .from('firmware-binaries')
            .download(activeRelease.storage_path);

        if (dlErr || !fileBlob) {
            throw new Error(`Storage error (${activeRelease.storage_path}): ${dlErr?.message || JSON.stringify(dlErr)}`);
        }
        const zipBuffer = await fileBlob.arrayBuffer();

        setProgress(25, "Verifying SHA-256 checksum...");
        const actualHash = await computeSha256Hex(zipBuffer);
        if (actualHash !== activeRelease.sha256.toLowerCase()) {
            throw new Error("SHA-256 mismatch! Aborting flash to protect hardware.");
        }
        log("SHA-256 verified OK.");

        setProgress(30, "Select XIAO USB port...");
        const port = await navigator.serial.requestPort({
            filters: [{ usbVendorId: 0x2886 }]
        });

        const { WebSerialDFU } = await import('./nrfSerialDfu.js?v=2');
        const dfu = new WebSerialDFU(port, {
            baudRate: 115200,
            onProgress: (sent, total) => {
                const pct = 30 + (sent / total) * 70;
                setProgress(pct, "Flashing nRF52840...");
            },
            onLog: (line) => log(line)
        });

        await dfu.flashZip(zipBuffer);

        setProgress(100, "Update Complete!");
        log(`Successfully flashed v${activeRelease.version}! Unplug USB-C to exit charging mode and reconnect in the app.`);
        showToast(`Firmware updated to v${activeRelease.version}!`);
    } catch (err) {
        log(`UPDATE FAILED: ${err.message}`);
        showToast("Firmware update failed. Check log.");
    } finally {
        flashBtn.disabled = false;
    }
};

initPortal();