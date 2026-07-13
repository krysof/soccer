import PAPU from "./nes-apu/papu.js";
const CPU_FREQUENCY_NTSC = 1789772.5;
const SOFTWARE_FRAMES_PER_SECOND = 60;
const DPCM_LOAD_ADDRESS = 0xFE40;
class StereoSampleRing {
  constructor(capacity = 1 << 17) {
    this.left = new Float32Array(capacity);
    this.right = new Float32Array(capacity);
    this.capacity = capacity;
    this.readIndex = 0;
    this.writeIndex = 0;
    this.available = 0;
    this.dropped = 0;
  }
  clear() {
    this.readIndex = 0;
    this.writeIndex = 0;
    this.available = 0;
  }
  push(left, right) {
    if (this.available === this.capacity) {
      this.readIndex = (this.readIndex + 1) % this.capacity;
      this.available--;
      this.dropped++;
    }
    this.left[this.writeIndex] = left;
    this.right[this.writeIndex] = right;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    this.available++;
  }
  pop() {
    if (this.available === 0) return null;
    const sample = [this.left[this.readIndex], this.right[this.readIndex]];
    this.readIndex = (this.readIndex + 1) % this.capacity;
    this.available--;
    return sample;
  }
}
function decodeRegisterTrace(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 6 || String.fromCharCode(...bytes.subarray(0, 4)) !== "NAT1") {
    throw new Error("invalid standalone APU trace");
  }
  const frameCount = bytes[4] | (bytes[5] << 8);
  const frames = [];
  let cursor = 6;
  for (let frame = 0; frame < frameCount; frame++) {
    if (cursor >= bytes.length) throw new Error("truncated standalone APU trace");
    const count = bytes[cursor++];
    const writes = [];
    for (let index = 0; index < count; index++) {
      if (cursor + 1 >= bytes.length) throw new Error("truncated standalone APU register write");
      writes.push([0x4000 + bytes[cursor++], bytes[cursor++]]);
    }
    frames.push(writes);
  }
  if (cursor !== bytes.length) throw new Error("unexpected standalone APU trace tail");
  return frames;
}
function pulseTimer(frequency) {
  return Math.max(8, Math.min(0x7FF, Math.round(CPU_FREQUENCY_NTSC / (16 * frequency) - 1)));
}
function sfxProfile(soundId) {
  if ([0x20, 0x22, 0x24, 0x29].includes(soundId)) return { kind: "kick", frames: 7, frequency: 185, noise: 6 };
  if ([0x23, 0x26, 0x27].includes(soundId)) return { kind: "keeper", frames: 10, frequency: 145, noise: 8 };
  if ([0x28, 0x2A, 0x37, 0x38, 0x39, 0x3C, 0x3E, 0x43, 0x45, 0x46].includes(soundId)) {
    return { kind: "special", frames: 18, frequency: 330, noise: 4, dpcm: true };
  }
  if (soundId === 0x2B) return { kind: "jump", frames: 8, frequency: 260, noise: 0 };
  if ([0x2C, 0x3D].includes(soundId)) return { kind: "land", frames: 6, frequency: 82, noise: 9 };
  if ([0x2D, 0x31, 0x40].includes(soundId)) return { kind: "whistle", frames: 17, frequency: 1320, noise: 0 };
  if (soundId === 0x2E) return { kind: "goal", frames: 24, frequency: 520, noise: 5, dpcm: true };
  if (soundId === 0x32) return { kind: "cursor", frames: 3, frequency: 720, noise: 0 };
  if (soundId === 0x33) return { kind: "confirm", frames: 8, frequency: 520, noise: 0 };
  if (soundId === 0x34) return { kind: "reject", frames: 10, frequency: 185, noise: 3 };
  if (soundId === 0x35) return { kind: "text", frames: 2, frequency: 880, noise: 0 };
  if ([0x36, 0x3B].includes(soundId)) return { kind: "tackle", frames: 10, frequency: 96, noise: 8 };
  if (soundId === 0x41) return { kind: "wind", frames: 14, frequency: 112, noise: 12 };
  if ([0x44, 0x47, 0x48, 0x49, 0x4A, 0x4B, 0x4C, 0x4D, 0x4E].includes(soundId)) {
    return { kind: "phone", frames: 12, frequency: 440, noise: 0 };
  }
  return null;
}
export class StandaloneNesApuAudioAdapter {
  constructor({ dpcmUrl, traceUrls = {}, enabled = true, volume = 0.58 }) {
    this.dpcmUrl = dpcmUrl;
    this.traceUrls = traceUrls;
    this.enabled = Boolean(enabled);
    this.volume = volume;
    this.state = this.enabled ? "idle" : "disabled";
    this.error = "";
    this.audioContext = null;
    this.processor = null;
    this.gain = null;
    this.samples = new StereoSampleRing();
    this.memory = new Uint8Array(0x10000);
    this.dpcmBytes = null;
    this.traces = new Map();
    this.apu = null;
    this.sampleRate = 48000;
    this.captureSamples = false;
    this.playbackPrimed = false;
    this.preparePromise = null;
    this.musicId = 0;
    this.musicFrame = 0;
    this.musicLoopCount = 0;
    this.sfx = null;
    this.frames = 0;
    this.registerWrites = 0;
    this.generatedSamples = 0;
    this.playedSamples = 0;
    this.underflows = 0;
    this.cycleRemainder = 0;
  }
  get claimsAudio() {
    return this.enabled && this.state !== "failed";
  }
  async prepare() {
    if (!this.enabled) return false;
    if (this.preparePromise) return this.preparePromise;
    this.state = "loading";
    const entries = Object.entries(this.traceUrls);
    this.preparePromise = Promise.all([
      fetch(this.dpcmUrl, { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error(`failed to load DPCM data: ${response.status}`);
        return response.arrayBuffer();
      }),
      ...entries.map(([, url]) => fetch(url, { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error(`failed to load APU trace: ${response.status}`);
        return response.arrayBuffer();
      })),
    ]).then(([dpcmBuffer, ...traceBuffers]) => {
      this.dpcmBytes = new Uint8Array(dpcmBuffer);
      entries.forEach(([id], index) => this.traces.set(Number(id), decodeRegisterTrace(traceBuffers[index])));
      this.rebuildApu(this.audioContext?.sampleRate || 48000);
      this.state = this.audioContext ? "active" : "ready";
      return true;
    }).catch((error) => {
      this.fail(error);
      return false;
    });
    return this.preparePromise;
  }
  fail(error) {
    this.state = "failed";
    this.error = String(error?.message || error);
    this.captureSamples = false;
    this.disconnectAudio();
    console.warn(`standalone NES APU disabled: ${this.error}`);
  }
  createApuHost(sampleRate) {
    const cpu = {
      IRQ_NORMAL: 0,
      dataBus: 0,
      instrBusCycles: 0,
      apuCatchupCycles: 0,
      haltCycles() {},
      requestIrq() {},
    };
    return {
      opts: {
        sampleRate,
        onAudioSample: (left, right) => {
          if (!this.captureSamples || this.audioContext?.state !== "running") return;
          this.samples.push(left, right);
          this.generatedSamples++;
        },
      },
      cpu,
      mmap: { load: (address) => this.memory[address & 0xFFFF] },
    };
  }
  rebuildApu(sampleRate) {
    this.sampleRate = sampleRate;
    this.memory.fill(0);
    if (this.dpcmBytes) this.memory.set(this.dpcmBytes.subarray(0, 0x10000 - DPCM_LOAD_ADDRESS), DPCM_LOAD_ADDRESS);
    this.samples.clear();
    this.playbackPrimed = false;
    this.cycleRemainder = 0;
    this.apu = new PAPU(this.createApuHost(sampleRate));
    this.apu.setMasterVolume?.(256);
    this.writeRegister(0x4015, 0x0F);
  }
  async attachAudioContext(context) {
    if (!this.enabled || !context) return false;
    this.audioContext = context;
    await this.prepare();
    if (this.state === "failed" || !this.apu) return false;
    if (this.sampleRate !== context.sampleRate) this.rebuildApu(context.sampleRate);
    if (!this.processor) {
      this.processor = context.createScriptProcessor(2048, 0, 2);
      this.gain = context.createGain();
      this.gain.gain.value = this.volume;
      this.processor.onaudioprocess = (event) => this.fillAudioBuffer(event.outputBuffer);
      this.processor.connect(this.gain).connect(context.destination);
    }
    this.captureSamples = true;
    this.state = "active";
    return true;
  }
  fillAudioBuffer(outputBuffer) {
    const left = outputBuffer.getChannelData(0);
    const right = outputBuffer.numberOfChannels > 1 ? outputBuffer.getChannelData(1) : left;
    if (!this.playbackPrimed && this.samples.available >= left.length * 2) this.playbackPrimed = true;
    for (let index = 0; index < left.length; index++) {
      const sample = this.playbackPrimed ? this.samples.pop() : null;
      if (!sample) {
        left[index] = 0;
        right[index] = 0;
        if (this.playbackPrimed) {
          this.underflows++;
          this.playbackPrimed = false;
        }
      } else {
        left[index] = sample[0];
        right[index] = sample[1];
        this.playedSamples++;
      }
    }
  }
  writeRegister(address, value) {
    if (!this.apu) return;
    this.apu.writeReg(address, value & 0xFF);
    this.registerWrites++;
  }
  handleSoundEvent(soundId) {
    const id = soundId & 0xFF;
    if (id === 0x00) {
      this.musicId = 0;
      this.musicFrame = 0;
      this.sfx = null;
      this.writeRegister(0x4015, 0x00);
      return;
    }
    if (id < 0x20) {
      this.musicId = id;
      this.musicFrame = 0;
      this.musicLoopCount = 0;
      this.writeRegister(0x4015, 0x0F);
      return;
    }
    const profile = sfxProfile(id);
    if (profile) this.sfx = { ...profile, soundId: id, frame: 0 };
  }
  applyMusicFrame() {
    if (!this.apu || this.musicId === 0) return;
    const trace = this.traces.get(this.musicId);
    if (trace?.length) {
      for (const [address, value] of trace[this.musicFrame]) this.writeRegister(address, value);
      this.musicFrame++;
      if (this.musicFrame >= trace.length) {
        this.musicFrame = 0;
        this.musicLoopCount++;
      }
      return;
    }
    const step = Math.floor(this.musicFrame / 12) & 7;
    const scale = [262, 294, 330, 392, 330, 294, 247, 294];
    const frequency = scale[(step + this.musicId) & 7];
    const timer = pulseTimer(frequency);
    this.writeRegister(0x4015, 0x0F);
    this.writeRegister(0x4004, 0xB7);
    this.writeRegister(0x4006, timer & 0xFF);
    this.writeRegister(0x4007, (timer >> 8) & 0x07);
    this.musicFrame = (this.musicFrame + 1) % 96;
  }
  applySfxFrame() {
    if (!this.sfx) return;
    const effect = this.sfx;
    const remaining = Math.max(1, effect.frames - effect.frame);
    const volume = Math.max(1, Math.min(15, Math.ceil(15 * remaining / effect.frames)));
    let frequency = effect.frequency;
    if (effect.kind === "special") frequency += effect.frame * 28;
    if (effect.kind === "goal") frequency *= [1, 1.26, 1.5][Math.min(2, Math.floor(effect.frame / 8))];
    if (effect.kind === "confirm" || effect.kind === "phone") frequency *= effect.frame >= effect.frames / 2 ? 1.5 : 1;
    if (effect.kind === "reject") frequency = Math.max(80, frequency - effect.frame * 8);
    const timer = pulseTimer(frequency);
    this.writeRegister(0x4015, effect.dpcm && effect.frame === 0 ? 0x1F : 0x0F);
    this.writeRegister(0x4000, 0x90 | volume);
    this.writeRegister(0x4002, timer & 0xFF);
    this.writeRegister(0x4003, ((timer >> 8) & 0x07) | 0x08);
    if (effect.noise) {
      this.writeRegister(0x400C, 0x10 | volume);
      this.writeRegister(0x400E, effect.noise & 0x0F);
      this.writeRegister(0x400F, 0x08);
    }
    if (effect.dpcm && effect.frame === 0) {
      this.writeRegister(0x4010, 0x0B);
      this.writeRegister(0x4011, 0x00);
      this.writeRegister(0x4012, 0xFB);
      this.writeRegister(0x4013, 0x10);
      this.writeRegister(0x4015, 0x1F);
    }
    effect.frame++;
    if (effect.frame >= effect.frames) this.sfx = null;
  }
  advanceFrame() {
    if (!this.enabled || this.state === "failed") return;
    if (!this.preparePromise) this.prepare();
    if (!this.apu) return;
    this.applyMusicFrame();
    this.applySfxFrame();
    this.cycleRemainder += CPU_FREQUENCY_NTSC / SOFTWARE_FRAMES_PER_SECOND;
    const cycles = Math.floor(this.cycleRemainder);
    this.cycleRemainder -= cycles;
    this.apu.clockFrameCounter(cycles);
    this.frames++;
  }
  reset() {
    this.musicId = 0;
    this.musicFrame = 0;
    this.musicLoopCount = 0;
    this.sfx = null;
    this.frames = 0;
    if (this.dpcmBytes) this.rebuildApu(this.audioContext?.sampleRate || this.sampleRate);
  }
  disconnectAudio() {
    try { this.processor?.disconnect(); } catch {}
    try { this.gain?.disconnect(); } catch {}
    this.processor = null;
    this.gain = null;
    this.samples.clear();
    this.playbackPrimed = false;
  }
  snapshot() {
    return {
      mode: this.enabled ? "standalone-nes-apu" : "synthetic-fallback",
      state: this.state,
      containsRom: false,
      containsCpu: false,
      containsPpu: false,
      containsMapper: false,
      sampleRate: this.sampleRate,
      frames: this.frames,
      musicId: this.musicId,
      musicFrame: this.musicFrame,
      musicLoopCount: this.musicLoopCount,
      activeSfx: this.sfx?.soundId ?? 0,
      registerWrites: this.registerWrites,
      bufferedSamples: this.samples.available,
      generatedSamples: this.generatedSamples,
      playedSamples: this.playedSamples,
      underflows: this.underflows,
      droppedSamples: this.samples.dropped,
      traceCount: this.traces.size,
      dpcmBytes: this.dpcmBytes?.length || 0,
      error: this.error,
    };
  }
}