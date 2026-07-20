import { WasmNesApuAudioAdapter } from "./wasm-nes-apu-audio.be2b2989.js";
const INPUT = {
  UP: 1 << 0,
  DOWN: 1 << 1,
  LEFT: 1 << 2,
  RIGHT: 1 << 3,
  KICK: 1 << 4,
  SPRINT: 1 << 5,
  START: 1 << 6,
  SELECT: 1 << 7,
};
const PHASE = {
  TITLE: 0,
  MENU: 1,
  KICKOFF: 2,
  PLAYING: 3,
  GOAL: 4,
  FULL_TIME: 5,
  THROW_IN: 6,
  GOAL_KICK: 7,
  CORNER_KICK: 8,
  HALFTIME: 9,
  FREE_KICK: 10,
  PENALTY_KICK: 11,
  PAUSE: 12,
  CREDITS: 14,
};
const ACTION = {
  STAND: 0,
  RUN: 1,
  KICK: 2,
  TACKLE: 3,
  FALL: 4,
  KEEPER_SAVE: 5,
  HEADER: 6,
  CELEBRATE: 7,
  DEJECT: 8,
};
const TEAM_NAMES = ["熱血", "花園", "連合", "工業", "選抜", "世界"];
const WEATHER_NAMES = ["CLEAR", "RAIN", "MUD", "SNOW", "WIND"];
const ROLE_NAMES = ["GK", "DF", "DF", "FW", "WG", "WG"];
const PLAYER_NAMES = [
  ["ごだい", "ひろし", "こうじ", "くにお", "すすむ", "まさ"],
  ["まえだ", "いしだ", "たけし", "りき", "さおとめ", "よしの"],
  ["ごうだ", "にしむら", "さわぐち", "くまだ", "はやさか", "もちづき"],
  ["おにづか", "こばやし", "たいら", "きのした", "望月", "小林"],
  ["じんない", "あいはら", "みどう", "ゆうじ", "まもる", "けん"],
  ["ジョン", "マイク", "ピエール", "カルロス", "リー", "アレックス"],
];
const ORIGINAL_BACKGROUND_SCREEN_IDS = [
  0x02, 0x03, 0x0b, 0x04, 0x06, 0x07, 0x05, 0x08,
  0x0d, 0x0c, 0x09, 0x0f, 0x0a, 0x14, 0x15,
  0x10, 0x11, 0x12, 0x13,
  0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x21, 0x22, 0x23, 0x24,
];
const ORIGINAL_CREDITS_SCREEN_IDS = [0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x21, 0x22, 0x23, 0x24];
const keys = new Set();
let resetRequested = false;
const keyTapLatch = { kick: 0, sprint: 0, start: 0, select: 0 };
const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const stats = document.querySelector("#stats");
const app = document.querySelector("#app");
const gameWrap = document.querySelector(".game-wrap");
const touchControls = document.querySelector("#touchControls");
const stick = document.querySelector("#stick");
const knob = document.querySelector("#knob");
const btnKick = document.querySelector("#btnKick");
const btnSprint = document.querySelector("#btnSprint");
const btnStart = document.querySelector("#btnStart");
const btnSelect = document.querySelector("#btnSelect");
const DEBUG = new URLSearchParams(window.location.search).get("debug") === "1";
const CORE_KIND = "cpp";
const WASM_NES_APU_ENABLED = new URLSearchParams(window.location.search).get("audio") !== "synth";
const BUILD_ID = "cpp-only-core-20260720";
document.body.classList.toggle("debug", DEBUG);
stats.hidden = !DEBUG;
function enforceControllerOutsideGame() {
  if (touchControls.parentElement !== app || touchControls.previousElementSibling !== gameWrap) {
    gameWrap.insertAdjacentElement("afterend", touchControls);
  }
  touchControls.dataset.surface = "outside-game";
  touchControls.style.setProperty("position", "static", "important");
  touchControls.style.setProperty("inset", "auto", "important");
  touchControls.style.setProperty("transform", "none", "important");
}
enforceControllerOutsideGame();
window.addEventListener("resize", enforceControllerOutsideGame, { passive: true });
window.addEventListener("orientationchange", enforceControllerOutsideGame, { passive: true });
const TOUCH_TAP_LATCH_SOFTWARE_FRAMES = 7;
const touch = {
  stickPointer: null,
  kickPointer: null,
  sprintPointer: null,
  startPointer: null,
  selectPointer: null,
  axisX: 0,
  axisY: 0,
  originX: 0,
  originY: 0,
  kick: false,
  sprint: false,
  start: false,
  select: false,
  kickLatchTicks: 0,
  sprintLatchTicks: 0,
  startLatchTicks: 0,
  selectLatchTicks: 0,
  lastBits: 0,
  lastPackedBits: 0,
};
const originalAssets = {
  chr: null,
  chrAlt: null,
  field: null,
  tileSize: 16,
  columns: 128,
  splash: {},
  menu: {},
  modeSelection: {
    manifest: null,
    tileImage: null,
    canvas: null,
    context: null,
    nametable: null,
    key: "",
    previousState: 0xff,
  },
  opponentSelection: {
    manifest: null,
    tileImage: null,
    canvas: null,
    context: null,
    key: "",
  },
  teamPreview: {
    manifest: null,
    canvas: null,
    context: null,
    key: "",
  },
  playerOrder: {
    manifest: null,
    tileImage: null,
    canvas: null,
    context: null,
    key: "",
  },
  credits: {
    manifest: null,
    tileImages: {},
    states: new Map(),
  },
  bracket: {
    manifest: null,
    scripts: null,
    tileImage: null,
    canvas: null,
    context: null,
    key: "",
  },
  matchSettings: {
    manifest: null,
    scripts: null,
    tileImage: null,
    canvas: null,
    context: null,
    key: "",
  },
  formationControl: {
    manifest: null,
    scripts: null,
    tileImage: null,
    canvas: null,
    context: null,
    key: "",
  },
  weatherPreview: {
    manifest: null,
    scripts: null,
    tileImage: null,
    canvas: null,
    context: null,
    key: "",
  },
  tournamentRecord: {
    manifest: null,
    scripts: null,
    tileImage: null,
    canvas: null,
    context: null,
    key: "",
  },
  playerProfile: {
    manifest: null,
    scripts: null,
    tileImage: null,
    canvas: null,
    context: null,
    key: "",
  },
  musicSelection: {
    manifest: null,
    scripts: null,
    tileImage: null,
    canvas: null,
    context: null,
    key: "",
  },
  meetingSecret: {
    manifest: null,
    scripts: null,
    tileImages: {},
    canvas: null,
    context: null,
    key: "",
  },
  statusbar: {
    manifest: null,
  },
  result: {
    manifest: null,
    scripts: null,
    canvas: null,
    context: null,
    key: "",
    appliedUpdates: 0,
    mode: 0,
    supporterFrame: 0,
    supporterPpuLo: 0x18,
    supporterPpuHi: 0x24,
    supporterSubframe: 0,
    tileCache: new Map(),
  },
  sprite: {
    manifest: null,
    palettes: null,
    indexImage: null,
    indexPixels: null,
    indexWidth: 0,
    tileCache: new Map(),
    backgroundTileCache: new Map(),
  },
};
const sfx = {
  ctx: null,
  lastEventSerial: 0,
  lastScore: "0-0",
  lastPhase: PHASE.TITLE,
  lastSpecial: 0,
  lastAction: ACTION.STAND,
  lastKeeper: 0,
};
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
async function loadJson(src) {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`failed to load ${src}: ${response.status}`);
  return response.json();
}
async function withFallback(label, primary, fallback, loader) {
  try {
    return await loader(primary);
  } catch (primaryError) {
    if (!fallback || fallback === primary) throw primaryError;
    console.warn(`primary asset failed for ${label}: ${primaryError.message}; retrying ${fallback}`);
    try {
      return await loader(fallback);
    } catch (fallbackError) {
      throw new Error(`${label}: ${primaryError.message}; fallback failed: ${fallbackError.message}`);
    }
  }
}
function assetUrl(path) {
  return new URL(path, import.meta.url).toString();
}
function rootAssetUrl(path) {
  return new URL(path, document.baseURI).toString();
}
function cacheBustedOriginalAssetUrl(url) {
  const resolved = new URL(url);
  resolved.searchParams.set("v", BUILD_ID);
  return resolved.toString();
}
function originalAssetUrl(name) {
  return cacheBustedOriginalAssetUrl(assetUrl(`../original/${name}`));
}
function originalFallbackUrl(name) {
  return cacheBustedOriginalAssetUrl(rootAssetUrl(`original/${name}`));
}
const wasmNesApu = new WasmNesApuAudioAdapter({
  enabled: WASM_NES_APU_ENABLED,
});
wasmNesApu.prepare();
if (DEBUG) {
  window.__soccerAudio = () => wasmNesApu.snapshot();
  window.__soccerAudioAdapter = wasmNesApu;
}
window.addEventListener("keydown", (event) => {
  ensureAudio();
  if (event.code === "KeyR" && !event.repeat) resetRequested = true;
  keys.add(event.code);
  if (event.code === "KeyJ" || event.code === "KeyZ") {
    if (!keys.has("KeyK") && !keys.has("KeyX")) keyTapLatch.sprint = 0;
    keyTapLatch.kick = TOUCH_TAP_LATCH_SOFTWARE_FRAMES;
  }
  if (event.code === "KeyK" || event.code === "KeyX") {
    if (!keys.has("KeyJ") && !keys.has("KeyZ")) keyTapLatch.kick = 0;
    keyTapLatch.sprint = TOUCH_TAP_LATCH_SOFTWARE_FRAMES;
  }
  if (event.code === "Enter" || event.code === "Space") keyTapLatch.start = TOUCH_TAP_LATCH_SOFTWARE_FRAMES;
  if (event.code === "ShiftLeft" || event.code === "ShiftRight") keyTapLatch.select = TOUCH_TAP_LATCH_SOFTWARE_FRAMES;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
});
window.addEventListener("keyup", (event) => keys.delete(event.code));
function safeSetPointerCapture(element, pointerId) {
  try {
    element.setPointerCapture?.(pointerId);
  } catch (_err) {
  }
}
function setTouchButton(button, prop) {
  const latchProp = `${prop}LatchTicks`;
  const pointerProp = `${prop}Pointer`;
  const activate = () => {
    ensureAudio();
    if (prop === "kick" && !touch.sprint) touch.sprintLatchTicks = 0;
    if (prop === "sprint" && !touch.kick) touch.kickLatchTicks = 0;
    touch[prop] = true;
    touch[latchProp] = TOUCH_TAP_LATCH_SOFTWARE_FRAMES;
    button.classList.add("active");
  };
  const deactivate = () => {
    touch[prop] = false;
    button.classList.remove("active");
  };
  const down = (event) => {
    event.preventDefault();
    touch[pointerProp] = event.pointerId;
    safeSetPointerCapture(button, event.pointerId);
    activate();
  };
  const up = (event) => {
    event.preventDefault();
    touch[pointerProp] = null;
    deactivate();
  };
  button.addEventListener("pointerdown", down);
  button.addEventListener("pointerup", up);
  button.addEventListener("pointercancel", up);
  button.addEventListener("lostpointercapture", (event) => {
    if (event.pointerType === "touch") return;
    up(event);
  });
  for (const name of ["pointerup", "pointercancel"]) {
    window.addEventListener(name, (event) => {
      if (touch[pointerProp] === event.pointerId) up(event);
    });
  }
  button.addEventListener("touchstart", (event) => { event.preventDefault(); activate(); }, { passive: false });
  button.addEventListener("touchend", (event) => { event.preventDefault(); deactivate(); }, { passive: false });
  button.addEventListener("touchcancel", (event) => { event.preventDefault(); deactivate(); }, { passive: false });
}
setTouchButton(btnKick, "kick");
setTouchButton(btnSprint, "sprint");
setTouchButton(btnStart, "start");
setTouchButton(btnSelect, "select");
function ensureAudio() {
  if (sfx.ctx) {
    if (sfx.ctx.state === "suspended") sfx.ctx.resume?.();
    wasmNesApu.attachAudioContext(sfx.ctx);
    return sfx.ctx;
  }
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  sfx.ctx = new AudioCtor();
  wasmNesApu.attachAudioContext(sfx.ctx);
  return sfx.ctx;
}
function tone(freq, duration = 0.08, type = "square", gain = 0.045, delay = 0) {
  const ctx = sfx.ctx;
  if (!ctx || ctx.state === "suspended") return;
  const now = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  amp.gain.setValueAtTime(0.0001, now);
  amp.gain.exponentialRampToValueAtTime(gain, now + 0.006);
  amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(amp).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}
function noise(duration = 0.06, gain = 0.035, delay = 0) {
  const ctx = sfx.ctx;
  if (!ctx || ctx.state === "suspended") return;
  const samples = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < samples; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / samples);
  const src = ctx.createBufferSource();
  const amp = ctx.createGain();
  src.buffer = buffer;
  amp.gain.value = gain;
  src.connect(amp).connect(ctx.destination);
  src.start(ctx.currentTime + delay);
}
function playSfx(name) {
  if (!sfx.ctx || sfx.ctx.state === "suspended") return;
  if (name === "kick") { tone(190, 0.045, "square", 0.035); noise(0.035, 0.018); }
  if (name === "tackle") { noise(0.11, 0.045); tone(95, 0.08, "sawtooth", 0.025); }
  if (name === "special") { tone(330, 0.07, "square", 0.04); tone(660, 0.09, "square", 0.035, 0.055); tone(990, 0.08, "triangle", 0.03, 0.12); }
  if (name === "keeper") { tone(150, 0.06, "triangle", 0.04); noise(0.05, 0.025, 0.02); }
  if (name === "whistle") { tone(1350, 0.12, "square", 0.028); tone(1750, 0.08, "square", 0.022, 0.10); }
  if (name === "goal") { tone(523, 0.10, "square", 0.045); tone(659, 0.10, "square", 0.045, 0.10); tone(784, 0.18, "square", 0.05, 0.20); noise(0.22, 0.025, 0.06); }
  if (name === "jump") { tone(260, 0.055, "square", 0.025); tone(390, 0.05, "square", 0.022, 0.035); }
  if (name === "land") { noise(0.045, 0.022); tone(80, 0.045, "triangle", 0.025); }
  if (name === "cursor") { tone(720, 0.025, "square", 0.018); }
  if (name === "confirm") { tone(520, 0.045, "square", 0.022); tone(780, 0.055, "square", 0.022, 0.035); }
  if (name === "reject") { tone(190, 0.06, "sawtooth", 0.025); tone(140, 0.08, "sawtooth", 0.02, 0.045); }
  if (name === "text") { tone(880, 0.018, "square", 0.012); }
  if (name === "wind") { noise(0.16, 0.018); tone(110, 0.13, "triangle", 0.012); }
  if (name === "phone") { tone(440, 0.08, "square", 0.018); tone(660, 0.08, "square", 0.016, 0.09); }
}
function playOriginalSoundEvent(soundId) {
  if ([0x20, 0x22, 0x29].includes(soundId)) return playSfx("kick");
  if ([0x23, 0x26, 0x27].includes(soundId)) return playSfx("keeper");
  if (soundId === 0x24) return playSfx("kick");
  if ([0x28, 0x2A, 0x37, 0x38, 0x39, 0x3C, 0x3E, 0x43, 0x45, 0x46].includes(soundId)) return playSfx("special");
  if (soundId === 0x2B) return playSfx("jump");
  if ([0x2C, 0x3D].includes(soundId)) return playSfx("land");
  if ([0x2D, 0x31, 0x40].includes(soundId)) return playSfx("whistle");
  if (soundId === 0x2E) return playSfx("goal");
  if (soundId === 0x32) return playSfx("cursor");
  if (soundId === 0x33) return playSfx("confirm");
  if (soundId === 0x34) return playSfx("reject");
  if (soundId === 0x35) return playSfx("text");
  if ([0x36, 0x3B].includes(soundId)) return playSfx("tackle");
  if (soundId === 0x41) return playSfx("wind");
  if ([0x44, 0x47, 0x48, 0x49, 0x4A, 0x4B, 0x4C, 0x4D, 0x4E].includes(soundId)) return playSfx("phone");
}
function drainOriginalSoundEvents(api, consume) {
  if (api.original_sound_event_serial && api.original_sound_event) {
    const current = api.original_sound_event_serial() >>> 0;
    let previous = sfx.lastEventSerial >>> 0;
    if (current < previous) previous = 0;
    if (current - previous > 16) previous = current - 16;
    for (let serial = previous + 1; serial <= current; serial++) {
      const soundId = api.original_sound_event(serial >>> 0) & 0xFF;
      if (soundId !== 0xFF) consume(soundId);
    }
    sfx.lastEventSerial = current;
    return true;
  }
  return false;
}
function updateSfx(api) {
  if (wasmNesApu.claimsAudio) {
    drainOriginalSoundEvents(api, (soundId) => wasmNesApu.handleSoundEvent(soundId));
    return;
  }
  if (!sfx.ctx || sfx.ctx.state === "suspended") return;
  if (drainOriginalSoundEvents(api, playOriginalSoundEvent)) {
    return;
  }
  const score = `${api.score_left()}-${api.score_right()}`;
  const phase = api.game_phase ? api.game_phase() : PHASE.PLAYING;
  const action = api.player_action ? api.player_action(api.controlled_player ? api.controlled_player() : 0) : ACTION.STAND;
  const special = api.ball_special_timer ? api.ball_special_timer() : 0;
  const keeper = api.keeper_outcome ? api.keeper_outcome() : 0;
  if (score !== sfx.lastScore) playSfx("goal");
  else if (phase !== sfx.lastPhase && [PHASE.KICKOFF, PHASE.FREE_KICK, PHASE.PENALTY_KICK, PHASE.THROW_IN, PHASE.GOAL_KICK, PHASE.CORNER_KICK].includes(phase)) playSfx("whistle");
  if (special > 0 && sfx.lastSpecial === 0) playSfx("special");
  if (action === ACTION.KICK && sfx.lastAction !== ACTION.KICK) playSfx("kick");
  if (action === ACTION.TACKLE && sfx.lastAction !== ACTION.TACKLE) playSfx("tackle");
  if (keeper > 0 && sfx.lastKeeper === 0) playSfx("keeper");
  sfx.lastScore = score;
  sfx.lastPhase = phase;
  sfx.lastSpecial = special;
  sfx.lastAction = action;
  sfx.lastKeeper = keeper;
}
function resetStick() {
  touch.stickPointer = null;
  touch.axisX = 0;
  touch.axisY = 0;
  touch.originX = 0;
  touch.originY = 0;
  knob.style.transform = "translate(-50%, -50%)";
}
function eventClientPoint(event) {
  const scrollX = window.scrollX || window.pageXOffset || 0;
  const scrollY = window.scrollY || window.pageYOffset || 0;
  return {
    x: Number.isFinite(event.clientX) ? event.clientX : ((event.pageX || 0) - scrollX),
    y: Number.isFinite(event.clientY) ? event.clientY : ((event.pageY || 0) - scrollY),
  };
}
function updateStick(event) {
  const rect = stick.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const max = rect.width * 0.34;
  const point = eventClientPoint(event);
  let dx = point.x - cx;
  let dy = point.y - cy;
  const len = Math.hypot(dx, dy);
  if (len > max) { dx = dx / len * max; dy = dy / len * max; }
  const fixedAxisX = Math.abs(dx) < max * 0.16 ? 0 : Math.sign(dx);
  const fixedAxisY = Math.abs(dy) < max * 0.16 ? 0 : Math.sign(dy);
  const relDx = point.x - touch.originX;
  const relDy = point.y - touch.originY;
  const relDead = Math.max(10, rect.width * 0.08);
  const relAxisX = Math.abs(relDx) < relDead ? 0 : Math.sign(relDx);
  const relAxisY = Math.abs(relDy) < relDead ? 0 : Math.sign(relDy);
  const useRelativeDrag = Math.abs(relDx) >= relDead || Math.abs(relDy) >= relDead;
  touch.axisX = useRelativeDrag ? relAxisX : fixedAxisX;
  touch.axisY = useRelativeDrag ? relAxisY : fixedAxisY;
  knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
}
function shouldStartFallbackStick(target, clientX, clientY) {
  if (target?.closest?.(".touch-btn")) return false;
  if (target?.closest?.("#stick")) return true;
  const panelRect = touchControls.getBoundingClientRect();
  const stickRect = stick.getBoundingClientRect();
  const pad = Math.max(24, stickRect.width * 0.20);
  const inControllerPanel =
    clientX >= panelRect.left && clientX <= panelRect.right &&
    clientY >= panelRect.top && clientY <= panelRect.bottom;
  const inExpandedStick =
    clientX >= stickRect.left - pad && clientX <= stickRect.right + pad &&
    clientY >= stickRect.top - pad && clientY <= stickRect.bottom + pad;
  const inLeftControllerArea = clientX <= panelRect.left + panelRect.width * 0.48;
  return inControllerPanel && (inExpandedStick || inLeftControllerArea);
}
function beginStickPointer(event, captureElement = stick) {
  event.preventDefault();
  ensureAudio();
  if (touch.stickPointer !== null && touch.stickPointer !== event.pointerId) resetStick();
  touch.stickPointer = event.pointerId;
  const point = eventClientPoint(event);
  touch.originX = point.x;
  touch.originY = point.y;
  safeSetPointerCapture(captureElement, event.pointerId);
  updateStick(event);
}
stick.addEventListener("pointerdown", (event) => {
  beginStickPointer(event, stick);
});
stick.addEventListener("pointermove", (event) => {
  if (touch.stickPointer === event.pointerId) { event.preventDefault(); updateStick(event); }
});
touchControls.addEventListener("pointerdown", (event) => {
  if (!shouldStartFallbackStick(event.target, event.clientX, event.clientY)) return;
  beginStickPointer(event, touchControls);
});
touchControls.addEventListener("pointermove", (event) => {
  if (touch.stickPointer === event.pointerId) { event.preventDefault(); updateStick(event); }
});
window.addEventListener("pointermove", (event) => {
  if (touch.stickPointer === event.pointerId) { event.preventDefault(); updateStick(event); }
});
for (const name of ["pointerup", "pointercancel"]) {
  window.addEventListener(name, (event) => {
    if (touch.stickPointer === event.pointerId) {
      event.preventDefault();
      resetStick();
    }
  });
}
for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
  stick.addEventListener(name, (event) => {
    if (name === "lostpointercapture" && event.pointerType === "touch") return;
    if (touch.stickPointer === event.pointerId || (name === "lostpointercapture" && typeof touch.stickPointer !== "string")) {
      event.preventDefault();
      resetStick();
    }
  });
}
function touchPointEvent(point) {
  return { clientX: point.clientX, clientY: point.clientY, pageX: point.pageX, pageY: point.pageY };
}
function eachChangedTouch(event, callback) {
  const touches = event.changedTouches;
  if (!touches) return false;
  for (let i = 0; i < touches.length; i += 1) {
    const point = touches.item ? touches.item(i) : touches[i];
    if (point && callback(point) === true) return true;
  }
  return false;
}
function beginStickTouch(event, point) {
  event.preventDefault();
  ensureAudio();
  if (touch.stickPointer !== null && touch.stickPointer !== `touch:${point.identifier}`) resetStick();
  touch.stickPointer = `touch:${point.identifier}`;
  touch.originX = Number.isFinite(point.clientX) ? point.clientX : (point.pageX || 0) - (window.scrollX || window.pageXOffset || 0);
  touch.originY = Number.isFinite(point.clientY) ? point.clientY : (point.pageY || 0) - (window.scrollY || window.pageYOffset || 0);
  updateStick(touchPointEvent(point));
}
stick.addEventListener("touchstart", (event) => {
  const point = event.changedTouches[0];
  if (!point) return;
  beginStickTouch(event, point);
}, { passive: false });
touchControls.addEventListener("touchstart", (event) => {
  eachChangedTouch(event, (point) => {
    if (!shouldStartFallbackStick(event.target, point.clientX, point.clientY)) return false;
    beginStickTouch(event, point);
    return true;
  });
}, { passive: false });
function moveStickTouch(event) {
  if (typeof touch.stickPointer !== "string" || !touch.stickPointer.startsWith("touch:")) return;
  const id = Number(touch.stickPointer.slice(6));
  eachChangedTouch(event, (point) => {
    if (point.identifier === id) {
      event.preventDefault();
      updateStick(touchPointEvent(point));
      return true;
    }
    return false;
  });
}
for (const element of [stick, touchControls, document, window]) {
  element.addEventListener("touchmove", moveStickTouch, { passive: false, capture: true });
}
function endStickTouch(event) {
  if (typeof touch.stickPointer !== "string" || !touch.stickPointer.startsWith("touch:")) return;
  const id = Number(touch.stickPointer.slice(6));
  eachChangedTouch(event, (point) => {
    if (point.identifier === id) {
      event.preventDefault();
      resetStick();
      return true;
    }
    return false;
  });
}
for (const element of [stick, touchControls, document, window]) {
  element.addEventListener("touchend", endStickTouch, { passive: false, capture: true });
  element.addEventListener("touchcancel", endStickTouch, { passive: false, capture: true });
}
function inputBits() {
  let bits = 0;
  if (keys.has("ArrowUp") || keys.has("KeyW") || touch.axisY < 0) bits |= INPUT.UP;
  if (keys.has("ArrowDown") || keys.has("KeyS") || touch.axisY > 0) bits |= INPUT.DOWN;
  if (keys.has("ArrowLeft") || keys.has("KeyA") || touch.axisX < 0) bits |= INPUT.LEFT;
  if (keys.has("ArrowRight") || keys.has("KeyD") || touch.axisX > 0) bits |= INPUT.RIGHT;
  if (keys.has("KeyJ") || keys.has("KeyZ") || keyTapLatch.kick > 0 || touch.kick || touch.kickLatchTicks > 0) bits |= INPUT.KICK;
  if (keys.has("KeyK") || keys.has("KeyX") || keyTapLatch.sprint > 0 || touch.sprint || touch.sprintLatchTicks > 0) bits |= INPUT.SPRINT;
  if (keys.has("Enter") || keys.has("Space") || keyTapLatch.start > 0 || touch.start || touch.startLatchTicks > 0) bits |= INPUT.START;
  if (keys.has("ShiftLeft") || keys.has("ShiftRight") || keyTapLatch.select > 0 || touch.select || touch.selectLatchTicks > 0) bits |= INPUT.SELECT;
  touch.lastBits = bits;
  const pads = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
  let packed = bits & 0xFF;
  for (let slot = 0; slot < 4; slot += 1) {
    const pad = pads?.[slot];
    if (!pad || pad.connected === false) continue;
    const padBits = standardGamepadInputBits(pad);
    packed = (packed | ((padBits & 0xFF) << (slot * 8))) >>> 0;
  }
  touch.lastPackedBits = packed;
  return packed;
}
function gamepadButtonPressed(gamepad, index) {
  const button = gamepad?.buttons?.[index];
  if (typeof button === "number") return button > 0.5;
  return Boolean(button?.pressed || (button?.value ?? 0) > 0.5);
}
function standardGamepadInputBits(gamepad) {
  const axisX = Number(gamepad?.axes?.[0] ?? 0);
  const axisY = Number(gamepad?.axes?.[1] ?? 0);
  const threshold = 0.45;
  let bits = 0;
  if (gamepadButtonPressed(gamepad, 12) || axisY < -threshold) bits |= INPUT.UP;
  if (gamepadButtonPressed(gamepad, 13) || axisY > threshold) bits |= INPUT.DOWN;
  if (gamepadButtonPressed(gamepad, 14) || axisX < -threshold) bits |= INPUT.LEFT;
  if (gamepadButtonPressed(gamepad, 15) || axisX > threshold) bits |= INPUT.RIGHT;
  if (gamepadButtonPressed(gamepad, 0)) bits |= INPUT.KICK;
  if (gamepadButtonPressed(gamepad, 1)) bits |= INPUT.SPRINT;
  if (gamepadButtonPressed(gamepad, 9)) bits |= INPUT.START;
  if (gamepadButtonPressed(gamepad, 8)) bits |= INPUT.SELECT;
  return bits;
}
function consumeTapLatchesAfterSoftwareFrame() {
  if (touch.kickLatchTicks > 0) touch.kickLatchTicks -= 1;
  if (touch.sprintLatchTicks > 0) touch.sprintLatchTicks -= 1;
  if (touch.startLatchTicks > 0) touch.startLatchTicks -= 1;
  if (touch.selectLatchTicks > 0) touch.selectLatchTicks -= 1;
  if (keyTapLatch.kick > 0) keyTapLatch.kick -= 1;
  if (keyTapLatch.sprint > 0) keyTapLatch.sprint -= 1;
  if (keyTapLatch.start > 0) keyTapLatch.start -= 1;
  if (keyTapLatch.select > 0) keyTapLatch.select -= 1;
}
function fnv1aBytes(bytes) {
  let value = 0x811c9dc5;
  for (const byte of bytes) {
    value ^= byte;
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value >>> 0;
}
function fnv1aText(text) {
  return fnv1aBytes(new TextEncoder().encode(text));
}
async function fetchCoreResponse(label, primary, fallback) {
  return withFallback(label, primary, fallback, (url) => fetch(url).then((r) => {
    if (!r.ok) throw new Error(`failed to load ${url}: ${r.status}`);
    return r;
  }));
}
async function loadCppCoreData(api) {
  if (!api.cpp_asset_reset || !api.cpp_asset_reserve || !api.cpp_asset_commit || !api.memory) {
    throw new Error("C++ core does not expose the external BIN resource ABI");
  }
  const manifestResponse = await fetchCoreResponse(
    "core-data/manifest.json",
    assetUrl("../core-data/manifest.json"),
    rootAssetUrl("core-data/manifest.json"),
  );
  const manifest = await manifestResponse.json();
  if (manifest.schema !== 1 || !Array.isArray(manifest.records)) {
    throw new Error("unsupported C++ core-data manifest");
  }
  api.cpp_asset_reset();
  let cursor = 0;
  let loadedBytes = 0;
  const workers = Array.from({ length: Math.min(12, manifest.records.length) }, async () => {
    while (cursor < manifest.records.length) {
      const record = manifest.records[cursor++];
      const response = await fetchCoreResponse(
        record.path,
        assetUrl(`../core-data/${record.path}`),
        rootAssetUrl(`core-data/${record.path}`),
      );
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== record.length) {
        throw new Error(`${record.path}: got ${bytes.byteLength} bytes, expected ${record.length}`);
      }
      const assetId = fnv1aText(record.path);
      const pointer = api.cpp_asset_reserve(assetId, bytes.byteLength) >>> 0;
      if (!pointer) throw new Error(`C++ core rejected BIN resource ${record.path}`);
      new Uint8Array(api.memory.buffer, pointer, bytes.byteLength).set(bytes);
      if (api.cpp_asset_commit(assetId, bytes.byteLength) !== 1) {
        throw new Error(`C++ core failed to commit BIN resource ${record.path}`);
      }
      if ((api.cpp_asset_checksum(assetId) >>> 0) !== fnv1aBytes(bytes)) {
        throw new Error(`C++ core checksum mismatch for ${record.path}`);
      }
      loadedBytes += bytes.byteLength;
    }
  });
  await Promise.all(workers);
  if (api.cpp_asset_loaded_count() !== manifest.records.length
      || api.cpp_asset_loaded_bytes() !== loadedBytes) {
    throw new Error("C++ core did not commit the complete external BIN resource set");
  }
  return { count: manifest.records.length, bytes: loadedBytes };
}
async function loadWasm() {
  const filename = "soccer_core_cpp.wasm";
  const relative = "../soccer_core_cpp.1e3009a3.wasm";
  const response = await fetchCoreResponse(filename, assetUrl(relative), rootAssetUrl(filename));
  const bytes = await response.arrayBuffer();
  const result = await WebAssembly.instantiate(bytes, {});
  const loaded = await loadCppCoreData(result.instance.exports);
  document.body.dataset.core = CORE_KIND;
  document.body.dataset.coreAssets = String(loaded.count);
  return result.instance.exports;
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
const ORIGINAL_CAMERA_VIEW_W = 0x100;
const ORIGINAL_CAMERA_VIEW_H = 0xB0;
const ORIGINAL_CAMERA_BASE_Y = 0x48;
const ORIGINAL_STATUSBAR_SPLIT_Y = 0xB9;
function synchronizeOriginalFieldFootprints(api, originalScreen) {
  const field = originalAssets.field;
  if (!field?.manifest || !api.original_footprint_commit_serial) return;
  if (originalScreen !== 0) {
    if (field.footprintActive) {
      field.footprintActive = false;
      field.footprints.clear();
      field.compositeKey = "";
      field.footprintBaseKey = "";
    }
    return;
  }
  if (!field.footprintActive) {
    field.footprintActive = true;
    field.footprints.clear();
    field.compositeKey = "";
    field.footprintBaseKey = "";
  }
  const serial = api.original_footprint_commit_serial() >>> 0;
  if (field.footprintSerial === serial) return;
  field.footprintSerial = serial;
  const count = Math.min(api.original_committed_footprint_count?.() || 0, 4);
  for (let index = 0; index < count; index++) {
    const x = api.original_committed_footprint_world_x(index) & 0xFFFF;
    const y = api.original_committed_footprint_world_y(index) & 0xFFFF;
    field.footprints.set(`${x >> 3}/${y >> 3}`, { x, y });
  }
  if (count) field.compositeKey = "";
}
function originalFieldSubpalettes(fieldColor) {
  const paletteData = originalAssets.sprite.palettes;
  const base = paletteData?.background_pairs?.[fieldColor & 0xFF];
  const fixed = paletteData?.background_pairs?.[0x0F];
  if (!base || !fixed) return null;
  const palettes = [base[0].slice(), base[1].slice(), fixed[0].slice(), fixed[1].slice()];
  const universal = palettes[0][0];
  for (const palette of palettes) palette[0] = universal;
  return palettes;
}
function drawOriginalFieldFootprints(api, fieldContext, coverage, fieldColor, puddleSet) {
  const field = originalAssets.field;
  if (!field?.footprints?.size) return;
  const manifest = field.manifest;
  const assetScale = manifest.scale || 1;
  const mapTileWidth = manifest.logical_width >> 3;
  const palettes = originalFieldSubpalettes(fieldColor);
  if (!palettes) return;
  const fieldBank = api.original_field_bg_bank
    ? (api.original_field_bg_bank() & 0xFF) || (manifest.default_field_bank & 0xFF)
    : manifest.default_field_bank & 0xFF;
  const fieldPrgBank = api.original_field_prg_bank
    ? (api.original_field_prg_bank() & 0xFF) || (manifest.default_prg_bank & 0xFF)
    : manifest.default_prg_bank & 0xFF;
  for (const footprint of field.footprints.values()) {
    const tileX = footprint.x >> 3;
    const tileY = footprint.y >> 3;
    if (tileX < 0 || tileX >= mapTileWidth || tileY < 0 || tileY >= (manifest.logical_height >> 3)) continue;
    const sector = (footprint.y < manifest.top_height ? 0 : 4)
      + Math.min(3, Math.max(0, Math.floor(footprint.x / manifest.sector_width)));
    const variant = Math.min(coverage + (((puddleSet >> sector) & 1) ? 1 : 0), 2);
    const slots = manifest.prg_variants?.[String(fieldPrgBank)]?.[String(variant)]?.palette_slots
      || manifest.variants?.[String(variant)]?.palette_slots;
    const paletteSlot = slots?.[tileY * mapTileWidth + tileX] ?? 0;
    const highBankOffset = footprint.x < manifest.sector_width * 2 ? 0x04 : 0x02;
    const tile = originalBackgroundTile(
      fieldBank,
      (fieldBank + highBankOffset) & 0xFF,
      0xFF,
      palettes[paletteSlot & 3],
    );
    if (!tile) continue;
    fieldContext.drawImage(
      tile,
      footprint.x * assetScale,
      footprint.y * assetScale,
      8 * assetScale,
      8 * assetScale,
    );
  }
}
function composeOriginalField(api) {
  const field = originalAssets.field;
  if (!field?.manifest) return null;
  const coverage = clamp(api.original_field_puddle_coverage ? api.original_field_puddle_coverage() : 0, 0, 2);
  const fieldColor = clamp(api.original_field_color ? api.original_field_color() : 0, 0, 4);
  const puddleSet = api.original_puddle_set ? api.original_puddle_set() & 0xFF : 0;
  const fieldPrgBank = api.original_field_prg_bank
    ? (api.original_field_prg_bank() & 0xFF) || (field.manifest.default_prg_bank & 0xFF)
    : field.manifest.default_prg_bank & 0xFF;
  const fieldBank = api.original_field_bg_bank
    ? (api.original_field_bg_bank() & 0xFF) || (field.manifest.default_field_bank & 0xFF)
    : field.manifest.default_field_bank & 0xFF;
  const key = `${fieldPrgBank}/${fieldBank}/${coverage}/${fieldColor}/${puddleSet}`;
  if (field.footprintBaseKey && field.footprintBaseKey !== key) {
    field.footprints.clear();
  }
  field.footprintBaseKey = key;
  if (field.compositeKey === key && field.composite) return field.composite;
  const base = field.images[`${fieldPrgBank}/${fieldBank}/${coverage}/${fieldColor}`]
    || field.images[String(coverage)]?.[String(fieldColor)];
  if (!base) return null;
  if (!field.composite) {
    field.composite = document.createElement("canvas");
    field.compositeContext = field.composite.getContext("2d");
  }
  field.composite.width = base.naturalWidth || base.width;
  field.composite.height = base.naturalHeight || base.height;
  const fieldContext = field.compositeContext;
  fieldContext.imageSmoothingEnabled = false;
  fieldContext.clearRect(0, 0, field.composite.width, field.composite.height);
  fieldContext.drawImage(base, 0, 0);
  const wetVariant = Math.min(coverage + 1, 2);
  const wet = field.images[`${fieldPrgBank}/${fieldBank}/${wetVariant}/${fieldColor}`]
    || field.images[String(wetVariant)]?.[String(fieldColor)];
  if (wet && wetVariant !== coverage && puddleSet) {
    const assetScale = field.manifest.scale || 1;
    const sectorWidth = field.manifest.sector_width * assetScale;
    const topHeight = field.manifest.top_height * assetScale;
    const bottomHeight = field.manifest.bottom_height * assetScale;
    for (let sector = 0; sector < 8; sector++) {
      if ((puddleSet & (1 << sector)) === 0) continue;
      const column = sector & 3;
      const sourceX = column * sectorWidth;
      const sourceY = sector < 4 ? 0 : topHeight;
      const height = sector < 4 ? topHeight : bottomHeight;
      fieldContext.drawImage(wet, sourceX, sourceY, sectorWidth, height, sourceX, sourceY, sectorWidth, height);
    }
  }
  drawOriginalFieldFootprints(api, fieldContext, coverage, fieldColor, puddleSet);
  field.compositeKey = key;
  return field.composite;
}
function drawField(api, screenW, screenH, worldW = screenW, worldH = screenH, cameraX = null, cameraY = ORIGINAL_CAMERA_BASE_Y) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const img = composeOriginalField(api);
  if (img) {
    ctx.imageSmoothingEnabled = false;
    const manifest = originalAssets.field.manifest;
    const assetScale = manifest.scale || 1;
    const logicalWidth = manifest.logical_width;
    const logicalHeight = manifest.logical_height;
    const viewWidth = manifest.camera_width || ORIGINAL_CAMERA_VIEW_W;
    const viewHeight = manifest.camera_height || ORIGINAL_CAMERA_VIEW_H;
    const clampedCameraX = clamp(cameraX == null ? 0 : cameraX, 0, logicalWidth - viewWidth);
    const clampedCameraY = clamp(cameraY == null ? 0 : cameraY, 0, logicalHeight - viewHeight);
    const sourceX = clampedCameraX * assetScale;
    const sourceY = clampedCameraY * assetScale;
    const sourceW = viewWidth * assetScale;
    const sourceH = viewHeight * assetScale;
    if (originalFieldFullScreenActive(api)) {
      const layout = originalFullScreenLayout();
      const fieldHeight = ORIGINAL_STATUSBAR_SPLIT_Y;
      const clampedStatusCameraY = clamp(cameraY == null ? 0 : cameraY, 0, logicalHeight - fieldHeight);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, screenW, screenH);
      ctx.drawImage(
        img,
        sourceX, clampedStatusCameraY * assetScale, sourceW, fieldHeight * assetScale,
        layout.x, layout.y, layout.w, fieldHeight * layout.scale,
      );
      ctx.imageSmoothingEnabled = true;
      return {
        sourceX: clampedCameraX,
        sourceY: clampedStatusCameraY,
        sourceW: viewWidth,
        sourceH: fieldHeight,
        fullW: logicalWidth,
        fullH: logicalHeight,
        screenW,
        screenH,
        worldW,
        worldH,
        cameraX: clampedCameraX,
        cameraY: clampedStatusCameraY,
        destX: layout.x,
        destY: layout.y,
        destW: layout.w,
        destH: fieldHeight * layout.scale,
        logicalScale: layout.scale,
        verticalOffset: 0,
        original: true,
        statusbarLayout: layout,
      };
    }
    const targetAspect = viewWidth / viewHeight;
    let destW = screenW;
    let destH = destW / targetAspect;
    if (destH > screenH) {
      destH = screenH;
      destW = destH * targetAspect;
    }
    const destX = (screenW - destW) / 2;
    const destY = (screenH - destH) / 2;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, screenW, screenH);
    ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, destX, destY, destW, destH);
    ctx.imageSmoothingEnabled = true;
    return {
      sourceX: clampedCameraX,
      sourceY: clampedCameraY,
      sourceW: viewWidth,
      sourceH: viewHeight,
      fullW: logicalWidth,
      fullH: logicalHeight,
      screenW,
      screenH,
      worldW,
      worldH,
      cameraX: clampedCameraX,
      cameraY: clampedCameraY,
      destX,
      destY,
      destW,
      destH,
      logicalScale: destH / viewHeight,
      verticalOffset: 0,
      original: true,
    };
  }
  ctx.fillStyle = "#166f39";
  ctx.fillRect(0, 0, screenW, screenH);
  for (let x = 0; x < screenW; x += 80) {
    ctx.fillStyle = x % 160 === 0 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.035)";
    ctx.fillRect(x, 0, 80, screenH);
  }
  ctx.strokeStyle = "rgba(255,255,255,.75)";
  ctx.lineWidth = 3;
  ctx.strokeRect(30, 30, screenW - 60, screenH - 60);
  ctx.beginPath(); ctx.moveTo(screenW / 2, 30); ctx.lineTo(screenW / 2, screenH - 30); ctx.stroke();
  ctx.beginPath(); ctx.arc(screenW / 2, screenH / 2, 72, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,.9)";
  ctx.strokeRect(0, screenH / 2 - 74, 30, 148);
  ctx.strokeRect(screenW - 30, screenH / 2 - 74, 30, 148);
  ctx.strokeStyle = "rgba(255,255,255,.65)";
  ctx.strokeRect(30, screenH / 2 - 82, 88, 164);
  ctx.strokeRect(screenW - 118, screenH / 2 - 82, 88, 164);
  return { sourceX: 0, sourceW: screenW, sourceH: screenH, fullW: screenW, fullH: screenH, screenW, screenH, worldW, worldH, cameraX, cameraY, verticalOffset: (ORIGINAL_CAMERA_BASE_Y - cameraY) / worldH * screenH, original: false };
}
async function loadOriginalFieldAssets() {
  const manifest = await withFallback(
    "field_manifest.json",
    originalAssetUrl("field_manifest.json"),
    originalFallbackUrl("field_manifest.json"),
    loadJson,
  );
  const images = {};
  const requests = [];
  for (const [key, fileOrPaletteFiles] of Object.entries(manifest.images || {})) {
    if (typeof fileOrPaletteFiles === "string") {
      requests.push(
        withFallback(fileOrPaletteFiles, originalAssetUrl(fileOrPaletteFiles), originalFallbackUrl(fileOrPaletteFiles), loadImage)
          .then((image) => { images[key] = image; }),
      );
    } else {
      images[key] = {};
      for (const [palette, fileName] of Object.entries(fileOrPaletteFiles)) {
        requests.push(
          withFallback(fileName, originalAssetUrl(fileName), originalFallbackUrl(fileName), loadImage)
            .then((image) => { images[key][palette] = image; }),
        );
      }
    }
  }
  await Promise.all(requests);
  return {
    manifest,
    images,
    composite: null,
    compositeContext: null,
    compositeKey: "",
    footprintBaseKey: "",
    footprintSerial: null,
    footprintActive: false,
    footprints: new Map(),
  };
}
function worldToScreen(view, x, y) {
  if (!view || !view.original) {
    return { x: x / view.worldW * view.screenW, y: y / view.worldH * view.screenH + (view.verticalOffset || 0) };
  }
  return {
    x: view.destX + (x - view.cameraX) * (view.destW / view.sourceW),
    y: view.destY + (y - view.cameraY) * (view.destH / view.sourceH),
  };
}
function originalCommittedObjectScreenBytes(api, objectIndex) {
  if (!originalCommittedSpriteFrameActive(api)
      || !api.original_committed_sprite_screen_x
      || !api.original_committed_sprite_screen_y
      || !api.original_committed_sprite_ground_y) return null;
  return {
    x: api.original_committed_sprite_screen_x(objectIndex) & 0xFF,
    y: api.original_committed_sprite_screen_y(objectIndex) & 0xFF,
    groundY: api.original_committed_sprite_ground_y(objectIndex) & 0xFF,
  };
}
function originalCommittedObjectCanvasPosition(api, objectIndex, view, ground = false) {
  const position = originalCommittedObjectScreenBytes(api, objectIndex);
  if (!position || !view?.original) return null;
  const scaleX = view.destW / view.sourceW;
  const scaleY = view.destH / view.sourceH;
  return {
    x: view.destX + position.x * scaleX,
    y: view.destY + (ground ? position.groundY : position.y) * scaleY,
    screenX: position.x,
    screenY: ground ? position.groundY : position.y,
  };
}
function originalCommittedCamera(api, copy = false) {
  if (!originalCommittedSpriteFrameActive(api)) return null;
  const prefix = copy ? "original_committed_copy_camera" : "original_committed_camera";
  const xLo = api[`${prefix}_x_lo`];
  const xHi = api[`${prefix}_x_hi`];
  const yLo = api[`${prefix}_y_lo`];
  const yHi = api[`${prefix}_y_hi`];
  if (!xLo || !xHi || !yLo || !yHi) return null;
  return {
    x: ((xHi() & 0xFF) << 8) | (xLo() & 0xFF),
    y: ((yHi() & 0xFF) << 8) | (yLo() & 0xFF),
  };
}
function originalPlayerPosition(api, index) {
  if (api.original_player_x_lo && api.original_player_x_hi && api.original_player_y_lo && api.original_player_y_hi) {
    return {
      x: (api.original_player_x_hi(index) << 8) | api.original_player_x_lo(index),
      y: (api.original_player_y_hi(index) << 8) | api.original_player_y_lo(index),
      z: api.original_player_z_lo && api.original_player_z_hi
        ? ((api.original_player_z_hi(index) << 8) | api.original_player_z_lo(index))
        : 0,
    };
  }
  return { x: api.player_x(index), y: api.player_y(index), z: 0 };
}
function originalBallPosition(api) {
  if (api.original_ball_x_lo && api.original_ball_x_hi && api.original_ball_y_lo && api.original_ball_y_hi) {
    return {
      x: (api.original_ball_x_hi() << 8) | api.original_ball_x_lo(),
      y: (api.original_ball_y_hi() << 8) | api.original_ball_y_lo(),
      z: api.original_ball_z_lo && api.original_ball_z_hi
        ? ((api.original_ball_z_hi() << 8) | api.original_ball_z_lo())
        : 0,
    };
  }
  return { x: api.ball_x(), y: api.ball_y(), z: api.ball_z ? api.ball_z() : 0 };
}
function originalFieldMarkerPosition(api, slot) {
  if (!api.original_field_marker_x_lo || !api.original_field_marker_x_hi
      || !api.original_field_marker_y_lo || !api.original_field_marker_y_hi) {
    return null;
  }
  return {
    x: (api.original_field_marker_x_hi(slot) << 8) | api.original_field_marker_x_lo(slot),
    y: (api.original_field_marker_y_hi(slot) << 8) | api.original_field_marker_y_lo(slot),
    z: api.original_field_marker_z_lo && api.original_field_marker_z_hi
      ? ((api.original_field_marker_z_hi(slot) << 8) | api.original_field_marker_z_lo(slot))
      : 0,
  };
}
function normalizeOriginalHeight(value) {
  return value >= 0 && value < 0x8000 ? value : 0;
}
function drawOriginalControlNumberMarker(api, view, playerPosition, screenPosition, slot = 0) {
  if (!view?.original) return;
  const relativeX = playerPosition.x - view.cameraX;
  const relativeY = playerPosition.y - view.cameraY;
  if (relativeX < 0x08 || relativeX >= 0x100 || relativeY < 0x18 || relativeY >= 0xE0) return;
  const scale = view.logicalScale || 1;
  const height = normalizeOriginalHeight(playerPosition.z);
  const manifest = originalAssets.sprite.manifest;
  const animation = 0x80 | (slot & 3);
  const tile = manifest?.specialGroup3Tiles?.[animation & 0x7F];
  if (!Number.isFinite(tile)) return;
  const paletteSlot = ((animation & 1) + 1) & 3;
  const paletteNumber = api.original_sprite_palette_number(paletteSlot) & 0xFF;
  const bankSlot = tile >> 6;
  const bankNumber = api.original_sprite_bank(bankSlot) & 0xFF;
  const tileCanvas = originalSpriteTile(bankNumber, tile & 0x3F, paletteNumber);
  if (!tileCanvas) return;
  drawOriginalSpriteTile(
    tileCanvas,
    screenPosition.x - 4 * scale,
    screenPosition.y - (height + 0x20 + 11) * scale,
    paletteSlot,
    scale,
  );
}
function originalMinimapStatusbarActive(api) {
  return (api.original_screen_number?.() & 0xFF) === 0x00
    && (api.original_statusbar_view?.() & 0x7F) === 0x06;
}
function originalFieldFullScreenActive(api) {
  return (api.original_screen_number?.() & 0xFF) === 0x00;
}
function originalStatusbarPlayerRecord(manifest, team, playerNumber) {
  const rawName = manifest.roster_name_tiles?.[team & 0x0F]?.[Math.min(playerNumber & 0xFF, 0x0B)]
    || [0xFF, 0xFF, 0xFF, 0xFF, 0xFF];
  const markers = new Array(5).fill(0xFA);
  const glyphs = new Array(5).fill(0xFF);
  for (let index = 0; index < 5; index++) {
    const raw = rawName[index] & 0xFF;
    if (raw < 0x50) {
      markers[index] = 0xFB;
      glyphs[index] = (raw + 0x80) & 0xFF;
    } else if (raw < 0x80) {
      markers[index] = 0xFC;
      glyphs[index] = (raw + 0x50) & 0xFF;
    } else {
      glyphs[index] = raw;
    }
  }
  const data = manifest.player_hud_data?.[team & 0x0F]?.[Math.min(playerNumber & 0xFF, 0x0B)]
    || [0, 0];
  return { markers, glyphs, data0: data[0] & 0xFF, data1: data[1] & 0xFF };
}
function composeOriginalMatchStatusbarTiles(api, manifest) {
  const tiles = manifest.base_tiles.map((row) => row.slice());
  if (api.original_hud_tile) {
    for (let index = 0; index < 6; index++) {
      tiles[1][13 + index] = api.original_hud_tile(5 - index) & 0xFF;
    }
  }
  const difficulty = api.original_difficulty_mode ? api.original_difficulty_mode() & 0xFF : 0;
  const substitution = api.original_substitution_counter ? api.original_substitution_counter() & 0xFF : 0;
  for (let side = 0; side < 2; side++) {
    const teamByte = api.original_team_number ? api.original_team_number(side) & 0xFF : side;
    let playerNumber;
    let controlObject;
    if (difficulty & 0x20) {
      if (((side ^ substitution) & 1) !== 0) {
        playerNumber = api.original_player_number ? api.original_player_number(0x0A + side) & 0xFF : 0;
        controlObject = 0x0A + side;
      } else {
        playerNumber = (substitution & 0x7F) >> 1;
        controlObject = substitution & 0x7F;
      }
    } else {
      playerNumber = api.original_player_number ? api.original_player_number(side) & 0xFF : 0;
      controlObject = side;
    }
    const record = originalStatusbarPlayerRecord(manifest, teamByte, playerNumber);
    const column = side === 0 ? 1 : 20;
    for (let index = 0; index < 5; index++) {
      tiles[0][column + index] = record.markers[index];
      tiles[1][column + index] = record.glyphs[index];
    }
    tiles[2][column] = difficulty & 0x20
      ? 0xFF
      : (teamByte & 0x80 ? 0x4C : 0x3E + side);
    tiles[2][column + 1] = record.data0;
    tiles[2][column + 2] = (record.data0 + 1) & 0xFF;
    const controlPosition = controlObject < 12 && api.original_player_control_position
      ? api.original_player_control_position(controlObject) & 0xFF : 0;
    const controlIndex = Math.min(6, (controlPosition & 0x30) >> 3);
    tiles[2][column + 3] = manifest.control_tiles[controlIndex] & 0xFF;
    tiles[2][column + 4] = manifest.control_tiles[controlIndex + 1] & 0xFF;
    if ((difficulty & 0x20) === 0) tiles[2][column + 5] = 0xDC;
    tiles[3][column + 1] = 0x0C;
    tiles[3][column + 2] = 0x0D;
    tiles[3][column + 3] = record.data1;
  }
  const copySideBuffer = (side, getter) => {
    if (!getter) return;
    const primaryColumn = side === 0 ? 1 : 20;
    const secondaryColumn = side === 0 ? 7 : 26;
    tiles[3][primaryColumn] = getter(0) & 0xFF;
    for (let index = 0; index < 5; index++) {
      tiles[4][primaryColumn + index] = getter(1 + index) & 0xFF;
      tiles[0][secondaryColumn + index] = getter(6 + index) & 0xFF;
      tiles[1][secondaryColumn + index] = getter(11 + index) & 0xFF;
      tiles[2][secondaryColumn + index] = getter(16 + index) & 0xFF;
      tiles[3][secondaryColumn + index] = getter(21 + index) & 0xFF;
      tiles[4][secondaryColumn + index] = getter(26 + index) & 0xFF;
    }
  };
  copySideBuffer(0, api.original_attribute_buffer
    ? (index) => api.original_attribute_buffer(index) : null);
  copySideBuffer(1, api.original_graphics_buffer
    ? (index) => api.original_graphics_buffer(index) : null);
  return tiles;
}
function originalStatusbarTilePalette(manifest, palettePair, row, column) {
  const attributeRow = Math.min(1, Math.floor(row / 4));
  const attribute = manifest.attribute_bytes[attributeRow * 8 + Math.floor(column / 4)] & 0xFF;
  const shift = (Math.floor((row & 3) / 2) * 4) + (Math.floor((column & 3) / 2) * 2);
  const paletteIndex = (attribute >> shift) & 3;
  return palettePair[Math.max(0, Math.min(1, paletteIndex - 2))] || palettePair[0];
}
function drawOriginalMatchStatusbar(api, view) {
  if (!view?.statusbarLayout || !originalMinimapStatusbarActive(api)) return false;
  const layout = view.statusbarLayout;
  const scale = layout.scale;
  const manifest = originalAssets.statusbar.manifest;
  if (!manifest?.base_tiles || !manifest?.attribute_bytes) return false;
  const palettes = originalAssets.sprite.palettes;
  const paletteNumber = api.original_background_palette_number
    ? api.original_background_palette_number(1) & 0xFF : 0x29;
  const palettePair = palettes?.background_pairs?.[paletteNumber];
  if (!palettePair?.[0]) return false;
  const teamByte = api.original_team_number ? api.original_team_number(1) & 0xFF : 0;
  const bank0 = teamByte & 0x40 ? 0x06 : 0x04;
  const bank1 = 0x02;
  const tiles = composeOriginalMatchStatusbarTiles(api, manifest);
  const panelLogicalY = ORIGINAL_STATUSBAR_SPLIT_Y;
  for (let row = 0; row < tiles.length; row++) {
    for (let column = 0; column < tiles[row].length; column++) {
      const palette = originalStatusbarTilePalette(manifest, palettePair, row, column);
      const tile = originalBackgroundTile(bank0, bank1, tiles[row][column], palette);
      if (!tile) continue;
      ctx.drawImage(
        tile,
        layout.x + column * 8 * scale,
        layout.y + (panelLogicalY + row * 8) * scale,
        8 * scale,
        8 * scale,
      );
    }
  }
  const markers = [];
  const committedCopyCamera = originalCommittedCamera(api, true);
  const copyCameraX = committedCopyCamera?.x ?? (api.original_copy_camera_x_lo && api.original_copy_camera_x_hi
    ? (api.original_copy_camera_x_hi() << 8) | api.original_copy_camera_x_lo() : 0);
  const copyCameraY = committedCopyCamera?.y ?? (api.original_copy_camera_y_lo && api.original_copy_camera_y_hi
    ? (api.original_copy_camera_y_hi() << 8) | api.original_copy_camera_y_lo() : 0);
  const markerCount = api.original_field_marker_count ? api.original_field_marker_count() : 0;
  for (let slot = 0; slot < markerCount; slot++) {
    const animation = api.original_field_marker_animation(slot) & 0xFF;
    const position = originalFieldMarkerPosition(api, slot);
    const visible = !api.original_field_marker_visibility
      || api.original_field_marker_visibility(slot) !== 0;
    if (!position || !visible || (animation & 0x7F) === 0x7F) continue;
    const committedPosition = originalCommittedObjectScreenBytes(api, 0x0E + slot);
    const logicalX = committedPosition ? committedPosition.x : position.x - copyCameraX;
    const logicalY = committedPosition ? committedPosition.y : position.y - copyCameraY;
    const surface = normalizeOriginalHeight(position.z) === 0 ? "statusbar" : "field";
    if (surface === "statusbar") {
      drawOriginalObject(
        api,
        0x0E + slot,
        layout.x + logicalX * scale,
        layout.y + logicalY * scale,
        scale,
      );
    }
    markers.push({
      object: 0x0E + slot,
      animation,
      motion: api.original_field_marker_motion ? api.original_field_marker_motion(slot) & 0xFF : 0,
      logicalX,
      logicalY,
      z: position.z,
      surface,
    });
  }
  if (DEBUG) {
    window.__soccerMinimap = {
      visible: true,
      view: api.original_statusbar_view() & 0xFF,
      bank0,
      bank1,
      paletteNumber,
      markers,
      fullHud: true,
      panel: { x: 0x60, y: panelLogicalY, width: 64, height: 48 },
      buffers: {
        left: Array.from({ length: 31 }, (_, index) => api.original_attribute_buffer(index) & 0xFF),
        right: Array.from({ length: 31 }, (_, index) => api.original_graphics_buffer(index) & 0xFF),
      },
    };
  }
  return true;
}
function drawCircle(x, y, r, fill, stroke = "rgba(0,0,0,.35)") {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = stroke; ctx.stroke();
}
function drawOriginalTile(tileIndex, x, y, size = 16, alt = false) {
  const img = alt ? originalAssets.chrAlt : originalAssets.chr;
  if (!img) return false;
  const ts = originalAssets.tileSize;
  const sx = (tileIndex % originalAssets.columns) * ts;
  const sy = Math.floor(tileIndex / originalAssets.columns) * ts;
  ctx.drawImage(img, sx, sy, ts, ts, x, y, size, size);
  return true;
}
function initializeOriginalSpritePixels() {
  const sprite = originalAssets.sprite;
  if (!sprite.indexImage) return;
  const canvas = document.createElement("canvas");
  canvas.width = sprite.indexImage.naturalWidth;
  canvas.height = sprite.indexImage.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = false;
  context.drawImage(sprite.indexImage, 0, 0);
  sprite.indexPixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  sprite.indexWidth = canvas.width;
  sprite.tileCache.clear();
  sprite.backgroundTileCache.clear();
}
function originalSignedByte(value) {
  const byte = value & 0xFF;
  return byte & 0x80 ? byte - 0x100 : byte;
}
function originalMirroredSpriteX(value) {
  const byte = value & 0xFF;
  return originalSignedByte(((byte ^ 0xFF) - 7) & 0xFF);
}
function originalSpriteTile(bankNumber, tileWithinBank, paletteNumber) {
  const sprite = originalAssets.sprite;
  const manifest = sprite.manifest;
  const paletteData = sprite.palettes;
  if (!manifest || !paletteData || !sprite.indexPixels) return null;
  const key = `${bankNumber & 0xFF}:${tileWithinBank & 0x3F}:${paletteNumber & 0xFF}`;
  const cached = sprite.tileCache.get(key);
  if (cached) return cached;
  const tileIndex = (bankNumber & 0xFF) * 64 + (tileWithinBank & 0x3F);
  if (tileIndex >= manifest.chr.tileCount) return null;
  const palette = paletteData.sprite[paletteNumber & 0xFF];
  if (!palette || palette.length < 4) return null;
  const nesRgb = paletteData.nes_rgb;
  const sourceX = (tileIndex % manifest.chr.columns) * manifest.chr.tileSize;
  const sourceY = Math.floor(tileIndex / manifest.chr.columns) * manifest.chr.tileSize;
  const tileCanvas = document.createElement("canvas");
  tileCanvas.width = 8;
  tileCanvas.height = 8;
  const tileContext = tileCanvas.getContext("2d");
  const image = tileContext.createImageData(8, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const sourceOffset = ((sourceY + y) * sprite.indexWidth + sourceX + x) * 4;
      const colorIndex = Math.round(sprite.indexPixels[sourceOffset] / 85) & 3;
      const destinationOffset = (y * 8 + x) * 4;
      const color = nesRgb[(palette[colorIndex] || 0) & 0x3F];
      image.data[destinationOffset] = color[0];
      image.data[destinationOffset + 1] = color[1];
      image.data[destinationOffset + 2] = color[2];
      image.data[destinationOffset + 3] = colorIndex === 0 ? 0 : 255;
    }
  }
  tileContext.putImageData(image, 0, 0);
  sprite.tileCache.set(key, tileCanvas);
  return tileCanvas;
}
function originalBackgroundTile(bank0, bank1, tileByte, palette) {
  const sprite = originalAssets.sprite;
  const manifest = sprite.manifest;
  const paletteData = sprite.palettes;
  if (!manifest || !paletteData || !sprite.indexPixels || !palette || palette.length < 4) return null;
  const tile = tileByte & 0xFF;
  const tileIndex = tile < 0x80
    ? (bank0 & 0xFE) * 64 + tile
    : (bank1 & 0xFE) * 64 + (tile - 0x80);
  if (tileIndex >= manifest.chr.tileCount) return null;
  const key = `${bank0 & 0xFE}:${bank1 & 0xFE}:${tile}:${palette.join("/")}`;
  const cached = sprite.backgroundTileCache.get(key);
  if (cached) return cached;
  const sourceX = (tileIndex % manifest.chr.columns) * manifest.chr.tileSize;
  const sourceY = Math.floor(tileIndex / manifest.chr.columns) * manifest.chr.tileSize;
  const tileCanvas = document.createElement("canvas");
  tileCanvas.width = 8;
  tileCanvas.height = 8;
  const tileContext = tileCanvas.getContext("2d");
  const image = tileContext.createImageData(8, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const sourceOffset = ((sourceY + y) * sprite.indexWidth + sourceX + x) * 4;
      const colorIndex = Math.round(sprite.indexPixels[sourceOffset] / 85) & 3;
      const destinationOffset = (y * 8 + x) * 4;
      const color = paletteData.nes_rgb[(palette[colorIndex] || 0) & 0x3F];
      image.data[destinationOffset] = color[0];
      image.data[destinationOffset + 1] = color[1];
      image.data[destinationOffset + 2] = color[2];
      image.data[destinationOffset + 3] = 255;
    }
  }
  tileContext.putImageData(image, 0, 0);
  sprite.backgroundTileCache.set(key, tileCanvas);
  return tileCanvas;
}
function originalBackgroundSubPalettes(palette0Number, palette1Number) {
  const pairs = originalAssets.sprite.palettes?.background_pairs;
  const first = pairs?.[palette0Number & 0xFF];
  const second = pairs?.[palette1Number & 0xFF];
  if (!first?.[0] || !first?.[1] || !second?.[0] || !second?.[1]) return null;
  const result = [first[0], first[1], second[0], second[1]].map((entry) => [...entry]);
  const universal = result[0][0];
  for (const entry of result) entry[0] = universal;
  return result;
}
function renderOriginalDynamicBackgroundNametable(context, nametable, bank0, bank1, subPalettes) {
  if (!subPalettes || nametable.length < 0x400) return false;
  const attributes = nametable.subarray(0x3C0, 0x400);
  context.clearRect(0, 0, 256, 240);
  context.imageSmoothingEnabled = false;
  for (let row = 0; row < 30; row++) {
    for (let column = 0; column < 32; column++) {
      const tileNumber = nametable[row * 32 + column] & 0xFF;
      const attribute = attributes[(row >> 2) * 8 + (column >> 2)] & 0xFF;
      const shift = ((row & 2) << 1) | (column & 2);
      const paletteSlot = (attribute >> shift) & 3;
      const tile = originalBackgroundTile(bank0, bank1, tileNumber, subPalettes[paletteSlot]);
      if (tile) context.drawImage(tile, column * 8, row * 8);
    }
  }
  return true;
}
function originalCommittedSpriteFrameActive(api) {
  return Boolean(api.original_committed_sprite_serial
    && api.original_committed_sprite_serial() !== 0);
}
function originalSpriteBankForObject(api, objectIndex, bankSlot) {
  const screen = api.original_screen_number ? api.original_screen_number() & 0xFF : 0;
  const subtype = api.original_screen_subtype ? api.original_screen_subtype() & 0x7F : 0;
  if (screen === 0x02 && subtype === 0x05
      && (bankSlot === 1 || bankSlot === 2) && api.original_object_work_0061) {
    return api.original_object_work_0061(bankSlot === 1 ? 5 : 6) & 0xFF;
  }
  if (objectIndex <= 0x0C && originalCommittedSpriteFrameActive(api)
      && api.original_committed_sprite_bank) {
    return api.original_committed_sprite_bank(bankSlot) & 0xFF;
  }
  return api.original_sprite_bank(bankSlot) & 0xFF;
}
function originalSpritePaletteForObject(api, objectIndex, paletteSlot) {
  if (objectIndex <= 0x0C && originalCommittedSpriteFrameActive(api)
      && api.original_committed_sprite_palette) {
    return api.original_committed_sprite_palette(paletteSlot) & 0xFF;
  }
  return api.original_sprite_palette_number(paletteSlot) & 0xFF;
}
function originalPlayerFaceForObject(api, objectIndex) {
  if (objectIndex < 0x0C && originalCommittedSpriteFrameActive(api)
      && api.original_committed_player_face) {
    return api.original_committed_player_face(objectIndex) & 0xFF;
  }
  return objectIndex < 0x0C && api.original_player_face
    ? api.original_player_face(objectIndex) & 0xFF : 0;
}
function originalObjectVisibleForCommittedFrame(api, objectIndex) {
  const screen = api.original_screen_number ? api.original_screen_number() & 0xFF : 0;
  if (screen === 0x02) {
    const animation = originalObjectAnimation(api, objectIndex);
    return Number.isFinite(animation) && (animation & 0x7F) !== 0x7F;
  }
  if (objectIndex <= 0x0C && originalCommittedSpriteFrameActive(api)
      && api.original_committed_sprite_visibility) {
    return (api.original_committed_sprite_visibility(objectIndex) & 0xFF) !== 0;
  }
  if (objectIndex === 0x0C) {
    return !api.original_ball_visibility_flag || api.original_ball_visibility_flag() !== 0;
  }
  return !api.original_visibility || api.original_visibility(objectIndex) !== 0;
}
function originalObjectAnimation(api, objectIndex) {
  if (objectIndex <= 0x0C && api.original_committed_sprite_animation
      && api.original_committed_sprite_serial
      && api.original_committed_sprite_serial() !== 0) {
    return api.original_committed_sprite_animation(objectIndex) & 0xFF;
  }
  if (objectIndex === 0x0C) {
    return api.original_ball_animation ? api.original_ball_animation() & 0xFF : null;
  }
  if (objectIndex >= 0x0E && objectIndex <= 0x12) {
    return api.original_field_marker_animation
      ? api.original_field_marker_animation(objectIndex - 0x0E) & 0xFF : null;
  }
  return api.original_player_animation ? api.original_player_animation(objectIndex) & 0xFF : null;
}
function resolveOriginalObjectFrame(api, objectIndex) {
  const manifest = originalAssets.sprite.manifest;
  if (!manifest || !api.original_object_work_0061) return null;
  const animation = originalObjectAnimation(api, objectIndex);
  if (!Number.isFinite(animation)) return null;
  const groupNumber = objectIndex <= 0x0C && api.original_committed_sprite_group
      && api.original_committed_sprite_serial
      && api.original_committed_sprite_serial() !== 0
    ? api.original_committed_sprite_group(objectIndex) & 0xFF
    : api.original_object_work_0061(objectIndex) & 0xFF;
  if (groupNumber === 3) {
    const index = animation & 0x7F;
    const tile = manifest.specialGroup3Tiles[index];
    return Number.isFinite(tile) ? { animation, groupNumber, specialTile: tile } : null;
  }
  const group = manifest.groups[groupNumber];
  const animationIndex = animation & 0x7F;
  if (!group || animationIndex >= group.length) return null;
  const frameAddress = group[animationIndex];
  const frame = manifest.frames[frameAddress.toString(16).toUpperCase().padStart(4, "0")];
  return frame ? { animation, groupNumber, frameAddress, frame } : null;
}
function drawOriginalSpriteTile(tileCanvas, x, y, attr, drawScale) {
  const size = 8 * drawScale;
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2);
  ctx.scale(attr & 0x40 ? -1 : 1, attr & 0x80 ? -1 : 1);
  ctx.drawImage(tileCanvas, -size / 2, -size / 2, size, size);
  ctx.restore();
}
function drawOriginalObject(api, objectIndex, x, y, displayScale = 2) {
  if (objectIndex <= 0x0C && !originalObjectVisibleForCommittedFrame(api, objectIndex)) {
    return false;
  }
  const resolved = resolveOriginalObjectFrame(api, objectIndex);
  const manifest = originalAssets.sprite.manifest;
  if (!resolved || !manifest) return false;
  const animation = resolved.animation;
  if (Number.isFinite(resolved.specialTile)) {
    const paletteSlot = ((animation & 1) + 1) & 3;
    const paletteNumber = originalSpritePaletteForObject(api, objectIndex, paletteSlot);
    const bankSlot = resolved.specialTile >> 6;
    const bankNumber = originalSpriteBankForObject(api, objectIndex, bankSlot);
    const tileCanvas = originalSpriteTile(bankNumber, resolved.specialTile & 0x3F, paletteNumber);
    if (!tileCanvas) return false;
    drawOriginalSpriteTile(tileCanvas, x - 4 * displayScale, y - 11 * displayScale, paletteSlot, displayScale);
    return true;
  }
  const objectPaletteSlot = manifest.objectPaletteSlots[objectIndex] || 0;
  const faceNumber = originalPlayerFaceForObject(api, objectIndex);
  const mirror = (animation & 0x80) === 0;
  for (let i = 0; i < resolved.frame.count; i++) {
    let tile = resolved.frame.tile[i] & 0xFF;
    if (tile < 6) {
      const faceIndex = faceNumber * 6 + tile;
      if (faceIndex < manifest.faceTiles.length) tile = manifest.faceTiles[faceIndex];
    }
    const attr = ((resolved.frame.attr[i] ^ (mirror ? 0x40 : 0)) | objectPaletteSlot) & 0xFF;
    const paletteSlot = attr & 3;
    const paletteNumber = originalSpritePaletteForObject(api, objectIndex, paletteSlot);
    const bankSlot = tile >> 6;
    const bankNumber = originalSpriteBankForObject(api, objectIndex, bankSlot);
    const tileCanvas = originalSpriteTile(bankNumber, tile & 0x3F, paletteNumber);
    if (!tileCanvas) continue;
    const offsetX = mirror ? originalMirroredSpriteX(resolved.frame.x[i]) : resolved.frame.x[i];
    const offsetY = resolved.frame.y[i];
    drawOriginalSpriteTile(
      tileCanvas,
      x + offsetX * displayScale,
      y + offsetY * displayScale,
      attr,
      displayScale,
    );
  }
  return true;
}
function drawOriginalBall(api, x, y, z = 0, displayScale = 2) {
  const visualY = y - z * displayScale;
  return drawOriginalObject(api, 0x0C, x, visualY, displayScale);
}
function drawOriginalObjectShadow(api, objectIndex, kind, x, y, displayScale = 2) {
  const tileNumber = kind === "state" ? 0xA1 : 0xB7;
  const paletteSlot = kind === "state" ? 1 : 0;
  const paletteNumber = originalSpritePaletteForObject(api, objectIndex, paletteSlot);
  const bankSlot = tileNumber >> 6;
  const bankNumber = originalSpriteBankForObject(api, objectIndex, bankSlot);
  const tileCanvas = originalSpriteTile(bankNumber, tileNumber & 0x3F, paletteNumber);
  if (!tileCanvas) return null;
  if (kind === "state") {
    drawOriginalSpriteTile(
      tileCanvas,
      x - 4 * displayScale,
      y - 8 * displayScale,
      0x01,
      displayScale,
    );
  } else {
    drawOriginalSpriteTile(
      tileCanvas,
      x - 8 * displayScale,
      y - 7 * displayScale,
      0x00,
      displayScale,
    );
    drawOriginalSpriteTile(
      tileCanvas,
      x,
      y - 7 * displayScale,
      0x40,
      displayScale,
    );
  }
  return { object: objectIndex, kind, tileNumber, paletteSlot, bankSlot, bankNumber };
}
function drawWeather(api, view, screenW, screenH) {
  if (view?.original) return;
  const weather = api.field_weather ? api.field_weather() : 0;
  const hazards = api.field_hazard_count ? api.field_hazard_count() : 0;
  for (let i = 0; i < hazards; i++) {
    const h = worldToScreen(view, api.field_hazard_x(i), api.field_hazard_y(i));
    if (weather === 1) {
      ctx.fillStyle = "rgba(70,130,190,.38)";
      ctx.beginPath(); ctx.ellipse(h.x, h.y, 28, 12, -0.15, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(180,220,255,.35)"; ctx.stroke();
    } else if (weather === 2) {
      ctx.fillStyle = "rgba(92,58,30,.42)";
      ctx.beginPath(); ctx.ellipse(h.x, h.y, 30, 14, 0.12, 0, Math.PI * 2); ctx.fill();
    } else if (weather === 3) {
      ctx.fillStyle = "rgba(230,245,255,.34)";
      ctx.beginPath(); ctx.ellipse(h.x, h.y, 32, 16, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  if (weather === 1 || weather === 3) {
    ctx.save();
    ctx.strokeStyle = weather === 1 ? "rgba(160,205,255,.28)" : "rgba(255,255,255,.55)";
    ctx.lineWidth = weather === 1 ? 1 : 2;
    const tick = api.game_tick_count ? api.game_tick_count() : 0;
    for (let i = 0; i < 36; i++) {
      const x = (i * 83 + tick * (weather === 1 ? 5 : 1)) % screenW;
      const y = (i * 47 + tick * (weather === 1 ? 9 : 2)) % screenH;
      ctx.beginPath();
      if (weather === 1) { ctx.moveTo(x, y); ctx.lineTo(x - 8, y + 18); }
      else { ctx.moveTo(x, y); ctx.lineTo(x + 1, y + 1); }
      ctx.stroke();
    }
    ctx.restore();
  }
  if (weather === 4) {
    ctx.save();
    ctx.strokeStyle = "rgba(230,245,255,.22)";
    const tick = api.game_tick_count ? api.game_tick_count() : 0;
    for (let i = 0; i < 12; i++) {
      const y = 40 + i * 38;
      const x = (screenW - ((tick * 7 + i * 91) % (screenW + 120))) - 60;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 28, y - 9, x + 74, y); ctx.stroke();
    }
    ctx.restore();
  }
}
function drawOriginalWeatherSprites(api, view) {
  if (!view?.original || !api.original_weather_effect
      || !api.original_weather_sprite_count) {
    if (DEBUG) window.__soccerWeatherSprites = [];
    return [];
  }
  const effect = api.original_weather_sprite_effect
    ? api.original_weather_sprite_effect() & 0x7F
    : api.original_weather_effect() & 0x7F;
  if (![0x01, 0x02, 0x03, 0x04, 0x05, 0x06].includes(effect)) {
    if (DEBUG) window.__soccerWeatherSprites = [];
    return [];
  }
  const scale = view.logicalScale || 2;
  const count = Math.min(12, api.original_weather_sprite_count() & 0xFF);
  const rendered = [];
  for (let index = count - 1; index >= 0; index--) {
    const y = api.original_weather_sprite_y(index) & 0xFF;
    if (y >= 0xF0) continue;
    const x = api.original_weather_sprite_x(index) & 0xFF;
    const tileNumber = api.original_weather_sprite_tile(index) & 0xFF;
    const attribute = api.original_weather_sprite_attribute(index) & 0xFF;
    const bankSlot = tileNumber >> 6;
    const bankNumber = api.original_sprite_bank(bankSlot) & 0xFF;
    const paletteSlot = attribute & 0x03;
    const paletteNumber = api.original_sprite_palette_number(paletteSlot) & 0xFF;
    const tileCanvas = originalSpriteTile(bankNumber, tileNumber & 0x3F, paletteNumber);
    if (!tileCanvas) continue;
    drawOriginalSpriteTile(
      tileCanvas,
      view.destX + x * scale,
      view.destY + (y + 1) * scale,
      attribute,
      scale,
    );
    rendered.push({
      index, effect, x, y, tileNumber, attribute,
      bankSlot, bankNumber, paletteSlot, paletteNumber,
    });
  }
  if (DEBUG) window.__soccerWeatherSprites = rendered;
  return rendered;
}
function drawScore(api, w, originalStatusbarDrawn = false) {
  if (originalStatusbarDrawn) return;
  const leftScore = api.score_left();
  const rightScore = api.score_right();
  const seconds = api.match_seconds_left ? api.match_seconds_left() : 0;
  const period = api.current_period ? api.current_period() : 1;
  const cpuTeam = api.cpu_team_id ? api.cpu_team_id() : 1;
  const timeText = api.original_time_minutes
    ? `${api.original_time_minutes()}:${api.original_time_seconds_tens()}${api.original_time_seconds_ones()}`
    : `${String(Math.floor(seconds / 60)).padStart(1, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  ctx.fillStyle = "rgba(0,0,0,.62)";
  ctx.fillRect(w / 2 - 138, 10, 276, 46);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 18px ui-monospace, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.fillText(`${TEAM_NAMES[0]} ${leftScore} - ${rightScore} ${TEAM_NAMES[cpuTeam] || "CPU"}`, w / 2, 32);
  ctx.font = "12px ui-monospace, Consolas, monospace";
  ctx.fillText(`${period}H  ${timeText}`, w / 2, 50);
  const foulsL = api.foul_count_left ? api.foul_count_left() : 0;
  const foulsR = api.foul_count_right ? api.foul_count_right() : 0;
  ctx.fillText(`F ${foulsL}-${foulsR}`, w / 2 + 104, 50);
  ctx.textAlign = "left";
}
function drawOverlay(title, lines = []) {
  ctx.fillStyle = "rgba(0,0,0,.68)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff";
  ctx.font = "bold 42px system-ui, sans-serif";
  ctx.fillText(title, canvas.width / 2, 170);
  ctx.font = "18px system-ui, sans-serif";
  lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, 230 + i * 32));
  ctx.textAlign = "left";
}
function drawOriginalSplash(api) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const id = api.original_background_image_id ? api.original_background_image_id() : 0;
  const subtype = api.original_screen_subtype ? api.original_screen_subtype() & 0x7F : 0;
  let img = originalAssets.splash[id];
  if (id === 1 && api.original_frame_counter && (api.original_frame_counter() & 4) !== 0) {
    img = originalAssets.splash.titleBlink || img;
  }
  const brightness = api.original_current_brightness ? api.original_current_brightness() : 0x40;
  const alpha = Math.max(0, Math.min(1, brightness / 0x40));
  let layout = originalFullScreenLayout();
  if (img) {
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, layout.x, layout.y, layout.w, layout.h);
    ctx.globalAlpha = 1;
  }
  drawOriginalSplashObjects(api, layout, id, subtype, alpha);
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,.75)";
  ctx.font = "15px system-ui, sans-serif";
  ctx.fillText("Start：PC Enter / Space，手机 START 键", canvas.width / 2, canvas.height - 12);
  ctx.textAlign = "left";
}
function originalSplashSignedCoordinate(value) {
  const word = value & 0xFFFF;
  return word & 0x8000 ? word - 0x10000 : word;
}
function drawOriginalSplashObjects(api, layout, backgroundId, subtype, alpha) {
  const ballOnly = subtype === 0x01 || subtype === 0x03 || subtype === 0x0B;
  const kunioScene = backgroundId === 0x01 && subtype >= 0x06 && subtype <= 0x0A;
  if (!ballOnly && !kunioScene) {
    if (DEBUG) window.__soccerSplashRenderer = { backgroundId, subtype, drawnObjectIds: [] };
    return;
  }
  const drawnObjectIds = [];
  let playerPosition = null;
  let ballPosition = null;
  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.x, layout.y, layout.w, layout.h);
  ctx.clip();
  ctx.globalAlpha = alpha;
  if (kunioScene && api.original_player_x_lo && api.original_player_animation) {
    const raw = originalPlayerPosition(api, 0);
    playerPosition = {
      x: originalSplashSignedCoordinate(raw.x),
      y: originalSplashSignedCoordinate(raw.y),
      z: normalizeOriginalHeight(raw.z),
    };
    const screenX = layout.x + playerPosition.x * layout.scale;
    const screenY = layout.y + (playerPosition.y - playerPosition.z) * layout.scale;
    if (drawOriginalObject(api, 0, screenX, screenY, layout.scale)) drawnObjectIds.push(0);
  }
  if (api.original_ball_x_lo && api.original_ball_animation) {
    const raw = originalBallPosition(api);
    ballPosition = {
      x: originalSplashSignedCoordinate(raw.x),
      y: originalSplashSignedCoordinate(raw.y),
      z: normalizeOriginalHeight(raw.z),
    };
    const screenX = layout.x + ballPosition.x * layout.scale;
    const screenY = layout.y + ballPosition.y * layout.scale;
    if (drawOriginalBall(api, screenX, screenY, ballPosition.z, layout.scale)) {
      drawnObjectIds.push(0x0C);
    }
  }
  ctx.restore();
  if (DEBUG) {
    window.__soccerSplashRenderer = {
      backgroundId,
      subtype,
      drawnObjectIds,
      playerPosition,
      ballPosition,
    };
  }
}
function originalFullScreenLayout() {
  const scale = Math.min(canvas.width / 256, canvas.height / 240);
  const w = Math.round(256 * scale);
  const h = Math.round(240 * scale);
  return { scale, x: (canvas.width - w) / 2, y: (canvas.height - h) / 2, w, h };
}
function originalResultBackgroundTile(screenMeta, tileNumber, paletteSlot) {
  const result = originalAssets.result;
  const sprite = originalAssets.sprite;
  const rendererManifest = sprite.manifest;
  const paletteData = sprite.palettes;
  if (!screenMeta || !rendererManifest || !paletteData || !sprite.indexPixels) return null;
  const palette = screenMeta.subPalettes?.[paletteSlot & 3];
  if (!palette || palette.length < 4) return null;
  const key = `${screenMeta.chr0}:${screenMeta.chr1}:${tileNumber & 0xFF}:${palette.join("/")}`;
  const cached = result.tileCache.get(key);
  if (cached) return cached;
  const tile = tileNumber & 0xFF;
  const absoluteTile = tile < 0x80
    ? (screenMeta.chr0 & 0xFE) * 64 + tile
    : (screenMeta.chr1 & 0xFE) * 64 + (tile - 0x80);
  if (absoluteTile >= rendererManifest.chr.tileCount) return null;
  const sourceX = (absoluteTile % rendererManifest.chr.columns) * rendererManifest.chr.tileSize;
  const sourceY = Math.floor(absoluteTile / rendererManifest.chr.columns) * rendererManifest.chr.tileSize;
  const tileCanvas = document.createElement("canvas");
  tileCanvas.width = 8;
  tileCanvas.height = 8;
  const tileContext = tileCanvas.getContext("2d");
  const image = tileContext.createImageData(8, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const sourceOffset = ((sourceY + y) * sprite.indexWidth + sourceX + x) * 4;
      const colorIndex = Math.round(sprite.indexPixels[sourceOffset] / 85) & 3;
      const destinationOffset = (y * 8 + x) * 4;
      const color = paletteData.nes_rgb[(palette[colorIndex] || 0) & 0x3F];
      image.data[destinationOffset] = color[0];
      image.data[destinationOffset + 1] = color[1];
      image.data[destinationOffset + 2] = color[2];
      image.data[destinationOffset + 3] = 255;
    }
  }
  tileContext.putImageData(image, 0, 0);
  result.tileCache.set(key, tileCanvas);
  return tileCanvas;
}
function drawOriginalResultTile(resultContext, screenMeta, ppuAddress, tileNumber) {
  const normalized = (ppuAddress - 0x2000) & 0x07FF;
  const nametable = (normalized >> 10) & 1;
  const local = normalized & 0x03FF;
  const row = local >> 5;
  const column = local & 0x1F;
  if (row >= 30) return;
  const attributes = screenMeta.nametableAttributes?.[nametable]
    || screenMeta.nametableAttributes?.[0];
  const attribute = attributes?.[(row >> 2) * 8 + (column >> 2)] || 0;
  const shift = ((row & 2) << 1) | (column & 2);
  const paletteSlot = (attribute >> shift) & 3;
  const tile = originalResultBackgroundTile(screenMeta, tileNumber, paletteSlot);
  if (tile) resultContext.drawImage(tile, nametable * 256 + column * 8, row * 8);
}
function writeOriginalResultTiles(resultContext, screenMeta, ppuAddress, tiles, increment = 1) {
  for (let index = 0; index < tiles.length; index++) {
    drawOriginalResultTile(
      resultContext,
      screenMeta,
      (ppuAddress + index * increment) & 0x3FFF,
      tiles[index],
    );
  }
}
function drawOriginalResultLargeDigit(resultContext, screenMeta, ppuAddress, digitTiles) {
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 6; row++) {
      drawOriginalResultTile(
        resultContext,
        screenMeta,
        ppuAddress + column + row * 0x20,
        digitTiles[column * 6 + row],
      );
    }
  }
}
function drawOriginalResultNamesAndScore(api, resultContext, screenMeta) {
  const scripts = originalAssets.result.scripts;
  if (!scripts) return;
  const subtype = api.original_screen_subtype ? api.original_screen_subtype() & 0x7F : 0;
  if (subtype === 0x08) {
    writeOriginalResultTiles(resultContext, screenMeta, 0x24CC, scripts.halfTimeTeamName);
    writeOriginalResultTiles(
      resultContext,
      screenMeta,
      0x24EC,
      scripts.halfTimeTeamName.map((tile) => tile === 0x35 ? 0x35 : (tile + 0x10) & 0xFF),
    );
  } else {
    for (let side = 0; side < 2; side++) {
      const team = api.original_team_number ? api.original_team_number(side) & 0x0F : 0;
      const tiles = scripts.teamNames[team];
      const address = 0x2400 | scripts.teamNamePpuLo[side];
      writeOriginalResultTiles(resultContext, screenMeta, address, tiles);
      writeOriginalResultTiles(
        resultContext,
        screenMeta,
        address + 0x20,
        tiles.map((tile) => tile === 0x35 ? 0x35 : (tile + 0x10) & 0xFF),
      );
    }
  }
  const scores = [api.score_left ? api.score_left() : 0, api.score_right ? api.score_right() : 0];
  for (let side = 0; side < 2; side++) {
    const score = clamp(scores[side], 0, 99);
    if (score < 10) {
      drawOriginalResultLargeDigit(
        resultContext,
        screenMeta,
        0x2500 | scripts.singleScorePpuLo[side],
        scripts.scoreDigits[score],
      );
    } else {
      drawOriginalResultLargeDigit(
        resultContext,
        screenMeta,
        0x2500 | scripts.tensScorePpuLo[side],
        scripts.scoreDigits[Math.floor(score / 10)],
      );
      drawOriginalResultLargeDigit(
        resultContext,
        screenMeta,
        0x2500 | scripts.onesScorePpuLo[side],
        scripts.scoreDigits[score % 10],
      );
    }
  }
  writeOriginalResultTiles(resultContext, screenMeta, 0x256F, [0x36, 0x46], 0x20);
  writeOriginalResultTiles(resultContext, screenMeta, 0x2570, [0x36, 0x46], 0x20);
}
function drawOriginalResultWetnessRows(api, resultContext, screenMeta) {
  const scripts = originalAssets.result.scripts;
  if (!scripts) return;
  const wetness = api.original_surface_wetness ? api.original_surface_wetness() & 0x0F : 0;
  const pattern = scripts.wetnessPatterns[Math.min(wetness, scripts.wetnessPatterns.length - 1)];
  for (const base of [0x2300, 0x2700]) {
    for (let column = 0; column < 0x20; column++) {
      writeOriginalResultTiles(resultContext, screenMeta, base + column, pattern, 0x20);
    }
  }
}
function applyOriginalResultSupporterUpdate(resultContext, screenMeta) {
  const result = originalAssets.result;
  const scripts = result.scripts;
  if (!scripts || result.mode === 0) return;
  if (result.mode === 1) {
    do {
      const group = result.supporterSubframe & 1;
      const frame = result.supporterFrame;
      const strip = scripts.supporterScrollFrames[group][frame];
      const count = result.supporterPpuHi === 0x24
        && result.supporterPpuLo >= 0x04 && result.supporterPpuLo < 0x1C ? 4 : 18;
      writeOriginalResultTiles(
        resultContext,
        screenMeta,
        (result.supporterPpuHi << 8) | result.supporterPpuLo,
        strip.slice(0, count),
        0x20,
      );
      result.supporterFrame = (result.supporterFrame + 1) & 0xFF;
      result.supporterPpuLo = (result.supporterPpuLo + 1) & 0xFF;
    } while ((result.supporterPpuLo & 1) !== 0);
    if (result.supporterPpuLo >= 0x20) {
      result.supporterPpuLo = 0;
      result.supporterPpuHi = result.supporterPpuHi === 0x20 ? 0x24 : 0x20;
    }
    if (result.supporterFrame >= 0x12) {
      result.supporterFrame = 0;
      result.supporterSubframe = (result.supporterSubframe + 1) & 0xFF;
      if (result.supporterPpuLo >= 0x14) {
        result.supporterPpuLo = (result.supporterPpuLo - 0x14) & 0xFF;
      } else {
        result.supporterPpuLo = ((result.supporterPpuLo - 0x14) & 0xFF) & 0x1F;
        result.supporterPpuHi = result.supporterPpuHi === 0x20 ? 0x24 : 0x20;
      }
    }
    return;
  }
  const frame = result.supporterFrame;
  const addresses = scripts.supporterPatchAddresses[frame & 0x7F];
  const ppuHi = scripts.supporterPatchPpuHi;
  const tiles = scripts.supporterTiles[String(result.mode)] || scripts.supporterTiles["3"];
  for (let index = 0; index < 8; index++) {
    const ppuLo = addresses[index];
    let tileOffset = frame & 0x80 ? 8 : 0;
    if ((((ppuLo >> 5) ^ ppuLo) & 0x02) !== 0) tileOffset += 4;
    const address = (ppuHi[index] << 8) | ppuLo;
    writeOriginalResultTiles(resultContext, screenMeta, address, tiles.slice(tileOffset, tileOffset + 2));
    writeOriginalResultTiles(resultContext, screenMeta, address + 0x20, tiles.slice(tileOffset + 2, tileOffset + 4));
  }
  result.supporterFrame = (result.supporterFrame + 1) & 0xFF;
  if ((result.supporterFrame & 0x7F) >= 0x0D) result.supporterFrame &= 0x80;
  result.supporterFrame ^= 0x80;
}
function composeOriginalResultBackground(api, backgroundId, baseImage) {
  const result = originalAssets.result;
  const screenMeta = result.manifest?.screens?.[String(backgroundId)];
  if (!baseImage || !screenMeta || !result.scripts) return baseImage;
  const teams = [0, 1].map((side) => api.original_team_number ? api.original_team_number(side) & 0x0F : 0);
  const scores = [api.score_left ? api.score_left() : 0, api.score_right ? api.score_right() : 0];
  const wetness = api.original_surface_wetness ? api.original_surface_wetness() & 0xFF : 0;
  const subtype = api.original_screen_subtype ? api.original_screen_subtype() & 0x7F : 0;
  const mode = api.original_footprint_ppu_lo ? api.original_footprint_ppu_lo() & 0xFF : 0;
  const key = `${backgroundId}/${teams.join("/")}/${scores.join("/")}/${wetness}/${subtype}/${mode}`;
  const targetUpdates = api.original_cutscene_timer ? api.original_cutscene_timer() & 0xFF : 0;
  if (result.key !== key || targetUpdates < result.appliedUpdates) {
    const resultCanvas = document.createElement("canvas");
    resultCanvas.width = 0x200;
    resultCanvas.height = 0xF0;
    const resultContext = resultCanvas.getContext("2d");
    resultContext.imageSmoothingEnabled = false;
    resultContext.fillStyle = "#000";
    resultContext.fillRect(0, 0, resultCanvas.width, resultCanvas.height);
    const imageWidth = baseImage.naturalWidth || baseImage.width;
    if (imageWidth >= 0x200) resultContext.drawImage(baseImage, 0, 0);
    else resultContext.drawImage(baseImage, 0x100, 0);
    result.canvas = resultCanvas;
    result.context = resultContext;
    result.key = key;
    result.appliedUpdates = 0;
    result.mode = mode;
    result.supporterFrame = 0;
    result.supporterPpuLo = 0x18;
    result.supporterPpuHi = 0x24;
    result.supporterSubframe = 0;
    drawOriginalResultNamesAndScore(api, resultContext, screenMeta);
    drawOriginalResultWetnessRows(api, resultContext, screenMeta);
  }
  while (result.appliedUpdates < targetUpdates) {
    applyOriginalResultSupporterUpdate(result.context, screenMeta);
    result.appliedUpdates++;
  }
  if (DEBUG) {
    window.__soccerResultRenderer = {
      backgroundId,
      mode: result.mode,
      updates: result.appliedUpdates,
      frame: result.supporterFrame,
      ppuLo: result.supporterPpuLo,
      ppuHi: result.supporterPpuHi,
      subframe: result.supporterSubframe,
    };
  }
  return result.canvas;
}
function drawOriginalMenuObjects(api, layout, subtype) {
  const objectIdsBySubtype = {
    0x01: [0, 2],
    0x02: [0],
    0x03: [0, 1, 3],
    0x04: [0, 1, 3],
    0x05: [0, 1, 2, 3],
    0x06: [0],
    0x07: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    0x08: [0],
    0x0a: [0],
    0x0b: [0, 2],
    0x0c: [0, 1, 2],
    0x0d: [0, 1, 2],
  };
  const objectIds = objectIdsBySubtype[subtype];
  if (!objectIds) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.x, layout.y, layout.w, layout.h);
  ctx.clip();
  const drawnObjectIds = [];
  for (const index of objectIds) {
    if (!api.original_player_x_lo || !api.original_player_animation) continue;
    const p = index === 0x0C ? originalBallPosition(api) : originalPlayerPosition(api, index);
    const cameraY = (subtype === 0x06 || subtype === 0x07)
      && api.original_camera_y_lo && api.original_camera_y_hi
      ? ((api.original_camera_y_hi() << 8) | api.original_camera_y_lo())
      : 0;
    const x = layout.x + p.x * layout.scale;
    const y = layout.y + (p.y - cameraY - normalizeOriginalHeight(p.z)) * layout.scale;
    if (drawOriginalObject(api, index, x, y, layout.scale)) drawnObjectIds.push(index);
  }
  if ((subtype === 0x01 || subtype === 0x03 || subtype === 0x05 || subtype === 0x0f)
      && api.original_ball_x_lo) {
    const ball = originalBallPosition(api);
    if (drawOriginalBall(api, layout.x + ball.x * layout.scale,
      layout.y + ball.y * layout.scale, normalizeOriginalHeight(ball.z), layout.scale)) {
      drawnObjectIds.push(12);
    }
  }
  ctx.restore();
  if (DEBUG) {
    window.__soccerMenuRenderer = {
      subtype,
      drawnObjectIds,
      stagedBank1: api.original_object_work_0061 ? api.original_object_work_0061(5) & 0xFF : null,
      stagedBank2: api.original_object_work_0061 ? api.original_object_work_0061(6) & 0xFF : null,
    };
  }
}
function writeOriginalBracketPatch(nametable, patch, increment = 1) {
  if (!patch || !Array.isArray(patch.tiles)) return;
  let address = patch.address & 0x3fff;
  for (const tile of patch.tiles) {
    if (address >= 0x2000 && address < 0x2400) {
      nametable[address - 0x2000] = tile & 0xff;
    }
    address = (address + increment) & 0x3fff;
  }
}
function applyOriginalBracketPatchGroup(nametable, group, verticalGraphics) {
  if (!Array.isArray(group)) return;
  for (let channel = 0; channel < group.length; channel++) {
    const increment = verticalGraphics && channel === 1 ? 32 : 1;
    writeOriginalBracketPatch(nametable, group[channel], increment);
  }
}
function renderOriginalBracketNametable(nametable, manifest, tileImage, target) {
  const targetContext = target.getContext("2d");
  targetContext.clearRect(0, 0, 256, 240);
  targetContext.imageSmoothingEnabled = false;
  const attributes = nametable.subarray(0x3c0, 0x400);
  for (let row = 0; row < 30; row++) {
    for (let col = 0; col < 32; col++) {
      const tile = nametable[row * 32 + col];
      const attribute = attributes[Math.floor(row / 4) * 8 + Math.floor(col / 4)];
      const shift = ((row & 2) << 1) | (col & 2);
      const palette = (attribute >> shift) & 3;
      targetContext.drawImage(
        tileImage,
        (tile & 0x0f) * 8,
        palette * 128 + (tile >> 4) * 8,
        8,
        8,
        col * 8,
        row * 8,
        8,
        8,
      );
    }
  }
}
function composeOriginalBracketScreen(api) {
  const bracket = originalAssets.bracket;
  const manifest = bracket.manifest;
  const scripts = bracket.scripts;
  if (!manifest || !scripts || !bracket.tileImage || !api.original_ram_054b) return null;
  const round = api.original_ram_054a ? api.original_ram_054a() & 0xff : 0;
  const slots = Array.from({ length: 10 }, (_, index) => api.original_ram_054b(index) & 0xff);
  const teams = [0, 1].map((side) => api.original_team_number ? api.original_team_number(side) & 0xff : 0);
  const key = `${round}:${slots.join(",")}:${teams.join(",")}`;
  if (bracket.canvas && bracket.key === key) return bracket.canvas;
  if (!bracket.canvas) {
    bracket.canvas = document.createElement("canvas");
    bracket.canvas.width = 256;
    bracket.canvas.height = 240;
  }
  const nametable = Uint8Array.from(manifest.nametable || []);
  for (let slot = 0; slot < 6; slot++) {
    const team = slots[slot] & 0x0f;
    const label = scripts.teamLabels?.[team];
    const address = scripts.teamLabelAddresses?.[slot];
    if (label && Number.isFinite(address)) {
      writeOriginalBracketPatch(nametable, { address, tiles: label.top }, 1);
      writeOriginalBracketPatch(nametable, { address: address + 0x20, tiles: label.bottom }, 1);
    }
    if (teams.some((value) => (value & 0x0f) === team)) {
      for (const patch of scripts.activeMarkers?.[slot] || []) {
        writeOriginalBracketPatch(nametable, patch, 1);
      }
    }
  }
  for (let completed = 0; completed < round; completed++) {
    for (let slot = 0; slot < 10; slot++) {
      if (slots[slot] & 0x80) {
        applyOriginalBracketPatchGroup(nametable, scripts.progressPatches?.[slot], true);
      }
    }
    applyOriginalBracketPatchGroup(nametable, scripts.progressPatches?.[round + 8], false);
  }
  renderOriginalBracketNametable(nametable, manifest, bracket.tileImage, bracket.canvas);
  bracket.key = key;
  if (DEBUG) {
    window.__soccerBracketRenderer = { round, slots: [...slots], teams: [...teams], key };
  }
  return bracket.canvas;
}
function renderOriginalMatchSettingsNametable(context, nametable, tileImage, destinationY) {
  const attributes = nametable.subarray(0x3c0, 0x400);
  for (let row = 0; row < 30; row++) {
    for (let col = 0; col < 32; col++) {
      const tile = nametable[row * 32 + col];
      const attribute = attributes[Math.floor(row / 4) * 8 + Math.floor(col / 4)];
      const shift = ((row & 2) << 1) | (col & 2);
      const palette = (attribute >> shift) & 3;
      context.drawImage(
        tileImage,
        (tile & 0x0f) * 8,
        palette * 128 + (tile >> 4) * 8,
        8,
        8,
        col * 8,
        destinationY + row * 8,
        8,
        8,
      );
    }
  }
}
function composeOriginalModeSelectionScreen(api) {
  const mode = originalAssets.modeSelection;
  if (!mode.manifest || !mode.tileImage || !Array.isArray(mode.manifest.nametable)) {
    return null;
  }
  const state = api.original_option_counter ? api.original_option_counter() & 0xff : 0;
  const option = api.original_option_number ? api.original_option_number() & 0xff : 0xff;
  const count = api.original_attribute_buffer_count
    ? Math.min(0x20, api.original_attribute_buffer_count() & 0xff) : 0;
  const address = api.original_attribute_buffer_address
    ? api.original_attribute_buffer_address() & 0x3fff : 0;
  const patch = Array.from({ length: count }, (_, index) =>
    api.original_attribute_buffer ? api.original_attribute_buffer(index) & 0xff : 0);
  const packed = Array.from({ length: 10 }, (_, index) =>
    api.original_ram_046e ? api.original_ram_046e(index) & 0xff : 0);
  if (!mode.canvas) {
    mode.canvas = document.createElement("canvas");
    mode.canvas.width = 256;
    mode.canvas.height = 240;
    mode.context = mode.canvas.getContext("2d");
  }
  if (!mode.nametable || state === 0 || mode.previousState === 0xff) {
    mode.nametable = Uint8Array.from(mode.manifest.nametable);
    mode.key = "";
  }
  if (state !== 0 && address >= 0x2000 && address < 0x2400) {
    let offset = address - 0x2000;
    for (const tile of patch) {
      if (offset >= 0 && offset < mode.nametable.length) mode.nametable[offset] = tile;
      offset++;
    }
  }
  const key = `${state}:${option}:${address}:${patch.join(",")}:${packed.join(",")}`;
  if (key !== mode.key) {
    mode.context.clearRect(0, 0, 256, 240);
    mode.context.imageSmoothingEnabled = false;
    renderOriginalMatchSettingsNametable(mode.context, mode.nametable, mode.tileImage, 0);
    mode.key = key;
  }
  mode.previousState = state;
  if (DEBUG) {
    window.__soccerModeSelectionRenderer = {
      state, option, address, patch, packed,
      nametable: Array.from(mode.nametable),
    };
  }
  return mode.canvas;
}
function composeOriginalMatchSettingsScreen(api) {
  const settings = originalAssets.matchSettings;
  const manifest = settings.manifest;
  const scripts = settings.scripts;
  if (!manifest || !scripts || !settings.tileImage || !Array.isArray(manifest.nametables)) {
    return null;
  }
  const continent = api.original_continent_option ? api.original_continent_option() & 0xff : 0;
  const surfaceWetness = api.original_surface_wetness ? api.original_surface_wetness() & 0xff : 0;
  const rainWind = api.original_rain_wind_option ? api.original_rain_wind_option() & 0xff : 0;
  const storm = api.original_lightning_tornado_direction
    ? api.original_lightning_tornado_direction() & 0xff : 0;
  const key = `${continent}:${surfaceWetness}:${rainWind}:${storm}`;
  if (settings.canvas && settings.key === key) return settings.canvas;
  if (!settings.canvas) {
    settings.canvas = document.createElement("canvas");
    settings.canvas.width = 256;
    settings.canvas.height = 480;
    settings.context = settings.canvas.getContext("2d");
  }
  const nametables = manifest.nametables.map((source) => Uint8Array.from(source));
  const wetnessToOption = [0, 1, 1, 2, 2, 3];
  const options = {
    2: continent & 0x03,
    3: surfaceWetness & 0x0f,
    4: wetnessToOption[Math.min(surfaceWetness >> 4, wetnessToOption.length - 1)],
    5: rainWind & 0x0f,
    6: (rainWind >> 4) & 0x0f,
    7: storm & 0x03,
    8: (storm >> 2) & 0x03,
    9: (storm >> 4) & 0x03,
  };
  for (let state = 2; state <= 9; state++) {
    const patterns = scripts.highlightPatterns?.[state];
    const address = scripts.highlightAddresses?.[state];
    if (!patterns || !Number.isFinite(address)) continue;
    const option = Math.min(options[state] ?? 0, patterns.length - 1);
    const pattern = patterns[option];
    const tableIndex = address >= 0x2800 ? 1 : 0;
    const baseAddress = tableIndex ? 0x2800 : 0x2000;
    for (let offset = 0; offset < pattern.length; offset++) {
      const target = address - baseAddress + offset;
      if (target >= 0 && target < nametables[tableIndex].length) {
        nametables[tableIndex][target] = pattern[offset] & 0xff;
      }
    }
  }
  settings.context.clearRect(0, 0, 256, 480);
  settings.context.imageSmoothingEnabled = false;
  renderOriginalMatchSettingsNametable(settings.context, nametables[0], settings.tileImage, 0);
  renderOriginalMatchSettingsNametable(settings.context, nametables[1], settings.tileImage, 240);
  settings.key = key;
  return settings.canvas;
}
function writeOriginalFormationControlPatch(nametables, address, tiles) {
  if (!Array.isArray(tiles) && !(tiles instanceof Uint8Array)) return;
  const tableIndex = (address & 0x0800) !== 0 ? 1 : 0;
  let offset = address & 0x03FF;
  for (const tile of tiles) {
    if (offset >= 0 && offset < nametables[tableIndex].length) {
      nametables[tableIndex][offset] = tile & 0xFF;
    }
    offset++;
  }
}
function originalFormationControlPpuAddress(rawX, rawY) {
  const packedRow = (rawY & 0x1F) | (rawX & 0x20) | ((rawY & 0x20) << 1);
  return (0x2000 + (packedRow << 5) + (rawX & 0x1F)) & 0x3FFF;
}
function composeOriginalFormationControlScreen(api) {
  const formation = originalAssets.formationControl;
  const manifest = formation.manifest;
  const scripts = formation.scripts;
  if (!manifest || !scripts || !formation.tileImage || !Array.isArray(manifest.nametables)) {
    return null;
  }
  const side = api.original_substitution_counter
    ? api.original_substitution_counter() & 1 : 0;
  const team = api.original_team_number ? api.original_team_number(side) & 0x0F : 0;
  const state = api.original_option_counter ? api.original_option_counter() & 0xFF : 0;
  const selectedFormation = api.original_team_formation
    ? api.original_team_formation(side) & 0x03 : 0;
  const config = api.original_ram_05d3 ? api.original_ram_05d3(side) & 0xFF : 0;
  const playerNumbers = Array.from({ length: 6 }, (_, slot) => api.original_player_number
    ? api.original_player_number(slot * 2 + side) & 0xFF : slot);
  const assignmentSlot = api.original_option_number_05cb
    ? api.original_option_number_05cb() & 0xFF : 0xFF;
  const key = `${side}:${team}:${state}:${selectedFormation}:${config}:${assignmentSlot}:${playerNumbers.join(",")}`;
  if (formation.canvas && formation.key === key) return formation.canvas;
  if (!formation.canvas) {
    formation.canvas = document.createElement("canvas");
    formation.canvas.width = 256;
    formation.canvas.height = 480;
    formation.context = formation.canvas.getContext("2d");
  }
  const nametables = manifest.nametables.map((source) => Uint8Array.from(source));
  const overlay = manifest.teamOverlays?.[String(team)];
  if (overlay) {
    writeOriginalFormationControlPatch(nametables, overlay.address, overlay.tiles);
  }
  writeOriginalFormationControlPatch(
    nametables,
    scripts.yesNoMarkerAddress,
    state < 3 ? scripts.yesNoTopTiles : scripts.yesNoBottomTiles,
  );
  for (const address of new Set(scripts.formationChoiceAddresses || [])) {
    writeOriginalFormationControlPatch(nametables, address, [0x02, 0x02]);
  }
  const formationAddress = scripts.formationChoiceAddresses?.[
    Math.min(selectedFormation, (scripts.formationChoiceAddresses?.length || 1) - 1)
  ];
  if (Number.isFinite(formationAddress)) {
    writeOriginalFormationControlPatch(
      nametables,
      formationAddress,
      [((scripts.formationChoiceGlyphs?.[side] ?? 0x1B) & 0xFF), 0x1F],
    );
  }
  for (let group = 0; group < 4; group++) {
    let selected = (config >> (group * 2)) & 3;
    if (selected === 3) selected = 0;
    const patch = scripts.configurationPatches?.[group * 3 + selected];
    if (patch) writeOriginalFormationControlPatch(nametables, patch.address, patch.tiles);
  }
  const confirmedSlots = state > 4
    ? 6
    : state === 4 ? Math.min(6, assignmentSlot) : 0;
  const order = scripts.playerOrder || [];
  const glyphs = scripts.formationPlayerGlyphs?.[
    Math.min(selectedFormation, (scripts.formationPlayerGlyphs?.length || 1) - 1)
  ] || [];
  const coordinates = scripts.playerGridCoordinates || [];
  for (let slot = 0; slot < confirmedSlots; slot++) {
    const option = Math.max(0, order.indexOf(playerNumbers[slot]));
    const coordinate = coordinates[option];
    if (!coordinate) continue;
    const address = originalFormationControlPpuAddress(coordinate[0], coordinate[1]);
    writeOriginalFormationControlPatch(
      nametables,
      address,
      [0x02, glyphs[slot * 2 + 1] ?? 0x02, glyphs[slot * 2] ?? 0x02],
    );
  }
  formation.context.clearRect(0, 0, 256, 480);
  formation.context.imageSmoothingEnabled = false;
  renderOriginalMatchSettingsNametable(formation.context, nametables[0], formation.tileImage, 0);
  renderOriginalMatchSettingsNametable(formation.context, nametables[1], formation.tileImage, 240);
  formation.key = key;
  return formation.canvas;
}
function writeOriginalWeatherPreviewTiles(nametable, address, tiles) {
  let offset = (address - 0x2000) & 0x03ff;
  for (const tile of tiles || []) {
    if (offset >= 0 && offset < nametable.length) nametable[offset] = tile & 0xff;
    offset++;
  }
}
function writeOriginalWeatherPreviewRows(nametable, patch) {
  if (!patch || !Array.isArray(patch.rows)) return;
  for (let row = 0; row < patch.rows.length; row++) {
    writeOriginalWeatherPreviewTiles(nametable, patch.address + row * 0x20, patch.rows[row]);
  }
}
function composeOriginalWeatherPreviewScreen(api) {
  const weather = originalAssets.weatherPreview;
  const manifest = weather.manifest;
  const scripts = weather.scripts;
  if (!manifest || !scripts || !weather.tileImage || !Array.isArray(manifest.nametable)) {
    return null;
  }
  const difficulty = api.original_difficulty_mode ? api.original_difficulty_mode() & 0xff : 0;
  const continent = api.original_continent_option ? api.original_continent_option() & 0xff : 0;
  const rightTeam = api.original_team_number ? api.original_team_number(1) & 0xff : 0;
  const tournamentRound = api.original_ram_054a ? api.original_ram_054a() & 0xff : 0xff;
  const condition = api.original_ram_0603 ? api.original_ram_0603() & 0xff : 0;
  const rainWind = api.original_rain_wind_option ? api.original_rain_wind_option() & 0xff : 0;
  const storm = api.original_lightning_tornado_direction
    ? api.original_lightning_tornado_direction() & 0xff : 0;
  const key = `${difficulty}:${continent}:${rightTeam}:${tournamentRound}:${condition}:${rainWind}:${storm}`;
  if (weather.canvas && weather.key === key) return weather.canvas;
  if (!weather.canvas) {
    weather.canvas = document.createElement("canvas");
    weather.canvas.width = 256;
    weather.canvas.height = 240;
    weather.context = weather.canvas.getContext("2d");
  }
  const nametable = Uint8Array.from(manifest.nametable);
  let continentPatchIndex;
  if ((difficulty & 0x80) === 0) {
    continentPatchIndex = continent;
  } else if ((tournamentRound & 0x80) === 0) {
    continentPatchIndex = 4;
  } else {
    continentPatchIndex = (rightTeam & 0x0f) + 4;
  }
  writeOriginalWeatherPreviewRows(
    nametable,
    scripts.continentPatches?.[Math.min(continentPatchIndex, (scripts.continentPatches?.length || 1) - 1)],
  );
  const conditionIndex = Math.min(7, (condition & 0xe0) >> 5);
  writeOriginalWeatherPreviewRows(nametable, scripts.conditionPatches?.[conditionIndex]);
  writeOriginalWeatherPreviewTiles(
    nametable,
    0x2219,
    scripts.weatherIconTiles?.slice(conditionIndex * 2, conditionIndex * 2 + 2),
  );
  const direction = storm & 3;
  writeOriginalWeatherPreviewTiles(
    nametable,
    0x225a,
    scripts.directionTiles?.slice(direction * 2, direction * 2 + 2),
  );
  const windOffset = Math.min(32, (rainWind & 0x70) >> 1);
  writeOriginalWeatherPreviewTiles(
    nametable,
    0x2278,
    scripts.windTextTiles?.slice(windOffset, windOffset + 4),
  );
  writeOriginalWeatherPreviewTiles(
    nametable,
    0x2298,
    scripts.windTextTiles?.slice(windOffset + 4, windOffset + 8),
  );
  let stormAddress = 0x22d8;
  if (storm & 0x0c) {
    writeOriginalWeatherPreviewTiles(nametable, stormAddress, scripts.stormTextTiles?.slice(0, 4));
    stormAddress += 0x40;
  }
  if (storm & 0x30) {
    writeOriginalWeatherPreviewTiles(nametable, stormAddress, scripts.stormTextTiles?.slice(4, 8));
  }
  weather.context.clearRect(0, 0, 256, 240);
  weather.context.imageSmoothingEnabled = false;
  renderOriginalMatchSettingsNametable(weather.context, nametable, weather.tileImage, 0);
  weather.key = key;
  if (DEBUG) {
    window.__soccerWeatherPreviewRenderer = {
      subtype: 0x08,
      backgroundId: manifest.backgroundId,
      continentPatchIndex,
      conditionIndex,
      windOffset,
      storm,
      key,
      nametable: Array.from(nametable),
    };
  }
  return weather.canvas;
}
function originalTournamentRecordDigits(value, blankTile) {
  const digits = [Math.floor(value / 100), Math.floor(value / 10) % 10, value % 10];
  let started = false;
  return digits.map((digit, index) => {
    if (digit !== 0 || started || index === 2) {
      started = true;
      return 0x80 | digit;
    }
    return blankTile;
  });
}
function composeOriginalOpponentSelectionScreen(api) {
  const opponent = originalAssets.opponentSelection;
  const manifest = opponent.manifest;
  const scripts = originalAssets.tournamentRecord.scripts;
  if (!manifest || !scripts || !opponent.tileImage || !Array.isArray(manifest.nametable)) {
    return null;
  }
  const statuses = Array.from({ length: 12 }, (_, index) =>
    api.original_team_status_053e ? api.original_team_status_053e(index) & 0xff : 0);
  const values = [
    api.original_ram_0558 ? api.original_ram_0558() & 0xff : 0,
    api.original_ram_0557 ? api.original_ram_0557() & 0xff : 0,
    api.original_ram_0555 ? api.original_ram_0555() & 0xff : 0,
  ];
  const packed = Array.from({ length: 10 }, (_, index) =>
    api.original_ram_046e ? api.original_ram_046e(index) & 0xff : 0);
  const option = api.original_option_number ? api.original_option_number() & 0xff : 0xff;
  const key = `${statuses.join(",")}:${values.join(",")}:${packed.join(",")}:${option}`;
  if (opponent.canvas && opponent.key === key) return opponent.canvas;
  if (!opponent.canvas) {
    opponent.canvas = document.createElement("canvas");
    opponent.canvas.width = 256;
    opponent.canvas.height = 240;
    opponent.context = opponent.canvas.getContext("2d");
  }
  const nametable = Uint8Array.from(manifest.nametable);
  const statusAddresses = scripts.statusAddresses || [];
  const statusIndices = scripts.statusIndices || [];
  for (let slot = 0; slot < 12; slot++) {
    let status = statuses[statusIndices[slot] ?? slot] ?? 0;
    const count = status & 3;
    for (let mark = 0; mark < count; mark++) {
      writeOriginalWeatherPreviewTiles(
        nametable,
        (statusAddresses[slot] ?? 0x2000) + mark,
        [status & 0x80 ? scripts.winTile : scripts.lossTile],
      );
      status = (status << 1) & 0xff;
    }
  }
  for (let index = 0; index < 3; index++) {
    writeOriginalWeatherPreviewTiles(
      nametable,
      scripts.numberAddresses?.[index] ?? 0x2000,
      originalTournamentRecordDigits(values[index], scripts.blankTile ?? 0x02),
    );
  }
  const packedTiles = [];
  for (let index = 0; index < packed.length; index++) {
    packedTiles.push(packed[index] | 0x80);
    if (index === 2 || index === 5) packedTiles.push(0xff);
  }
  writeOriginalWeatherPreviewTiles(nametable, scripts.packedAddress ?? 0x236b, packedTiles);
  let highlightAddress = 0;
  let highlightBytes = [];
  if ((option & 0x80) === 0) {
    const attributePairs = [0xAA, 0xFA, 0xAF, 0xFA, 0xAF, 0xAA, 0xFF, 0xAA];
    const row = option & 3;
    highlightAddress = 0x23C8 + row * 8;
    highlightBytes = [
      ...Array(8).fill(attributePairs[row * 2]),
      ...Array(8).fill(attributePairs[row * 2 + 1]),
    ];
    writeOriginalWeatherPreviewTiles(nametable, highlightAddress, highlightBytes);
  }
  opponent.context.clearRect(0, 0, 256, 240);
  opponent.context.imageSmoothingEnabled = false;
  renderOriginalMatchSettingsNametable(opponent.context, nametable, opponent.tileImage, 0);
  opponent.key = key;
  if (DEBUG) {
    window.__soccerOpponentSelectionRenderer = {
      option,
      statuses,
      values,
      packed,
      highlightAddress,
      highlightBytes: [...highlightBytes],
      key,
      nametable: Array.from(nametable),
    };
  }
  return opponent.canvas;
}
function composeOriginalPlayerOrderScreen(api) {
  const order = originalAssets.playerOrder;
  const manifest = order.manifest;
  const backgroundId = api.original_background_image_id
    ? api.original_background_image_id() & 0xFF : 0;
  if (backgroundId !== 0x13 || !manifest || !order.tileImage
      || !Array.isArray(manifest.nametable)) {
    return null;
  }
  const attributeCount = api.original_attribute_buffer_count
    ? Math.min(0x20, api.original_attribute_buffer_count() & 0xFF) : 0;
  const graphicsCount = api.original_graphics_buffer_count
    ? Math.min(0x20, api.original_graphics_buffer_count() & 0xFF) : 0;
  const attributeAddress = api.original_attribute_buffer_address
    ? api.original_attribute_buffer_address() & 0x3FFF : 0;
  const graphicsAddress = api.original_graphics_buffer_address
    ? api.original_graphics_buffer_address() & 0x3FFF : 0;
  const attributeBytes = Array.from({ length: attributeCount }, (_, index) =>
    api.original_attribute_buffer(index) & 0xFF);
  const graphicsBytes = Array.from({ length: graphicsCount }, (_, index) =>
    api.original_graphics_buffer(index) & 0xFF);
  const key = `${attributeAddress}:${attributeBytes.join(",")}:${graphicsAddress}:${graphicsBytes.join(",")}`;
  if (order.canvas && order.key === key) return order.canvas;
  if (!order.canvas) {
    order.canvas = document.createElement("canvas");
    order.canvas.width = 256;
    order.canvas.height = 240;
    order.context = order.canvas.getContext("2d");
  }
  const nametable = Uint8Array.from(manifest.nametable);
  writeOriginalWeatherPreviewTiles(nametable, attributeAddress, attributeBytes);
  writeOriginalWeatherPreviewTiles(nametable, graphicsAddress, graphicsBytes);
  order.context.clearRect(0, 0, 256, 240);
  order.context.imageSmoothingEnabled = false;
  renderOriginalMatchSettingsNametable(order.context, nametable, order.tileImage, 0);
  order.key = key;
  if (DEBUG) {
    window.__soccerPlayerOrderRenderer = {
      backgroundId,
      attributeAddress,
      attributeBytes: [...attributeBytes],
      graphicsAddress,
      graphicsBytes: [...graphicsBytes],
      key,
      nametable: Array.from(nametable),
    };
  }
  return order.canvas;
}
function writeOriginalNametableRectangle(nametable, destination, width, height, tiles) {
  const offset = (destination & 0x3FFF) - 0x2000;
  if (offset < 0 || !Array.isArray(tiles)) return;
  const startRow = Math.floor(offset / 32);
  const startColumn = offset & 31;
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const source = row * width + column;
      const target = (startRow + row) * 32 + startColumn + column;
      if (source < tiles.length && target >= 0 && target < 0x3C0) {
        nametable[target] = tiles[source] & 0xFF;
      }
    }
  }
}
function composeOriginalTeamPreviewScreen(api) {
  const preview = originalAssets.teamPreview;
  const manifest = preview.manifest;
  if (!manifest || !Array.isArray(manifest.nametable)) return null;
  const teams = [0, 1].map((side) => api.original_team_number
    ? api.original_team_number(side) & 0x0F : 0);
  const continent = api.original_continent_option
    ? Math.min(api.original_continent_option() & 0xFF, 4) : 0;
  const bank0 = api.original_background_bank
    ? api.original_background_bank(0) & 0xFF : manifest.chr0;
  const bank1 = api.original_background_bank
    ? api.original_background_bank(1) & 0xFF : manifest.chr1;
  const paletteNumbers = [0, 1].map((slot) => api.original_background_palette_number
    ? api.original_background_palette_number(slot) & 0xFF
    : (slot === 0 ? 0x1C : 0x1C));
  const subPalettes = originalBackgroundSubPalettes(paletteNumbers[0], paletteNumbers[1]);
  if (!subPalettes) return null;
  const key = `${teams.join(",")}:${continent}:${bank0}:${bank1}:${paletteNumbers.join(",")}`;
  if (preview.canvas && preview.key === key) return preview.canvas;
  if (!preview.canvas) {
    preview.canvas = document.createElement("canvas");
    preview.canvas.width = 256;
    preview.canvas.height = 240;
    preview.context = preview.canvas.getContext("2d");
  }
  const nametable = Uint8Array.from(manifest.nametable);
  const logo = manifest.teamLogo;
  for (let side = 0; side < 2; side++) {
    writeOriginalNametableRectangle(
      nametable,
      logo?.destinations?.[side] ?? (side === 0 ? 0x20E5 : 0x20F4),
      logo?.width ?? 7,
      logo?.height ?? 9,
      logo?.tilesByTeam?.[teams[side]],
    );
  }
  const heading = manifest.continentHeading;
  writeOriginalNametableRectangle(
    nametable,
    heading?.destination ?? 0x2044,
    heading?.width ?? 24,
    heading?.height ?? 2,
    heading?.tilesByContinent?.[continent],
  );
  renderOriginalDynamicBackgroundNametable(
    preview.context,
    nametable,
    bank0 || manifest.chr0,
    bank1 || manifest.chr1,
    subPalettes,
  );
  preview.key = key;
  if (DEBUG) {
    window.__soccerTeamPreviewRenderer = {
      teams: [...teams],
      continent,
      bank0: bank0 || manifest.chr0,
      bank1: bank1 || manifest.chr1,
      paletteNumbers: [...paletteNumbers],
      expectedFlagAnimations: teams.map((team) => manifest.flagAnimationByTeam?.[team]),
      expectedFlagPalettes: teams.map((team) => manifest.flagPaletteByTeam?.[team]),
      key,
      nametable: Array.from(nametable),
    };
  }
  return preview.canvas;
}
function composeOriginalTournamentRecordScreen(api) {
  const record = originalAssets.tournamentRecord;
  const manifest = record.manifest;
  const scripts = record.scripts;
  if (!manifest || !scripts || !record.tileImage || !Array.isArray(manifest.nametable)) {
    return null;
  }
  const statuses = Array.from({ length: 12 }, (_, index) =>
    api.original_team_status_053e ? api.original_team_status_053e(index) & 0xff : 0);
  const values = [
    api.original_ram_0558 ? api.original_ram_0558() & 0xff : 0,
    api.original_ram_0557 ? api.original_ram_0557() & 0xff : 0,
    api.original_ram_0555 ? api.original_ram_0555() & 0xff : 0,
  ];
  const packed = Array.from({ length: 10 }, (_, index) =>
    api.original_ram_046e ? api.original_ram_046e(index) & 0xff : 0);
  const key = `${statuses.join(",")}:${values.join(",")}:${packed.join(",")}`;
  if (record.canvas && record.key === key) return record.canvas;
  if (!record.canvas) {
    record.canvas = document.createElement("canvas");
    record.canvas.width = 256;
    record.canvas.height = 240;
    record.context = record.canvas.getContext("2d");
  }
  const nametable = Uint8Array.from(manifest.nametable);
  const statusAddresses = scripts.statusAddresses || [];
  const statusIndices = scripts.statusIndices || [];
  for (let slot = 0; slot < 12; slot++) {
    let status = statuses[statusIndices[slot] ?? slot] ?? 0;
    const count = status & 0x03;
    for (let mark = 0; mark < count; mark++) {
      writeOriginalWeatherPreviewTiles(
        nametable,
        (statusAddresses[slot] ?? 0x2000) + mark,
        [status & 0x80 ? scripts.winTile : scripts.lossTile],
      );
      status = (status << 1) & 0xff;
    }
  }
  for (let index = 0; index < 3; index++) {
    writeOriginalWeatherPreviewTiles(
      nametable,
      scripts.numberAddresses?.[index] ?? 0x2000,
      originalTournamentRecordDigits(values[index], scripts.blankTile ?? 0x02),
    );
  }
  const packedTiles = [];
  for (let index = 0; index < packed.length; index++) {
    packedTiles.push(packed[index] | 0x80);
    if (index === 2 || index === 5) packedTiles.push(0xff);
  }
  writeOriginalWeatherPreviewTiles(nametable, scripts.packedAddress ?? 0x236b, packedTiles);
  record.context.clearRect(0, 0, 256, 240);
  record.context.imageSmoothingEnabled = false;
  renderOriginalMatchSettingsNametable(record.context, nametable, record.tileImage, 0);
  record.key = key;
  if (DEBUG) {
    window.__soccerTournamentRecordRenderer = {
      subtype: 0x09,
      backgroundId: manifest.backgroundId,
      statuses,
      values,
      packed,
      key,
      nametable: Array.from(nametable),
    };
  }
  return record.canvas;
}
function originalPlayerProfileDoubleHeightTiles(values, textEffect = false) {
  const top = [];
  const bottom = [];
  for (const raw of values || []) {
    const value = raw & 0xff;
    if (textEffect && value === 0) {
      top.push(0xff);
      bottom.push(0xff);
    } else if ((value & 0x80) !== 0 || value < 0x10) {
      top.push(0xff);
      bottom.push(value);
    } else if (value < 0x50) {
      top.push(0xda);
      bottom.push(value | 0x80);
    } else {
      top.push(0xdb);
      bottom.push((value + 0x50) & 0xff);
    }
  }
  return { top, bottom };
}
function writeOriginalPlayerProfileDoubleHeightRow(nametable, address, values, textEffect = false) {
  const converted = originalPlayerProfileDoubleHeightTiles(values, textEffect);
  writeOriginalWeatherPreviewTiles(nametable, address, converted.top);
  writeOriginalWeatherPreviewTiles(nametable, address + 0x20, converted.bottom);
}
function replayOriginalTextEffect(
  nametable, script, effectCursor, effectStatus, effectAltCursor, workspace, startAddress,
) {
  let lineAddress = startAddress;
  let textAddress = lineAddress;
  const emit = (value) => {
    writeOriginalPlayerProfileDoubleHeightRow(nametable, textAddress, [value], true);
    textAddress++;
  };
  const emitWorkspace = (base, count) => {
    for (let index = 0; index < count && base + index < workspace.length; index++) {
      const value = workspace[base + index] & 0xff;
      if (value === 0xf8) break;
      if (value < 0xf0) emit(value);
    }
  };
  const last = Math.min(effectCursor, script.length - 1);
  for (let index = 0; index <= last; index++) {
    const value = script[index] & 0xff;
    if (value === 0xf4) {
      lineAddress = startAddress;
      textAddress = lineAddress;
    } else if (value === 0xf7) {
      lineAddress += 0x40;
      textAddress = lineAddress;
    } else if (value === 0xf0 || value === 0xf1) {
      const activeBit = value === 0xf0 ? 0x04 : 0x08;
      const base = value === 0xf0 ? 0 : 6;
      const insertionIsActive = index === effectCursor && (effectStatus & activeBit) !== 0;
      const count = insertionIsActive
        ? (effectAltCursor === 0xff ? 0 : effectAltCursor + 1)
        : workspace.length - base;
      emitWorkspace(base, count);
    } else if (value < 0xf0) {
      emit(value);
    }
  }
}
function composeOriginalPlayerProfileScreen(api) {
  const profile = originalAssets.playerProfile;
  const manifest = profile.manifest;
  const scripts = profile.scripts;
  if (!manifest || !scripts || !profile.tileImage || !Array.isArray(manifest.nametable)) {
    return null;
  }
  const selected = Math.min(11, api.original_selected_player_number
    ? api.original_selected_player_number() & 0xff : 0);
  const effectState = api.original_text_effect_state ? api.original_text_effect_state() & 0xff : 0x80;
  const effectStatus = api.original_text_effect_status ? api.original_text_effect_status() & 0xff : 0;
  const effectScriptId = api.original_text_effect_script_id
    ? api.original_text_effect_script_id() & 0xff : selected + 1;
  const effectCursor = api.original_text_effect_cursor ? api.original_text_effect_cursor() & 0xffff : 0;
  const effectAltCursor = api.original_text_effect_alt_cursor
    ? api.original_text_effect_alt_cursor() & 0xff : 0xff;
  const textWorkspace = Array.from({ length: 14 }, (_, index) =>
    api.original_meeting_name_workspace ? api.original_meeting_name_workspace(index) & 0xff : 0);
  const blinkAddress = api.original_attribute_buffer_address
    ? api.original_attribute_buffer_address() & 0x3fff : 0;
  const blinkTile = api.original_attribute_buffer ? api.original_attribute_buffer(0) & 0xff : 0xff;
  const key = `${selected}:${effectState}:${effectStatus}:${effectScriptId}:${effectCursor}:${effectAltCursor}:${textWorkspace.join(",")}:${blinkAddress}:${blinkTile}`;
  if (profile.canvas && profile.key === key) return profile.canvas;
  if (!profile.canvas) {
    profile.canvas = document.createElement("canvas");
    profile.canvas.width = 256;
    profile.canvas.height = 240;
    profile.context = profile.canvas.getContext("2d");
  }
  const nametable = Uint8Array.from(manifest.nametable);
  const record = scripts.records?.[selected] || scripts.records?.[0];
  if (record) {
    for (let index = 0; index < 3; index++) {
      const value = record[index] & 0xff;
      writeOriginalWeatherPreviewTiles(
        nametable,
        scripts.statAddresses?.[index] ?? (0x20f9 + index * 0x40),
        [0x80 | Math.floor(value / 10), 0x80 | (value % 10)],
      );
    }
    writeOriginalWeatherPreviewTiles(nametable, scripts.rankAddress ?? 0x21b9, [record[3]]);
    const playerName = scripts.playerNames?.[selected] || scripts.playerNames?.[0] || [];
    writeOriginalPlayerProfileDoubleHeightRow(
      nametable, scripts.nameAddress ?? 0x21c4, playerName,
    );
    let descriptionAddress = scripts.descriptionAddress ?? 0x21d2;
    for (const rowIndex of record.slice(4, 7)) {
      if ((rowIndex & 0x80) !== 0) break;
      const row = scripts.descriptionRows?.[rowIndex];
      if (!row) break;
      writeOriginalPlayerProfileDoubleHeightRow(nametable, descriptionAddress, row);
      descriptionAddress += 0x40;
    }
  }
  const textHasStarted = (effectState & 0x80) === 0 && (effectStatus !== 0 || effectCursor !== 0);
  if (textHasStarted) {
    const blankRow = new Array(0x1b).fill(0xff);
    for (const address of [0x2302, 0x2322, 0x2342, 0x2362]) {
      writeOriginalWeatherPreviewTiles(nametable, address, blankRow);
    }
    const script = scripts.textScripts?.[Math.max(0, effectScriptId - 1)] || [];
    replayOriginalTextEffect(
      nametable, script, effectCursor, effectStatus, effectAltCursor,
      textWorkspace, scripts.textAddress ?? 0x2302,
    );
  }
  if ((effectStatus & 0x20) !== 0 && blinkAddress === 0x2390) {
    writeOriginalWeatherPreviewTiles(nametable, 0x2390, [blinkTile]);
  }
  profile.context.clearRect(0, 0, 256, 240);
  profile.context.imageSmoothingEnabled = false;
  renderOriginalMatchSettingsNametable(profile.context, nametable, profile.tileImage, 0);
  profile.key = key;
  if (DEBUG) {
    window.__soccerPlayerProfileRenderer = {
      subtype: 0x0a,
      backgroundId: manifest.backgroundId,
      selected,
      effectState,
      effectStatus,
      effectScriptId,
      effectCursor,
      effectAltCursor,
      textWorkspace,
      key,
      nametable: Array.from(nametable),
    };
  }
  return profile.canvas;
}
function composeOriginalMusicSelectionScreen(api) {
  const music = originalAssets.musicSelection;
  const manifest = music.manifest;
  const scripts = music.scripts;
  if (!manifest || !scripts || !music.tileImage) return null;
  const option = api.original_option_number ? api.original_option_number() & 0xff : 0xff;
  const hiddenNumber = api.original_option_number_05cb
    ? api.original_option_number_05cb() & 0xff : 0;
  const bufferAddress = api.original_graphics_buffer_address
    ? api.original_graphics_buffer_address() & 0x3fff : 0;
  const bufferCount = api.original_graphics_buffer_count
    ? Math.min(0x20, api.original_graphics_buffer_count() & 0xff) : 0;
  const buffer = [];
  if (bufferAddress === (scripts.hiddenNumberAddress ?? 0x20e5)) {
    for (let index = 0; index < bufferCount; index++) {
      buffer.push(api.original_graphics_buffer(index) & 0xff);
    }
  }
  const key = `${option}:${hiddenNumber}:${bufferAddress}:${buffer.join(",")}`;
  if (music.canvas && music.key === key) return music.canvas;
  if (!music.canvas) {
    music.canvas = document.createElement("canvas");
    music.canvas.width = 256;
    music.canvas.height = 240;
    music.context = music.canvas.getContext("2d");
  }
  const nametable = Uint8Array.from(manifest.nametable || []);
  if (bufferAddress >= 0x2000 && bufferAddress < 0x2400) {
    let address = bufferAddress;
    for (const tile of buffer) {
      nametable[address - 0x2000] = tile;
      address++;
      if (address >= 0x2400) break;
    }
  }
  music.context.clearRect(0, 0, 256, 240);
  music.context.imageSmoothingEnabled = false;
  renderOriginalMatchSettingsNametable(music.context, nametable, music.tileImage, 0);
  music.key = key;
  if (DEBUG) {
    window.__soccerMusicSelectionRenderer = {
      subtype: 0x0b,
      backgroundId: manifest.backgroundId,
      option,
      hiddenNumber,
      bufferAddress,
      buffer: [...buffer],
      key,
      nametable: Array.from(nametable),
    };
  }
  return music.canvas;
}
function composeOriginalMeetingSecretScreen(api, backgroundId) {
  const meeting = originalAssets.meetingSecret;
  const screen = meeting.manifest?.screens?.[String(backgroundId)];
  const scripts = meeting.scripts;
  const tileImage = meeting.tileImages?.[String(backgroundId)];
  if (!screen || !scripts || !tileImage || !Array.isArray(screen.nametable)) return null;
  const state = api.original_option_counter ? api.original_option_counter() & 0xff : 0;
  const option = api.original_option_number ? api.original_option_number() & 0xff : 0xff;
  const selected = api.original_selected_player_number
    ? api.original_selected_player_number() & 0xff : 0;
  const firstRosterOption = api.original_meeting_first_roster_option
    ? api.original_meeting_first_roster_option() & 0xff : 0;
  const effectState = api.original_text_effect_state ? api.original_text_effect_state() & 0xff : 0;
  const effectStatus = api.original_text_effect_status ? api.original_text_effect_status() & 0xff : 0;
  const effectScriptId = api.original_text_effect_script_id
    ? api.original_text_effect_script_id() & 0xff : 0;
  const effectCursor = api.original_text_effect_cursor ? api.original_text_effect_cursor() & 0xffff : 0;
  const effectAltCursor = api.original_text_effect_alt_cursor
    ? api.original_text_effect_alt_cursor() & 0xff : 0xff;
  const textWorkspace = Array.from({ length: 14 }, (_, index) =>
    api.original_meeting_name_workspace ? api.original_meeting_name_workspace(index) & 0xff : 0);
  const blinkAddress = api.original_attribute_buffer_address
    ? api.original_attribute_buffer_address() & 0x3fff : 0;
  const blinkTile = api.original_attribute_buffer ? api.original_attribute_buffer(0) & 0xff : 0xff;
  const meetingPlayerData = Array.from({ length: 12 }, (_, index) =>
    api.original_meeting_player_data ? api.original_meeting_player_data(index) & 0xff : 0);
  const key = `${backgroundId}:${state}:${option}:${selected}:${firstRosterOption}:${effectState}:${effectStatus}:${effectScriptId}:${effectCursor}:${effectAltCursor}:${textWorkspace.join(",")}:${blinkAddress}:${blinkTile}:${meetingPlayerData.join(",")}`;
  if (meeting.canvas && meeting.key === key) return meeting.canvas;
  if (!meeting.canvas) {
    meeting.canvas = document.createElement("canvas");
    meeting.canvas.width = 256;
    meeting.canvas.height = 240;
    meeting.context = meeting.canvas.getContext("2d");
  }
  const nametable = Uint8Array.from(screen.nametable);
  const parameterTiles = scripts.parameterTiles || [];
  const parameterGroups = scripts.parameterGroups || [];
  const parameterAddresses = scripts.parameterAddresses || [];
  if (parameterTiles.length >= 12 * 8 && parameterGroups.length >= 8 * 6
      && parameterAddresses.length >= 12) {
    for (let player = 0; player < 12; player++) {
      const value = meetingPlayerData[player];
      const pair = (value >> 1) & 0x06;
      const group = ((value & 0x0e) >> 1) * 6;
      const playerTiles = player * 8;
      const base = (parameterAddresses[player] & 0x3fff) - 0x2000;
      const writes = [
        [base, parameterGroups[group + 2]],
        [base + 0x20, parameterGroups[group + 3]],
        [base + 0x40, parameterGroups[group + 4]],
        [base + 1, parameterTiles[playerTiles + pair]],
        [base + 0x21, parameterGroups[group]],
        [base + 0x41, parameterGroups[group + 5]],
        [base + 2, parameterTiles[playerTiles + pair + 1]],
        [base + 0x22, parameterGroups[group + 1]],
        [base + 0x42, 0x1f],
      ];
      for (const [offset, tile] of writes) {
        if (offset >= 0 && offset < nametable.length) nametable[offset] = tile & 0xff;
      }
    }
  }
  for (const pair of scripts.stateNametablePatches?.[String(state)] || []) {
    const [offset, value] = pair;
    if (offset >= 0 && offset < nametable.length) nametable[offset] = value & 0xff;
  }
  const transformMeetingRow = (values, lowAttribute, middleAttribute, highAttribute) => {
    const graphics = [], attributes = [];
    for (const raw of values) {
      const value = raw & 0xff;
      if ((value & 0x80) !== 0 || value < 0x10) {
        graphics.push(value); attributes.push(lowAttribute);
      } else if (value < 0x50) {
        if (middleAttribute !== 0) {
          graphics.push(value | 0x80); attributes.push(middleAttribute);
        } else {
          graphics.push(0x50); attributes.push(highAttribute || lowAttribute);
        }
      } else {
        graphics.push((value + 0x50) & 0xff); attributes.push(highAttribute || lowAttribute);
      }
    }
    return { graphics, attributes };
  };
  const playerNames = scripts.playerNames || [];
  if (state >= 2 && playerNames.length >= 12 * 5) {
    const offset = Math.min(selected, 11) * 5;
    const name = transformMeetingRow(playerNames.slice(offset, offset + 5), 0x59, 0x5a, 0x5b);
    writeOriginalWeatherPreviewTiles(nametable, 0x22af, name.attributes);
    writeOriginalWeatherPreviewTiles(nametable, 0x22cf, name.graphics);
  }
  const individualRows = scripts.individualOptionRows || [];
  if (state === 6 && individualRows.length >= 12 * 8) {
    const rowIndex = Math.min(option, 11) * 8;
    const row = transformMeetingRow(individualRows.slice(rowIndex, rowIndex + 8), 0x02, 0xda, 0xdb);
    row.graphics[0] = (row.graphics[0] - firstRosterOption) & 0xff;
    writeOriginalWeatherPreviewTiles(nametable, 0x2275, row.attributes);
    writeOriginalWeatherPreviewTiles(nametable, 0x2295, row.graphics);
  }
  const scriptIndex = effectScriptId - (scripts.textScriptFirstId ?? 0x0d);
  const textScript = scripts.textScripts?.[scriptIndex] || [];
  const textHasStarted = state >= 7 && (effectState & 0x80) === 0
    && (effectStatus !== 0 || effectCursor !== 0);
  if (textHasStarted && textScript.length) {
    const blankRow = new Array(0x1b).fill(0xff);
    for (const address of [0x2302, 0x2322, 0x2342, 0x2362]) {
      writeOriginalWeatherPreviewTiles(nametable, address, blankRow);
    }
    replayOriginalTextEffect(
      nametable, textScript, effectCursor, effectStatus, effectAltCursor,
      textWorkspace, scripts.textAddress ?? 0x2302,
    );
  }
  if ((effectStatus & 0x20) !== 0 && blinkAddress === 0x2390) {
    writeOriginalWeatherPreviewTiles(nametable, blinkAddress, [blinkTile]);
  }
  meeting.context.clearRect(0, 0, 256, 240);
  meeting.context.imageSmoothingEnabled = false;
  renderOriginalMatchSettingsNametable(meeting.context, nametable, tileImage, 0);
  meeting.key = key;
  if (DEBUG) {
    window.__soccerMeetingSecretRenderer = {
      subtype: api.original_screen_subtype ? api.original_screen_subtype() & 0x7f : 0,
      backgroundId,
      state,
      option,
      selected,
      firstRosterOption,
      effectState,
      effectStatus,
      effectScriptId,
      effectCursor,
      effectAltCursor,
      textWorkspace,
      meetingPlayerData,
      key,
      nametable: Array.from(nametable),
    };
  }
  return meeting.canvas;
}
function drawOriginalMenuScreen(api) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const id = api.original_background_image_id ? api.original_background_image_id() : 0x02;
  const subtype = api.original_screen_subtype ? api.original_screen_subtype() & 0x7f : 0;
  const img = subtype === 0x0f
    ? (composeOriginalBracketScreen(api) || originalAssets.menu[id])
    : subtype === 0x01
      ? (composeOriginalModeSelectionScreen(api) || originalAssets.menu[id])
    : subtype === 0x02
      ? (composeOriginalOpponentSelectionScreen(api) || originalAssets.menu[id])
    : subtype === 0x03
      ? (composeOriginalTeamPreviewScreen(api) || originalAssets.menu[id])
    : subtype === 0x04
      ? (composeOriginalPlayerOrderScreen(api) || originalAssets.menu[id])
    : subtype === 0x06
      ? (composeOriginalMatchSettingsScreen(api) || originalAssets.menu[id])
      : subtype === 0x07
        ? (composeOriginalFormationControlScreen(api) || originalAssets.menu[0x05])
      : subtype === 0x08
        ? (composeOriginalWeatherPreviewScreen(api) || originalAssets.menu[id])
      : subtype === 0x09
        ? (composeOriginalTournamentRecordScreen(api) || originalAssets.menu[id])
      : subtype === 0x0a
        ? (composeOriginalPlayerProfileScreen(api) || originalAssets.menu[id])
      : subtype === 0x0b
        ? (composeOriginalMusicSelectionScreen(api) || originalAssets.menu[id])
      : subtype === 0x0c || subtype === 0x0d
        ? (composeOriginalMeetingSecretScreen(api, id) || originalAssets.menu[id])
      : originalAssets.menu[id];
  const layout = originalFullScreenLayout();
  const brightness = api.original_current_brightness ? api.original_current_brightness() : 0x40;
  if (img) {
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = Math.max(0, Math.min(1, brightness / 0x40));
    if ((subtype === 0x06 || subtype === 0x07) && (img.height || img.naturalHeight) >= 480) {
      const cameraY = api.original_camera_y_lo && api.original_camera_y_hi
        ? ((api.original_camera_y_hi() << 8) | api.original_camera_y_lo())
        : 0;
      const sourceY = cameraY >= 0x0100 ? 240 : Math.min(cameraY, 240);
      ctx.drawImage(img, 0, sourceY, 256, 240, layout.x, layout.y, layout.w, layout.h);
      if (DEBUG) {
        const rendererState = {
          subtype,
          backgroundId: id,
          state: api.original_option_counter ? api.original_option_counter() & 0xff : 0,
          option: api.original_option_number ? api.original_option_number() & 0xff : 0,
          cameraY,
          sourceY,
          key: subtype === 0x06
            ? originalAssets.matchSettings.key
            : originalAssets.formationControl.key,
        };
        if (subtype === 0x06) window.__soccerMatchSettingsRenderer = rendererState;
        else window.__soccerFormationControlRenderer = rendererState;
      }
    } else {
      ctx.drawImage(img, layout.x, layout.y, layout.w, layout.h);
    }
    ctx.globalAlpha = 1;
  }
  drawOriginalMenuObjects(api, layout, subtype);
}
function applyOriginalCreditsBuffer(api, nametable, bufferName, countName, addressName) {
  if (!api[bufferName] || !api[countName] || !api[addressName]) return "";
  const count = Math.min(0x20, api[countName]() & 0xff);
  const address = api[addressName]() & 0x3fff;
  const values = [];
  for (let index = 0; index < count; index++) {
    const value = api[bufferName](index) & 0xff;
    values.push(value);
    const target = address + index;
    if (target >= 0x2000 && target < 0x2400) nametable[target - 0x2000] = value;
  }
  return `${address.toString(16)}:${values.join(",")}`;
}
function composeOriginalCreditsBackground(api, backgroundId) {
  const credits = originalAssets.credits;
  const meta = credits.manifest?.screens?.[String(backgroundId)];
  const tileImage = credits.tileImages[backgroundId];
  if (!meta || !tileImage) return originalAssets.menu[backgroundId] || null;
  let state = credits.states.get(backgroundId);
  if (!state) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 240;
    state = { canvas, nametable: Uint8Array.from(meta.nametable || []), signature: "" };
    credits.states.set(backgroundId, state);
  }
  const attrSignature = applyOriginalCreditsBuffer(
    api, state.nametable, "original_attribute_buffer",
    "original_attribute_buffer_count", "original_attribute_buffer_address",
  );
  const graphicsSignature = applyOriginalCreditsBuffer(
    api, state.nametable, "original_graphics_buffer",
    "original_graphics_buffer_count", "original_graphics_buffer_address",
  );
  const signature = `${attrSignature}|${graphicsSignature}`;
  if (state.signature !== signature || !state.rendered) {
    renderOriginalBracketNametable(state.nametable, meta, tileImage, state.canvas);
    state.signature = signature;
    state.rendered = true;
  }
  return state.canvas;
}
function drawOriginalCreditsScreen(api) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const subtype = api.original_screen_subtype ? api.original_screen_subtype() & 0x7f : 0;
  const backgroundId = api.original_background_image_id
    ? api.original_background_image_id() & 0xff : 0x1c;
  const background = backgroundId === 0
    ? originalAssets.splash[0]
    : composeOriginalCreditsBackground(api, backgroundId);
  const layout = originalFullScreenLayout();
  const cameraX = api.original_camera_x_lo && api.original_camera_x_hi
    ? (api.original_camera_x_hi() << 8) | api.original_camera_x_lo() : 0;
  const cameraY = api.original_camera_y_lo && api.original_camera_y_hi
    ? (api.original_camera_y_hi() << 8) | api.original_camera_y_lo() : 0;
  const brightness = api.original_current_brightness ? api.original_current_brightness() : 0x40;
  if (background) {
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = Math.max(0, Math.min(1, brightness / 0x40));
    const backgroundWidth = background.naturalWidth || background.width;
    if (backgroundWidth >= 0x200) {
      const sourceX = clamp(cameraX, 0, backgroundWidth - 0x100);
      ctx.drawImage(
        background, sourceX, 0, 0x100, 0xf0,
        layout.x, layout.y, layout.w, layout.h,
      );
    } else {
      ctx.drawImage(background, layout.x, layout.y, layout.w, layout.h);
    }
    ctx.globalAlpha = 1;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.x, layout.y, layout.w, layout.h);
  ctx.clip();
  const drawnObjects = [];
  const drawPlayer = (index) => {
    if (!api.original_player_z_hi || (api.original_player_z_hi(index) & 0x80) !== 0) return;
    const player = originalPlayerPosition(api, index);
    const x = layout.x + (player.x - cameraX) * layout.scale;
    const y = layout.y + (player.y - cameraY - normalizeOriginalHeight(player.z)) * layout.scale;
    if (drawOriginalObject(api, index, x, y, layout.scale)) drawnObjects.push(index);
  };
  if (subtype <= 7) {
    for (let index = 0; index < 4; index++) drawPlayer(index);
  }
  if (api.original_ball_z_hi && (api.original_ball_z_hi() & 0x80) === 0) {
    const ball = originalBallPosition(api);
    if (drawOriginalBall(
      api,
      layout.x + (ball.x - cameraX) * layout.scale,
      layout.y + (ball.y - cameraY) * layout.scale,
      normalizeOriginalHeight(ball.z),
      layout.scale,
    )) drawnObjects.push(0x0c);
  }
  ctx.restore();
  if (DEBUG) {
    window.__soccerCreditsRenderer = {
      subtype, backgroundId, cameraX, cameraY,
      scene: api.original_credits_scene_index ? api.original_credits_scene_index() : 0,
      effectDone: api.original_credits_effect_done ? api.original_credits_effect_done() : 0,
      drawnObjects,
    };
  }
}
function playerLabel(api, index) {
  if (index == null || index >= 255) return "—";
  const role = api.original_player_role ? api.original_player_role(index) : index % 6;
  const team = api.player_team ? api.player_team(index) : (index % 2 === 0 ? 0 : 1);
  const cpuTeam = api.cpu_team_id ? api.cpu_team_id() : 1;
  const teamId = team === 0 ? 0 : cpuTeam;
  const name = (PLAYER_NAMES[teamId] && PLAYER_NAMES[teamId][role]) || `P${index}`;
  return `${name} ${ROLE_NAMES[role] || ""}`.trim();
}
function drawMenuOverlay(api) {
  const selected = api.menu_opponent_id ? api.menu_opponent_id() : (api.cpu_team_id ? api.cpu_team_id() : 1);
  const wins = api.tournament_wins ? api.tournament_wins() : 0;
  ctx.fillStyle = "rgba(0,0,0,.72)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff";
  ctx.font = "bold 36px system-ui, sans-serif";
  ctx.fillText("SELECT TEAM", canvas.width / 2, 104);
  ctx.font = "15px ui-monospace, Consolas, monospace";
  ctx.fillStyle = "#d7f7ff";
  ctx.fillText(`熱血  VS  ${TEAM_NAMES[selected] || "CPU"}     WIN ${wins}`, canvas.width / 2, 134);
  const startY = 176;
  for (let team = 1; team < TEAM_NAMES.length; team++) {
    const y = startY + (team - 1) * 48;
    const active = team === selected;
    const weatherId = team === 2 ? 1 : team === 3 ? 2 : team === 4 ? 3 : team === 5 ? 4 : 0;
    if (active) {
      ctx.fillStyle = "rgba(255,230,70,.22)";
      ctx.fillRect(canvas.width / 2 - 236, y - 26, 472, 38);
      ctx.strokeStyle = "rgba(255,230,70,.85)";
      ctx.strokeRect(canvas.width / 2 - 236, y - 26, 472, 38);
    }
    ctx.fillStyle = active ? "#ffe64a" : "#ffffff";
    ctx.font = active ? "bold 20px ui-monospace, Consolas, monospace" : "18px ui-monospace, Consolas, monospace";
    const cursor = active ? "▶" : " ";
    const spd = api.team_speed ? api.team_speedForMenu?.(team) : null;
    const speed = api.team_speed ? (team === selected ? api.team_speed(1) : "") : "";
    const pow = api.team_power ? (team === selected ? api.team_power(1) : "") : "";
    ctx.fillText(`${cursor} ${TEAM_NAMES[team]}   FIELD ${WEATHER_NAMES[weatherId]}`, canvas.width / 2, y);
    if (active) {
      ctx.font = "13px ui-monospace, Consolas, monospace";
      ctx.fillStyle = "#b8d5ff";
      ctx.fillText(`SPD ${speed}  POW ${pow}  KEEPER ${api.team_keeper ? api.team_keeper(1) : "?"}  SPECIAL ${api.team_special_curve ? api.team_special_curve(1) : "?"}`, canvas.width / 2, y + 20);
      const captain = (PLAYER_NAMES[team] && PLAYER_NAMES[team][3]) || "CAPTAIN";
      ctx.fillText(`CAPTAIN ${captain}`, canvas.width / 2 + 188, y + 20);
    }
  }
  ctx.fillStyle = "#fff";
  ctx.font = "16px system-ui, sans-serif";
  ctx.fillText("方向键/摇杆选择对手；PC：J/Z/Enter 开赛；手机：点 A开赛", canvas.width / 2, startY + 5 * 48 + 18);
  ctx.textAlign = "left";
}
function render(api) {
  gameWrap.classList.remove("original-result-screen");
  const worldW = api.game_field_w();
  const worldH = api.game_field_h();
  const screenW = canvas.width;
  const screenH = canvas.height;
  const phase = api.game_phase ? api.game_phase() : PHASE.PLAYING;
  const originalScreen = api.original_screen_number ? api.original_screen_number() : 0;
  synchronizeOriginalFieldFootprints(api, originalScreen);
  const originalField4x3 = originalFieldFullScreenActive(api);
  gameWrap.classList.toggle(
    "original-4x3-screen",
    phase === PHASE.TITLE || originalScreen === 0x02 || originalScreen === 0x03
      || originalField4x3,
  );
  if (phase === PHASE.TITLE) {
    drawOriginalSplash(api);
    return;
  }
  if (originalScreen === 0x02) {
    drawOriginalMenuScreen(api);
    return;
  }
  if (originalScreen === 0x03) {
    drawOriginalCreditsScreen(api);
    return;
  }
  const originalSubtype = api.original_screen_subtype ? api.original_screen_subtype() : 0;
  const cpuTeam = api.cpu_team_id ? api.cpu_team_id() : 1;
  const menuTeam = api.menu_opponent_id ? api.menu_opponent_id() : cpuTeam;
  const wins = api.tournament_wins ? api.tournament_wins() : 0;
  const ballPosition = originalBallPosition(api);
  const bx = ballPosition.x;
  const by = ballPosition.y;
  const bz = normalizeOriginalHeight(ballPosition.z);
  const bspin = api.ball_spin ? api.ball_spin() : Math.floor(api.game_tick_count() / 6);
  const bspecial = api.ball_special_timer ? api.ball_special_timer() : 0;
  const exposesOriginalCamera = api.original_camera_x_lo && api.original_camera_x_hi
    && api.original_camera_y_lo && api.original_camera_y_hi;
  const committedCamera = originalScreen === 0x00 ? originalCommittedCamera(api, false) : null;
  const rawCameraX = committedCamera?.x ?? (exposesOriginalCamera
    ? ((api.original_camera_x_hi() << 8) | api.original_camera_x_lo()) : 0);
  const rawCameraY = committedCamera?.y ?? (exposesOriginalCamera
    ? ((api.original_camera_y_hi() << 8) | api.original_camera_y_lo()) : 0);
  const cameraX = exposesOriginalCamera
    ? rawCameraX
    : clamp(bx - ORIGINAL_CAMERA_VIEW_W / 2, 0, 1024 - ORIGINAL_CAMERA_VIEW_W);
  const cameraY = exposesOriginalCamera
    ? rawCameraY
    : ORIGINAL_CAMERA_BASE_Y;
  const isOriginalResultScreen = originalScreen === 0x00
    && originalSubtype >= 0x04 && originalSubtype <= 0x0C
    && originalSubtype !== 0x06;
  gameWrap.classList.toggle("original-result-screen", isOriginalResultScreen);
  gameWrap.classList.toggle("original-4x3-screen", isOriginalResultScreen || originalField4x3);
  const resultBackgroundId = api.original_background_image_id
    ? api.original_background_image_id() & 0xFF : 0x10;
  const originalResultBaseBackground = isOriginalResultScreen
    ? originalAssets.menu[resultBackgroundId] : null;
  const originalResultBackground = isOriginalResultScreen
    ? composeOriginalResultBackground(api, resultBackgroundId, originalResultBaseBackground)
    : null;
  const committedCopyCamera = originalScreen === 0x00 ? originalCommittedCamera(api, true) : null;
  const copyCameraX = committedCopyCamera?.x ?? (api.original_copy_camera_x_lo && api.original_copy_camera_x_hi
    ? (api.original_copy_camera_x_hi() << 8) | api.original_copy_camera_x_lo()
    : cameraX);
  const copyCameraY = committedCopyCamera?.y ?? (api.original_copy_camera_y_lo && api.original_copy_camera_y_hi
    ? (api.original_copy_camera_y_hi() << 8) | api.original_copy_camera_y_lo()
    : cameraY);
  let view;
  let objectView;
  if (isOriginalResultScreen) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const layout = originalFullScreenLayout();
    if (originalResultBackground) {
      const brightness = api.original_current_brightness
        ? api.original_current_brightness() : 0x40;
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = Math.max(0, Math.min(1, brightness / 0x40));
      const resultWidth = originalResultBackground.naturalWidth || originalResultBackground.width;
      if (resultWidth >= 0x200) {
        const sourceX = clamp(copyCameraX, 0, resultWidth - 0x100);
        ctx.drawImage(
          originalResultBackground,
          sourceX, 0, 0x100, 0xF0,
          layout.x, layout.y, layout.w, layout.h,
        );
      } else {
        ctx.drawImage(originalResultBackground, layout.x, layout.y, layout.w, layout.h);
      }
      ctx.globalAlpha = 1;
    }
    view = {
      original: true,
      cameraX: copyCameraX,
      cameraY: copyCameraY,
      sourceX: copyCameraX,
      sourceY: copyCameraY,
      sourceW: 0x100,
      sourceH: 0xF0,
      destX: layout.x,
      destY: layout.y,
      destW: layout.w,
      destH: layout.h,
      logicalScale: layout.scale,
      screenW,
      screenH,
      worldW,
      worldH,
    };
    objectView = view;
  } else {
    view = drawField(api, screenW, screenH, worldW, worldH, cameraX, cameraY);
    drawWeather(api, view, screenW, screenH);
    objectView = view;
  }
  if (DEBUG) {
    window.__soccerView = { cameraX: view.cameraX, cameraY: view.cameraY, sourceX: view.sourceX, sourceY: view.sourceY, sourceW: view.sourceW, sourceH: view.sourceH, destX: view.destX, destY: view.destY, destW: view.destW, destH: view.destH };
    window.__soccerObjectView = isOriginalResultScreen ? {
      cameraX: objectView.cameraX,
      cameraY: objectView.cameraY,
      sourceW: objectView.sourceW,
      sourceH: objectView.sourceH,
      destX: objectView.destX,
      destY: objectView.destY,
      destW: objectView.destW,
      destH: objectView.destH,
      backgroundId: resultBackgroundId,
      hasBackground: Boolean(originalResultBackground),
    } : null;
  }
  const count = api.player_count ? api.player_count() : 1;
  const sourceControlled = api.original_controlled_player ? api.original_controlled_player(0) : 0xFF;
  const controlled = sourceControlled < count
    ? sourceControlled
    : (api.controlled_player ? api.controlled_player() : 0);
  const playerPositions = [];
  const markerPositions = [];
  for (let i = 0; i < count; i++) {
    if (api.player_active && !api.player_active(i)) continue;
    const originalPosition = originalPlayerPosition(api, i);
    playerPositions[i] = originalPosition;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(objectView.destX, objectView.destY, objectView.destW, objectView.destH);
  ctx.clip();
  let entities = [];
  if (!isOriginalResultScreen && api.original_animation_priority_count && api.original_animation_priority) {
    const useCommittedPriority = originalCommittedSpriteFrameActive(api)
      && api.original_committed_animation_priority_count
      && api.original_committed_animation_priority;
    const priorityCount = Math.min(useCommittedPriority
      ? api.original_committed_animation_priority_count()
      : api.original_animation_priority_count(), 0x20);
    const seen = new Set();
    for (let slot = priorityCount - 1; slot >= 0; slot--) {
      const entry = useCommittedPriority
        ? api.original_committed_animation_priority(slot)
        : api.original_animation_priority(slot);
      const object = entry & 0x1F;
      const variant = entry & 0xE0;
      if (variant === 0x20 || variant === 0x40) {
        if (object === 0x0C) {
          if (originalObjectVisibleForCommittedFrame(api, object)) {
            entities.push({ type: "shadow", kind: variant === 0x20 ? "state" : "air", index: object });
          }
        } else if (object < count && (!api.player_active || api.player_active(object))
            && originalObjectVisibleForCommittedFrame(api, object)) {
          entities.push({ type: "shadow", kind: variant === 0x20 ? "state" : "air", index: object });
        }
        continue;
      }
      if ((entry & 0x60) !== 0) continue;
      if (seen.has(object)) continue;
      if (object === 0x0C) {
        if (originalObjectVisibleForCommittedFrame(api, object)) {
          entities.push({ type: "ball", groundY: by });
          seen.add(object);
        }
      } else if (object >= 0x0E && object <= 0x12 && api.original_field_marker_animation) {
        const markerSlot = object - 0x0E;
        const originalPosition = originalFieldMarkerPosition(api, markerSlot);
        const visible = !api.original_field_marker_visibility
          || api.original_field_marker_visibility(markerSlot) !== 0;
        markerPositions[markerSlot] = originalPosition;
        if (originalPosition && visible && normalizeOriginalHeight(originalPosition.z) !== 0) {
          entities.push({ type: "marker", index: markerSlot, object, groundY: originalPosition.y });
          seen.add(object);
        }
      } else if (object < count && (!api.player_active || api.player_active(object))) {
        const originalPosition = playerPositions[object] || originalPlayerPosition(api, object);
        playerPositions[object] = originalPosition;
        entities.push({ type: "player", index: object, groundY: originalPosition.y });
        seen.add(object);
      }
    }
  } else {
    entities = [{ type: "ball", groundY: by }];
    for (let i = 0; i < count; i++) {
      if (api.player_active && !api.player_active(i)) continue;
      const originalPosition = playerPositions[i] || originalPlayerPosition(api, i);
      playerPositions[i] = originalPosition;
      entities.push({ type: "player", index: i, groundY: originalPosition.y });
    }
    entities.sort((a, b) => a.groundY - b.groundY);
  }
  const renderedShadows = [];
  const renderedObjects = [];
  for (const entity of entities) {
    if (entity.type === "shadow") {
      const position = entity.index === 0x0C
        ? { x: bx, y: by }
        : (playerPositions[entity.index] || originalPlayerPosition(api, entity.index));
      const screenPosition = originalCommittedObjectCanvasPosition(
        api, entity.index, objectView, true,
      ) || worldToScreen(objectView, position.x, position.y);
      const rendered = drawOriginalObjectShadow(
        api,
        entity.index,
        entity.kind,
        screenPosition.x,
        screenPosition.y,
        objectView.logicalScale || 2,
      );
      if (rendered) renderedShadows.push(rendered);
      renderedObjects.push({ type: "shadow", index: entity.index, x: screenPosition.x, y: screenPosition.y });
      continue;
    }
    if (entity.type === "ball") {
      const committed = originalCommittedObjectCanvasPosition(api, 0x0C, objectView, false);
      const b = committed || worldToScreen(objectView, bx, by);
      if (committed) drawOriginalObject(api, 0x0C, b.x, b.y, objectView.logicalScale || 2);
      else drawOriginalBall(api, b.x, b.y, bz, objectView.logicalScale || 2);
      renderedObjects.push({ type: "ball", index: 0x0C, x: b.x, y: b.y });
      continue;
    }
    if (entity.type === "marker") {
      const originalPosition = markerPositions[entity.index]
        || originalFieldMarkerPosition(api, entity.index);
      if (!originalPosition) continue;
      const committed = originalCommittedObjectCanvasPosition(api, entity.object, objectView, false);
      const p = committed || worldToScreen(objectView, originalPosition.x, originalPosition.y);
      const height = committed ? 0 : normalizeOriginalHeight(originalPosition.z);
      drawOriginalObject(
        api,
        entity.object,
        p.x,
        p.y - height * (objectView.logicalScale || 1),
        objectView.logicalScale || 2,
      );
      renderedObjects.push({ type: "marker", index: entity.object, x: p.x, y: p.y - height * (objectView.logicalScale || 1) });
      continue;
    }
    const i = entity.index;
    const originalPosition = playerPositions[i] || originalPlayerPosition(api, i);
    const committed = originalCommittedObjectCanvasPosition(api, i, objectView, false);
    const p = committed || worldToScreen(objectView, originalPosition.x, originalPosition.y);
    const playerHeight = committed ? 0 : normalizeOriginalHeight(originalPosition.z);
    const visualY = p.y - playerHeight * (objectView.logicalScale || 1);
    drawOriginalObject(api, i, p.x, visualY, objectView.logicalScale || 2);
    renderedObjects.push({ type: "player", index: i, x: p.x, y: visualY });
  }
  if (DEBUG) window.__soccerShadows = renderedShadows;
  if (DEBUG) window.__soccerRenderedObjects = renderedObjects;
  if (DEBUG) {
    const overhead = entities.find((entity) => entity.type === "marker" && entity.index > 0);
    const position = overhead ? markerPositions[overhead.index] : null;
    const screen = position ? worldToScreen(objectView, position.x, position.y) : null;
    window.__soccerControlledMarker = overhead && position && screen ? {
      object: overhead.object,
      slot: overhead.index - 1,
      index: api.original_controlled_player ? api.original_controlled_player(overhead.index - 1) & 0xFF : 0xFF,
      worldX: position.x,
      worldY: position.y,
      worldZ: position.z,
      screenX: screen.x,
      screenY: screen.y,
      fieldKey: originalAssets.field?.compositeKey || "",
    } : null;
  }
  if (!isOriginalResultScreen) drawOriginalWeatherSprites(api, objectView);
  ctx.restore();
  const drewOriginalMinimap = !isOriginalResultScreen && drawOriginalMatchStatusbar(api, objectView);
  if (DEBUG && !drewOriginalMinimap) window.__soccerMinimap = { visible: false, markers: [] };
  if (!isOriginalResultScreen) drawScore(api, screenW, drewOriginalMinimap);
  if (DEBUG && !isOriginalResultScreen) {
    const stamina = api.player_stamina(controlled);
    const controlledInjury = api.player_injury ? api.player_injury(controlled) : 0;
    ctx.fillStyle = "rgba(0,0,0,.45)";
    ctx.fillRect(16, 16, 132, 16);
    ctx.fillStyle = stamina > 30 ? "#62e572" : "#ffcc4d";
    ctx.fillRect(18, 18, Math.max(0, stamina) * 1.28, 12);
    ctx.fillStyle = "#ff7777";
    ctx.font = "11px ui-monospace, Consolas, monospace";
    ctx.fillText(`INJ ${controlledInjury}`, 154, 28);
    if (api.player_role_speed) {
      ctx.fillStyle = "rgba(0,0,0,.45)";
      ctx.fillRect(16, 36, 260, 18);
      ctx.fillStyle = "#d7f7ff";
      const rs = api.player_role_speed(controlled);
      const rp = api.player_role_power(controlled);
      const rt = api.player_role_tackle(controlled);
      const rk = api.player_role_keeper(controlled);
      ctx.fillText(`ROLE SPD ${rs} POW ${rp} TKL ${rt} GK ${rk}`, 20, 49);
    }
  }
  if (originalScreen !== 0x00) {
    if (phase === PHASE.KICKOFF) drawOverlay("KICK OFF", ["PC：按 J / Z 开球", "手机：点 A开球，然后摇杆移动"]);
    if (phase === PHASE.GOAL) {
      const scorer = api.last_goal_player ? api.last_goal_player() : 255;
      const assist = api.last_assist_player ? api.last_assist_player() : 255;
      const own = api.last_goal_is_own ? api.last_goal_is_own() : 0;
      drawOverlay("GOAL!", [
        `比分 ${api.score_left()} - ${api.score_right()}`,
        own ? "OWN GOAL" : `SCORER ${playerLabel(api, scorer)}`,
        assist < 255 ? `ASSIST ${playerLabel(api, assist)}` : "NO ASSIST",
      ]);
    }
    if (phase === PHASE.HALFTIME) drawOverlay("HALF TIME", ["换边，下半场准备", "PC：按 J / Z 继续", "手机：点 A继续"]);
    if (phase === PHASE.FULL_TIME) drawOverlay("FULL TIME", [`最终比分 ${api.score_left()} - ${api.score_right()}`, api.score_left() > api.score_right() ? "胜利：下场对手升级" : "败北/平局：重新挑战", "PC：按 J / Z 返回菜单", "手机：点 A返回菜单"]);
    if (phase === PHASE.THROW_IN) drawOverlay("THROW IN", ["PC：按 J / Z 继续", "手机：点 A继续"]);
    if (phase === PHASE.GOAL_KICK) drawOverlay("GOAL KICK", ["PC：按 J / Z 继续", "手机：点 A继续"]);
    if (phase === PHASE.CORNER_KICK) drawOverlay("CORNER KICK", ["PC：按 J / Z 继续", "手机：点 A继续"]);
    if (phase === PHASE.FREE_KICK) drawOverlay("FREE KICK", [`犯规队 ${api.foul_team ? TEAM_NAMES[api.foul_team()] || api.foul_team() : "?"}`, "PC：按 J / Z 继续", "手机：点 A继续"]);
    if (phase === PHASE.PENALTY_KICK) drawOverlay("PENALTY KICK", [`禁区犯规：${api.foul_team ? TEAM_NAMES[api.foul_team()] || api.foul_team() : "?"}`, "PC：按 J / Z 射门", "手机：点 A射门"]);
    if (phase === PHASE.PAUSE) drawOverlay("PAUSE", ["START 继续", "原作暂停：A / B 不会解除暂停"]);
  }
  const restart = api.restart_team ? api.restart_team() : 0;
  const lastTouch = api.last_touch_team ? api.last_touch_team() : 0;
  const action = api.player_action ? api.player_action(controlled) : 0;
  const charge = api.shot_charge ? api.shot_charge() : 0;
  const curve = api.ball_curve ? api.ball_curve() : 0;
  const keeper = api.keeper_outcome ? api.keeper_outcome() : 0;
  const hold = api.keeper_hold_timer ? api.keeper_hold_timer() : 0;
  const special = api.ball_special_timer ? api.ball_special_timer() : 0;
  const period = api.current_period ? api.current_period() : 1;
  const swapped = api.side_swapped ? api.side_swapped() : 0;
  const fouls = `${api.foul_count_left ? api.foul_count_left() : 0}-${api.foul_count_right ? api.foul_count_right() : 0}`;
  const foulTeam = api.foul_team ? api.foul_team() : 0;
  const weather = api.field_weather ? api.field_weather() : 0;
  const hazards = api.field_hazard_count ? api.field_hazard_count() : 0;
  const wind = `${api.field_wind_x ? api.field_wind_x() : 0}/${api.field_wind_y ? api.field_wind_y() : 0}`;
  const specialShots = `${api.special_count_left ? api.special_count_left() : 0}-${api.special_count_right ? api.special_count_right() : 0}`;
  const lastSpecial = api.last_special_team ? api.last_special_team() : 0;
  const injuries = `${api.injury_count_left ? api.injury_count_left() : 0}-${api.injury_count_right ? api.injury_count_right() : 0}`;
  const lastHurt = `${api.last_hurt_team ? api.last_hurt_team() : 0}/${api.last_hurt_player ? api.last_hurt_player() : 0}`;
  const lastTouchPlayer = api.last_touch_player ? api.last_touch_player() : 255;
  const originalOwner = api.original_ball_owner ? api.original_ball_owner() : 0;
  const goalInfo = `${api.last_goal_team ? api.last_goal_team() : 0}/${api.last_goal_player ? api.last_goal_player() : 255}/${api.last_assist_player ? api.last_assist_player() : 255}/${api.last_goal_is_own ? api.last_goal_is_own() : 0}`;
  const roleInfo = api.player_role_speed ? `${api.player_role_speed(controlled)}/${api.player_role_power(controlled)}/${api.player_role_stamina(controlled)}/${api.player_role_tackle(controlled)}/${api.player_role_keeper(controlled)}` : "0";
  const playerOrig = api.original_player_motion ? `${api.original_player_motion(controlled).toString(16).padStart(2, "0")}/${api.original_player_action(controlled).toString(16).padStart(2, "0")}/${api.original_player_state(controlled).toString(16).padStart(2, "0")}` : "??/??/??";
  const playerDispatch = api.original_player_current_motion_dispatch_addr ? api.original_player_current_motion_dispatch_addr(controlled).toString(16).padStart(4, "0") : "????";
  const playerMainDispatch = api.original_player_current_main_motion_dispatch_addr ? api.original_player_current_main_motion_dispatch_addr(controlled).toString(16).padStart(4, "0") : "????";
  const playerAnimDispatch = api.original_player_current_animation_script_addr
    ? api.original_player_current_animation_script_addr(controlled).toString(16).padStart(4, "0")
    : (api.original_player_current_animation_script_dispatch_addr ? api.original_player_current_animation_script_dispatch_addr(controlled).toString(16).padStart(4, "0") : "????");
  const playerRam = api.original_player_x_lo
    ? `${api.original_player_x_hi(controlled).toString(16).padStart(2, "0")}${api.original_player_x_lo(controlled).toString(16).padStart(2, "0")}/${api.original_player_y_hi(controlled).toString(16).padStart(2, "0")}${api.original_player_y_lo(controlled).toString(16).padStart(2, "0")}/${api.original_player_z_hi(controlled).toString(16).padStart(2, "0")}${api.original_player_z_lo(controlled).toString(16).padStart(2, "0")}`
    : "????/????/????";
  const pauseReturn = api.pause_return_phase ? api.pause_return_phase() : 3;
  const script = api.original_game_script ? api.original_game_script().toString(16).padStart(2, "0") : "??";
  const ballObj = api.original_ball_object_id ? api.original_ball_object_id().toString(16).padStart(2, "0") : "??";
  const ballDispatch = api.original_ball_current_motion_dispatch_addr
    ? api.original_ball_current_motion_dispatch_addr().toString(16).padStart(4, "0")
    : "????";
  const ballRam = api.original_ball_x_lo
    ? `${api.original_ball_x_hi().toString(16).padStart(2, "0")}${api.original_ball_x_lo().toString(16).padStart(2, "0")}/${api.original_ball_y_hi().toString(16).padStart(2, "0")}${api.original_ball_y_lo().toString(16).padStart(2, "0")}/${api.original_ball_z_hi().toString(16).padStart(2, "0")}${api.original_ball_z_lo().toString(16).padStart(2, "0")}`
    : "????/????/????";
  const ballState = api.original_ball_motion
    ? `${api.original_ball_motion().toString(16).padStart(2, "0")}/${api.original_ball_shot_type().toString(16).padStart(2, "0")}/${api.original_ball_state().toString(16).padStart(2, "0")}/${api.original_ball_action_timer().toString(16).padStart(2, "0")}/${api.original_ball_hp().toString(16).padStart(2, "0")}`
    : "??/??/??/??/??";
  const ballAnim = api.original_ball_animation
    ? `${api.original_ball_animation().toString(16).padStart(2, "0")}/${api.original_ball_anim_frame().toString(16).padStart(2, "0")}/${api.original_ball_anim_timer().toString(16).padStart(2, "0")}`
    : "??/??/??";
  const ballSpeedRam = api.original_ball_spd_x_lo
    ? `${api.original_ball_spd_x_hi().toString(16).padStart(2, "0")}${api.original_ball_spd_x_lo().toString(16).padStart(2, "0")}/${api.original_ball_spd_y_hi().toString(16).padStart(2, "0")}${api.original_ball_spd_y_lo().toString(16).padStart(2, "0")}/${api.original_ball_spd_z_hi().toString(16).padStart(2, "0")}${api.original_ball_spd_z_lo().toString(16).padStart(2, "0")}/g${api.original_ball_gravity_hi().toString(16).padStart(2, "0")}${api.original_ball_gravity_lo().toString(16).padStart(2, "0")}`
    : "????/????/????/g????";
  const btnHold = api.debug_original_button_ram ? api.debug_original_button_ram(0, 0x04).toString(16).padStart(2, "0") : "??";
  const btnPress = api.debug_original_button_ram ? api.debug_original_button_ram(0, 0x08).toString(16).padStart(2, "0") : "??";
  if (DEBUG) {
    stats.hidden = false;
    stats.textContent = `build=${BUILD_ID} phase=${phase} input=$${touch.lastBits.toString(16).padStart(2, "0")} stick=${touch.axisX}/${touch.axisY} btn=${btnHold}/${btnPress} script=$${script} pauseRet=${pauseReturn} period=${period} swap=${swapped} cpu=${cpuTeam} menu=${menuTeam} wins=${wins} weather=${weather} hazards=${hazards} wind=${wind} score=${api.score_left()}-${api.score_right()} goal=${goalInfo} fouls=${fouls} foulTeam=${foulTeam} injuries=${injuries} lastHurt=${lastHurt} spShots=${specialShots} lastSp=${lastSpecial} time=${api.match_seconds_left()} tick=${api.game_tick_count()} players=${count} role=${roleInfo} pOrig=${playerOrig}@${playerDispatch}/${playerMainDispatch}/${playerAnimDispatch} pRam=${playerRam} ballObj=$${ballObj}@${ballDispatch} ballRam=${ballRam} ballState=${ballState} ballAnim=${ballAnim} ballSpeed=${ballSpeedRam} owner=${originalOwner} camera=${cameraX.toString(16)}/${cameraY.toString(16)} ball=(${bx},${by},z=${bz}) curve=${curve} special=${special} act=${action} charge=${charge} keeper=${keeper}/${hold} touch=${lastTouch}/${lastTouchPlayer} restart=${restart}`;
  }
}
async function main() {
  const menuScreensPromise = Promise.all(ORIGINAL_BACKGROUND_SCREEN_IDS.map(async (id) => {
    const suffix = id >= 0x10 && id <= 0x12 ? "_wide" : "";
    const name = `screen_${id.toString(16).padStart(2, "0")}${suffix}.png`;
    const image = await withFallback(name, originalAssetUrl(name), originalFallbackUrl(name), loadImage);
    return [id, image];
  })).then((entries) => Object.fromEntries(entries));
  const creditsTilesPromise = Promise.all(ORIGINAL_CREDITS_SCREEN_IDS.map(async (id) => {
    const name = `credits_tiles_${id.toString(16).padStart(2, "0")}.png`;
    const image = await withFallback(name, originalAssetUrl(name), originalFallbackUrl(name), loadImage);
    return [id, image];
  })).then((entries) => Object.fromEntries(entries));
  const [api, chr, chrAlt, field, spriteManifest, spriteIndexImage, palettes, statusbarRenderer, splashLogo, splashTitle, splashTitleBlink, splashStory, resultScreenManifest, resultRenderer, modeSelectionScreenManifest, modeSelectionTiles, opponentSelectionScreenManifest, opponentSelectionTiles, teamPreviewScreenManifest, playerOrderScreenManifest, playerOrderTiles, bracketScreenManifest, bracketRenderer, bracketTiles, matchSettingsScreenManifest, matchSettingsRenderer, matchSettingsTiles, formationControlScreenManifest, formationControlRenderer, formationControlTiles, weatherPreviewScreenManifest, weatherPreviewRenderer, weatherPreviewTiles, tournamentRecordScreenManifest, tournamentRecordRenderer, tournamentRecordTiles, playerProfileScreenManifest, playerProfileRenderer, playerProfileTiles, musicSelectionScreenManifest, musicSelectionRenderer, musicSelectionTiles, meetingSecretScreenManifest, meetingSecretRenderer, meetingSecretTiles0a, meetingSecretTiles0f, creditsScreenManifest, creditsTiles, menuScreens] = await Promise.all([
    loadWasm(),
    withFallback("chr_sprite_pal_01.png", originalAssetUrl("chr_sprite_pal_01.png"), originalFallbackUrl("chr_sprite_pal_01.png"), loadImage),
    withFallback("chr_sprite_pal_08.png", originalAssetUrl("chr_sprite_pal_08.png"), originalFallbackUrl("chr_sprite_pal_08.png"), loadImage),
    loadOriginalFieldAssets(),
    withFallback("sprite_renderer.json", originalAssetUrl("sprite_renderer.json"), originalFallbackUrl("sprite_renderer.json"), loadJson),
    withFallback("sprite_chr_indices.png", originalAssetUrl("sprite_chr_indices.png"), originalFallbackUrl("sprite_chr_indices.png"), loadImage),
    withFallback("palettes.json", originalAssetUrl("palettes.json"), originalFallbackUrl("palettes.json"), loadJson),
    withFallback("statusbar_renderer.json", originalAssetUrl("statusbar_renderer.json"), originalFallbackUrl("statusbar_renderer.json"), loadJson),
    withFallback("splash_00_logo.png", originalAssetUrl("splash_00_logo.png"), originalFallbackUrl("splash_00_logo.png"), loadImage),
    withFallback("splash_01_title.png", originalAssetUrl("splash_01_title.png"), originalFallbackUrl("splash_01_title.png"), loadImage),
    withFallback("splash_01_title_blink.png", originalAssetUrl("splash_01_title_blink.png"), originalFallbackUrl("splash_01_title_blink.png"), loadImage),
    withFallback("splash_0e_story.png", originalAssetUrl("splash_0e_story.png"), originalFallbackUrl("splash_0e_story.png"), loadImage),
    withFallback("result_screen_manifest.json", originalAssetUrl("result_screen_manifest.json"), originalFallbackUrl("result_screen_manifest.json"), loadJson),
    withFallback("result_renderer.json", originalAssetUrl("result_renderer.json"), originalFallbackUrl("result_renderer.json"), loadJson),
    withFallback("mode_selection_screen_manifest.json", originalAssetUrl("mode_selection_screen_manifest.json"), originalFallbackUrl("mode_selection_screen_manifest.json"), loadJson),
    withFallback("mode_selection_tiles.png", originalAssetUrl("mode_selection_tiles.png"), originalFallbackUrl("mode_selection_tiles.png"), loadImage),
    withFallback("opponent_selection_screen_manifest.json", originalAssetUrl("opponent_selection_screen_manifest.json"), originalFallbackUrl("opponent_selection_screen_manifest.json"), loadJson),
    withFallback("opponent_selection_tiles.png", originalAssetUrl("opponent_selection_tiles.png"), originalFallbackUrl("opponent_selection_tiles.png"), loadImage),
    withFallback("team_preview_screen_manifest.json", originalAssetUrl("team_preview_screen_manifest.json"), originalFallbackUrl("team_preview_screen_manifest.json"), loadJson),
    withFallback("player_order_screen_manifest.json", originalAssetUrl("player_order_screen_manifest.json"), originalFallbackUrl("player_order_screen_manifest.json"), loadJson),
    withFallback("player_order_tiles.png", originalAssetUrl("player_order_tiles.png"), originalFallbackUrl("player_order_tiles.png"), loadImage),
    withFallback("bracket_screen_manifest.json", originalAssetUrl("bracket_screen_manifest.json"), originalFallbackUrl("bracket_screen_manifest.json"), loadJson),
    withFallback("bracket_renderer.json", originalAssetUrl("bracket_renderer.json"), originalFallbackUrl("bracket_renderer.json"), loadJson),
    withFallback("bracket_tiles.png", originalAssetUrl("bracket_tiles.png"), originalFallbackUrl("bracket_tiles.png"), loadImage),
    withFallback("match_settings_screen_manifest.json", originalAssetUrl("match_settings_screen_manifest.json"), originalFallbackUrl("match_settings_screen_manifest.json"), loadJson),
    withFallback("match_settings_renderer.json", originalAssetUrl("match_settings_renderer.json"), originalFallbackUrl("match_settings_renderer.json"), loadJson),
    withFallback("match_settings_tiles.png", originalAssetUrl("match_settings_tiles.png"), originalFallbackUrl("match_settings_tiles.png"), loadImage),
    withFallback("formation_control_screen_manifest.json", originalAssetUrl("formation_control_screen_manifest.json"), originalFallbackUrl("formation_control_screen_manifest.json"), loadJson),
    withFallback("formation_control_renderer.json", originalAssetUrl("formation_control_renderer.json"), originalFallbackUrl("formation_control_renderer.json"), loadJson),
    withFallback("formation_control_tiles.png", originalAssetUrl("formation_control_tiles.png"), originalFallbackUrl("formation_control_tiles.png"), loadImage),
    withFallback("weather_preview_screen_manifest.json", originalAssetUrl("weather_preview_screen_manifest.json"), originalFallbackUrl("weather_preview_screen_manifest.json"), loadJson),
    withFallback("weather_preview_renderer.json", originalAssetUrl("weather_preview_renderer.json"), originalFallbackUrl("weather_preview_renderer.json"), loadJson),
    withFallback("weather_preview_tiles.png", originalAssetUrl("weather_preview_tiles.png"), originalFallbackUrl("weather_preview_tiles.png"), loadImage),
    withFallback("tournament_record_screen_manifest.json", originalAssetUrl("tournament_record_screen_manifest.json"), originalFallbackUrl("tournament_record_screen_manifest.json"), loadJson),
    withFallback("tournament_record_renderer.json", originalAssetUrl("tournament_record_renderer.json"), originalFallbackUrl("tournament_record_renderer.json"), loadJson),
    withFallback("tournament_record_tiles.png", originalAssetUrl("tournament_record_tiles.png"), originalFallbackUrl("tournament_record_tiles.png"), loadImage),
    withFallback("player_profile_screen_manifest.json", originalAssetUrl("player_profile_screen_manifest.json"), originalFallbackUrl("player_profile_screen_manifest.json"), loadJson),
    withFallback("player_profile_renderer.json", originalAssetUrl("player_profile_renderer.json"), originalFallbackUrl("player_profile_renderer.json"), loadJson),
    withFallback("player_profile_tiles.png", originalAssetUrl("player_profile_tiles.png"), originalFallbackUrl("player_profile_tiles.png"), loadImage),
    withFallback("music_selection_screen_manifest.json", originalAssetUrl("music_selection_screen_manifest.json"), originalFallbackUrl("music_selection_screen_manifest.json"), loadJson),
    withFallback("music_selection_renderer.json", originalAssetUrl("music_selection_renderer.json"), originalFallbackUrl("music_selection_renderer.json"), loadJson),
    withFallback("music_selection_tiles.png", originalAssetUrl("music_selection_tiles.png"), originalFallbackUrl("music_selection_tiles.png"), loadImage),
    withFallback("meeting_secret_screen_manifest.json", originalAssetUrl("meeting_secret_screen_manifest.json"), originalFallbackUrl("meeting_secret_screen_manifest.json"), loadJson),
    withFallback("meeting_secret_renderer.json", originalAssetUrl("meeting_secret_renderer.json"), originalFallbackUrl("meeting_secret_renderer.json"), loadJson),
    withFallback("meeting_secret_tiles_0a.png", originalAssetUrl("meeting_secret_tiles_0a.png"), originalFallbackUrl("meeting_secret_tiles_0a.png"), loadImage),
    withFallback("meeting_secret_tiles_0f.png", originalAssetUrl("meeting_secret_tiles_0f.png"), originalFallbackUrl("meeting_secret_tiles_0f.png"), loadImage),
    withFallback("credits_screen_manifest.json", originalAssetUrl("credits_screen_manifest.json"), originalFallbackUrl("credits_screen_manifest.json"), loadJson),
    creditsTilesPromise,
    menuScreensPromise,
  ]);
  originalAssets.chr = chr;
  originalAssets.chrAlt = chrAlt;
  originalAssets.field = field;
  originalAssets.sprite.manifest = spriteManifest;
  originalAssets.sprite.indexImage = spriteIndexImage;
  originalAssets.sprite.palettes = palettes;
  originalAssets.statusbar.manifest = statusbarRenderer;
  initializeOriginalSpritePixels();
  originalAssets.splash = { 0: splashLogo, 1: splashTitle, 0x0e: splashStory, titleBlink: splashTitleBlink };
  originalAssets.menu = menuScreens;
  originalAssets.result.manifest = resultScreenManifest;
  originalAssets.result.scripts = resultRenderer;
  originalAssets.modeSelection.manifest = modeSelectionScreenManifest;
  originalAssets.modeSelection.tileImage = modeSelectionTiles;
  originalAssets.opponentSelection.manifest = opponentSelectionScreenManifest;
  originalAssets.opponentSelection.tileImage = opponentSelectionTiles;
  originalAssets.teamPreview.manifest = teamPreviewScreenManifest;
  originalAssets.playerOrder.manifest = playerOrderScreenManifest;
  originalAssets.playerOrder.tileImage = playerOrderTiles;
  originalAssets.bracket.manifest = bracketScreenManifest;
  originalAssets.bracket.scripts = bracketRenderer;
  originalAssets.bracket.tileImage = bracketTiles;
  originalAssets.matchSettings.manifest = matchSettingsScreenManifest;
  originalAssets.matchSettings.scripts = matchSettingsRenderer;
  originalAssets.matchSettings.tileImage = matchSettingsTiles;
  originalAssets.formationControl.manifest = formationControlScreenManifest;
  originalAssets.formationControl.scripts = formationControlRenderer;
  originalAssets.formationControl.tileImage = formationControlTiles;
  originalAssets.weatherPreview.manifest = weatherPreviewScreenManifest;
  originalAssets.weatherPreview.scripts = weatherPreviewRenderer;
  originalAssets.weatherPreview.tileImage = weatherPreviewTiles;
  originalAssets.tournamentRecord.manifest = tournamentRecordScreenManifest;
  originalAssets.tournamentRecord.scripts = tournamentRecordRenderer;
  originalAssets.tournamentRecord.tileImage = tournamentRecordTiles;
  originalAssets.playerProfile.manifest = playerProfileScreenManifest;
  originalAssets.playerProfile.scripts = playerProfileRenderer;
  originalAssets.playerProfile.tileImage = playerProfileTiles;
  originalAssets.musicSelection.manifest = musicSelectionScreenManifest;
  originalAssets.musicSelection.scripts = musicSelectionRenderer;
  originalAssets.musicSelection.tileImage = musicSelectionTiles;
  originalAssets.meetingSecret.manifest = meetingSecretScreenManifest;
  originalAssets.meetingSecret.scripts = meetingSecretRenderer;
  originalAssets.meetingSecret.tileImages = {
    "10": meetingSecretTiles0a,
    "15": meetingSecretTiles0f,
  };
  originalAssets.credits.manifest = creditsScreenManifest;
  originalAssets.credits.tileImages = creditsTiles;
  wasmNesApu.bindCore(api);
  api.game_init();
  if (DEBUG) {
    window.__soccerApi = api;
    window.__soccerCore = () => ({
      kind: CORE_KIND,
      assets: api.cpp_asset_loaded_count ? api.cpp_asset_loaded_count() : 0,
      bytes: api.cpp_asset_loaded_bytes ? api.cpp_asset_loaded_bytes() : 0,
    });
    window.__soccerRender = () => render(api);
    window.__soccerInputBits = () => inputBits();
    window.__soccerFootprints = () => ({
      serial: originalAssets.field?.footprintSerial ?? null,
      marks: Array.from(originalAssets.field?.footprints?.values?.() || []),
    });
    window.__soccerField = () => ({
      key: originalAssets.field?.compositeKey || "",
      loadedKeys: Object.keys(originalAssets.field?.images || {}),
      source: originalAssets.field?.manifest?.source || "",
    });
    window.__soccerConsumeTouchTapLatchSoftwareFrame = () => consumeTapLatchesAfterSoftwareFrame();
    window.__soccerSpriteFrame = (index) => {
      const frame = resolveOriginalObjectFrame(api, index);
      if (!frame) return null;
      return {
        animation: frame.animation,
        group: frame.groupNumber,
        address: frame.frameAddress ?? null,
        count: frame.frame?.count ?? 1,
        specialTile: frame.specialTile ?? null,
      };
    };
  }
  sfx.lastScore = `${api.score_left()}-${api.score_right()}`;
  sfx.lastPhase = api.game_phase ? api.game_phase() : PHASE.TITLE;
  let last = performance.now();
  let acc = 0;
  const ntscRateNumerator = api.platform_ntsc_video_rate_numerator();
  const ntscRateDenominator = api.platform_ntsc_video_rate_denominator();
  const stepMs = 1000 * ntscRateDenominator / ntscRateNumerator;
  const usesOriginalVideoScheduler = Boolean(api.game_video_frame);
  const advanceVideoFrame = api.game_video_frame || api.game_tick;
  const advanceInputVideoFrame = () => {
    const bits = inputBits();
    const ranSoftwareFrame = advanceVideoFrame(bits);
    wasmNesApu.advanceFrame();
    if (wasmNesApu.claimsAudio) {
      drainOriginalSoundEvents(api, (soundId) => wasmNesApu.handleSoundEvent(soundId));
    }
    if (!usesOriginalVideoScheduler || ranSoftwareFrame) {
      consumeTapLatchesAfterSoftwareFrame();
    }
    return { bits, ranSoftwareFrame: usesOriginalVideoScheduler ? ranSoftwareFrame : 1 };
  };
  if (DEBUG) window.__soccerAdvanceInputVideoFrame = advanceInputVideoFrame;
  function frame(now) {
    if (resetRequested) {
      api.game_init();
      wasmNesApu.reset();
      resetRequested = false;
    }
    acc += now - last; last = now; acc = Math.min(acc, stepMs * 8);
    while (acc >= stepMs) { advanceInputVideoFrame(); acc -= stepMs; }
    render(api);
    updateSfx(api);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
main().catch((err) => { console.error(err); stats.hidden = false; stats.textContent = `启动失败：${err.message}`; });