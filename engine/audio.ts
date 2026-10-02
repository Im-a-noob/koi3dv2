import { SceneName } from "../types/koi";

class AudioEngine {
  private actx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private brownBuffer: AudioBuffer | null = null;
  private ambientAudio: HTMLAudioElement | null = null;
  private rainNode: AudioNode | null = null;
  private rainGain: GainNode | null = null;
  private volume: number = 0.7;
  private isMuted: boolean = false;
  private initialized: boolean = false;

  init() {
    if (this.initialized) return;
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      this.actx = new AC();
      this.masterGain = this.actx.createGain();
      this.masterGain.gain.value = this.isMuted ? 0 : this.volume;
      this.masterGain.connect(this.actx.destination);

      // Generate 7s brown noise buffer for thunder
      const sr = this.actx.sampleRate;
      const len = Math.floor(sr * 7);
      this.brownBuffer = this.actx.createBuffer(1, len, sr);
      const data = this.brownBuffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      }

      // Rain generator
      const rainBuffer = this.actx.createBuffer(1, sr * 3, sr);
      const rData = rainBuffer.getChannelData(0);
      for (let i = 0; i < sr * 3; i++) {
        rData[i] = (Math.random() * 2 - 1) * 0.2;
      }
      const rainSrc = this.actx.createBufferSource();
      rainSrc.buffer = rainBuffer;
      rainSrc.loop = true;
      const rainFilter = this.actx.createBiquadFilter();
      rainFilter.type = "lowpass";
      rainFilter.frequency.value = 1200;
      this.rainGain = this.actx.createGain();
      this.rainGain.gain.value = 0;
      rainSrc.connect(rainFilter).connect(this.rainGain).connect(this.masterGain);
      rainSrc.start();
      this.rainNode = rainSrc;

      // Ambient stream
      this.ambientAudio = new Audio("/audio/ambient-river-v1.m4a");
      this.ambientAudio.loop = true;
      this.ambientAudio.volume = this.isMuted ? 0 : this.volume * 0.55;

      this.initialized = true;
    } catch (e) {
      console.warn("Audio initialization deferred:", e);
    }
  }

  ensureContext() {
    this.init();
    if (this.actx && this.actx.state === "suspended") {
      this.actx.resume();
    }
    if (this.ambientAudio && this.ambientAudio.paused && !this.isMuted) {
      this.ambientAudio.play().catch(() => {});
    }
  }

  setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain) {
      this.masterGain.gain.value = this.isMuted ? 0 : this.volume;
    }
    if (this.ambientAudio) {
      this.ambientAudio.volume = this.isMuted ? 0 : this.volume * 0.55;
    }
  }

  toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    this.setVolume(this.volume);
    if (!this.isMuted) {
      this.ensureContext();
    } else if (this.ambientAudio) {
      this.ambientAudio.pause();
    }
    return this.isMuted;
  }

  getMuted(): boolean {
    return this.isMuted;
  }

  getVolume(): number {
    return this.volume;
  }

  // Thunder sound from AndyLe
  thunder(near: number = 0.7) {
    if (this.isMuted || !this.actx || !this.brownBuffer || !this.masterGain) return;
    this.ensureContext();

    const t0 = this.actx.currentTime;
    const dur = 3.4 + (1 - near) * 2.4;

    const src = this.actx.createBufferSource();
    src.buffer = this.brownBuffer;

    const lp = this.actx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(180 + near * 800, t0);
    lp.frequency.exponentialRampToValueAtTime(70, t0 + dur);

    const g = this.actx.createGain();
    const peak = 0.45 + near * 0.9;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (near > 0.6 ? 0.03 : 0.4));

    for (let t = t0 + 0.45; t < t0 + dur - 0.6; t += 0.15 + Math.random() * 0.35) {
      g.gain.linearRampToValueAtTime(
        peak * (0.25 + Math.random() * 0.6) * (1 - (t - t0) / dur),
        t
      );
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(lp).connect(g).connect(this.masterGain);
    src.start(t0, Math.random() * 1.5, dur);

    if (near > 0.6) {
      const c = this.actx.createBufferSource();
      c.buffer = this.brownBuffer;
      const hp = this.actx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 900;
      const cg = this.actx.createGain();
      cg.gain.setValueAtTime(0.0001, t0);
      cg.gain.exponentialRampToValueAtTime(0.9 * near, t0 + 0.01);
      cg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
      c.connect(hp).connect(cg).connect(this.masterGain);
      c.start(t0, Math.random() * 3, 0.4);
    }
  }

  // Water splash sound when fish jumps or food drops
  splash(amp = 1.0) {
    if (this.isMuted || !this.actx || !this.masterGain) return;
    try {
      const t0 = this.actx.currentTime;
      const osc = this.actx.createOscillator();
      const gain = this.actx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(650, t0);
      osc.frequency.exponentialRampToValueAtTime(220, t0 + 0.14);

      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.linearRampToValueAtTime(0.18 * amp, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);

      osc.connect(gain).connect(this.masterGain);
      osc.start(t0);
      osc.stop(t0 + 0.2);
    } catch {}
  }

  // Realistic delicate bubble pop sound
  private lastBubblePopTime: number = 0;
  bubblePop(vol = 0.08) {
    if (this.isMuted || !this.actx || !this.masterGain) return;
    const now = performance.now();
    if (now - this.lastBubblePopTime < 50) return; // rate limit pops
    this.lastBubblePopTime = now;
    try {
      const t0 = this.actx.currentTime;
      const osc = this.actx.createOscillator();
      const gain = this.actx.createGain();
      osc.type = "sine";
      const startFreq = 750 + Math.random() * 550;
      osc.frequency.setValueAtTime(startFreq, t0);
      osc.frequency.exponentialRampToValueAtTime(startFreq * 1.55, t0 + 0.028);

      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(vol * 0.16, t0 + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.035);

      osc.connect(gain).connect(this.masterGain);
      osc.start(t0);
      osc.stop(t0 + 0.04);
    } catch {}
  }

  // Zen chime tone
  chime(freq = 528) {
    if (this.isMuted || !this.actx || !this.masterGain) return;
    try {
      const t0 = this.actx.currentTime;
      const osc = this.actx.createOscillator();
      const gain = this.actx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t0);

      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.linearRampToValueAtTime(0.2, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.8);

      osc.connect(gain).connect(this.masterGain);
      osc.start(t0);
      osc.stop(t0 + 2.0);
    } catch {}
  }

  updateScene(scene: SceneName) {
    if (this.rainGain) {
      const targetRain = scene === "rain" ? 0.35 : scene === "storm" ? 0.6 : 0;
      this.rainGain.gain.setTargetAtTime(
        this.isMuted ? 0 : targetRain * this.volume,
        (this.actx?.currentTime || 0) + 0.05,
        1.5
      );
    }
  }
}

export const sound = new AudioEngine();
