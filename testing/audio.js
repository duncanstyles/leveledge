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

export function playSuccessSound() {
    if (!audioCtx || !isSoundEnabled) return; 
    let now = audioCtx.currentTime;
    // Play a pleasant, quick C-Major chord (C5, E5, G5)
    [523.25, 659.25, 783.99].forEach((freq, i) => {
        let osc = audioCtx.createOscillator(); 
        let gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination); 
        osc.type = 'sine'; osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now); 
        gain.gain.linearRampToValueAtTime(0.3, now + 0.05); 
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4 + (i * 0.1)); 
        osc.start(now); osc.stop(now + 0.5 + (i * 0.1));
    });
}

export function playBombSound(slowMo = false) {
    if (!audioCtx || !isSoundEnabled) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    const timeScale = slowMo ? 2.2 : 1.0;
    const pitchScale = slowMo ? 0.55 : 1.0;
    const duration = 1.4 * timeScale;

    // 1. Sub-bass shockwave thump (pitch sweep down)
    const subOsc = audioCtx.createOscillator();
    const subGain = audioCtx.createGain();
    subOsc.type = 'triangle';
    subOsc.frequency.setValueAtTime(115 * pitchScale, now);
    subOsc.frequency.exponentialRampToValueAtTime(22 * pitchScale, now + 0.55 * timeScale);

    subGain.gain.setValueAtTime(0.95, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.85 * timeScale);

    subOsc.connect(subGain);
    subGain.connect(audioCtx.destination);
    subOsc.start(now);
    subOsc.stop(now + 0.9 * timeScale);

    // 2. Low-pass filtered explosion rumble & debris burst
    const bufferSize = Math.floor(audioCtx.sampleRate * duration);
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
    }

    const noise = audioCtx.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(950 * pitchScale, now);
    filter.frequency.exponentialRampToValueAtTime(85 * pitchScale, now + duration);

    const noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(0.85, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(audioCtx.destination);

    noise.start(now);
    noise.stop(now + duration);
}