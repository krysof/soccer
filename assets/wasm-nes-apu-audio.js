export class WasmNesApuAudioAdapter {
  constructor({ enabled = true, volume = 0.58 } = {}) {
    this.enabled = Boolean(enabled);
    this.volume = volume;
    this.state = this.enabled ? "waiting-core" : "disabled";
    this.error = "";
    this.api = null;
    this.audioContext = null;
    this.processor = null;
    this.gain = null;
    this.playbackPrimed = false;
    this.playedSamples = 0;
    this.underflows = 0;
    this.configuredSampleRate = 0;
    this.configuredOutputEnabled = false;
  }
  get claimsAudio() {
    return this.enabled && this.state !== "failed" && Boolean(this.api);
  }
  prepare() {
    return Promise.resolve(this.enabled);
  }
  fail(error) {
    this.state = "failed";
    this.error = String(error?.message || error);
    this.disconnectAudio();
    console.warn(`WASM NES APU disabled: ${this.error}`);
    return false;
  }
  bindCore(api) {
    if (!this.enabled) return false;
    const required = [
      "nes_apu_reset",
      "nes_apu_set_sample_rate",
      "nes_apu_set_output_enabled",
      "nes_apu_handle_sound_event",
      "nes_apu_advance_frame",
      "nes_apu_output_ptr",
      "nes_apu_output_capacity",
      "nes_apu_output_read_index",
      "nes_apu_available_samples",
      "nes_apu_consume_samples",
    ];
    if (!api?.memory || required.some((name) => typeof api[name] !== "function")) {
      return this.fail(new Error("soccer_core_cpp.wasm does not expose the NES APU ABI"));
    }
    this.api = api;
    api.nes_apu_reset();
    this.configureCoreForContext();
    this.state = this.audioContext ? "active" : "ready";
    return true;
  }
  configureCoreForContext() {
    if (!this.api) return;
    const sampleRate = this.audioContext?.sampleRate || 48000;
    const outputEnabled = Boolean(this.audioContext);
    let resetPlayback = false;
    if (this.configuredSampleRate !== sampleRate) {
      this.api.nes_apu_set_sample_rate(sampleRate);
      this.configuredSampleRate = sampleRate;
      resetPlayback = true;
    }
    if (this.configuredOutputEnabled !== outputEnabled) {
      this.api.nes_apu_set_output_enabled(outputEnabled ? 1 : 0);
      this.configuredOutputEnabled = outputEnabled;
      resetPlayback = true;
    }
    if (resetPlayback) this.playbackPrimed = false;
    if (this.audioContext) this.connectProcessor();
  }
  async attachAudioContext(context) {
    if (!this.enabled || !context) return false;
    if (this.audioContext && this.audioContext !== context) {
      try { this.processor?.disconnect(); } catch {}
      try { this.gain?.disconnect(); } catch {}
      this.processor = null;
      this.gain = null;
    }
    this.audioContext = context;
    if (!this.api) {
      this.state = "waiting-core";
      return true;
    }
    this.configureCoreForContext();
    this.state = "active";
    return true;
  }
  connectProcessor() {
    if (this.processor || !this.audioContext) return;
    this.processor = this.audioContext.createScriptProcessor(2048, 0, 2);
    this.gain = this.audioContext.createGain();
    this.gain.gain.value = this.volume;
    this.processor.onaudioprocess = (event) => this.fillAudioBuffer(event.outputBuffer);
    this.processor.connect(this.gain).connect(this.audioContext.destination);
  }
  fillAudioBuffer(outputBuffer) {
    const left = outputBuffer.getChannelData(0);
    const right = outputBuffer.numberOfChannels > 1 ? outputBuffer.getChannelData(1) : left;
    if (!this.api) {
      left.fill(0);
      right.fill(0);
      return;
    }
    let available = this.api.nes_apu_available_samples() >>> 0;
    if (!this.playbackPrimed && available >= left.length * 2) this.playbackPrimed = true;
    if (!this.playbackPrimed) {
      left.fill(0);
      right.fill(0);
      return;
    }
    const capacity = this.api.nes_apu_output_capacity() >>> 0;
    const pointer = this.api.nes_apu_output_ptr() >>> 0;
    const memory = new Float32Array(this.api.memory.buffer, pointer, capacity * 2);
    const readIndex = this.api.nes_apu_output_read_index() >>> 0;
    const count = Math.min(available, left.length);
    for (let index = 0; index < count; index++) {
      const slot = (readIndex + index) % capacity;
      left[index] = memory[slot * 2];
      right[index] = memory[slot * 2 + 1];
    }
    if (count < left.length) {
      left.fill(0, count);
      right.fill(0, count);
      this.underflows++;
      this.playbackPrimed = false;
    }
    this.api.nes_apu_consume_samples(count);
    this.playedSamples += count;
  }
  handleSoundEvent(soundId) {
    this.api?.nes_apu_handle_sound_event(soundId & 0xFF);
  }
  advanceFrame() {
    this.api?.nes_apu_advance_frame();
  }
  reset() {
    if (!this.api) return;
    this.api.nes_apu_reset();
    this.configureCoreForContext();
  }
  disconnectAudio() {
    try { this.processor?.disconnect(); } catch {}
    try { this.gain?.disconnect(); } catch {}
    this.processor = null;
    this.gain = null;
    this.playbackPrimed = false;
    if (this.api && this.configuredOutputEnabled) {
      this.api.nes_apu_set_output_enabled(0);
      this.configuredOutputEnabled = false;
    }
  }
  snapshot() {
    const api = this.api;
    return {
      mode: this.enabled ? "wasm-nes-apu" : "synthetic-fallback",
      state: this.state,
      containsRom: false,
      containsGameCpu: false,
      containsAudioDriver6502: true,
      containsPpu: false,
      containsMapper: false,
      implementation: "Portable WASM APU + isolated original sound driver",
      sampleRate: this.audioContext?.sampleRate || 48000,
      frames: api?.nes_apu_frames?.() >>> 0 || 0,
      musicId: api?.nes_apu_music_id?.() >>> 0 || 0,
      musicFrame: api?.nes_apu_music_frame?.() >>> 0 || 0,
      musicLoopCount: api?.nes_apu_music_loop_count?.() >>> 0 || 0,
      activeSfx: api?.nes_apu_active_sfx?.() >>> 0 || 0,
      registerWrites: api?.nes_apu_register_writes?.() >>> 0 || 0,
      bufferedSamples: api?.nes_apu_available_samples?.() >>> 0 || 0,
      generatedSamples: api?.nes_apu_generated_samples?.() >>> 0 || 0,
      playedSamples: this.playedSamples,
      underflows: this.underflows,
      droppedSamples: api?.nes_apu_dropped_samples?.() >>> 0 || 0,
      traceCount: api?.nes_apu_embedded_trace_count?.() >>> 0 || 0,
      audioBankBytes: api?.nes_apu_embedded_audio_bank_bytes?.() >>> 0 || 0,
      audioDriverFaultOpcode: api?.nes_apu_audio_driver_fault_opcode?.() >>> 0 || 0,
      audioDriverProgramId: api?.nes_apu_audio_driver_program_id?.() >>> 0 || 0,
      dpcmBytes: api?.nes_apu_embedded_dpcm_bytes?.() >>> 0 || 0,
      error: this.error,
    };
  }
}