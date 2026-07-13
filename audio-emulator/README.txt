Original audio emulator test adapter

- jsnes.min.js: JSNES 2.1.0, Apache-2.0; see LICENSE-jsnes.txt.
- original-audio-test.nes: local byte-perfect game ROM used only by the current
  Web audio validation adapter.
- No JSNES CPU/PPU/APU state is read by the Rust/WASM game core. The hidden
  emulator produces sound only; all visible state and gameplay still come from
  the translated core.
- Add ?audio=synth to the page URL to disable the emulator and use the older
  synthetic WebAudio fallback.
