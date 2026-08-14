import { WasmNesApuAudioAdapter } from "./wasm-nes-apu-audio.eb14abb4.js";
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
const keys = new Set();
let resetRequested = false;
const keyTapLatch = { kick: 0, sprint: 0, start: 0, select: 0 };
const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const stats = document.querySelector("#stats");
const releaseVersionElement = document.querySelector("#releaseVersion");
const releaseVersionMeta = document.querySelector('meta[name="soccer-release-version"]');
const app = document.querySelector("#app");
const gameWrap = document.querySelector(".game-wrap");
const touchControls = document.querySelector("#touchControls");
let leftControls = document.querySelector("#leftControls");
const stick = document.querySelector("#stick");
const knob = document.querySelector("#knob");
const btnKick = document.querySelector("#btnKick");
const btnSprint = document.querySelector("#btnSprint");
const btnStart = document.querySelector("#btnStart");
const btnSelect = document.querySelector("#btnSelect");
const DEBUG = new URLSearchParams(window.location.search).get("debug") === "1";
const CORE_KIND = "cpp";
let BUILD_ID = "development";
let releaseMetadata = null;
document.body.classList.toggle("debug", DEBUG);
stats.hidden = !DEBUG;
function validateReleaseMetadata(value) {
  const date = Number(value?.date);
  const revision = Number(value?.revision);
  const version = String(value?.version || "");
  if (!/^\d{8}\.\d+$/.test(version) || version !== `${date}.${revision}` || revision < 1) {
    throw new Error("invalid release-version.json");
  }
  return { date, revision, version };
}
async function loadReleaseMetadata() {
  const response = await fetch(rootAssetUrl("release-version.json"), { cache: "no-store" });
  if (!response.ok) throw new Error(`failed to load release-version.json: ${response.status}`);
  releaseMetadata = validateReleaseMetadata(await response.json());
  BUILD_ID = releaseMetadata.version;
  releaseVersionElement.textContent = releaseMetadata.version;
  releaseVersionMeta.content = releaseMetadata.version;
  document.body.dataset.releaseVersion = releaseMetadata.version;
  return releaseMetadata;
}
function verifyCoreReleaseMetadata(api) {
  if (!releaseMetadata || !api.soccer_release_version_date || !api.soccer_release_version_revision) {
    throw new Error("C++ core does not expose formal release metadata");
  }
  const coreDate = api.soccer_release_version_date() >>> 0;
  const coreRevision = api.soccer_release_version_revision() >>> 0;
  if (coreDate !== releaseMetadata.date || coreRevision !== releaseMetadata.revision) {
    throw new Error(`mixed release artifacts: page=${releaseMetadata.version} wasm=${coreDate}.${coreRevision}`);
  }
  document.body.dataset.coreReleaseVersion = `${coreDate}.${coreRevision}`;
}
function enforceControllerOutsideGame() {
  if (!leftControls) {
    leftControls = document.createElement("div");
    leftControls.id = "leftControls";
    leftControls.className = "left-controls";
    leftControls.setAttribute("aria-label", "左侧方向控制区");
  }
  if (stick.parentElement !== leftControls) leftControls.append(stick);
  if (leftControls.parentElement !== touchControls) touchControls.prepend(leftControls);
  if (gameWrap.parentElement !== touchControls) touchControls.insertBefore(gameWrap, document.querySelector(".buttons"));
  touchControls.dataset.surface = "outside-game";
  gameWrap.dataset.surface = "game";
  const rotated = isPortraitGameLayout();
  touchControls.dataset.orientation = rotated ? "portrait-rotated" : "landscape";
  document.documentElement.classList.toggle("portrait-game-layout", rotated);
}
function isPortraitGameLayout() {
  return window.matchMedia("(orientation: portrait)").matches
    && (window.matchMedia("(pointer: coarse)").matches || window.innerWidth <= 900);
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
const runtimeLifecycle = {
  paused: document.hidden,
  userStarted: false,
  gamepadsNeedNeutral: false,
  pauseCount: 0,
  resumeCount: 0,
  clockResetSerial: 0,
  videoFramesAdvanced: 0,
  lastAdvanceBurst: 0,
  maxAdvanceBurst: 0,
  lastPauseReason: document.hidden ? "initial-hidden" : "",
  resetClock: null,
};
let wakeLockSentinel = null;
const VIDEO_WRITE_BACKGROUND_UPLOAD = 3;
const VIDEO_WRITE_RESULT_SUPPORTER = 12;
const VIDEO_WRITE_RESULT_STATIC = 13;
const VIDEO_WRITE_TOURNAMENT_RECORD = 14;
const VIDEO_WRITE_MENU_CHR_COPY = 15;
const originalAssets = {
  field: null,
  logicalVideo: {
    bytes: new Uint8Array(0x4000),
    valid: new Uint8Array(0x4000),
    sources: new Uint8Array(0x4000).fill(0xFF),
    serial: null,
    processedCount: 0,
    revision: 0,
    backgroundRevision: 0,
    frameWrites: [],
    lastWriteBySource: new Map(),
  },
  splash: { states: new Map(), last: null },
  staticBackgrounds: new Map(),
  modeSelection: {
    background: null,
    canvas: null,
    context: null,
    nametable: null,
    key: "",
    previousState: 0xff,
  },
  opponentSelection: {
    background: null,
    canvas: null,
    context: null,
    key: "",
  },
  teamPreview: {
    background: null,
    canvas: null,
    context: null,
    key: "",
  },
  playerCountPreview: {
    background: null,
    canvas: null,
    context: null,
    key: "",
  },
  playerOrder: {
    background: null,
    canvas: null,
    context: null,
    key: "",
  },
  credits: {
    base: null,
    backgrounds: new Map(),
    states: new Map(),
  },
  bracket: {
    background: null,
    canvas: null,
    context: null,
    key: "",
  },
  matchSettings: {
    background: null,
    pageCanvases: null,
    nametables: null,
    canvas: null,
    context: null,
    key: "",
  },
  formationControl: {
    background: null,
    teamOverlayId: 0xffffffff,
    pageCanvases: null,
    nametables: null,
    canvas: null,
    context: null,
    key: "",
  },
  weatherPreview: {
    background: null,
    nametable: null,
    canvas: null,
    context: null,
    key: "",
  },
  tournamentRecord: {
    background: null,
    canvas: null,
    context: null,
    key: "",
  },
  playerProfile: {
    background: null,
    canvas: null,
    context: null,
    key: "",
  },
  musicSelection: {
    background: null,
    canvas: null,
    context: null,
    key: "",
  },
  meetingSecret: {
    backgrounds: new Map(),
    canvas: null,
    context: null,
    key: "",
  },
  result: {
    backgrounds: new Map(),
    canvas: null,
    context: null,
    key: "",
    logicalRevision: null,
    tileCache: new Map(),
  },
  sprite: {
    manifest: null,
    palettes: null,
    patternApi: null,
    patternIndexCache: new Map(),
    tileCache: new Map(),
    backgroundTileCache: new Map(),
  },
};
function normalizeOriginalVideoAddress(address) {
  let normalized = address & 0x3fff;
  if (normalized >= 0x3000 && normalized < 0x3f00) normalized -= 0x1000;
  if (normalized >= 0x3f00) {
    normalized = 0x3f00 | (normalized & 0x1f);
    if ((normalized & 0x13) === 0x10) normalized -= 0x10;
  }
  return normalized;
}
function resetOriginalLogicalVideo(api = null) {
  const video = originalAssets.logicalVideo;
  video.bytes.fill(0);
  video.valid.fill(0);
  video.sources.fill(0xFF);
  video.serial = api?.game_video_write_serial
    ? api.game_video_write_serial() >>> 0 : null;
  video.processedCount = 0;
  video.backgroundRevision = 0;
  video.frameWrites = [];
  video.lastWriteBySource.clear();
  video.revision += 1;
}
function syncOriginalLogicalVideoWrites(api) {
  if (!api.game_video_write_serial || !api.game_video_write_count
      || !api.game_video_write_source || !api.game_video_write_address
      || !api.game_video_write_increment || !api.game_video_write_size
      || !api.game_video_write_byte) return 0;
  const video = originalAssets.logicalVideo;
  const serial = api.game_video_write_serial() >>> 0;
  const count = Math.min(0x80, api.game_video_write_count() >>> 0);
  if (video.serial !== serial || count < video.processedCount) {
    video.serial = serial;
    video.processedCount = 0;
    video.frameWrites = [];
  }
  let applied = 0;
  for (let command = video.processedCount; command < count; command += 1) {
    const source = api.game_video_write_source(command) >>> 0;
    const rawAddress = api.game_video_write_address(command) >>> 0;
    const increment = api.game_video_write_increment(command) >>> 0;
    const size = Math.min(0x2000, api.game_video_write_size(command) >>> 0);
    if (source > 0xff || rawAddress > 0x3fff
        || (increment !== 1 && increment !== 32)) continue;
    if (source === VIDEO_WRITE_BACKGROUND_UPLOAD) {
      for (let target = 0; target < video.sources.length; target += 1) {
        if (video.sources[target] === VIDEO_WRITE_RESULT_SUPPORTER
            || video.sources[target] === VIDEO_WRITE_RESULT_STATIC
            || video.sources[target] === VIDEO_WRITE_TOURNAMENT_RECORD) {
          video.bytes[target] = 0;
          video.valid[target] = 0;
          video.sources[target] = 0xFF;
        }
      }
      video.lastWriteBySource.delete(VIDEO_WRITE_RESULT_SUPPORTER);
      video.lastWriteBySource.delete(VIDEO_WRITE_RESULT_STATIC);
      video.lastWriteBySource.delete(VIDEO_WRITE_TOURNAMENT_RECORD);
      video.backgroundRevision += 1;
    }
    const bytes = new Uint8Array(size);
    let address = rawAddress;
    for (let index = 0; index < size; index += 1) {
      const value = api.game_video_write_byte(command, index) >>> 0;
      if (value > 0xff) break;
      bytes[index] = value;
      const target = normalizeOriginalVideoAddress(address);
      video.bytes[target] = value;
      video.valid[target] = 1;
      video.sources[target] = source;
      address = (address + increment) & 0x3fff;
    }
    const write = { source, address: rawAddress, increment, bytes };
    video.frameWrites.push(write);
    video.lastWriteBySource.set(source, write);
    applied += 1;
  }
  video.processedCount = count;
  if (applied) video.revision += 1;
  return applied;
}
function originalLogicalNametable(destination, fallback) {
  const nametable = fallback ? Uint8Array.from(fallback) : new Uint8Array(0x400);
  const video = originalAssets.logicalVideo;
  for (let offset = 0; offset < nametable.length; offset += 1) {
    const address = normalizeOriginalVideoAddress(destination + offset);
    if (video.valid[address]) nametable[offset] = video.bytes[address];
  }
  return nametable;
}
function latestOriginalLogicalVideoWrite(sources) {
  const accepted = new Set(Array.isArray(sources) ? sources : [sources]);
  const writes = originalAssets.logicalVideo.frameWrites;
  for (let index = writes.length - 1; index >= 0; index -= 1) {
    if (accepted.has(writes[index].source)) return writes[index];
  }
  for (const source of accepted) {
    const write = originalAssets.logicalVideo.lastWriteBySource.get(source);
    if (write) return write;
  }
  return null;
}
function applyOriginalLogicalFrameWrites(nametable, destination, sources) {
  const accepted = new Set(Array.isArray(sources) ? sources : [sources]);
  const begin = normalizeOriginalVideoAddress(destination);
  const end = begin + nametable.length;
  for (const write of originalAssets.logicalVideo.frameWrites) {
    if (!accepted.has(write.source)) continue;
    let address = write.address;
    for (const value of write.bytes) {
      const target = normalizeOriginalVideoAddress(address);
      if (target >= begin && target < end) nametable[target - begin] = value;
      address = (address + write.increment) & 0x3fff;
    }
  }
}
const verifiedRendererBins = new Map();
const RENDERER_BIN_PATHS = new Set([
  "animation/sprite-renderer-82c6-af8d.bin",
  "palette/background-d2fb.bin",
  "palette/sprite-d1b7.bin",
]);
const sfx = {
  ctx: null,
  lastEventSerial: 0,
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
const wasmNesApu = new WasmNesApuAudioAdapter();
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
  const cancel = (event) => {
    up(event);
    touch[latchProp] = 0;
  };
  button.addEventListener("pointerdown", down);
  button.addEventListener("pointerup", up);
  button.addEventListener("pointercancel", cancel);
  button.addEventListener("lostpointercapture", (event) => {
    if (event.pointerType === "touch") return;
    up(event);
  });
  for (const name of ["pointerup", "pointercancel"]) {
    window.addEventListener(name, (event) => {
      if (touch[pointerProp] === event.pointerId) {
        if (name === "pointercancel") cancel(event);
        else up(event);
      }
    });
  }
  button.addEventListener("touchstart", (event) => { event.preventDefault(); activate(); }, { passive: false });
  button.addEventListener("touchend", (event) => { event.preventDefault(); deactivate(); }, { passive: false });
  button.addEventListener("touchcancel", (event) => {
    event.preventDefault();
    deactivate();
    touch[latchProp] = 0;
  }, { passive: false });
}
setTouchButton(btnKick, "kick");
setTouchButton(btnSprint, "sprint");
setTouchButton(btnStart, "start");
setTouchButton(btnSelect, "select");
function ensureAudio() {
  markUserInteraction();
  if (sfx.ctx) {
    if (!runtimeLifecycle.paused && sfx.ctx.state === "suspended") {
      Promise.resolve(sfx.ctx.resume?.()).catch(() => {});
    }
    wasmNesApu.attachAudioContext(sfx.ctx);
    return sfx.ctx;
  }
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  sfx.ctx = new AudioCtor();
  wasmNesApu.attachAudioContext(sfx.ctx);
  return sfx.ctx;
}
function drainOriginalSoundEvents(api, consume) {
  if (api.sound_event_serial && api.sound_event_at_serial) {
    const current = api.sound_event_serial() >>> 0;
    let previous = sfx.lastEventSerial >>> 0;
    if (current < previous) previous = 0;
    if (current - previous > 16) previous = current - 16;
    for (let serial = previous + 1; serial <= current; serial++) {
      const soundId = api.sound_event_at_serial(serial >>> 0) & 0xFF;
      if (soundId !== 0xFF) consume(soundId);
    }
    sfx.lastEventSerial = current;
    return true;
  }
  return false;
}
function updateSfx(api) {
  if (!wasmNesApu.claimsAudio) return;
  drainOriginalSoundEvents(api, (soundId) => wasmNesApu.handleSoundEvent(soundId));
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
  const screenDx = point.x - cx;
  const screenDy = point.y - cy;
  let dx = isPortraitGameLayout() ? screenDy : screenDx;
  let dy = isPortraitGameLayout() ? -screenDx : screenDy;
  const len = Math.hypot(dx, dy);
  if (len > max) { dx = dx / len * max; dy = dy / len * max; }
  const fixedAxisX = Math.abs(dx) < max * 0.16 ? 0 : Math.sign(dx);
  const fixedAxisY = Math.abs(dy) < max * 0.16 ? 0 : Math.sign(dy);
  const screenRelDx = point.x - touch.originX;
  const screenRelDy = point.y - touch.originY;
  const relDx = isPortraitGameLayout() ? screenRelDy : screenRelDx;
  const relDy = isPortraitGameLayout() ? -screenRelDx : screenRelDy;
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
  if (target?.closest?.(".game-wrap")) return false;
  if (target?.closest?.("#stick")) return true;
  const leftRect = leftControls.getBoundingClientRect();
  const stickRect = stick.getBoundingClientRect();
  const pad = Math.max(24, stickRect.width * 0.20);
  const inLeftControllerArea =
    clientX >= leftRect.left && clientX <= leftRect.right &&
    clientY >= leftRect.top && clientY <= leftRect.bottom;
  const inExpandedStick =
    clientX >= stickRect.left - pad && clientX <= stickRect.right + pad &&
    clientY >= stickRect.top - pad && clientY <= stickRect.bottom + pad;
  return inExpandedStick || inLeftControllerArea;
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
  if (runtimeLifecycle.paused) {
    touch.lastBits = 0;
    touch.lastPackedBits = 0;
    return 0;
  }
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
  const padBitsBySlot = [];
  let anyPadBits = false;
  for (let slot = 0; slot < 4; slot += 1) {
    const pad = pads?.[slot];
    const padBits = (!pad || pad.connected === false) ? 0 : standardGamepadInputBits(pad);
    padBitsBySlot[slot] = padBits;
    anyPadBits ||= padBits !== 0;
  }
  if (runtimeLifecycle.gamepadsNeedNeutral && !anyPadBits) {
    runtimeLifecycle.gamepadsNeedNeutral = false;
  }
  if (!runtimeLifecycle.gamepadsNeedNeutral) {
    for (let slot = 0; slot < 4; slot += 1) {
      packed = (packed | ((padBitsBySlot[slot] & 0xFF) << (slot * 8))) >>> 0;
    }
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
const lifecyclePauseReasons = new Set(document.hidden ? ["visibility"] : []);
function clearAllHostInput() {
  keys.clear();
  keyTapLatch.kick = 0;
  keyTapLatch.sprint = 0;
  keyTapLatch.start = 0;
  keyTapLatch.select = 0;
  resetRequested = false;
  resetStick();
  for (const prop of ["kick", "sprint", "start", "select"]) {
    touch[prop] = false;
    touch[`${prop}Pointer`] = null;
    touch[`${prop}LatchTicks`] = 0;
  }
  touch.lastBits = 0;
  touch.lastPackedBits = 0;
  for (const button of [btnKick, btnSprint, btnStart, btnSelect]) {
    button.classList.remove("active");
  }
  runtimeLifecycle.gamepadsNeedNeutral = true;
}
async function releaseWakeLock() {
  const sentinel = wakeLockSentinel;
  wakeLockSentinel = null;
  document.body.dataset.wakeLock = "released";
  if (!sentinel) return;
  try { await sentinel.release?.(); } catch {}
}
async function requestWakeLock() {
  if (!runtimeLifecycle.userStarted || runtimeLifecycle.paused || document.hidden
      || !navigator.wakeLock?.request) return false;
  if (wakeLockSentinel && !wakeLockSentinel.released) return true;
  try {
    const sentinel = await navigator.wakeLock.request("screen");
    wakeLockSentinel = sentinel;
    document.body.dataset.wakeLock = "held";
    sentinel.addEventListener?.("release", () => {
      if (wakeLockSentinel === sentinel) {
        wakeLockSentinel = null;
        document.body.dataset.wakeLock = "released";
      }
    }, { once: true });
    return true;
  } catch (_error) {
    document.body.dataset.wakeLock = "unavailable";
    return false;
  }
}
async function requestLandscapeOrientationLock() {
  if (!document.fullscreenElement || !screen.orientation?.lock) return false;
  try {
    await screen.orientation.lock("landscape");
    document.body.dataset.orientationLock = "landscape";
    return true;
  } catch (_error) {
    document.body.dataset.orientationLock = "unavailable";
    return false;
  }
}
function markUserInteraction() {
  runtimeLifecycle.userStarted = true;
  void requestWakeLock();
  void requestLandscapeOrientationLock();
}
function pauseRuntime(reason) {
  lifecyclePauseReasons.add(reason);
  const transitioned = !runtimeLifecycle.paused;
  runtimeLifecycle.paused = true;
  runtimeLifecycle.lastPauseReason = reason;
  clearAllHostInput();
  runtimeLifecycle.resetClock?.();
  if (transitioned) runtimeLifecycle.pauseCount += 1;
  if (sfx.ctx?.state === "running") Promise.resolve(sfx.ctx.suspend?.()).catch(() => {});
  void releaseWakeLock();
  document.body.dataset.runtimePaused = "true";
}
function resumeRuntime(reason) {
  lifecyclePauseReasons.delete(reason);
  if (document.hidden) lifecyclePauseReasons.add("visibility");
  else lifecyclePauseReasons.delete("visibility");
  if (lifecyclePauseReasons.size !== 0) return;
  const transitioned = runtimeLifecycle.paused;
  runtimeLifecycle.paused = false;
  if (transitioned) {
    clearAllHostInput();
    runtimeLifecycle.resetClock?.();
    runtimeLifecycle.resumeCount += 1;
  }
  enforceControllerOutsideGame();
  if (runtimeLifecycle.userStarted && sfx.ctx?.state === "suspended") {
    Promise.resolve(sfx.ctx.resume?.())
      .then(() => wasmNesApu.attachAudioContext(sfx.ctx))
      .catch(() => {});
  }
  void requestWakeLock();
  void requestLandscapeOrientationLock();
  document.body.dataset.runtimePaused = "false";
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pauseRuntime("visibility");
  else resumeRuntime("visibility");
});
window.addEventListener("pagehide", () => pauseRuntime("pagehide"));
window.addEventListener("pageshow", () => resumeRuntime("pagehide"));
document.addEventListener("freeze", () => pauseRuntime("freeze"));
document.addEventListener("resume", () => resumeRuntime("freeze"));
window.addEventListener("blur", () => pauseRuntime("blur"));
window.addEventListener("focus", () => resumeRuntime("blur"));
document.addEventListener("fullscreenchange", () => {
  enforceControllerOutsideGame();
  void requestLandscapeOrientationLock();
});
window.visualViewport?.addEventListener("resize", enforceControllerOutsideGame, { passive: true });
const preventGamePageDefault = (event) => event.preventDefault();
for (const name of ["gesturestart", "gesturechange", "gestureend"]) {
  document.addEventListener(name, preventGamePageDefault, { passive: false, capture: true });
}
for (const name of ["dblclick", "selectstart", "dragstart", "contextmenu"]) {
  app.addEventListener(name, preventGamePageDefault, { capture: true });
}
window.addEventListener("wheel", (event) => {
  if (event.ctrlKey || event.metaKey) event.preventDefault();
}, { passive: false, capture: true });
window.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey)) return;
  if (["Equal", "Minus", "Digit0", "NumpadAdd", "NumpadSubtract", "Numpad0"].includes(event.code)) {
    event.preventDefault();
  }
}, { capture: true });
if (DEBUG) {
  window.__soccerLifecycle = () => ({
    paused: runtimeLifecycle.paused,
    userStarted: runtimeLifecycle.userStarted,
    gamepadsNeedNeutral: runtimeLifecycle.gamepadsNeedNeutral,
    pauseCount: runtimeLifecycle.pauseCount,
    resumeCount: runtimeLifecycle.resumeCount,
    clockResetSerial: runtimeLifecycle.clockResetSerial,
    videoFramesAdvanced: runtimeLifecycle.videoFramesAdvanced,
    lastAdvanceBurst: runtimeLifecycle.lastAdvanceBurst,
    maxAdvanceBurst: runtimeLifecycle.maxAdvanceBurst,
    lastPauseReason: runtimeLifecycle.lastPauseReason,
    pauseReasons: Array.from(lifecyclePauseReasons),
    wakeLock: document.body.dataset.wakeLock || "idle",
    orientationLock: document.body.dataset.orientationLock || "idle",
    audioState: sfx.ctx?.state || "none",
  });
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
async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("SHA-256 verification is unavailable in this browser");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
  if (!api.resource_catalog_validate || !api.resource_catalog_ready
      || !api.resource_catalog_required_count || !api.resource_catalog_required_bytes) {
    throw new Error("C++ core does not expose the strict resource catalog ABI");
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
  const paths = new Set();
  let manifestBytes = 0;
  for (const [index, record] of manifest.records.entries()) {
    if (!record || typeof record.path !== "string"
        || !/^[a-z0-9][a-z0-9/_.-]*\.bin$/.test(record.path)
        || record.path.includes("..") || paths.has(record.path)
        || !Number.isInteger(record.length) || record.length <= 0
        || typeof record.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(record.sha256)
        || typeof record.category !== "string" || !record.category
        || typeof record.layout !== "string" || !record.layout
        || !Array.isArray(record.source_ranges) || record.source_ranges.length === 0
        || !Array.isArray(record.consumers) || record.consumers.length === 0) {
      throw new Error(`invalid C++ core-data manifest record ${index}`);
    }
    paths.add(record.path);
    manifestBytes += record.length;
  }
  if (manifest.records.length !== (api.resource_catalog_required_count() >>> 0)
      || manifestBytes !== (api.resource_catalog_required_bytes() >>> 0)) {
    throw new Error("C++ core-data manifest does not match the compiled resource contract");
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
      const actualSha256 = await sha256Hex(bytes);
      if (actualSha256 !== record.sha256) {
        throw new Error(`${record.path}: SHA-256 mismatch`);
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
      if (RENDERER_BIN_PATHS.has(record.path)) {
        verifiedRendererBins.set(record.path, bytes.slice());
      }
      loadedBytes += bytes.byteLength;
    }
  });
  await Promise.all(workers);
  if (api.cpp_asset_loaded_count() !== manifest.records.length
      || api.cpp_asset_loaded_bytes() !== loadedBytes) {
    throw new Error("C++ core did not commit the complete external BIN resource set");
  }
  if (api.resource_catalog_validate() !== 1 || api.resource_catalog_ready() !== 1) {
    const code = api.resource_catalog_error_code?.() >>> 0;
    const asset = api.resource_catalog_error_asset_id?.() >>> 0;
    throw new Error(`C++ core rejected required resource catalog: code=${code} asset=${asset}`);
  }
  return { count: manifest.records.length, bytes: loadedBytes };
}
function splitPaletteRecords(bytes, recordBytes, expectedRecords, label) {
  if (!(bytes instanceof Uint8Array)
      || bytes.byteLength !== recordBytes * expectedRecords) {
    throw new Error(`${label}: invalid classified BIN length`);
  }
  return Array.from({ length: expectedRecords }, (_, index) =>
    Array.from(bytes.subarray(index * recordBytes, (index + 1) * recordBytes)));
}
async function loadPlatformNesRgbPalette() {
  const manifestResponse = await fetchCoreResponse(
    "platform-data/manifest.json",
    assetUrl("../platform-data/manifest.json"),
    rootAssetUrl("platform-data/manifest.json"),
  );
  const manifest = await manifestResponse.json();
  const record = manifest?.records?.find((entry) => entry?.path === "video/nes-rgb-fceux.bin");
  if (manifest?.schema !== 1 || !Array.isArray(manifest.records) || manifest.records.length !== 1
      || record?.category !== "platform-video" || record?.length !== 64 * 3
      || !/^[0-9a-f]{64}$/.test(record?.sha256 || "")) {
    throw new Error("invalid platform video-data manifest");
  }
  const response = await fetchCoreResponse(
    record.path,
    assetUrl(`../platform-data/${record.path}`),
    rootAssetUrl(`platform-data/${record.path}`),
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== record.length || await sha256Hex(bytes) !== record.sha256) {
    throw new Error(`${record.path}: platform palette integrity failure`);
  }
  return splitPaletteRecords(bytes, 3, 64, record.path);
}
async function loadOriginalPaletteDataFromBins() {
  const spriteBytes = verifiedRendererBins.get("palette/sprite-d1b7.bin");
  const backgroundBytes = verifiedRendererBins.get("palette/background-d2fb.bin");
  const sprite = splitPaletteRecords(spriteBytes, 4, 54, "palette/sprite-d1b7.bin");
  const flattenedBackground = splitPaletteRecords(
    backgroundBytes, 8, 74, "palette/background-d2fb.bin",
  );
  const backgroundPairs = flattenedBackground.map((record) => [
    record.slice(0, 4),
    record.slice(4, 8),
  ]);
  const nesRgb = await loadPlatformNesRgbPalette();
  document.body.dataset.paletteSource = "classified-bin";
  document.body.dataset.spritePaletteRecords = String(sprite.length);
  document.body.dataset.backgroundPaletteRecords = String(backgroundPairs.length);
  document.body.dataset.nesRgbRecords = String(nesRgb.length);
  return { sprite, background_pairs: backgroundPairs, nes_rgb: nesRgb };
}
function loadOriginalSpriteRendererFromBin(api) {
  const bytes = verifiedRendererBins.get("animation/sprite-renderer-82c6-af8d.bin");
  const base = 0x82C6;
  const end = 0xAF8D;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== end - base) {
    throw new Error("animation/sprite-renderer-82c6-af8d.bin: invalid classified BIN length");
  }
  const byte = (address) => {
    if (!Number.isInteger(address) || address < base || address >= end) {
      throw new Error(`sprite renderer address out of range: $${address.toString(16)}`);
    }
    return bytes[address - base];
  };
  const word = (address) => byte(address) | (byte(address + 1) << 8);
  const range = (first, last) => Array.from(bytes.subarray(first - base, last - base));
  const signed = (value) => (value & 0x80) ? value - 0x100 : value;
  const starts = Array.from({ length: 10 }, (_, group) => word(0x83D8 + group * 2));
  const compactBoundaries = [...new Set([...starts.filter((start) => start < 0x8676), 0x8676])]
    .sort((left, right) => left - right);
  const groups = starts.map((start) => {
    const tableEnd = start === 0xACCF
      ? word(start)
      : compactBoundaries.find((boundary) => boundary > start);
    if (!tableEnd || ((tableEnd - start) & 1)) {
      throw new Error(`unaligned sprite group table $${start.toString(16)}-$${tableEnd?.toString(16)}`);
    }
    return Array.from({ length: (tableEnd - start) / 2 }, (_, index) =>
      word(start + index * 2));
  });
  const parseFrame = (address) => {
    const count = byte(address);
    if (count < 1 || count > 0x40) {
      throw new Error(`bad sprite count $${count.toString(16)} at $${address.toString(16)}`);
    }
    const pointers = Array.from({ length: 4 }, (_, index) => word(address + 1 + index * 2));
    const arrays = pointers.map((pointer) =>
      Array.from({ length: count }, (_, index) => byte(pointer + index)));
    return {
      address,
      count,
      tile: arrays[0],
      attr: arrays[1],
      x: arrays[2].map(signed),
      y: arrays[3].map(signed),
    };
  };
  const uniqueFrames = [...new Set(groups.flat())].sort((left, right) => left - right);
  const frames = Object.fromEntries(uniqueFrames.map((address) => [
    address.toString(16).toUpperCase().padStart(4, "0"),
    parseFrame(address),
  ]));
  const patternTileCount = api.graphics_pattern_tile_count?.() >>> 0;
  if (typeof api.graphics_pattern_color_index !== "function"
      || patternTileCount !== 8192) {
    throw new Error("classified CHR pattern-table API is unavailable or malformed");
  }
  const manifest = {
    source: {
      renderer: "src/bank_04.asm:809A-8188",
      groups: "src/bank_04.asm:83D8-866D,ACCF-ACDC",
      chrBanks: "src/bank_FF.asm:EE9A-EED2",
    },
    groups,
    frames,
    faceTiles: range(0x82C6, 0x83BC),
    objectPaletteSlots: range(0x83BC, 0x83CE),
    specialGroup3Tiles: range(0x83CE, 0x83D3),
    chr: { tileCount: patternTileCount },
  };
  document.body.dataset.spriteRendererSource = "classified-bin";
  document.body.dataset.spriteRendererGroups = String(groups.length);
  document.body.dataset.spriteRendererFrames = String(uniqueFrames.length);
  document.body.dataset.graphicsPatternsSource = "classified-bin";
  document.body.dataset.graphicsPatternTiles = String(patternTileCount);
  return manifest;
}
async function loadWasm() {
  const filename = DEBUG ? "soccer_core_cpp.wasm" : "soccer_core_cpp_production.wasm";
  const relative = DEBUG ? "../strict-tests.e9e10fc4.wasm" : "../soccer_core_cpp.48a8e89a.wasm";
  const response = await fetchCoreResponse(filename, assetUrl(relative), rootAssetUrl(filename));
  const bytes = await response.arrayBuffer();
  const result = await WebAssembly.instantiate(bytes, {});
  verifyCoreReleaseMetadata(result.instance.exports);
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
  if (!field?.geometry || !api.footprint_commit_serial) return;
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
  const serial = api.footprint_commit_serial() >>> 0;
  if (field.footprintSerial === serial) return;
  field.footprintSerial = serial;
  const count = Math.min(api.committed_footprint_count?.() || 0, 4);
  for (let index = 0; index < count; index++) {
    const x = api.committed_footprint_world_x(index) & 0xFFFF;
    const y = api.committed_footprint_world_y(index) & 0xFFFF;
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
function drawOriginalFieldFootprints(api, fieldContext, fieldColor) {
  const field = originalAssets.field;
  if (!field?.footprints?.size) return;
  const geometry = field.geometry;
  const assetScale = geometry.scale;
  const mapTileWidth = geometry.logical_width >> 3;
  const palettes = originalFieldSubpalettes(fieldColor);
  if (!palettes || api.field_renderer_prepare() !== 1) return;
  const fieldBank = api.field_background_bank
    ? (api.field_background_bank() & 0xFF) || geometry.default_field_bank
    : geometry.default_field_bank;
  for (const footprint of field.footprints.values()) {
    const tileX = footprint.x >> 3;
    const tileY = footprint.y >> 3;
    if (tileX < 0 || tileX >= mapTileWidth
        || tileY < 0 || tileY >= (geometry.logical_height >> 3)) continue;
    const paletteSlot = api.field_renderer_palette_slot(tileY * mapTileWidth + tileX);
    if (paletteSlot > 3) continue;
    const highBankOffset = footprint.x < geometry.sector_width * 2 ? 0x04 : 0x02;
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
  if (!field?.geometry || api.field_renderer_prepare() !== 1) return null;
  const coverage = clamp(api.field_puddle_coverage ? api.field_puddle_coverage() : 0, 0, 2);
  const fieldColor = clamp(api.field_color ? api.field_color() : 0, 0, 4);
  const puddleSet = api.puddle_set ? api.puddle_set() & 0xFF : 0;
  const fieldPrgBank = api.field_program_bank
    ? (api.field_program_bank() & 0xFF) || field.geometry.default_prg_bank
    : field.geometry.default_prg_bank;
  const fieldBank = api.field_background_bank
    ? (api.field_background_bank() & 0xFF) || field.geometry.default_field_bank
    : field.geometry.default_field_bank;
  const key = `${fieldPrgBank}/${fieldBank}/${coverage}/${fieldColor}/${puddleSet}`;
  if (field.footprintBaseKey && field.footprintBaseKey !== key) {
    field.footprints.clear();
  }
  field.footprintBaseKey = key;
  if (field.compositeKey === key && field.composite) return field.composite;
  if (!field.composite) {
    field.composite = document.createElement("canvas");
    field.compositeContext = field.composite.getContext("2d");
  }
  const geometry = field.geometry;
  const assetScale = geometry.scale;
  field.composite.width = geometry.logical_width * assetScale;
  field.composite.height = geometry.logical_height * assetScale;
  const fieldContext = field.compositeContext;
  fieldContext.imageSmoothingEnabled = false;
  fieldContext.clearRect(0, 0, field.composite.width, field.composite.height);
  const palettes = originalFieldSubpalettes(fieldColor);
  if (!palettes) return null;
  const tileWidth = geometry.logical_width >> 3;
  const tileHeight = geometry.logical_height >> 3;
  for (let tileY = 0; tileY < tileHeight; tileY++) {
    for (let tileX = 0; tileX < tileWidth; tileX++) {
      const index = tileY * tileWidth + tileX;
      const tileByte = api.field_renderer_tile(index);
      const paletteSlot = api.field_renderer_palette_slot(index);
      if (tileByte > 0xFF || paletteSlot > 3) return null;
      const highBankOffset = tileX < (geometry.sector_width >> 2) ? 0x04 : 0x02;
      const tile = originalBackgroundTile(
        fieldBank,
        (fieldBank + highBankOffset) & 0xFF,
        tileByte,
        palettes[paletteSlot],
      );
      if (!tile) return null;
      fieldContext.drawImage(
        tile,
        tileX * 8 * assetScale,
        tileY * 8 * assetScale,
        8 * assetScale,
        8 * assetScale,
      );
    }
  }
  drawOriginalFieldFootprints(api, fieldContext, fieldColor);
  field.compositeKey = key;
  field.renderedKeys.add(key);
  return field.composite;
}
function drawField(api, screenW, screenH, worldW = screenW, worldH = screenH, cameraX = null, cameraY = ORIGINAL_CAMERA_BASE_Y) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const img = composeOriginalField(api);
  if (img) {
    ctx.imageSmoothingEnabled = false;
    const geometry = originalAssets.field.geometry;
    const assetScale = geometry.scale;
    const logicalWidth = geometry.logical_width;
    const logicalHeight = geometry.logical_height;
    const viewWidth = geometry.camera_width;
    const viewHeight = geometry.camera_height;
    const clampedCameraX = clamp(cameraX == null ? 0 : cameraX, 0, logicalWidth - viewWidth);
    const clampedCameraY = clamp(cameraY == null ? 0 : cameraY, 0, logicalHeight - viewHeight);
    const sourceX = clampedCameraX * assetScale;
    const sourceY = clampedCameraY * assetScale;
    const sourceW = viewWidth * assetScale;
    const sourceH = viewHeight * assetScale;
    if (originalFieldFullScreenActive(api)) {
      const layout = originalFullScreenLayout();
      const fieldHeight = api.game_video_split_enabled?.()
        && api.game_video_split_scanline
        ? (api.game_video_split_scanline() & 0xFF) + 1
        : ORIGINAL_STATUSBAR_SPLIT_Y;
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
function loadOriginalFieldAssets(api) {
  if (typeof api.field_renderer_prepare !== "function"
      || typeof api.field_renderer_tile !== "function"
      || typeof api.field_renderer_palette_slot !== "function") {
    throw new Error("C++ core is missing the classified field renderer ABI");
  }
  return {
    geometry: {
      source: "classified-bin-cpp",
      default_prg_bank: 0x01,
      default_field_bank: 0x40,
      scale: 2,
      logical_width: 1024,
      logical_height: 368,
      camera_width: 256,
      camera_height: 176,
      sector_width: 256,
      top_height: 240,
      bottom_height: 128,
    },
    composite: null,
    compositeContext: null,
    compositeKey: "",
    renderedKeys: new Set(),
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
      || !api.committed_sprite_screen_x
      || !api.committed_sprite_screen_y
      || !api.committed_sprite_ground_y) return null;
  return {
    x: api.committed_sprite_screen_x(objectIndex) & 0xFF,
    y: api.committed_sprite_screen_y(objectIndex) & 0xFF,
    groundY: api.committed_sprite_ground_y(objectIndex) & 0xFF,
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
function originalCommittedVideoView(api) {
  if (!api.game_video_view_serial || !api.game_video_view_scroll_x
      || !api.game_video_view_scroll_y) return null;
  const serial = api.game_video_view_serial() >>> 0;
  if (!serial) return null;
  return {
    serial,
    x: api.game_video_view_scroll_x() & 0xFFFF,
    y: api.game_video_view_scroll_y() & 0xFFFF,
    nametable: api.game_video_view_nametable
      ? api.game_video_view_nametable() & 0x03 : 0,
    banks: api.game_video_view_background_bank
      ? [api.game_video_view_background_bank(0) & 0xFF,
        api.game_video_view_background_bank(1) & 0xFF]
      : [],
    split: api.game_video_split_enabled ? api.game_video_split_enabled() !== 0 : false,
    splitScanline: api.game_video_split_scanline
      ? api.game_video_split_scanline() & 0xFF : 0,
    splitKind: api.game_video_split_kind ? api.game_video_split_kind() & 0xFF : 0,
  };
}
function originalPlayerPosition(api, index) {
  if (api.player_position_x_low && api.player_position_x_high && api.player_position_y_low && api.player_position_y_high) {
    return {
      x: (api.player_position_x_high(index) << 8) | api.player_position_x_low(index),
      y: (api.player_position_y_high(index) << 8) | api.player_position_y_low(index),
      z: api.player_position_z_low && api.player_position_z_high
        ? ((api.player_position_z_high(index) << 8) | api.player_position_z_low(index))
        : 0,
    };
  }
  return { x: api.player_x(index), y: api.player_y(index), z: 0 };
}
function originalBallPosition(api) {
  if (api.ball_position_x_low && api.ball_position_x_high && api.ball_position_y_low && api.ball_position_y_high) {
    return {
      x: (api.ball_position_x_high() << 8) | api.ball_position_x_low(),
      y: (api.ball_position_y_high() << 8) | api.ball_position_y_low(),
      z: api.ball_position_z_low && api.ball_position_z_high
        ? ((api.ball_position_z_high() << 8) | api.ball_position_z_low())
        : 0,
    };
  }
  return { x: api.ball_x(), y: api.ball_y(), z: api.ball_z ? api.ball_z() : 0 };
}
function originalFieldMarkerPosition(api, slot) {
  if (!api.field_marker_x_low || !api.field_marker_x_high
      || !api.field_marker_y_low || !api.field_marker_y_high) {
    return null;
  }
  return {
    x: (api.field_marker_x_high(slot) << 8) | api.field_marker_x_low(slot),
    y: (api.field_marker_y_high(slot) << 8) | api.field_marker_y_low(slot),
    z: api.field_marker_z_low && api.field_marker_z_high
      ? ((api.field_marker_z_high(slot) << 8) | api.field_marker_z_low(slot))
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
  const paletteNumber = api.sprite_palette_id(paletteSlot) & 0xFF;
  const bankSlot = tile >> 6;
  const bankNumber = api.sprite_bank(bankSlot) & 0xFF;
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
function originalStatusbarSplitActive(api) {
  if ((api.screen_id?.() & 0xFF) !== 0x00) return false;
  if (api.game_video_split_enabled && api.game_video_split_kind) {
    return api.game_video_split_enabled() !== 0
      && (api.game_video_split_kind() & 0xFF) === 0x02;
  }
  return (api.statusbar_view?.() & 0x7F) === 0x06;
}
function originalFieldFullScreenActive(api) {
  return (api.screen_id?.() & 0xFF) === 0x00;
}
function originalStatusbarTilePalette(nametable, palettePair, row, column) {
  const attributeRow = Math.min(1, Math.floor(row / 4));
  const attribute = nametable[0x3E0 + attributeRow * 8 + Math.floor(column / 4)];
  const shift = Math.floor((row & 3) / 2) * 4
    + Math.floor((column & 3) / 2) * 2;
  const paletteIndex = (attribute >> shift) & 3;
  return palettePair[Math.max(0, Math.min(1, paletteIndex - 2))] || palettePair[0];
}
function drawOriginalMatchStatusbar(api, view) {
  if (!view?.statusbarLayout || !originalStatusbarSplitActive(api)) return false;
  const layout = view.statusbarLayout;
  const scale = layout.scale;
  const statusbarAddress = normalizeOriginalVideoAddress(0x2A00);
  if (!originalAssets.logicalVideo.valid[statusbarAddress]) return false;
  const statusbarNametable = originalLogicalNametable(0x2800);
  const palettes = originalAssets.sprite.palettes;
  const paletteNumber = api.background_palette_id
    ? api.background_palette_id(1) & 0xFF : 0x29;
  const palettePair = palettes?.background_pairs?.[paletteNumber];
  if (!palettePair?.[0]) return false;
  const teamByte = api.team_number ? api.team_number(1) & 0xFF : 0;
  const bank0 = api.game_video_split_background_bank
    ? api.game_video_split_background_bank(0) & 0xFF
    : (teamByte & 0x40 ? 0x06 : 0x04);
  const bank1 = api.game_video_split_background_bank
    ? api.game_video_split_background_bank(1) & 0xFF : 0x02;
  const panelLogicalY = api.game_video_split_scanline
    ? (api.game_video_split_scanline() & 0xFF) + 1
    : ORIGINAL_STATUSBAR_SPLIT_Y;
  for (let row = 0; row < 7; row++) {
    for (let column = 0; column < 32; column++) {
      const palette = originalStatusbarTilePalette(
        statusbarNametable, palettePair, row, column);
      const tileId = statusbarNametable[0x200 + row * 32 + column];
      const tile = originalBackgroundTile(bank0, bank1, tileId, palette);
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
  if ((api.statusbar_view?.() & 0x7F) !== 0x06) return true;
  const markers = [];
  const committedCopyCamera = originalCommittedCamera(api, true);
  const copyCameraX = committedCopyCamera?.x ?? (api.camera_copy_x_low && api.camera_copy_x_high
    ? (api.camera_copy_x_high() << 8) | api.camera_copy_x_low() : 0);
  const copyCameraY = committedCopyCamera?.y ?? (api.camera_copy_y_low && api.camera_copy_y_high
    ? (api.camera_copy_y_high() << 8) | api.camera_copy_y_low() : 0);
  const markerCount = api.field_marker_count ? api.field_marker_count() : 0;
  for (let slot = 0; slot < markerCount; slot++) {
    const animation = api.field_marker_animation_id(slot) & 0xFF;
    const position = originalFieldMarkerPosition(api, slot);
    const visible = !api.field_marker_visibility
      || api.field_marker_visibility(slot) !== 0;
    if (!position || !visible || (animation & 0x7F) === 0x7F) continue;
    const committedPosition = originalCommittedObjectScreenBytes(api, 0x0E + slot);
    const logicalX = committedPosition ? committedPosition.x : position.x - copyCameraX;
    const logicalY = committedPosition ? committedPosition.y : position.y - copyCameraY;
    const surface = normalizeOriginalHeight(position.z) === 0 ? "statusbar" : "field";
    markers.push({
      object: 0x0E + slot,
      animation,
      motion: api.field_marker_motion ? api.field_marker_motion(slot) & 0xFF : 0,
      logicalX,
      logicalY,
      z: position.z,
      surface,
    });
  }
  drawCppLogicalOam(api, {
    original: true,
    sourceW: 0x100,
    sourceH: 0xF0,
    destX: layout.x,
    destY: layout.y,
    destW: 0x100 * scale,
    destH: 0xF0 * scale,
    logicalScale: scale,
  }, {
    filter: ({ object }) => object >= 0x0E && object <= 0x12
      && (api.committed_sprite_screen_y(object) & 0xFF)
        === (api.committed_sprite_ground_y(object) & 0xFF),
    debugTarget: "__soccerStatusbarLogicalOam",
  });
  if (DEBUG) {
    const fieldWrites = originalAssets.logicalVideo.frameWrites
      .filter((write) => write.source === 4);
    window.__soccerMinimap = {
      visible: true,
      view: api.statusbar_view() & 0xFF,
      bank0,
      bank1,
      paletteNumber,
      markers,
      fullHud: true,
      panel: { x: 0x60, y: panelLogicalY, width: 64, height: 48 },
      buffers: {
        left: fieldWrites[0] ? Array.from(fieldWrites[0].bytes) : [],
        right: fieldWrites[1] ? Array.from(fieldWrites[1].bytes) : [],
      },
    };
  }
  return true;
}
function drawCircle(x, y, r, fill, stroke = "rgba(0,0,0,.35)") {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = stroke; ctx.stroke();
}
function originalPatternTile(bankNumber, tileWithinBank) {
  const sprite = originalAssets.sprite;
  const api = sprite.patternApi;
  if (!api?.graphics_pattern_color_index) return null;
  const bank = bankNumber & 0xFF;
  const tile = tileWithinBank & 0x3F;
  const key = `${bank}:${tile}`;
  const cached = sprite.patternIndexCache.get(key);
  if (cached) return cached;
  const indices = new Uint8Array(64);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const value = api.graphics_pattern_color_index(bank, tile, x, y) >>> 0;
      if (value > 3) return null;
      indices[y * 8 + x] = value;
    }
  }
  sprite.patternIndexCache.set(key, indices);
  return indices;
}
function originalSpriteTile(bankNumber, tileWithinBank, paletteNumber) {
  const sprite = originalAssets.sprite;
  const manifest = sprite.manifest;
  const paletteData = sprite.palettes;
  if (!manifest || !paletteData || !sprite.patternApi) return null;
  const key = `${bankNumber & 0xFF}:${tileWithinBank & 0x3F}:${paletteNumber & 0xFF}`;
  const cached = sprite.tileCache.get(key);
  if (cached) return cached;
  const tileIndex = (bankNumber & 0xFF) * 64 + (tileWithinBank & 0x3F);
  if (tileIndex >= manifest.chr.tileCount) return null;
  const indices = originalPatternTile(bankNumber, tileWithinBank);
  if (!indices) return null;
  const palette = paletteData.sprite[paletteNumber & 0xFF];
  if (!palette || palette.length < 4) return null;
  const nesRgb = paletteData.nes_rgb;
  const tileCanvas = document.createElement("canvas");
  tileCanvas.width = 8;
  tileCanvas.height = 8;
  const tileContext = tileCanvas.getContext("2d");
  const image = tileContext.createImageData(8, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const colorIndex = indices[y * 8 + x];
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
  if (!manifest || !paletteData || !sprite.patternApi || !palette || palette.length < 4) return null;
  const tile = tileByte & 0xFF;
  const tileIndex = tile < 0x80
    ? (bank0 & 0xFE) * 64 + tile
    : (bank1 & 0xFE) * 64 + (tile - 0x80);
  if (tileIndex >= manifest.chr.tileCount) return null;
  const patternBank = Math.floor(tileIndex / 64);
  const indices = originalPatternTile(patternBank, tileIndex & 0x3F);
  if (!indices) return null;
  const key = `${bank0 & 0xFE}:${bank1 & 0xFE}:${tile}:${palette.join("/")}`;
  const cached = sprite.backgroundTileCache.get(key);
  if (cached) return cached;
  const tileCanvas = document.createElement("canvas");
  tileCanvas.width = 8;
  tileCanvas.height = 8;
  const tileContext = tileCanvas.getContext("2d");
  const image = tileContext.createImageData(8, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const colorIndex = indices[y * 8 + x];
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
  return Boolean(api.committed_sprite_serial
    && api.committed_sprite_serial() !== 0);
}
function originalSpriteBankForObject(api, objectIndex, bankSlot) {
  const screen = api.screen_id ? api.screen_id() & 0xFF : 0;
  const subtype = api.screen_subtype ? api.screen_subtype() & 0x7F : 0;
  if (screen === 0x02 && subtype === 0x05
      && (bankSlot === 1 || bankSlot === 2) && api.object_graphics_group) {
    return api.object_graphics_group(bankSlot === 1 ? 5 : 6) & 0xFF;
  }
  if (objectIndex <= 0x0C && originalCommittedSpriteFrameActive(api)
      && api.committed_sprite_bank_id) {
    return api.committed_sprite_bank_id(bankSlot) & 0xFF;
  }
  return api.sprite_bank(bankSlot) & 0xFF;
}
function originalObjectVisibleForCommittedFrame(api, objectIndex) {
  const screen = api.screen_id ? api.screen_id() & 0xFF : 0;
  if (screen === 0x02) {
    const animation = originalObjectAnimation(api, objectIndex);
    return Number.isFinite(animation) && (animation & 0x7F) !== 0x7F;
  }
  if (objectIndex <= 0x0C && originalCommittedSpriteFrameActive(api)
      && api.committed_sprite_visibility) {
    return (api.committed_sprite_visibility(objectIndex) & 0xFF) !== 0;
  }
  if (objectIndex === 0x0C) {
    return !api.ball_visibility_flag || api.ball_visibility_flag() !== 0;
  }
  return !api.player_visibility || api.player_visibility(objectIndex) !== 0;
}
function originalObjectAnimation(api, objectIndex) {
  if (objectIndex <= 0x0C && api.committed_sprite_animation_id
      && api.committed_sprite_serial
      && api.committed_sprite_serial() !== 0) {
    return api.committed_sprite_animation_id(objectIndex) & 0xFF;
  }
  if (objectIndex === 0x0C) {
    return api.ball_animation ? api.ball_animation() & 0xFF : null;
  }
  if (objectIndex >= 0x0E && objectIndex <= 0x12) {
    return api.field_marker_animation_id
      ? api.field_marker_animation_id(objectIndex - 0x0E) & 0xFF : null;
  }
  return api.player_animation ? api.player_animation(objectIndex) & 0xFF : null;
}
function resolveOriginalObjectFrame(api, objectIndex) {
  const manifest = originalAssets.sprite.manifest;
  if (!manifest || !api.object_graphics_group) return null;
  const animation = originalObjectAnimation(api, objectIndex);
  if (!Number.isFinite(animation)) return null;
  const groupNumber = objectIndex <= 0x0C && api.committed_sprite_group
      && api.committed_sprite_serial
      && api.committed_sprite_serial() !== 0
    ? api.committed_sprite_group(objectIndex) & 0xFF
    : api.object_graphics_group(objectIndex) & 0xFF;
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
function drawCppLogicalOam(api, view, options = {}) {
  const required = [
    "game_sprite_draw_count", "game_sprite_draw_x", "game_sprite_draw_y",
    "game_sprite_draw_tile", "game_sprite_draw_attribute",
    "game_sprite_draw_bank", "game_sprite_draw_palette",
    "game_sprite_draw_oam_slot", "game_sprite_draw_object",
    "game_sprite_draw_serial",
  ];
  if (!view?.original || required.some((name) => typeof api[name] !== "function")) {
    return false;
  }
  const count = Math.min(api.game_sprite_draw_count() >>> 0, 64);
  const scaleX = view.destW / view.sourceW;
  const scaleY = view.destH / view.sourceH;
  const drawScale = view.logicalScale || Math.min(scaleX, scaleY);
  const filter = typeof options.filter === "function" ? options.filter : null;
  const publishDebug = options.publishDebug !== false;
  const debugTarget = options.debugTarget || "__soccerLogicalOam";
  const commands = [];
  const drawnCommands = [];
  for (let index = 0; index < count; index++) {
    const x = api.game_sprite_draw_x(index) & 0xFF;
    const y = api.game_sprite_draw_y(index) & 0xFF;
    const tile = api.game_sprite_draw_tile(index) & 0xFF;
    const attribute = api.game_sprite_draw_attribute(index) & 0xFF;
    const bank = api.game_sprite_draw_bank(index) & 0xFF;
    const palette = api.game_sprite_draw_palette(index) & 0xFF;
    const oamSlot = api.game_sprite_draw_oam_slot(index) & 0xFF;
    const object = api.game_sprite_draw_object(index) & 0xFF;
    const command = { index, x, y, tile, attribute, bank, palette, oamSlot, object };
    const tileCanvas = originalSpriteTile(bank, tile & 0x3F, palette);
    const accepted = !filter || filter(command);
    if (accepted && tileCanvas) {
      drawOriginalSpriteTile(
        tileCanvas,
        view.destX + x * scaleX,
        view.destY + y * scaleY,
        attribute,
        drawScale,
      );
    }
    if (DEBUG && accepted) drawnCommands.push(command);
    if (DEBUG) commands.push(command);
  }
  if (DEBUG && publishDebug) {
    window[debugTarget] = {
      source: "cpp-logical-oam",
      serial: api.game_sprite_draw_serial() >>> 0,
      count,
      commands,
      drawnCommands,
    };
  }
  return true;
}
function drawWeather(api, view, screenW, screenH) {
  if (view?.original) return;
  const weather = api.field_weather ? api.field_weather() : 0;
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
  if (!view?.original || !api.weather_effect_state
      || !api.weather_sprite_count) {
    if (DEBUG) window.__soccerWeatherSprites = [];
    return [];
  }
  const effect = api.weather_sprite_effect
    ? api.weather_sprite_effect() & 0x7F
    : api.weather_effect_state() & 0x7F;
  if (![0x01, 0x02, 0x03, 0x04, 0x05, 0x06].includes(effect)) {
    if (DEBUG) window.__soccerWeatherSprites = [];
    return [];
  }
  const scale = view.logicalScale || 2;
  const count = Math.min(12, api.weather_sprite_count() & 0xFF);
  const rendered = [];
  for (let index = count - 1; index >= 0; index--) {
    const y = api.weather_sprite_y(index) & 0xFF;
    if (y >= 0xF0) continue;
    const x = api.weather_sprite_x(index) & 0xFF;
    const tileNumber = api.weather_sprite_tile(index) & 0xFF;
    const attribute = api.weather_sprite_attribute(index) & 0xFF;
    const bankSlot = tileNumber >> 6;
    const bankNumber = api.sprite_bank(bankSlot) & 0xFF;
    const paletteSlot = attribute & 0x03;
    const paletteNumber = api.sprite_palette_id(paletteSlot) & 0xFF;
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
  const cpuTeam = api.team_number
    ? (api.team_number(1) & 0x0F) : 1;
  const timeText = api.match_time_minutes
    ? `${api.match_time_minutes()}:${api.match_time_seconds_tens()}${api.match_time_seconds_ones()}`
    : `${String(Math.floor(seconds / 60)).padStart(1, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  ctx.fillStyle = "rgba(0,0,0,.62)";
  ctx.fillRect(w / 2 - 138, 10, 276, 46);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 18px ui-monospace, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.fillText(`${TEAM_NAMES[0]} ${leftScore} - ${rightScore} ${TEAM_NAMES[cpuTeam] || "CPU"}`, w / 2, 32);
  ctx.font = "12px ui-monospace, Consolas, monospace";
  ctx.fillText(`${period}H  ${timeText}`, w / 2, 50);
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
  const id = api.background_image_id ? api.background_image_id() : 0;
  const subtype = api.screen_subtype ? api.screen_subtype() & 0x7F : 0;
  const blinkOff = id === 1 && (subtype === 0x07 || subtype === 0x0A)
    && api.frame_counter && (api.frame_counter() & 4) !== 0;
  const img = composeOriginalSplashBackground(api, id, blinkOff);
  const brightness = api.current_brightness ? api.current_brightness() : 0x40;
  const alpha = Math.max(0, Math.min(1, brightness / 0x40));
  let layout = originalFullScreenLayout();
  if (img) {
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, layout.x, layout.y, layout.w, layout.h);
    ctx.globalAlpha = 1;
  }
  drawOriginalSplashObjects(api, layout, id, subtype, alpha);
}
function originalSplashSignedCoordinate(value) {
  const word = value & 0xFFFF;
  return word & 0x8000 ? word - 0x10000 : word;
}
function drawOriginalSplashObjects(api, layout, backgroundId, subtype, alpha) {
  const ballOnly = subtype === 0x01 || subtype === 0x03 || subtype === 0x0B;
  const kunioScene = backgroundId === 0x01 && subtype >= 0x06 && subtype <= 0x0A;
  if (!ballOnly && !kunioScene) {
    if (DEBUG) window.__soccerSplashRenderer = {
      ...(window.__soccerSplashRenderer || {}),
      backgroundId, subtype, drawnObjectIds: [], logicalOamCount: 0,
    };
    return;
  }
  const priorityCount = api.committed_animation_priority_count
    ? Math.min(api.committed_animation_priority_count() & 0xFF, 0x20)
    : 0;
  const drawnObjectIds = [];
  for (let slot = 0; slot < priorityCount; slot++) {
    const objectId = api.committed_animation_priority_object(slot) & 0x1F;
    if (objectId < 19 && !drawnObjectIds.includes(objectId)) drawnObjectIds.push(objectId);
  }
  let playerPosition = null;
  let ballPosition = null;
  if (kunioScene && api.player_position_x_low) {
    const raw = originalPlayerPosition(api, 0);
    playerPosition = {
      x: originalSplashSignedCoordinate(raw.x),
      y: originalSplashSignedCoordinate(raw.y),
      z: normalizeOriginalHeight(raw.z),
    };
  }
  if (api.ball_position_x_low) {
    const raw = originalBallPosition(api);
    ballPosition = {
      x: originalSplashSignedCoordinate(raw.x),
      y: originalSplashSignedCoordinate(raw.y),
      z: normalizeOriginalHeight(raw.z),
    };
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.x, layout.y, layout.w, layout.h);
  ctx.clip();
  ctx.globalAlpha = alpha;
  drawCppLogicalOam(api, {
    original: true,
    destX: layout.x,
    destY: layout.y,
    destW: layout.w,
    destH: layout.h,
    sourceW: 256,
    sourceH: 240,
    logicalScale: layout.scale,
  });
  ctx.restore();
  if (DEBUG) {
    window.__soccerSplashRenderer = {
      ...(window.__soccerSplashRenderer || {}),
      backgroundId,
      subtype,
      drawnObjectIds,
      playerPosition,
      ballPosition,
      logicalOamCount: api.game_sprite_draw_count ? api.game_sprite_draw_count() >>> 0 : 0,
    };
  }
}
function originalFullScreenLayout() {
  const scale = Math.min(canvas.width / 256, canvas.height / 240);
  const w = Math.round(256 * scale);
  const h = Math.round(240 * scale);
  return { scale, x: (canvas.width - w) / 2, y: (canvas.height - h) / 2, w, h };
}
function originalResultScreenMetaFromCpp(api, backgroundId) {
  const result = originalAssets.result;
  const cached = result.backgrounds.get(backgroundId);
  if (cached) return cached;
  const background = decodeOriginalBackgroundImageFromCpp(api, backgroundId);
  if (!background || background.destination !== 0x2000
      || background.stream.length < 0x400) return null;
  const subPalettes = originalBackgroundSubPalettes(background.palette0, background.palette1);
  if (!subPalettes) return null;
  const tableCount = Math.max(1, Math.ceil(background.stream.length / 0x400));
  const screenMeta = {
    background,
    chr0: background.chr0,
    chr1: background.chr1,
    subPalettes,
    nametableAttributes: Array.from({ length: tableCount }, (_, index) =>
      Array.from(background.stream.slice(index * 0x400 + 0x3C0, index * 0x400 + 0x400))),
  };
  result.backgrounds.set(backgroundId, screenMeta);
  return screenMeta;
}
function originalResultBackgroundTile(screenMeta, tileNumber, paletteSlot) {
  const result = originalAssets.result;
  const sprite = originalAssets.sprite;
  const rendererManifest = sprite.manifest;
  const paletteData = sprite.palettes;
  if (!screenMeta || !rendererManifest || !paletteData || !sprite.patternApi) return null;
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
  const indices = originalPatternTile(Math.floor(absoluteTile / 64), absoluteTile & 0x3F);
  if (!indices) return null;
  const tileCanvas = document.createElement("canvas");
  tileCanvas.width = 8;
  tileCanvas.height = 8;
  const tileContext = tileCanvas.getContext("2d");
  const image = tileContext.createImageData(8, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const colorIndex = indices[y * 8 + x];
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
function composeOriginalResultBackground(api, backgroundId) {
  const result = originalAssets.result;
  const logicalVideo = originalAssets.logicalVideo;
  const screenMeta = originalResultScreenMetaFromCpp(api, backgroundId);
  const baseImage = composeOriginalStaticBackground(api, backgroundId);
  if (!baseImage || !screenMeta) return baseImage;
  const key = `${backgroundId & 0xFF}/${logicalVideo.backgroundRevision}`;
  if (result.key !== key || !result.canvas) {
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
    result.logicalRevision = null;
  }
  if (result.logicalRevision !== logicalVideo.revision) {
    for (let address = 0x2000; address < 0x3000; address += 1) {
      const normalized = normalizeOriginalVideoAddress(address);
      const source = logicalVideo.sources[normalized];
      if (logicalVideo.valid[normalized]
          && (source === VIDEO_WRITE_RESULT_SUPPORTER
              || source === VIDEO_WRITE_RESULT_STATIC)) {
        drawOriginalResultTile(
          result.context, screenMeta, address, logicalVideo.bytes[normalized]);
      }
    }
    result.logicalRevision = logicalVideo.revision;
  }
  if (DEBUG) {
    window.__soccerResultRenderer = {
      backgroundId,
      logicalRevision: result.logicalRevision,
      backgroundRevision: logicalVideo.backgroundRevision,
      writes: logicalVideo.frameWrites
        .filter((write) => write.source === VIDEO_WRITE_RESULT_SUPPORTER
          || write.source === VIDEO_WRITE_RESULT_STATIC)
        .map((write) => ({
          source: write.source,
          address: write.address,
          increment: write.increment,
          size: write.bytes.length,
        })),
    };
  }
  return result.canvas;
}
function drawOriginalMenuObjects(api, layout, subtype) {
  const priorityCount = api.committed_animation_priority_count
    ? Math.min(api.committed_animation_priority_count() & 0xFF, 0x20)
    : 0;
  const drawnObjectIds = [];
  for (let slot = 0; slot < priorityCount; slot++) {
    const objectId = api.committed_animation_priority_object(slot) & 0x1F;
    if (objectId < 19 && !drawnObjectIds.includes(objectId)) drawnObjectIds.push(objectId);
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.x, layout.y, layout.w, layout.h);
  ctx.clip();
  drawCppLogicalOam(api, {
    original: true,
    destX: layout.x,
    destY: layout.y,
    destW: layout.w,
    destH: layout.h,
    sourceW: 256,
    sourceH: 240,
    logicalScale: layout.scale,
  });
  ctx.restore();
  if (DEBUG) {
    window.__soccerMenuRenderer = {
      subtype,
      drawnObjectIds,
      logicalOamCount: api.game_sprite_draw_count ? api.game_sprite_draw_count() >>> 0 : 0,
      stagedBank1: api.object_graphics_group ? api.object_graphics_group(5) & 0xFF : null,
      stagedBank2: api.object_graphics_group ? api.object_graphics_group(6) & 0xFF : null,
    };
  }
}
function composeOriginalBracketScreen(api) {
  const bracket = originalAssets.bracket;
  const logicalVideo = originalAssets.logicalVideo;
  const backgroundId = api.background_image_id
    ? api.background_image_id() & 0xff : 0;
  if (backgroundId !== 0x15) return null;
  if (!bracket.background) {
    bracket.background = decodeOriginalBackgroundImageFromCpp(api, backgroundId);
  }
  const background = bracket.background;
  if (!background || background.destination !== 0x2000
      || background.stream.length !== 0x400) return null;
  const subPalettes = originalBackgroundSubPalettes(background.palette0, background.palette1);
  if (!subPalettes) return null;
  const key = `${logicalVideo.revision}`;
  if (bracket.canvas && bracket.key === key) return bracket.canvas;
  if (!bracket.canvas) {
    bracket.canvas = document.createElement("canvas");
    bracket.canvas.width = 256;
    bracket.canvas.height = 240;
    bracket.context = bracket.canvas.getContext("2d");
  }
  const nametable = originalLogicalNametable(0x2000, background.stream);
  if (!renderOriginalDynamicBackgroundNametable(
    bracket.context,
    nametable,
    background.chr0,
    background.chr1,
    subPalettes,
  )) return null;
  bracket.key = key;
  if (DEBUG) {
    const round = api.tournament_bracket_stage
      ? api.tournament_bracket_stage() & 0xff : 0;
    const slots = Array.from({ length: 10 }, (_, index) =>
      api.tournament_bracket_slot ? api.tournament_bracket_slot(index) & 0xff : 0);
    const teams = [0, 1].map((side) => api.team_number
      ? api.team_number(side) & 0xff : 0);
    window.__soccerBracketRenderer = {
      source: "logical-video-cpp",
      backgroundId,
      destination: background.destination,
      chr0: background.chr0,
      chr1: background.chr1,
      paletteNumbers: [background.palette0, background.palette1],
      mirroring: background.mirroring,
      round,
      slots: [...slots],
      teams: [...teams],
      logicalRevision: logicalVideo.revision,
      writes: logicalVideo.frameWrites
        .filter(({ source }) => source >= 0 && source <= 2)
        .map(({ source, address, increment, bytes }) => ({
          source, address, increment, bytes: Array.from(bytes),
        })),
      key,
      nametable: Array.from(nametable),
    };
  }
  return bracket.canvas;
}
function renderOriginalExtractedAtlasNametable(
  context, nametable, tileImage, destinationY,
) {
  const attributes = nametable.subarray(0x3c0, 0x400);
  for (let row = 0; row < 30; row++) {
    for (let column = 0; column < 32; column++) {
      const tile = nametable[row * 32 + column];
      const attribute = attributes[(row >> 2) * 8 + (column >> 2)];
      const shift = ((row & 2) << 1) | (column & 2);
      const palette = (attribute >> shift) & 3;
      context.drawImage(
        tileImage,
        (tile & 0x0f) * 8,
        palette * 128 + (tile >> 4) * 8,
        8,
        8,
        column * 8,
        destinationY + row * 8,
        8,
        8,
      );
    }
  }
}
function composeOriginalModeSelectionScreen(api) {
  const mode = originalAssets.modeSelection;
  if (!mode.background) {
    mode.background = decodeOriginalBackgroundImageFromCpp(api, 0x02);
  }
  const background = mode.background;
  if (!background || background.destination !== 0x2000
      || background.stream.length !== 0x400) return null;
  const subPalettes = originalBackgroundSubPalettes(background.palette0, background.palette1);
  if (!subPalettes) return null;
  const state = api.option_repeat_counter ? api.option_repeat_counter() & 0xff : 0;
  const option = api.primary_option_index ? api.primary_option_index() & 0xff : 0xff;
  const videoWrite = latestOriginalLogicalVideoWrite(0);
  const address = videoWrite?.address ?? 0;
  const patch = videoWrite ? Array.from(videoWrite.bytes) : [];
  const packed = Array.from({ length: 10 }, (_, index) =>
    api.tournament_persistent_byte ? api.tournament_persistent_byte(index) & 0xff : 0);
  if (!mode.canvas) {
    mode.canvas = document.createElement("canvas");
    mode.canvas.width = 256;
    mode.canvas.height = 240;
    mode.context = mode.canvas.getContext("2d");
  }
  mode.nametable = originalLogicalNametable(0x2000, background.stream);
  const key = `${state}:${option}:${originalAssets.logicalVideo.revision}:${packed.join(",")}`;
  if (key !== mode.key) {
    if (!renderOriginalDynamicBackgroundNametable(
      mode.context,
      mode.nametable,
      background.chr0,
      background.chr1,
      subPalettes,
    )) return null;
    mode.key = key;
  }
  mode.previousState = state;
  if (DEBUG) {
    window.__soccerModeSelectionRenderer = {
      state, option, address, patch, packed,
      backgroundId: background.imageId,
      destination: background.destination,
      chr0: background.chr0,
      chr1: background.chr1,
      paletteNumbers: [background.palette0, background.palette1],
      mirroring: background.mirroring,
      nametable: Array.from(mode.nametable),
    };
  }
  return mode.canvas;
}
function composeOriginalMatchSettingsScreen(api) {
  const settings = originalAssets.matchSettings;
  if (!settings.background) {
    settings.background = decodeOriginalBackgroundImageFromCpp(api, 0x07);
  }
  const background = settings.background;
  if (!background || background.destination !== 0x2000
      || background.stream.length < 0x800) return null;
  const subPalettes = originalBackgroundSubPalettes(
    background.palette0, background.palette1,
  );
  if (!subPalettes) return null;
  const continent = api.continent_option ? api.continent_option() & 0xff : 0;
  const surfaceWetness = api.surface_wetness ? api.surface_wetness() & 0xff : 0;
  const rainWind = api.rain_wind_option ? api.rain_wind_option() & 0xff : 0;
  const storm = api.lightning_tornado_direction
    ? api.lightning_tornado_direction() & 0xff : 0;
  const logicalRevision = originalAssets.logicalVideo.revision;
  const key = `${logicalRevision}:${continent}:${surfaceWetness}:${rainWind}:${storm}`;
  if (settings.canvas && settings.key === key) return settings.canvas;
  if (!settings.canvas) {
    settings.canvas = document.createElement("canvas");
    settings.canvas.width = 256;
    settings.canvas.height = 480;
    settings.context = settings.canvas.getContext("2d");
    settings.pageCanvases = Array.from({ length: 2 }, () => {
      const page = document.createElement("canvas");
      page.width = 256;
      page.height = 240;
      return page;
    });
  }
  const nametables = [
    originalLogicalNametable(0x2000, background.stream.slice(0, 0x400)),
    originalLogicalNametable(0x2800, background.stream.slice(0x400, 0x800)),
  ];
  settings.context.clearRect(0, 0, 256, 480);
  settings.context.imageSmoothingEnabled = false;
  for (let page = 0; page < 2; page++) {
    const pageCanvas = settings.pageCanvases[page];
    if (!renderOriginalDynamicBackgroundNametable(
      pageCanvas.getContext("2d"),
      nametables[page],
      background.chr0,
      background.chr1,
      subPalettes,
    )) return null;
    settings.context.drawImage(pageCanvas, 0, page * 240);
  }
  settings.nametables = nametables;
  settings.key = key;
  return settings.canvas;
}
function composeOriginalFormationControlScreen(api) {
  const formation = originalAssets.formationControl;
  if (!formation.background) {
    formation.background = decodeOriginalBackgroundImageFromCpp(api, 0x05);
  }
  const background = formation.background;
  if (!background || background.destination !== 0x2000
      || background.stream.length < 0x800) return null;
  const subPalettes = originalBackgroundSubPalettes(
    background.palette0, background.palette1,
  );
  if (!subPalettes) return null;
  const logicalVideo = originalAssets.logicalVideo;
  const side = api.substitution_counter
    ? api.substitution_counter() & 1 : 0;
  const team = api.team_number ? api.team_number(side) & 0x0F : 0;
  const state = api.option_repeat_counter ? api.option_repeat_counter() & 0xFF : 0;
  const currentBackgroundId = api.background_image_id
    ? api.background_image_id() & 0xFF : 0x05;
  const teamOverlayId = currentBackgroundId === 0x05
    ? 0xffffffff : currentBackgroundId;
  const key = `${logicalVideo.revision}`;
  if (formation.canvas && formation.key === key) return formation.canvas;
  if (!formation.canvas) {
    formation.canvas = document.createElement("canvas");
    formation.canvas.width = 256;
    formation.canvas.height = 480;
    formation.context = formation.canvas.getContext("2d");
    formation.pageCanvases = Array.from({ length: 2 }, () => {
      const page = document.createElement("canvas");
      page.width = 256;
      page.height = 240;
      return page;
    });
  }
  const nametables = [
    originalLogicalNametable(0x2000, background.stream.slice(0, 0x400)),
    originalLogicalNametable(0x2800, background.stream.slice(0x400, 0x800)),
  ];
  formation.context.clearRect(0, 0, 256, 480);
  formation.context.imageSmoothingEnabled = false;
  for (let page = 0; page < 2; page++) {
    const pageCanvas = formation.pageCanvases[page];
    if (!renderOriginalDynamicBackgroundNametable(
      pageCanvas.getContext("2d"),
      nametables[page],
      background.chr0,
      background.chr1,
      subPalettes,
    )) return null;
    formation.context.drawImage(pageCanvas, 0, page * 240);
  }
  formation.teamOverlayId = teamOverlayId;
  formation.nametables = nametables;
  formation.logicalRevision = logicalVideo.revision;
  formation.writes = logicalVideo.frameWrites.map((write) => ({
    source: write.source,
    address: write.address,
    increment: write.increment,
    bytes: Array.from(write.bytes),
  }));
  formation.key = key;
  return formation.canvas;
}
function writeOriginalNametableTiles(nametable, address, tiles) {
  let offset = (address - 0x2000) & 0x03ff;
  for (const tile of tiles || []) {
    if (offset >= 0 && offset < nametable.length) nametable[offset] = tile & 0xff;
    offset++;
  }
}
function composeOriginalWeatherPreviewScreen(api) {
  const weather = originalAssets.weatherPreview;
  if (!weather.background) {
    weather.background = decodeOriginalBackgroundImageFromCpp(api, 0x08);
  }
  const background = weather.background;
  if (!background || background.destination !== 0x2000
      || background.stream.length !== 0x400) return null;
  const subPalettes = originalBackgroundSubPalettes(
    background.palette0, background.palette1,
  );
  if (!subPalettes) return null;
  const logicalVideo = originalAssets.logicalVideo;
  const key = `${logicalVideo.revision}`;
  if (weather.canvas && weather.key === key) return weather.canvas;
  if (!weather.canvas) {
    weather.canvas = document.createElement("canvas");
    weather.canvas.width = 256;
    weather.canvas.height = 240;
    weather.context = weather.canvas.getContext("2d");
  }
  const nametable = originalLogicalNametable(0x2000, background.stream);
  if (!renderOriginalDynamicBackgroundNametable(
    weather.context,
    nametable,
    background.chr0,
    background.chr1,
    subPalettes,
  )) return null;
  weather.nametable = nametable;
  weather.key = key;
  if (DEBUG) {
    window.__soccerWeatherPreviewRenderer = {
      subtype: 0x08,
      source: "logical-video-cpp",
      backgroundId: background.imageId,
      destination: background.destination,
      chr0: background.chr0,
      chr1: background.chr1,
      paletteNumbers: [background.palette0, background.palette1],
      mirroring: background.mirroring,
      logicalRevision: logicalVideo.revision,
      writes: logicalVideo.frameWrites.map((write) => ({
        source: write.source,
        address: write.address,
        increment: write.increment,
        bytes: Array.from(write.bytes),
      })),
      key,
      nametable: Array.from(nametable),
    };
  }
  return weather.canvas;
}
function decodeOriginalBackgroundImageFromCpp(api, imageId) {
  if (!api.background_renderer_decode_image
      || !api.background_renderer_stream_byte
      || !api.background_renderer_destination
      || !api.background_renderer_chr_bank
      || !api.background_renderer_palette_number
      || !api.background_renderer_mirroring) return null;
  const size = api.background_renderer_decode_image(imageId) >>> 0;
  const destination = api.background_renderer_destination() >>> 0;
  if (!size || size > 0x1000 || destination < 0x2000 || destination >= 0x3000) {
    return null;
  }
  const stream = new Uint8Array(size);
  for (let index = 0; index < size; index++) {
    const value = api.background_renderer_stream_byte(index) >>> 0;
    if (value > 0xFF) return null;
    stream[index] = value;
  }
  return {
    imageId: imageId & 0xFF,
    destination,
    stream,
    chr0: api.background_renderer_chr_bank(0) & 0xFF,
    chr1: api.background_renderer_chr_bank(1) & 0xFF,
    palette0: api.background_renderer_palette_number(0) & 0xFF,
    palette1: api.background_renderer_palette_number(1) & 0xFF,
    mirroring: api.background_renderer_mirroring() & 0xFF,
  };
}
function composeOriginalStaticBackground(api, imageId) {
  const id = imageId & 0xff;
  const cached = originalAssets.staticBackgrounds.get(id);
  if (cached) return cached.canvas;
  const background = decodeOriginalBackgroundImageFromCpp(api, id);
  if (!background || background.destination !== 0x2000
      || background.stream.length < 0x400) return null;
  const pageCount = Math.min(2, Math.floor(background.stream.length / 0x400));
  const subPalettes = originalBackgroundSubPalettes(
    background.palette0, background.palette1);
  if (!pageCount || !subPalettes) return null;
  const canvas = document.createElement("canvas");
  canvas.width = pageCount * 0x100;
  canvas.height = 0xf0;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.imageSmoothingEnabled = false;
  const nametables = [];
  for (let page = 0; page < pageCount; page++) {
    const begin = page * 0x400;
    const nametable = Uint8Array.from(
      background.stream.subarray(begin, begin + 0x400));
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = 0x100;
    pageCanvas.height = 0xf0;
    const pageContext = pageCanvas.getContext("2d");
    if (!pageContext || !renderOriginalDynamicBackgroundNametable(
      pageContext, nametable, background.chr0, background.chr1, subPalettes)) {
      return null;
    }
    context.drawImage(pageCanvas, page * 0x100, 0);
    nametables.push(nametable);
  }
  originalAssets.staticBackgrounds.set(id, {
    background,
    canvas,
    nametables,
  });
  return canvas;
}
function composeOriginalSplashBackground(api, imageId, blinkOff = false) {
  const id = imageId & 0xff;
  composeOriginalStaticBackground(api, id);
  const base = originalAssets.staticBackgrounds.get(id);
  if (!base || base.nametables.length !== 1) return base?.canvas || null;
  const background = base.background;
  const bank0Value = api.background_bank
    ? api.background_bank(0) & 0xff : background.chr0;
  const bank1Value = api.background_bank
    ? api.background_bank(1) & 0xff : background.chr1;
  const bank0 = bank0Value || background.chr0;
  const bank1 = bank1Value || background.chr1;
  const palette0 = api.background_palette_id
    ? api.background_palette_id(0) & 0xff : background.palette0;
  const palette1 = api.background_palette_id
    ? api.background_palette_id(1) & 0xff : background.palette1;
  const key = `${id}:${bank0}:${bank1}:${palette0}:${palette1}:${blinkOff ? 1 : 0}`;
  const cached = originalAssets.splash.states.get(key);
  if (cached) {
    originalAssets.splash.last = cached;
    publishOriginalSplashRendererDebug(id, cached);
    return cached.canvas;
  }
  const subPalettes = originalBackgroundSubPalettes(palette0, palette1);
  if (!subPalettes) return null;
  const nametable = Uint8Array.from(base.nametables[0]);
  if (id === 0x01 && blinkOff) {
    nametable.fill(0x00, 0x2c6, 0x2c6 + 0x12);
    nametable[0x2ad] = 0x00;
  }
  const splashCanvas = document.createElement("canvas");
  splashCanvas.width = 0x100;
  splashCanvas.height = 0xf0;
  const splashContext = splashCanvas.getContext("2d");
  if (!splashContext || !renderOriginalDynamicBackgroundNametable(
    splashContext, nametable, bank0, bank1, subPalettes)) return null;
  const state = {
    source: "classified-bin-cpp",
    background,
    canvas: splashCanvas,
    nametable,
    bank0,
    bank1,
    paletteNumbers: [palette0, palette1],
    blinkOff: Boolean(blinkOff),
  };
  originalAssets.splash.states.set(key, state);
  originalAssets.splash.last = state;
  publishOriginalSplashRendererDebug(id, state);
  return splashCanvas;
}
function publishOriginalSplashRendererDebug(imageId, state) {
  if (!DEBUG || !state) return;
  window.__soccerSplashRenderer = {
    source: state.source,
    backgroundId: imageId & 0xff,
    destination: state.background.destination,
    bank0: state.bank0,
    bank1: state.bank1,
    paletteNumbers: [...state.paletteNumbers],
    mirroring: state.background.mirroring,
    blinkOff: state.blinkOff,
    nametable: Array.from(state.nametable),
  };
}
function composeOriginalOpponentSelectionScreen(api) {
  const opponent = originalAssets.opponentSelection;
  if (!opponent.background) {
    opponent.background = decodeOriginalBackgroundImageFromCpp(api, 0x03);
  }
  const background = opponent.background;
  if (!background || background.destination !== 0x2000
      || background.stream.length !== 0x400) return null;
  const subPalettes = originalBackgroundSubPalettes(background.palette0, background.palette1);
  if (!subPalettes) return null;
  const option = api.primary_option_index ? api.primary_option_index() & 0xff : 0xff;
  const logicalRevision = originalAssets.logicalVideo.revision;
  const key = `${logicalRevision}:${option}`;
  if (opponent.canvas && opponent.key === key) return opponent.canvas;
  if (!opponent.canvas) {
    opponent.canvas = document.createElement("canvas");
    opponent.canvas.width = 256;
    opponent.canvas.height = 240;
    opponent.context = opponent.canvas.getContext("2d");
  }
  const nametable = originalLogicalNametable(0x2000, background.stream);
  const attributeWrite = latestOriginalLogicalVideoWrite(0);
  const graphicsWrite = latestOriginalLogicalVideoWrite(1);
  if (!renderOriginalDynamicBackgroundNametable(
    opponent.context,
    nametable,
    background.chr0,
    background.chr1,
    subPalettes,
  )) return null;
  opponent.key = key;
  if (DEBUG) {
    window.__soccerOpponentSelectionRenderer = {
      option,
      logicalRevision,
      recordWrite: latestOriginalLogicalVideoWrite(VIDEO_WRITE_TOURNAMENT_RECORD),
      attributeWrite,
      graphicsWrite,
      backgroundId: background.imageId,
      destination: background.destination,
      chr0: background.chr0,
      chr1: background.chr1,
      paletteNumbers: [background.palette0, background.palette1],
      mirroring: background.mirroring,
      key,
      nametable: Array.from(nametable),
    };
  }
  return opponent.canvas;
}
function composeOriginalPlayerOrderScreen(api) {
  const order = originalAssets.playerOrder;
  const backgroundId = api.background_image_id
    ? api.background_image_id() & 0xFF : 0;
  if (backgroundId !== 0x13) return null;
  if (!order.background) {
    order.background = decodeOriginalBackgroundImageFromCpp(api, backgroundId);
  }
  const background = order.background;
  if (!background || background.destination !== 0x2000
      || background.stream.length !== 0x400) return null;
  const subPalettes = originalBackgroundSubPalettes(background.palette0, background.palette1);
  if (!subPalettes) return null;
  const attributeWrite = latestOriginalLogicalVideoWrite(0);
  const graphicsWrite = latestOriginalLogicalVideoWrite(1);
  const attributeAddress = attributeWrite?.address ?? 0;
  const graphicsAddress = graphicsWrite?.address ?? 0;
  const attributeBytes = attributeWrite ? Array.from(attributeWrite.bytes) : [];
  const graphicsBytes = graphicsWrite ? Array.from(graphicsWrite.bytes) : [];
  const key = `${originalAssets.logicalVideo.revision}`;
  if (order.canvas && order.key === key) return order.canvas;
  if (!order.canvas) {
    order.canvas = document.createElement("canvas");
    order.canvas.width = 256;
    order.canvas.height = 240;
    order.context = order.canvas.getContext("2d");
  }
  const nametable = originalLogicalNametable(0x2000, background.stream);
  if (!renderOriginalDynamicBackgroundNametable(
    order.context,
    nametable,
    background.chr0,
    background.chr1,
    subPalettes,
  )) return null;
  order.key = key;
  if (DEBUG) {
    window.__soccerPlayerOrderRenderer = {
      backgroundId,
      destination: background.destination,
      chr0: background.chr0,
      chr1: background.chr1,
      paletteNumbers: [background.palette0, background.palette1],
      mirroring: background.mirroring,
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
function composeOriginalTeamPreviewScreen(api) {
  const preview = originalAssets.teamPreview;
  const logicalVideo = originalAssets.logicalVideo;
  const backgroundId = api.background_image_id
    ? api.background_image_id() & 0xFF : 0;
  if (backgroundId !== 0x0B) return null;
  if (!preview.background) {
    preview.background = decodeOriginalBackgroundImageFromCpp(api, backgroundId);
  }
  const background = preview.background;
  if (!background || background.destination !== 0x2000
      || background.stream.length !== 0x400) return null;
  const teams = [0, 1].map((side) => api.team_number
    ? api.team_number(side) & 0x0F : 0);
  const continent = api.continent_option
    ? Math.min(api.continent_option() & 0xFF, 4) : 0;
  const bank0 = api.background_bank
    ? api.background_bank(0) & 0xFF : background.chr0;
  const bank1 = api.background_bank
    ? api.background_bank(1) & 0xFF : background.chr1;
  const paletteNumbers = [0, 1].map((slot) => api.background_palette_id
    ? api.background_palette_id(slot) & 0xFF
    : (slot === 0 ? background.palette0 : background.palette1));
  const subPalettes = originalBackgroundSubPalettes(paletteNumbers[0], paletteNumbers[1]);
  if (!subPalettes) return null;
  const key = `${teams.join(",")}:${continent}:${bank0}:${bank1}:`
    + `${paletteNumbers.join(",")}:${logicalVideo.revision}`;
  if (preview.canvas && preview.key === key) return preview.canvas;
  if (!preview.canvas) {
    preview.canvas = document.createElement("canvas");
    preview.canvas.width = 256;
    preview.canvas.height = 240;
    preview.context = preview.canvas.getContext("2d");
  }
  const nametable = originalLogicalNametable(0x2000, background.stream);
  if (!renderOriginalDynamicBackgroundNametable(
    preview.context,
    nametable,
    bank0 || background.chr0,
    bank1 || background.chr1,
    subPalettes,
  )) return null;
  preview.key = key;
  if (DEBUG) {
    window.__soccerTeamPreviewRenderer = {
      source: "logical-video-cpp",
      backgroundId,
      destination: background.destination,
      teams: [...teams],
      continent,
      bank0: bank0 || background.chr0,
      bank1: bank1 || background.chr1,
      paletteNumbers: [...paletteNumbers],
      expectedFlagAnimations: [
        api.ball_animation ? api.ball_animation() & 0xff : null,
        api.player_animation ? api.player_animation(0) & 0xff : null,
      ],
      expectedFlagPalettes: [0, 1].map((slot) => api.sprite_palette_id
        ? api.sprite_palette_id(slot) & 0xff : null),
      mirroring: background.mirroring,
      logicalRevision: logicalVideo.revision,
      writes: logicalVideo.frameWrites
        .filter(({ source }) => source === VIDEO_WRITE_MENU_CHR_COPY)
        .map(({ source, address, increment, bytes }) => ({
          source, address, increment, bytes: Array.from(bytes),
        })),
      key,
      nametable: Array.from(nametable),
    };
  }
  return preview.canvas;
}
function composeOriginalPlayerCountPreviewScreen(api) {
  const preview = originalAssets.playerCountPreview;
  const logicalVideo = originalAssets.logicalVideo;
  const backgroundId = api.background_image_id
    ? api.background_image_id() & 0xFF : 0;
  if (backgroundId !== 0x06) return null;
  if (!preview.background) {
    preview.background = decodeOriginalBackgroundImageFromCpp(api, backgroundId);
  }
  const background = preview.background;
  if (!background || background.destination !== 0x2000
      || background.stream.length < 0x400) return null;
  const bank0 = api.background_bank
    ? api.background_bank(0) & 0xFF : background.chr0;
  const bank1 = api.background_bank
    ? api.background_bank(1) & 0xFF : background.chr1;
  const paletteNumbers = [0, 1].map((slot) => api.background_palette_id
    ? api.background_palette_id(slot) & 0xFF
    : (slot === 0 ? background.palette0 : background.palette1));
  const subPalettes = originalBackgroundSubPalettes(
    paletteNumbers[0], paletteNumbers[1]);
  if (!subPalettes) return null;
  const playersAmount = api.selected_player_count
    ? api.selected_player_count() & 0xFF : 0;
  const key = `${playersAmount}:${bank0}:${bank1}:${paletteNumbers.join(",")}:`
    + `${logicalVideo.revision}`;
  if (preview.canvas && preview.key === key) return preview.canvas;
  if (!preview.canvas) {
    preview.canvas = document.createElement("canvas");
    preview.canvas.width = 256;
    preview.canvas.height = 240;
    preview.context = preview.canvas.getContext("2d");
  }
  const nametable = originalLogicalNametable(0x2000, background.stream);
  if (!renderOriginalDynamicBackgroundNametable(
    preview.context,
    nametable,
    bank0 || background.chr0,
    bank1 || background.chr1,
    subPalettes,
  )) return null;
  preview.key = key;
  if (DEBUG) {
    window.__soccerPlayerCountPreviewRenderer = {
      source: "logical-video-cpp",
      backgroundId,
      playersAmount,
      destination: background.destination,
      chr0: bank0 || background.chr0,
      chr1: bank1 || background.chr1,
      paletteNumbers: [...paletteNumbers],
      mirroring: background.mirroring,
      logicalRevision: logicalVideo.revision,
      writes: logicalVideo.frameWrites
        .filter(({ source }) => source >= 0 && source <= 2)
        .map(({ source, address, increment, bytes }) => ({
          source, address, increment, bytes: Array.from(bytes),
        })),
      key,
      nametable: Array.from(nametable),
    };
  }
  return preview.canvas;
}
function composeOriginalTournamentRecordScreen(api) {
  const record = originalAssets.tournamentRecord;
  const backgroundId = api.background_image_id
    ? api.background_image_id() & 0xff : 0;
  if (backgroundId !== 0x0d) return null;
  if (!record.background) {
    record.background = decodeOriginalBackgroundImageFromCpp(api, backgroundId);
  }
  const background = record.background;
  if (!background || background.destination !== 0x2000
      || background.stream.length !== 0x400) return null;
  const subPalettes = originalBackgroundSubPalettes(background.palette0, background.palette1);
  if (!subPalettes) return null;
  const logicalRevision = originalAssets.logicalVideo.revision;
  const key = `${logicalRevision}`;
  if (record.canvas && record.key === key) return record.canvas;
  if (!record.canvas) {
    record.canvas = document.createElement("canvas");
    record.canvas.width = 256;
    record.canvas.height = 240;
    record.context = record.canvas.getContext("2d");
  }
  const nametable = originalLogicalNametable(0x2000, background.stream);
  if (!renderOriginalDynamicBackgroundNametable(
    record.context,
    nametable,
    background.chr0,
    background.chr1,
    subPalettes,
  )) return null;
  record.key = key;
  if (DEBUG) {
    window.__soccerTournamentRecordRenderer = {
      subtype: 0x09,
      backgroundId,
      destination: background.destination,
      chr0: background.chr0,
      chr1: background.chr1,
      paletteNumbers: [background.palette0, background.palette1],
      mirroring: background.mirroring,
      logicalRevision,
      recordWrite: latestOriginalLogicalVideoWrite(VIDEO_WRITE_TOURNAMENT_RECORD),
      packedRowWrite: latestOriginalLogicalVideoWrite(0),
      key,
      nametable: Array.from(nametable),
    };
  }
  return record.canvas;
}
function composeOriginalPlayerProfileScreen(api) {
  const profile = originalAssets.playerProfile;
  const backgroundId = api.background_image_id
    ? api.background_image_id() & 0xff : 0;
  if (backgroundId !== 0x0c) return null;
  if (!profile.background) {
    profile.background = decodeOriginalBackgroundImageFromCpp(api, backgroundId);
  }
  const background = profile.background;
  if (!background || background.destination !== 0x2000
      || background.stream.length !== 0x400) return null;
  const subPalettes = originalBackgroundSubPalettes(background.palette0, background.palette1);
  if (!subPalettes) return null;
  const selected = api.selected_player_index
    ? api.selected_player_index() & 0xff : 0;
  const effectState = api.text_effect_state ? api.text_effect_state() & 0xff : 0x80;
  const effectStatus = api.text_effect_status ? api.text_effect_status() & 0xff : 0;
  const effectScriptId = api.text_effect_script_id
    ? api.text_effect_script_id() & 0xff : selected + 1;
  const effectCursor = api.text_effect_cursor ? api.text_effect_cursor() & 0xffff : 0;
  const effectAltCursor = api.text_effect_alternate_cursor
    ? api.text_effect_alternate_cursor() & 0xff : 0xff;
  const textWorkspace = Array.from({ length: 14 }, (_, index) =>
    api.meeting_name_workspace_byte ? api.meeting_name_workspace_byte(index) & 0xff : 0);
  const logicalVideo = originalAssets.logicalVideo;
  const key = `${logicalVideo.revision}`;
  if (profile.canvas && profile.key === key) return profile.canvas;
  if (!profile.canvas) {
    profile.canvas = document.createElement("canvas");
    profile.canvas.width = 256;
    profile.canvas.height = 240;
    profile.context = profile.canvas.getContext("2d");
  }
  const nametable = originalLogicalNametable(0x2000, background.stream);
  if (!renderOriginalDynamicBackgroundNametable(
    profile.context,
    nametable,
    background.chr0,
    background.chr1,
    subPalettes,
  )) return null;
  profile.key = key;
  if (DEBUG) {
    window.__soccerPlayerProfileRenderer = {
      subtype: 0x0a,
      source: "logical-video-cpp",
      backgroundId,
      destination: background.destination,
      chr0: background.chr0,
      chr1: background.chr1,
      paletteNumbers: [background.palette0, background.palette1],
      mirroring: background.mirroring,
      selected,
      effectState,
      effectStatus,
      effectScriptId,
      effectCursor,
      effectAltCursor,
      textWorkspace,
      logicalRevision: logicalVideo.revision,
      writes: logicalVideo.frameWrites.map((write) => ({
        source: write.source,
        address: write.address,
        increment: write.increment,
        bytes: Array.from(write.bytes),
      })),
      key,
      nametable: Array.from(nametable),
    };
  }
  return profile.canvas;
}
function composeOriginalMusicSelectionScreen(api) {
  const music = originalAssets.musicSelection;
  if (!music.background) {
    music.background = decodeOriginalBackgroundImageFromCpp(api, 0x09);
  }
  const background = music.background;
  if (!background || background.destination !== 0x2000
      || background.stream.length !== 0x400) return null;
  const subPalettes = originalBackgroundSubPalettes(
    background.palette0,
    background.palette1,
  );
  if (!subPalettes) return null;
  const option = api.primary_option_index ? api.primary_option_index() & 0xff : 0xff;
  const hiddenNumber = api.secondary_option_index
    ? api.secondary_option_index() & 0xff : 0;
  const graphicsWrite = latestOriginalLogicalVideoWrite(1);
  const bufferAddress = graphicsWrite?.address ?? 0;
  const buffer = graphicsWrite ? Array.from(graphicsWrite.bytes) : [];
  const key = `${option}:${hiddenNumber}:${originalAssets.logicalVideo.revision}`;
  if (music.canvas && music.key === key) return music.canvas;
  if (!music.canvas) {
    music.canvas = document.createElement("canvas");
    music.canvas.width = 256;
    music.canvas.height = 240;
    music.context = music.canvas.getContext("2d");
  }
  const nametable = originalLogicalNametable(0x2000, background.stream);
  music.context.clearRect(0, 0, 256, 240);
  music.context.imageSmoothingEnabled = false;
  renderOriginalDynamicBackgroundNametable(
    music.context,
    nametable,
    background.chr0,
    background.chr1,
    subPalettes,
  );
  music.key = key;
  if (DEBUG) {
    window.__soccerMusicSelectionRenderer = {
      subtype: 0x0b,
      backgroundId: background.imageId,
      destination: background.destination,
      chr0: background.chr0,
      chr1: background.chr1,
      paletteNumbers: [background.palette0, background.palette1],
      mirroring: background.mirroring,
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
  if (!meeting.backgrounds.has(backgroundId)) {
    meeting.backgrounds.set(
      backgroundId,
      decodeOriginalBackgroundImageFromCpp(api, backgroundId),
    );
  }
  const background = meeting.backgrounds.get(backgroundId);
  if (!background || background.destination !== 0x2000
      || background.stream.length !== 0x400) return null;
  const subPalettes = originalBackgroundSubPalettes(
    background.palette0,
    background.palette1,
  );
  if (!subPalettes) return null;
  const key = `${backgroundId}:${originalAssets.logicalVideo.revision}`;
  if (meeting.canvas && meeting.key === key) return meeting.canvas;
  if (!meeting.canvas) {
    meeting.canvas = document.createElement("canvas");
    meeting.canvas.width = 256;
    meeting.canvas.height = 240;
    meeting.context = meeting.canvas.getContext("2d");
  }
  const nametable = originalLogicalNametable(0x2000, background.stream);
  if (!renderOriginalDynamicBackgroundNametable(
    meeting.context,
    nametable,
    background.chr0,
    background.chr1,
    subPalettes,
  )) return null;
  meeting.key = key;
  if (DEBUG) {
    window.__soccerMeetingSecretRenderer = {
      subtype: api.screen_subtype ? api.screen_subtype() & 0x7f : 0,
      source: "classified-bin-cpp",
      backgroundId,
      destination: background.destination,
      chr0: background.chr0,
      chr1: background.chr1,
      paletteNumbers: [background.palette0, background.palette1],
      mirroring: background.mirroring,
      logicalRevision: originalAssets.logicalVideo.revision,
      writes: originalAssets.logicalVideo.frameWrites
        .map(({ source, address, increment, bytes }) => ({
          source, address, increment, bytes: Array.from(bytes),
        })),
      key,
      nametable: Array.from(nametable),
    };
  }
  return meeting.canvas;
}
function drawOriginalMenuScreen(api) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const id = api.background_image_id ? api.background_image_id() : 0x02;
  const subtype = api.screen_subtype ? api.screen_subtype() & 0x7f : 0;
  const staticBackground = composeOriginalStaticBackground(api, id);
  const img = subtype === 0x0f
    ? (composeOriginalBracketScreen(api) || staticBackground)
    : subtype === 0x01
      ? (composeOriginalModeSelectionScreen(api) || staticBackground)
    : subtype === 0x02
      ? (composeOriginalOpponentSelectionScreen(api) || staticBackground)
    : subtype === 0x03
      ? (composeOriginalTeamPreviewScreen(api) || staticBackground)
    : subtype === 0x04
      ? (composeOriginalPlayerOrderScreen(api) || staticBackground)
    : subtype === 0x05
      ? (composeOriginalPlayerCountPreviewScreen(api) || staticBackground)
    : subtype === 0x06
      ? (composeOriginalMatchSettingsScreen(api) || staticBackground)
      : subtype === 0x07
        ? (composeOriginalFormationControlScreen(api)
          || composeOriginalStaticBackground(api, 0x05))
      : subtype === 0x08
        ? (composeOriginalWeatherPreviewScreen(api) || staticBackground)
      : subtype === 0x09
        ? (composeOriginalTournamentRecordScreen(api) || staticBackground)
      : subtype === 0x0a
        ? (composeOriginalPlayerProfileScreen(api) || staticBackground)
      : subtype === 0x0b
        ? (composeOriginalMusicSelectionScreen(api) || staticBackground)
      : subtype === 0x0c || subtype === 0x0d
        ? (composeOriginalMeetingSecretScreen(api, id) || staticBackground)
      : staticBackground;
  const layout = originalFullScreenLayout();
  const brightness = api.current_brightness ? api.current_brightness() : 0x40;
  if (img) {
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = Math.max(0, Math.min(1, brightness / 0x40));
    if ((subtype === 0x06 || subtype === 0x07) && (img.height || img.naturalHeight) >= 480) {
      const cameraY = api.camera_y_low && api.camera_y_high
        ? ((api.camera_y_high() << 8) | api.camera_y_low())
        : 0;
      const sourceY = cameraY >= 0x0100 ? 240 : Math.min(cameraY, 240);
      ctx.drawImage(img, 0, sourceY, 256, 240, layout.x, layout.y, layout.w, layout.h);
      if (DEBUG) {
        const rendererState = {
          subtype,
          backgroundId: id,
          state: api.option_repeat_counter ? api.option_repeat_counter() & 0xff : 0,
          option: api.primary_option_index ? api.primary_option_index() & 0xff : 0,
          cameraY,
          sourceY,
          key: subtype === 0x06
            ? originalAssets.matchSettings.key
            : originalAssets.formationControl.key,
        };
        if (subtype === 0x06) {
          const background = originalAssets.matchSettings.background;
          rendererState.source = "logical-video-cpp";
          rendererState.destination = background?.destination ?? 0;
          rendererState.chr0 = background?.chr0 ?? 0;
          rendererState.chr1 = background?.chr1 ?? 0;
          rendererState.paletteNumbers = background
            ? [background.palette0, background.palette1] : [];
          rendererState.mirroring = background?.mirroring ?? 0;
          rendererState.logicalRevision = originalAssets.logicalVideo.revision;
          rendererState.writes = originalAssets.logicalVideo.frameWrites.map((write) => ({
            source: write.source,
            address: write.address,
            increment: write.increment,
            bytes: Array.from(write.bytes),
          }));
          rendererState.nametables = originalAssets.matchSettings.nametables
            ? originalAssets.matchSettings.nametables.map((table) => Array.from(table))
            : [];
          window.__soccerMatchSettingsRenderer = rendererState;
        }
        else {
          const background = originalAssets.formationControl.background;
          rendererState.backgroundId = background?.imageId ?? 0;
          rendererState.source = "logical-video-cpp";
          rendererState.destination = background?.destination ?? 0;
          rendererState.chr0 = background?.chr0 ?? 0;
          rendererState.chr1 = background?.chr1 ?? 0;
          rendererState.paletteNumbers = background
            ? [background.palette0, background.palette1] : [];
          rendererState.mirroring = background?.mirroring ?? 0;
          rendererState.teamOverlayId = originalAssets.formationControl.teamOverlayId;
          rendererState.logicalRevision = originalAssets.logicalVideo.revision;
          rendererState.writes = originalAssets.logicalVideo.frameWrites.map((write) => ({
            source: write.source,
            address: write.address,
            increment: write.increment,
            bytes: Array.from(write.bytes),
          }));
          rendererState.nametables = originalAssets.formationControl.nametables
            ? originalAssets.formationControl.nametables.map((table) => Array.from(table))
            : [];
          window.__soccerFormationControlRenderer = rendererState;
        }
      }
    } else {
      ctx.drawImage(img, layout.x, layout.y, layout.w, layout.h);
    }
    ctx.globalAlpha = 1;
  }
  drawOriginalMenuObjects(api, layout, subtype);
}
function composeOriginalCreditsBackground(api, backgroundId) {
  const credits = originalAssets.credits;
  if (!credits.base) credits.base = decodeOriginalBackgroundImageFromCpp(api, 0x1c);
  if (!credits.backgrounds.has(backgroundId)) {
    credits.backgrounds.set(backgroundId, decodeOriginalBackgroundImageFromCpp(api, backgroundId));
  }
  const base = credits.base;
  const overlay = credits.backgrounds.get(backgroundId);
  if (!base || !overlay || base.destination !== 0x2000 || base.stream.length < 0x400) return null;
  let state = credits.states.get(backgroundId);
  if (!state) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 240;
    const nametable = Uint8Array.from(base.stream.subarray(0, 0x400));
    const overlayOffset = overlay.destination - 0x2000;
    if (overlayOffset < 0 || overlayOffset >= 0x400) return null;
    const overlaySize = Math.min(overlay.stream.length, 0x400 - overlayOffset);
    nametable.set(overlay.stream.subarray(0, overlaySize), overlayOffset);
    state = {
      canvas,
      context: canvas.getContext("2d"),
      nametable,
      background: overlay,
      signature: "",
      rendered: false,
    };
    credits.states.set(backgroundId, state);
  }
  state.nametable = originalLogicalNametable(0x2000, state.nametable);
  const signature = `${originalAssets.logicalVideo.revision}`;
  if (state.signature !== signature || !state.rendered) {
    const background = state.background;
    const subPalettes = originalBackgroundSubPalettes(background.palette0, background.palette1);
    if (!state.context || !renderOriginalDynamicBackgroundNametable(
      state.context, state.nametable, background.chr0, background.chr1, subPalettes,
    )) return null;
    state.signature = signature;
    state.rendered = true;
  }
  return state.canvas;
}
function drawOriginalCreditsScreen(api) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const subtype = api.screen_subtype ? api.screen_subtype() & 0x7f : 0;
  const backgroundId = api.background_image_id
    ? api.background_image_id() & 0xff : 0x1c;
  const background = backgroundId === 0
    ? composeOriginalSplashBackground(api, 0, false)
    : composeOriginalCreditsBackground(api, backgroundId);
  const layout = originalFullScreenLayout();
  const cameraX = api.camera_x_low && api.camera_x_high
    ? (api.camera_x_high() << 8) | api.camera_x_low() : 0;
  const cameraY = api.camera_y_low && api.camera_y_high
    ? (api.camera_y_high() << 8) | api.camera_y_low() : 0;
  const brightness = api.current_brightness ? api.current_brightness() : 0x40;
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
  drawCppLogicalOam(api, {
    original: true,
    destX: layout.x,
    destY: layout.y,
    destW: layout.w,
    destH: layout.h,
    sourceW: 256,
    sourceH: 240,
    logicalScale: layout.scale,
  });
  ctx.restore();
  const priorityCount = api.committed_animation_priority_count
    ? Math.min(api.committed_animation_priority_count() & 0xFF, 0x20)
    : 0;
  const drawnObjects = [];
  for (let slot = 0; slot < priorityCount; slot++) {
    const object = api.committed_animation_priority_object(slot) & 0x1F;
    if (object <= 0x0C && !drawnObjects.includes(object)) drawnObjects.push(object);
  }
  if (DEBUG) {
    const creditsState = originalAssets.credits.states.get(backgroundId);
    const creditsBackground = creditsState?.background;
    window.__soccerCreditsRenderer = {
      subtype, backgroundId, cameraX, cameraY,
      source: "classified-bin-cpp",
      destination: creditsBackground?.destination ?? 0,
      chr0: creditsBackground?.chr0 ?? 0,
      chr1: creditsBackground?.chr1 ?? 0,
      paletteNumbers: creditsBackground
        ? [creditsBackground.palette0, creditsBackground.palette1] : [],
      mirroring: creditsBackground?.mirroring ?? 0,
      nametable: creditsState ? Array.from(creditsState.nametable) : [],
      scene: api.credits_scene_index ? api.credits_scene_index() : 0,
      effectDone: api.credits_effect_done ? api.credits_effect_done() : 0,
      drawnObjects,
    };
  }
}
function render(api) {
  gameWrap.classList.remove("original-result-screen");
  const worldW = api.game_field_w();
  const worldH = api.game_field_h();
  const screenW = canvas.width;
  const screenH = canvas.height;
  const phase = api.game_phase ? api.game_phase() : PHASE.PLAYING;
  const originalScreen = api.screen_id ? api.screen_id() : 0;
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
  const originalSubtype = api.screen_subtype ? api.screen_subtype() : 0;
  const cpuTeam = api.team_number
    ? (api.team_number(1) & 0x0F) : 1;
  const menuTeam = api.primary_option_index
    ? (api.primary_option_index() & 0xFF) : 0;
  const wins = api.tournament_win_count ? api.tournament_win_count() : 0;
  const ballPosition = originalBallPosition(api);
  const bx = ballPosition.x;
  const by = ballPosition.y;
  const bz = normalizeOriginalHeight(ballPosition.z);
  const exposesOriginalCamera = api.camera_x_low && api.camera_x_high
    && api.camera_y_low && api.camera_y_high;
  const committedVideoView = originalCommittedVideoView(api);
  const committedCamera = originalScreen === 0x00 ? originalCommittedCamera(api, false) : null;
  const rawCameraX = committedVideoView?.x ?? committedCamera?.x ?? (exposesOriginalCamera
    ? ((api.camera_x_high() << 8) | api.camera_x_low()) : 0);
  const rawCameraY = committedVideoView?.y ?? committedCamera?.y ?? (exposesOriginalCamera
    ? ((api.camera_y_high() << 8) | api.camera_y_low()) : 0);
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
  const resultBackgroundId = api.background_image_id
    ? api.background_image_id() & 0xFF : 0x10;
  const originalResultBackground = isOriginalResultScreen
    ? composeOriginalResultBackground(api, resultBackgroundId)
    : null;
  const committedCopyCamera = originalScreen === 0x00 ? originalCommittedCamera(api, true) : null;
  const copyCameraX = committedCopyCamera?.x ?? (api.camera_copy_x_low && api.camera_copy_x_high
    ? (api.camera_copy_x_high() << 8) | api.camera_copy_x_low()
    : cameraX);
  const copyCameraY = committedCopyCamera?.y ?? (api.camera_copy_y_low && api.camera_copy_y_high
    ? (api.camera_copy_y_high() << 8) | api.camera_copy_y_low()
    : cameraY);
  let view;
  let objectView;
  if (isOriginalResultScreen) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const layout = originalFullScreenLayout();
    if (originalResultBackground) {
      const brightness = api.current_brightness
        ? api.current_brightness() : 0x40;
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
    window.__soccerVideoView = committedVideoView;
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
  const sourceControlled = api.controlled_player_index ? api.controlled_player_index(0) : 0xFF;
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
  const usesCppLogicalOam = originalScreen === 0x00
    && drawCppLogicalOam(api, objectView, {
      filter: ({ object }) => {
        if (object < 0x0E || object > 0x12) return true;
        return (api.committed_sprite_screen_y(object) & 0xFF)
          !== (api.committed_sprite_ground_y(object) & 0xFF);
      },
    });
  if (originalScreen === 0x00 && !usesCppLogicalOam) {
    throw new Error("required C++ logical OAM adapter is unavailable");
  }
  let entities = [];
  if (DEBUG) {
  if (api.animation_priority_count && api.animation_priority_object) {
    const useCommittedPriority = originalCommittedSpriteFrameActive(api)
      && api.committed_animation_priority_count
      && api.committed_animation_priority_object;
    const priorityCount = Math.min(useCommittedPriority
      ? api.committed_animation_priority_count()
      : api.animation_priority_count(), 0x20);
    const seen = new Set();
    for (let slot = priorityCount - 1; slot >= 0; slot--) {
      const entry = useCommittedPriority
        ? api.committed_animation_priority_object(slot)
        : api.animation_priority_object(slot);
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
      } else if (object >= 0x0E && object <= 0x12 && api.field_marker_animation_id) {
        const markerSlot = object - 0x0E;
        const originalPosition = originalFieldMarkerPosition(api, markerSlot);
        const visible = !api.field_marker_visibility
          || api.field_marker_visibility(markerSlot) !== 0;
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
      const tileNumber = entity.kind === "state" ? 0xA1 : 0xB7;
      const paletteSlot = entity.kind === "state" ? 1 : 0;
      const bankSlot = tileNumber >> 6;
      const bankNumber = originalSpriteBankForObject(api, entity.index, bankSlot);
      const rendered = {
        object: entity.index, kind: entity.kind, tileNumber, paletteSlot,
        bankSlot, bankNumber,
      };
      if (rendered) renderedShadows.push(rendered);
      renderedObjects.push({ type: "shadow", index: entity.index, x: screenPosition.x, y: screenPosition.y });
      continue;
    }
    if (entity.type === "ball") {
      const committed = originalCommittedObjectCanvasPosition(api, 0x0C, objectView, false);
      const b = committed || worldToScreen(objectView, bx, by);
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
      renderedObjects.push({ type: "marker", index: entity.object, x: p.x, y: p.y - height * (objectView.logicalScale || 1) });
      continue;
    }
    const i = entity.index;
    const originalPosition = playerPositions[i] || originalPlayerPosition(api, i);
    const committed = originalCommittedObjectCanvasPosition(api, i, objectView, false);
    const p = committed || worldToScreen(objectView, originalPosition.x, originalPosition.y);
    const playerHeight = committed ? 0 : normalizeOriginalHeight(originalPosition.z);
    const visualY = p.y - playerHeight * (objectView.logicalScale || 1);
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
      index: api.controlled_player_index ? api.controlled_player_index(overhead.index - 1) & 0xFF : 0xFF,
      worldX: position.x,
      worldY: position.y,
      worldZ: position.z,
      screenX: screen.x,
      screenY: screen.y,
      fieldKey: originalAssets.field?.compositeKey || "",
    } : null;
  }
  }
  if (!isOriginalResultScreen) drawOriginalWeatherSprites(api, objectView);
  ctx.restore();
  const drewOriginalMinimap = !isOriginalResultScreen && drawOriginalMatchStatusbar(api, objectView);
  if (DEBUG && !drewOriginalMinimap) window.__soccerMinimap = { visible: false, markers: [] };
  if (!isOriginalResultScreen) drawScore(api, screenW, drewOriginalMinimap);
  if (DEBUG && !isOriginalResultScreen) {
    const stamina = api.player_stamina(controlled);
    ctx.fillStyle = "rgba(0,0,0,.45)";
    ctx.fillRect(16, 16, 132, 16);
    ctx.fillStyle = stamina > 30 ? "#62e572" : "#ffcc4d";
    ctx.fillRect(18, 18, Math.max(0, stamina) * 1.28, 12);
    ctx.font = "11px ui-monospace, Consolas, monospace";
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
      drawOverlay("GOAL!", [
        `比分 ${api.score_left()} - ${api.score_right()}`,
      ]);
    }
    if (phase === PHASE.HALFTIME) drawOverlay("HALF TIME", ["换边，下半场准备", "PC：按 J / Z 继续", "手机：点 A继续"]);
    if (phase === PHASE.FULL_TIME) drawOverlay("FULL TIME", [`最终比分 ${api.score_left()} - ${api.score_right()}`, api.score_left() > api.score_right() ? "胜利：下场对手升级" : "败北/平局：重新挑战", "PC：按 J / Z 返回菜单", "手机：点 A返回菜单"]);
    if (phase === PHASE.THROW_IN) drawOverlay("THROW IN", ["PC：按 J / Z 继续", "手机：点 A继续"]);
    if (phase === PHASE.GOAL_KICK) drawOverlay("GOAL KICK", ["PC：按 J / Z 继续", "手机：点 A继续"]);
    if (phase === PHASE.CORNER_KICK) drawOverlay("CORNER KICK", ["PC：按 J / Z 继续", "手机：点 A继续"]);
    if (phase === PHASE.FREE_KICK) drawOverlay("FREE KICK", ["PC：按 J / Z 继续", "手机：点 A继续"]);
    if (phase === PHASE.PENALTY_KICK) drawOverlay("PENALTY KICK", ["PC：按 J / Z 射门", "手机：点 A射门"]);
    if (phase === PHASE.PAUSE) drawOverlay("PAUSE", ["START 继续", "原作暂停：A / B 不会解除暂停"]);
  }
  const action = api.player_action_id ? api.player_action_id(controlled) : 0;
  const period = api.current_period ? api.current_period() : 1;
  const swapped = api.side_swapped ? api.side_swapped() : 0;
  const weather = api.field_weather ? api.field_weather() : 0;
  const wind = `${api.field_wind_x ? api.field_wind_x() : 0}/${api.field_wind_y ? api.field_wind_y() : 0}`;
  const originalOwner = api.ball_owner ? api.ball_owner() : 0;
  const roleInfo = api.player_role_speed ? `${api.player_role_speed(controlled)}/${api.player_role_power(controlled)}/${api.player_role_stamina(controlled)}/${api.player_role_tackle(controlled)}/${api.player_role_keeper(controlled)}` : "0";
  const playerOrig = api.player_motion ? `${api.player_motion(controlled).toString(16).padStart(2, "0")}/${api.player_action_id(controlled).toString(16).padStart(2, "0")}/${api.player_state_flags(controlled).toString(16).padStart(2, "0")}` : "??/??/??";
  const playerRam = api.player_position_x_low
    ? `${api.player_position_x_high(controlled).toString(16).padStart(2, "0")}${api.player_position_x_low(controlled).toString(16).padStart(2, "0")}/${api.player_position_y_high(controlled).toString(16).padStart(2, "0")}${api.player_position_y_low(controlled).toString(16).padStart(2, "0")}/${api.player_position_z_high(controlled).toString(16).padStart(2, "0")}${api.player_position_z_low(controlled).toString(16).padStart(2, "0")}`
    : "????/????/????";
  const script = api.game_script ? api.game_script().toString(16).padStart(2, "0") : "??";
  const ballObj = api.ball_object_id ? api.ball_object_id().toString(16).padStart(2, "0") : "??";
  const ballRam = api.ball_position_x_low
    ? `${api.ball_position_x_high().toString(16).padStart(2, "0")}${api.ball_position_x_low().toString(16).padStart(2, "0")}/${api.ball_position_y_high().toString(16).padStart(2, "0")}${api.ball_position_y_low().toString(16).padStart(2, "0")}/${api.ball_position_z_high().toString(16).padStart(2, "0")}${api.ball_position_z_low().toString(16).padStart(2, "0")}`
    : "????/????/????";
  const ballState = api.ball_motion
    ? `${api.ball_motion().toString(16).padStart(2, "0")}/${api.ball_shot_type().toString(16).padStart(2, "0")}/${api.ball_state_flags().toString(16).padStart(2, "0")}/${api.ball_action_timer().toString(16).padStart(2, "0")}/${api.ball_health_points().toString(16).padStart(2, "0")}`
    : "??/??/??/??/??";
  const ballAnim = api.ball_animation
    ? `${api.ball_animation().toString(16).padStart(2, "0")}/${api.ball_animation_frame().toString(16).padStart(2, "0")}/${api.ball_animation_timer().toString(16).padStart(2, "0")}`
    : "??/??/??";
  const ballSpeedRam = api.ball_velocity_x_low
    ? `${api.ball_velocity_x_high().toString(16).padStart(2, "0")}${api.ball_velocity_x_low().toString(16).padStart(2, "0")}/${api.ball_velocity_y_high().toString(16).padStart(2, "0")}${api.ball_velocity_y_low().toString(16).padStart(2, "0")}/${api.ball_velocity_z_high().toString(16).padStart(2, "0")}${api.ball_velocity_z_low().toString(16).padStart(2, "0")}/g${api.ball_gravity_high().toString(16).padStart(2, "0")}${api.ball_gravity_low().toString(16).padStart(2, "0")}`
    : "????/????/????/g????";
  const btnHold = api.debug_original_button_ram ? api.debug_original_button_ram(0, 0x04).toString(16).padStart(2, "0") : "??";
  const btnPress = api.debug_original_button_ram ? api.debug_original_button_ram(0, 0x08).toString(16).padStart(2, "0") : "??";
  if (DEBUG) {
    stats.hidden = false;
    stats.textContent = `build=${BUILD_ID} phase=${phase} input=$${touch.lastBits.toString(16).padStart(2, "0")} stick=${touch.axisX}/${touch.axisY} btn=${btnHold}/${btnPress} script=$${script} period=${period} swap=${swapped} cpu=${cpuTeam} menu=${menuTeam} wins=${wins} weather=${weather} wind=${wind} score=${api.score_left()}-${api.score_right()} time=${api.match_seconds_left()} tick=${api.game_tick_count()} players=${count} role=${roleInfo} pOrig=${playerOrig} pRam=${playerRam} ballObj=$${ballObj} ballRam=${ballRam} ballState=${ballState} ballAnim=${ballAnim} ballSpeed=${ballSpeedRam} owner=${originalOwner} camera=${cameraX.toString(16)}/${cameraY.toString(16)} ball=(${bx},${by},z=${bz}) act=${action}`;
  }
}
async function main() {
  await loadReleaseMetadata();
  const apiPromise = loadWasm();
  const spriteManifestPromise = apiPromise.then((api) => loadOriginalSpriteRendererFromBin(api));
  const palettesPromise = apiPromise.then(() => loadOriginalPaletteDataFromBins());
  const [api, field, spriteManifest, palettes] = await Promise.all([
    apiPromise,
    apiPromise.then((api) => loadOriginalFieldAssets(api)),
    spriteManifestPromise,
    palettesPromise,
  ]);
  originalAssets.field = field;
  originalAssets.sprite.manifest = spriteManifest;
  originalAssets.sprite.patternApi = api;
  originalAssets.sprite.palettes = palettes;
  document.body.dataset.statusbarRendererSource = "logical-video-cpp";
  document.body.dataset.splashRendererSource = "classified-bin-cpp";
  document.body.dataset.backgroundRendererSource = "classified-bin-cpp";
  document.body.dataset.fieldRendererSource = "classified-bin-cpp";
  document.body.dataset.logicalOamRendererSource = "cpp-logical-oam";
  document.body.dataset.logicalVideoRendererSource = "cpp-logical-video";
  document.body.dataset.resultRendererSource = "classified-bin-cpp";
  document.body.dataset.modeSelectionRendererSource = "classified-bin-cpp";
  document.body.dataset.opponentSelectionRendererSource = "classified-bin-cpp";
  document.body.dataset.teamPreviewRendererSource = "logical-video-cpp";
  document.body.dataset.playerCountPreviewRendererSource = "logical-video-cpp";
  document.body.dataset.playerOrderRendererSource = "classified-bin-cpp";
  document.body.dataset.bracketRendererSource = "logical-video-cpp";
  document.body.dataset.matchSettingsRendererSource = "logical-video-cpp";
  document.body.dataset.formationControlRendererSource = "logical-video-cpp";
  document.body.dataset.weatherPreviewRendererSource = "logical-video-cpp";
  document.body.dataset.tournamentRecordRendererSource = "logical-video-cpp";
  document.body.dataset.playerProfileRendererSource = "logical-video-cpp";
  document.body.dataset.musicSelectionRendererSource = "classified-bin-cpp";
  document.body.dataset.meetingSecretRendererSource = "logical-video-cpp";
  document.body.dataset.creditsRendererSource = "classified-bin-cpp";
  wasmNesApu.bindCore(api);
  api.game_init();
  resetOriginalLogicalVideo(api);
  syncOriginalLogicalVideoWrites(api);
  if (!api.game_initialization_ready || api.game_initialization_ready() !== 1) {
    throw new Error("C++ game initialization refused an invalid resource catalog");
  }
  if (DEBUG) {
    window.__soccerApi = api;
    window.__soccerCore = () => ({
      kind: CORE_KIND,
      assets: api.cpp_asset_loaded_count ? api.cpp_asset_loaded_count() : 0,
      bytes: api.cpp_asset_loaded_bytes ? api.cpp_asset_loaded_bytes() : 0,
    });
    window.__soccerRender = () => render(api);
    window.__soccerVideoViewState = () => originalCommittedVideoView(api);
    window.__soccerStatusbarSplitActive = () => originalStatusbarSplitActive(api);
    window.__soccerCreditsBackground = (backgroundId) => {
      const id = backgroundId & 0xff;
      const canvas = composeOriginalCreditsBackground(api, id);
      const state = originalAssets.credits.states.get(id);
      const background = state?.background;
      return {
        rendered: Boolean(canvas && state?.rendered),
        backgroundId: id,
        destination: background?.destination ?? 0,
        chr0: background?.chr0 ?? 0,
        chr1: background?.chr1 ?? 0,
        paletteNumbers: background ? [background.palette0, background.palette1] : [],
        mirroring: background?.mirroring ?? 0,
        nametable: state ? Array.from(state.nametable) : [],
      };
    };
    window.__soccerStaticBackground = (backgroundId) => {
      const id = backgroundId & 0xff;
      const canvas = composeOriginalStaticBackground(api, id);
      const state = originalAssets.staticBackgrounds.get(id);
      const background = state?.background;
      return {
        rendered: Boolean(canvas && state),
        backgroundId: id,
        width: canvas?.width ?? 0,
        height: canvas?.height ?? 0,
        destination: background?.destination ?? 0,
        chr0: background?.chr0 ?? 0,
        chr1: background?.chr1 ?? 0,
        paletteNumbers: background ? [background.palette0, background.palette1] : [],
        mirroring: background?.mirroring ?? 0,
        nametables: state ? state.nametables.map((table) => Array.from(table)) : [],
      };
    };
    window.__soccerSplashBackground = (backgroundId, blinkOff = false) => {
      const id = backgroundId & 0xff;
      const canvas = composeOriginalSplashBackground(api, id, Boolean(blinkOff));
      const state = originalAssets.splash.last;
      const background = state?.background;
      return {
        rendered: Boolean(canvas && state),
        source: state?.source || "",
        backgroundId: id,
        width: canvas?.width ?? 0,
        height: canvas?.height ?? 0,
        destination: background?.destination ?? 0,
        bank0: state?.bank0 ?? 0,
        bank1: state?.bank1 ?? 0,
        paletteNumbers: state ? [...state.paletteNumbers] : [],
        mirroring: background?.mirroring ?? 0,
        blinkOff: state?.blinkOff ?? false,
        nametable: state ? Array.from(state.nametable) : [],
      };
    };
    window.__soccerInputBits = () => inputBits();
    window.__soccerFootprints = () => ({
      serial: originalAssets.field?.footprintSerial ?? null,
      marks: Array.from(originalAssets.field?.footprints?.values?.() || []),
    });
    window.__soccerField = () => ({
      key: originalAssets.field?.compositeKey || "",
      loadedKeys: Array.from(originalAssets.field?.renderedKeys || []),
      source: originalAssets.field?.geometry?.source || "",
    });
    window.__soccerLogicalVideo = () => ({
      serial: originalAssets.logicalVideo.serial,
      processedCount: originalAssets.logicalVideo.processedCount,
      revision: originalAssets.logicalVideo.revision,
      writes: originalAssets.logicalVideo.frameWrites.map((write) => ({
        source: write.source,
        address: write.address,
        increment: write.increment,
        bytes: Array.from(write.bytes),
      })),
    });
    window.__soccerSyncLogicalVideo = () => syncOriginalLogicalVideoWrites(api);
    window.__soccerResetLogicalVideo = () => resetOriginalLogicalVideo(api);
    window.__soccerLogicalVideoByte = (address) => {
      const target = normalizeOriginalVideoAddress(address >>> 0);
      return originalAssets.logicalVideo.valid[target]
        ? originalAssets.logicalVideo.bytes[target] : null;
    };
    window.__soccerCommitLogicalVideoNmi = () => {
      const branch = api.debug_apply_original_nmi_screen_transfer_state();
      syncOriginalLogicalVideoWrites(api);
      return branch;
    };
    window.__soccerAdvanceLogicalTestFrame = (bits = 0) => {
      api.debug_apply_original_nmi_screen_transfer_state();
      syncOriginalLogicalVideoWrites(api);
      const result = api.game_tick(bits >>> 0);
      syncOriginalLogicalVideoWrites(api);
      return result;
    };
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
  let last = performance.now();
  let acc = 0;
  runtimeLifecycle.resetClock = () => {
    last = performance.now();
    acc = 0;
    runtimeLifecycle.lastAdvanceBurst = 0;
    runtimeLifecycle.clockResetSerial += 1;
  };
  document.body.dataset.runtimePaused = runtimeLifecycle.paused ? "true" : "false";
  const ntscRateNumerator = api.platform_ntsc_video_rate_numerator();
  const ntscRateDenominator = api.platform_ntsc_video_rate_denominator();
  const stepMs = 1000 * ntscRateDenominator / ntscRateNumerator;
  const usesOriginalVideoScheduler = Boolean(api.game_video_frame);
  const advanceVideoFrame = api.game_video_frame || api.game_tick;
  const advanceInputVideoFrame = () => {
    const bits = inputBits();
    const ranSoftwareFrame = advanceVideoFrame(bits);
    syncOriginalLogicalVideoWrites(api);
    runtimeLifecycle.videoFramesAdvanced += 1;
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
    if (runtimeLifecycle.paused || document.hidden) {
      if (document.hidden && !runtimeLifecycle.paused) pauseRuntime("visibility");
      last = now;
      acc = 0;
      runtimeLifecycle.lastAdvanceBurst = 0;
      requestAnimationFrame(frame);
      return;
    }
    if (resetRequested) {
      api.game_init();
      resetOriginalLogicalVideo(api);
      syncOriginalLogicalVideoWrites(api);
      wasmNesApu.reset();
      resetRequested = false;
    }
    acc += now - last; last = now; acc = Math.min(acc, stepMs * 8);
    let burst = 0;
    while (acc >= stepMs) { advanceInputVideoFrame(); acc -= stepMs; burst += 1; }
    runtimeLifecycle.lastAdvanceBurst = burst;
    runtimeLifecycle.maxAdvanceBurst = Math.max(runtimeLifecycle.maxAdvanceBurst, burst);
    render(api);
    updateSfx(api);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
main().catch((err) => { console.error(err); stats.hidden = false; stats.textContent = `启动失败：${err.message}`; });