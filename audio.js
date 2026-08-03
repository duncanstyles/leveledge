// audio.js

export let audioCtx; 
export let oscillator; 
export let gainNode; 
export let isAudioInitialized = false; 
export let isSoundEnabled = true;

// Helper to toggle state safely from main.js
export function toggleSoundState(enabled) {
    isSoundEnabled = enabled;
    if (!isSoundEnabled && isAudioInitialized && gainNode && audioCtx) {
        gainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);
    }
}

export function initAudio() {
    if (!isAudioInitialized) { 
        audioCtx = new (window.AudioContext || window.webkitAudioContext)(); 
        oscillator = audioCtx.createOscillator(); 
        gainNode = audioCtx.createGain();
        oscillator.type = 'sine'; 
        oscillator.frequency.value = 440; 
        gainNode.gain.value = 0; 
        oscillator.connect(gainNode); 
        gainNode.connect(audioCtx.destination); 
        oscillator.start(); 
        isAudioInitialized = true;
    } else { 
        audioCtx.resume(); 
    }
}

export function playBeep(freq, duration) {
    if (!audioCtx || !isSoundEnabled) return; 
    let beepOsc = audioCtx.createOscillator(); let beepGain = audioCtx.createGain();
    beepOsc.connect(beepGain); beepGain.connect(audioCtx.destination); beepOsc.type = 'sine'; beepOsc.frequency.value = freq;
    beepGain.gain.setValueAtTime(0.5, audioCtx.currentTime); beepGain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration); beepOsc.start(); beepOsc.stop(audioCtx.currentTime + duration);
}

export function playDoubleBeep() {
    if (!audioCtx || !isSoundEnabled) return; let now = audioCtx.currentTime;
    let osc1 = audioCtx.createOscillator(); let gain1 = audioCtx.createGain(); osc1.connect(gain1); gain1.connect(audioCtx.destination); osc1.type = 'sine'; osc1.frequency.value = 600;
    gain1.gain.setValueAtTime(0.5, now); gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.15); osc1.start(now); osc1.stop(now + 0.15);
    let osc2 = audioCtx.createOscillator(); let gain2 = audioCtx.createGain(); osc2.connect(gain2); gain2.connect(audioCtx.destination); osc2.type = 'sine'; osc2.frequency.value = 1200;
    gain2.gain.setValueAtTime(0.5, now + 0.15); gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.35); osc2.start(now + 0.15); osc2.stop(now + 0.35);
}

export function playTick(freq, duration) {
    if (!audioCtx || !isSoundEnabled) return; let tickOsc = audioCtx.createOscillator(); let tickGain = audioCtx.createGain();
    tickOsc.connect(tickGain); tickGain.connect(audioCtx.destination); tickOsc.type = 'square'; tickOsc.frequency.value = freq;
    tickGain.gain.setValueAtTime(0.6, audioCtx.currentTime); tickGain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration); tickOsc.start(); tickOsc.stop(audioCtx.currentTime + duration);
}