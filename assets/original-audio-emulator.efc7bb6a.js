const INPUT_TO_NES_BUTTON = [
  [1 << 4, 0], // host KICK   -> NES A
  [1 << 5, 1], // host SPRINT -> NES B
  [1 << 7, 2], // host SELECT -> NES SELECT
  [1 << 6, 3], // host START  -> NES START
  [1 << 0, 4], // host UP     -> NES UP
  [1 << 1, 5], // host DOWN   -> NES DOWN
  [1 << 2, 6], // host LEFT   -> NES LEFT
  [1 << 3, 7], // host RIGHT  -> NES RIGHT
];
let jsnesLoader = null;
function loadJsnesRuntime(url) {
  if (globalThis.jsnes?.NES) return Promise.resolve(globalThis.jsnes);
  if (jsnesLoader) return jsnesLoader;
  jsnesLoader = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.dataset.originalAudioEmulator = "jsnes";
    script.addEventListener("load", () => {
      if (globalThis.jsnes?.NES) resolve(globalThis.jsnes);
      else reject(new Error("JSNES loaded without the NES constructor"));
    }, { once: true });
    script.addEventListener("error", () => reject(new Error(`failed to load ${url}`)), { once: true });
    document.head.appendChild(script);
  });
  return jsnesLoader;
}
function bytesToBinaryString(bytes) {
  let result = "";
  const chunkSize = 0x4000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    result += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return result;
}
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
export class OriginalNesAudioTestAdapter {
  constructor({ runtimeUrl, romUrl, enabled = true, volume = 0.55 }) {
    this.runtimeUrl = runtimeUrl;
    this.romUrl = romUrl;
    this.enabled = Boolean(enabled);
    this.volume = volume;
    this.state = this.enabled ? "idle" : "disabled";
    this.error = "";
    this.runtime = null;
    this.romBinary = null;
    this.nes = null;
    this.sampleRate = 48000;
    this.audioContext = null;
    this.processor = null;
    this.gain = null;
    this.samples = new StereoSampleRing();
    this.inputHistory = [];
    this.lastInput = 0;
    this.emulatedFrames = 0;
    this.playedSamples = 0;
    this.generatedSamples = 0;
    this.underflows = 0;
    this.playbackPrimed = false;
    this.captureSamples = false;
    this.preparePromise = null;
  }
  get claimsAudio() {
    return this.enabled && this.state !== "failed";
  }
  prepare() {
    if (!this.enabled) return Promise.resolve(false);
    if (this.preparePromise) return this.preparePromise;
    this.state = "loading";
    this.preparePromise = Promise.all([
      loadJsnesRuntime(this.runtimeUrl),
      fetch(this.romUrl, { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error(`failed to load original audio ROM: ${response.status}`);
        return response.arrayBuffer();
      }),
    ]).then(([runtime, romBuffer]) => {
      this.runtime = runtime;
      this.romBinary = bytesToBinaryString(new Uint8Array(romBuffer));
      this.rebuildEmulator(this.audioContext?.sampleRate || 48000);
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
    console.warn(`original NES audio emulator disabled: ${this.error}`);
  }
  rebuildEmulator(sampleRate) {
    if (!this.runtime?.NES || !this.romBinary) return;
    const replay = this.inputHistory.slice();
    this.sampleRate = sampleRate;
    this.captureSamples = false;
    this.samples.clear();
    this.playbackPrimed = false;
    this.lastInput = 0;
    this.emulatedFrames = 0;
    this.nes = new this.runtime.NES({
      sampleRate,
      onFrame() {},
      onAudioSample: (left, right) => {
        if (!this.captureSamples || this.audioContext?.state !== "running") return;
        this.samples.push(left, right);
        this.generatedSamples++;
      },
    });
    this.nes.loadROM(this.romBinary);
    this.nes.setFramerate?.(60);
    for (const bits of replay) this.runEmulatorFrame(bits, false);
    this.captureSamples = Boolean(this.audioContext);
  }
  async attachAudioContext(context) {
    if (!this.enabled || !context) return false;
    this.audioContext = context;
    await this.prepare();
    if (this.state === "failed" || !this.nes) return false;
    if (this.sampleRate !== context.sampleRate) this.rebuildEmulator(context.sampleRate);
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
    for (let i = 0; i < left.length; i++) {
      const sample = this.playbackPrimed ? this.samples.pop() : null;
      if (!sample) {
        left[i] = 0;
        right[i] = 0;
        if (this.playbackPrimed) {
          this.underflows++;
          this.playbackPrimed = false;
        }
      } else {
        left[i] = sample[0];
        right[i] = sample[1];
        this.playedSamples++;
      }
    }
  }
  setController(bits) {
    if (!this.nes) return;
    for (const [mask, button] of INPUT_TO_NES_BUTTON) {
      const wasDown = (this.lastInput & mask) !== 0;
      const isDown = (bits & mask) !== 0;
      if (isDown && !wasDown) this.nes.buttonDown(1, button);
      if (!isDown && wasDown) this.nes.buttonUp(1, button);
    }
    this.lastInput = bits;
  }
  runEmulatorFrame(bits, capture = true) {
    if (!this.nes) return;
    this.setController(bits);
    const previousCapture = this.captureSamples;
    this.captureSamples = capture && Boolean(this.audioContext);
    this.nes.frame();
    this.captureSamples = previousCapture;
    this.emulatedFrames++;
  }
  advanceFrame(bits) {
    if (!this.enabled || this.state === "failed") return;
    const input = bits & 0xFF;
    this.inputHistory.push(input);
    if (!this.preparePromise) this.prepare();
    if (!this.nes) return;
    try {
      this.runEmulatorFrame(input, true);
    } catch (error) {
      this.fail(error);
    }
  }
  reset() {
    if (!this.enabled || !this.runtime || !this.romBinary) return;
    this.inputHistory.length = 0;
    this.rebuildEmulator(this.audioContext?.sampleRate || this.sampleRate);
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
      mode: this.enabled ? "original-nes-emulator-test" : "synthetic-fallback",
      state: this.state,
      hiddenVideo: true,
      sampleRate: this.sampleRate,
      emulatedFrames: this.emulatedFrames,
      bufferedSamples: this.samples.available,
      generatedSamples: this.generatedSamples,
      playedSamples: this.playedSamples,
      underflows: this.underflows,
      droppedSamples: this.samples.dropped,
      inputFrames: this.inputHistory.length,
      lastInput: this.lastInput,
      error: this.error,
    };
  }
}