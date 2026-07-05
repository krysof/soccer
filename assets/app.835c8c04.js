const INPUT = {
  UP: 1 << 0,
  DOWN: 1 << 1,
  LEFT: 1 << 2,
  RIGHT: 1 << 3,
  KICK: 1 << 4,
  SPRINT: 1 << 5,
  START: 1 << 6,
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
  MATCH_INTRO: 13,
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
const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const stats = document.querySelector("#stats");
const gameWrap = document.querySelector(".game-wrap");
const touchControls = document.querySelector("#touchControls");
const stick = document.querySelector("#stick");
const knob = document.querySelector("#knob");
const btnKick = document.querySelector("#btnKick");
const btnSprint = document.querySelector("#btnSprint");
const DEBUG = new URLSearchParams(window.location.search).get("debug") === "1";
document.body.classList.toggle("debug", DEBUG);
stats.hidden = !DEBUG;

const TOUCH_TAP_LATCH_TICKS = 4;
const touch = {
  stickPointer: null,
  kickPointer: null,
  sprintPointer: null,
  axisX: 0,
  axisY: 0,
  kick: false,
  sprint: false,
  kickLatchTicks: 0,
  sprintLatchTicks: 0,
  lastBits: 0,
};
const originalAssets = { chr: null, chrAlt: null, field: null, tileSize: 16, columns: 128, metasprites: [] };
const sfx = { ctx: null, lastScore: "0-0", lastPhase: PHASE.TITLE, lastSpecial: 0, lastAction: ACTION.STAND, lastKeeper: 0 };

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

function originalAssetUrl(name) {
  return assetUrl(`../original/${name}`);
}

function originalFallbackUrl(name) {
  return rootAssetUrl(`original/${name}`);
}

window.addEventListener("keydown", (event) => {
  ensureAudio();
  keys.add(event.code);
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
    touch[prop] = true;
    touch[latchProp] = TOUCH_TAP_LATCH_TICKS;
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

function ensureAudio() {
  if (sfx.ctx) {
    if (sfx.ctx.state === "suspended") sfx.ctx.resume?.();
    return sfx.ctx;
  }
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  sfx.ctx = new AudioCtor();
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
}

function updateSfx(api) {
  if (!sfx.ctx || sfx.ctx.state === "suspended") return;
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
  knob.style.transform = "translate(-50%, -50%)";
}

function updateStick(event) {
  const rect = stick.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const max = rect.width * 0.34;
  let dx = event.clientX - cx;
  let dy = event.clientY - cy;
  const len = Math.hypot(dx, dy);
  if (len > max) { dx = dx / len * max; dy = dy / len * max; }
  touch.axisX = Math.abs(dx) < max * 0.22 ? 0 : Math.sign(dx);
  touch.axisY = Math.abs(dy) < max * 0.22 ? 0 : Math.sign(dy);
  knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
}
function pointInGame(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}
function shouldStartFallbackStick(target, clientX, clientY) {
  if (!pointInGame(clientX, clientY)) return false;
  if (target?.closest?.(".touch-btn")) return false;
  if (target?.closest?.("#stick")) return false;
  const rect = canvas.getBoundingClientRect();
  return clientX <= rect.left + rect.width * 0.46 && clientY >= rect.top + rect.height * 0.34;
}
function beginStickPointer(event, captureElement = stick) {
  event.preventDefault();
  ensureAudio();
  if (touch.stickPointer !== null && touch.stickPointer !== event.pointerId) resetStick();
  touch.stickPointer = event.pointerId;
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
for (const element of [gameWrap, canvas]) {
  element.addEventListener("pointerdown", (event) => {
    if (!shouldStartFallbackStick(event.target, event.clientX, event.clientY)) return;
    beginStickPointer(event, element);
  });
  element.addEventListener("pointermove", (event) => {
    if (touch.stickPointer === event.pointerId) { event.preventDefault(); updateStick(event); }
  });
}
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
  return { clientX: point.clientX, clientY: point.clientY };
}

stick.addEventListener("touchstart", (event) => {
  event.preventDefault();
  const point = event.changedTouches[0];
  if (!point) return;
  touch.stickPointer = `touch:${point.identifier}`;
  updateStick(touchPointEvent(point));
}, { passive: false });
touchControls.addEventListener("touchstart", (event) => {
  for (const point of event.changedTouches) {
    if (!shouldStartFallbackStick(event.target, point.clientX, point.clientY)) continue;
    event.preventDefault();
    ensureAudio();
    touch.stickPointer = `touch:${point.identifier}`;
    updateStick(touchPointEvent(point));
    return;
  }
}, { passive: false });
for (const element of [gameWrap, canvas]) {
  element.addEventListener("touchstart", (event) => {
    for (const point of event.changedTouches) {
      if (!shouldStartFallbackStick(event.target, point.clientX, point.clientY)) continue;
      event.preventDefault();
      ensureAudio();
      touch.stickPointer = `touch:${point.identifier}`;
      updateStick(touchPointEvent(point));
      return;
    }
  }, { passive: false });
}

function moveStickTouch(event) {
  if (typeof touch.stickPointer !== "string" || !touch.stickPointer.startsWith("touch:")) return;
  const id = Number(touch.stickPointer.slice(6));
  for (const point of event.changedTouches) {
    if (point.identifier === id) {
      event.preventDefault();
      updateStick(touchPointEvent(point));
      return;
    }
  }
}

stick.addEventListener("touchmove", moveStickTouch, { passive: false });
window.addEventListener("touchmove", moveStickTouch, { passive: false });

function endStickTouch(event) {
  if (typeof touch.stickPointer !== "string" || !touch.stickPointer.startsWith("touch:")) return;
  const id = Number(touch.stickPointer.slice(6));
  for (const point of event.changedTouches) {
    if (point.identifier === id) {
      event.preventDefault();
      resetStick();
      return;
    }
  }
}

stick.addEventListener("touchend", endStickTouch, { passive: false });
stick.addEventListener("touchcancel", endStickTouch, { passive: false });
window.addEventListener("touchend", endStickTouch, { passive: false });
window.addEventListener("touchcancel", endStickTouch, { passive: false });

function inputBits() {
  let bits = 0;
  if (keys.has("ArrowUp") || keys.has("KeyW") || touch.axisY < 0) bits |= INPUT.UP;
  if (keys.has("ArrowDown") || keys.has("KeyS") || touch.axisY > 0) bits |= INPUT.DOWN;
  if (keys.has("ArrowLeft") || keys.has("KeyA") || touch.axisX < 0) bits |= INPUT.LEFT;
  if (keys.has("ArrowRight") || keys.has("KeyD") || touch.axisX > 0) bits |= INPUT.RIGHT;
  if (keys.has("KeyJ") || keys.has("KeyZ") || touch.kick || touch.kickLatchTicks > 0) bits |= INPUT.KICK;
  if (keys.has("KeyK") || keys.has("KeyX") || touch.sprint || touch.sprintLatchTicks > 0) bits |= INPUT.SPRINT;
  if (keys.has("Enter") || keys.has("Space")) bits |= INPUT.START;
  if (touch.kickLatchTicks > 0) touch.kickLatchTicks -= 1;
  if (touch.sprintLatchTicks > 0) touch.sprintLatchTicks -= 1;
  touch.lastBits = bits;
  return bits;
}

async function loadWasm() {
  const primary = assetUrl("../game_core.6474e6bb.wasm");
  const fallback = rootAssetUrl("game_core.wasm");
  const response = await withFallback("game_core.wasm", primary, fallback, (url) => fetch(url).then((r) => {
    if (!r.ok) throw new Error(`failed to load ${url}: ${r.status}`);
    return r;
  }));
  const bytes = await response.arrayBuffer();
  const result = await WebAssembly.instantiate(bytes, {});
  return result.instance.exports;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function drawField(screenW, screenH, worldW = screenW, worldH = screenH, focusX = worldW / 2) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (originalAssets.field) {
    ctx.imageSmoothingEnabled = false;
    const img = originalAssets.field;
    const sourceH = img.naturalHeight || img.height;
    const sourceW = Math.min(img.naturalWidth || img.width, sourceH * screenW / screenH);
    const fullW = img.naturalWidth || img.width;
    const focal = focusX / worldW * fullW;
    const sourceX = clamp(focal - sourceW / 2, 0, fullW - sourceW);
    ctx.drawImage(img, sourceX, 0, sourceW, sourceH, 0, 0, screenW, screenH);
    ctx.imageSmoothingEnabled = true;
    return { sourceX, sourceW, sourceH, fullW, fullH: sourceH, screenW, screenH, worldW, worldH, original: true };
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
  return { sourceX: 0, sourceW: screenW, sourceH: screenH, fullW: screenW, fullH: screenH, screenW, screenH, worldW, worldH, original: false };
}

function worldToScreen(view, x, y) {
  if (!view || !view.original) {
    return { x: x / view.worldW * view.screenW, y: y / view.worldH * view.screenH };
  }
  const sx = x / view.worldW * view.fullW;
  const sy = y / view.worldH * view.fullH;
  return {
    x: (sx - view.sourceX) * (view.screenW / view.sourceW),
    y: sy * (view.screenH / view.sourceH),
  };
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

function drawMetaSprite(frame, x, y, team, controlled = false, flip = false, teamMirror = true) {
  if (!frame) return false;
  const img = team === 1 ? originalAssets.chrAlt : originalAssets.chr;
  if (!img) return false;
  const srcTileSize = originalAssets.tileSize;
  const drawScale = controlled ? 2.2 : 2.0;
  const destTileSize = 8 * drawScale;

  for (let i = 0; i < frame.count; i++) {
    const tileIndex = frame.tile[i];
    const sx = (tileIndex % originalAssets.columns) * srcTileSize;
    const sy = Math.floor(tileIndex / originalAssets.columns) * srcTileSize;
    const attr = frame.attr[i] || 0;
    const hFlip = (attr & 0x40) !== 0;
    const vFlip = (attr & 0x80) !== 0;
    const rawX = frame.x[i] * drawScale;
    const rawY = frame.y[i] * drawScale;
    const mirror = flip || (teamMirror && team === 1);
    const dx = mirror ? x - rawX - destTileSize : x + rawX;
    const dy = y + rawY;

    ctx.save();
    ctx.translate(dx + destTileSize / 2, dy + destTileSize / 2);
    ctx.scale((hFlip ? -1 : 1) * (mirror ? -1 : 1), vFlip ? -1 : 1);
    ctx.drawImage(img, sx, sy, srcTileSize, srcTileSize, -destTileSize / 2, -destTileSize / 2, destTileSize, destTileSize);
    ctx.restore();
  }
  return true;
}

function drawOriginalPlayer(x, y, team, controlled = false, frameHint = 0, moving = false, facingX = 1, action = ACTION.STAND, originalAnimation = null) {
  const frames = originalAssets.metasprites;
  if (frames.length) {
    if (Number.isFinite(originalAnimation)) {
      const originalIdx = originalAnimation & 0x7F;
      if (originalIdx < frames.length) {
        const flip = (originalAnimation & 0x80) !== 0;
        if (drawMetaSprite(frames[originalIdx], x, y, team, controlled, flip, false)) {
          if (controlled) {
            ctx.strokeStyle = "#ffff66";
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(x, y - 34, 13, 0, Math.PI * 2); ctx.stroke();
          }
          return;
        }
      }
    }
    const runFrames = [0, 1, 2, 1];
    let idx = moving ? runFrames[Math.abs(frameHint) % runFrames.length] : 0;
    if (action === ACTION.KICK) idx = 3;
    if (action === ACTION.TACKLE) idx = 8;
    if (action === ACTION.FALL) idx = 4;
    if (action === ACTION.KEEPER_SAVE) idx = 10;
    if (action === ACTION.HEADER) idx = 6;
    if (action === ACTION.CELEBRATE) idx = 2;
    if (action === ACTION.DEJECT) idx = 4;
    idx = Math.min(idx, frames.length - 1);
    const flip = facingX < 0;
    if (drawMetaSprite(frames[idx], x, y, team, controlled, flip)) {
      if (controlled) {
        ctx.strokeStyle = "#ffff66";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y - 34, 13, 0, Math.PI * 2); ctx.stroke();
      }
      return;
    }
  }

  const base = 0x120;
  const size = controlled ? 20 : 18;
  const ox = Math.round(x - size);
  const oy = Math.round(y - size * 1.8);
  const tiles = [base, base + 1, base + 0x20, base + 0x21, base + 0x40, base + 0x41];
  for (let i = 0; i < tiles.length; i++) drawOriginalTile(tiles[i], ox + (i % 2) * size, oy + Math.floor(i / 2) * size, size, team === 1);
}

function drawOriginalBall(x, y, z = 0, spin = 0, special = 0, originalAnimation = null) {
  const visualY = y - z;
  const shadowScale = Math.max(0.35, 1 - z / 90);
  ctx.save();
  ctx.fillStyle = `rgba(0,0,0,${0.30 * shadowScale})`;
  ctx.beginPath();
  ctx.ellipse(Math.round(x), Math.round(y + 5), 9 * shadowScale, 4 * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const originalPhase = Number.isFinite(originalAnimation) ? (originalAnimation & 0x07) : (spin & 0x07);
  const tile = 0x1AEC;
  const size = (z > 0 ? 18 : 16) + (special > 0 ? 4 : 0);
  const bob = z > 0 ? Math.sin(originalPhase * 0.9) * 1.5 : 0;
  if (special > 0) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,245,120,.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(Math.round(x), Math.round(visualY + bob), size * 0.8 + Math.sin(originalPhase) * 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  const ok = drawOriginalTile(tile, Math.round(x - size / 2), Math.round(visualY - size / 2 + bob), size, false);
  if (!ok) {
    ctx.save();
    ctx.translate(Math.round(x), Math.round(visualY));
    ctx.fillStyle = "#f8f8f0";
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function drawWeather(api, view, screenW, screenH) {
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

function drawScore(api, w) {
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
  ctx.fillText("方向键/摇杆选择对手，J/Z/Enter 开赛", canvas.width / 2, startY + 5 * 48 + 18);
  ctx.textAlign = "left";
}

function drawMatchIntroOverlay(api) {
  const cpuTeam = api.cpu_team_id ? api.cpu_team_id() : 1;
  const weather = api.field_weather ? api.field_weather() : 0;
  const timer = api.phase_timer ? api.phase_timer() : 0;
  ctx.fillStyle = "rgba(0,0,0,.66)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 34px system-ui, sans-serif";
  ctx.fillText("MATCH START", canvas.width / 2, 112);
  ctx.font = "bold 46px ui-monospace, Consolas, monospace";
  ctx.fillStyle = "#ffe64a";
  ctx.fillText(`${TEAM_NAMES[0]}  VS  ${TEAM_NAMES[cpuTeam] || "CPU"}`, canvas.width / 2, 184);
  ctx.font = "17px ui-monospace, Consolas, monospace";
  ctx.fillStyle = "#d7f7ff";
  ctx.fillText(`FIELD ${WEATHER_NAMES[weather] || "?"}   SPD ${api.team_speed ? api.team_speed(1) : "?"}  POW ${api.team_power ? api.team_power(1) : "?"}  GK ${api.team_keeper ? api.team_keeper(1) : "?"}`, canvas.width / 2, 230);
  ctx.fillText(`CAPTAIN ${PLAYER_NAMES[0][3]}  /  ${PLAYER_NAMES[cpuTeam]?.[3] || "CPU"}    SPECIAL ${api.team_special_curve ? api.team_special_curve(1) : "?"}`, canvas.width / 2, 260);
  ctx.fillText(`READY ${Math.ceil(timer / 60)}`, canvas.width / 2, 290);
  ctx.font = "16px system-ui, sans-serif";
  ctx.fillStyle = "#fff";
  ctx.fillText("按 J / Z / Enter 跳过出场演出", canvas.width / 2, 326);
  ctx.textAlign = "left";
}

function render(api) {
  const worldW = api.game_field_w();
  const worldH = api.game_field_h();
  const screenW = canvas.width;
  const screenH = canvas.height;
  const phase = api.game_phase ? api.game_phase() : PHASE.PLAYING;
  const cpuTeam = api.cpu_team_id ? api.cpu_team_id() : 1;
  const menuTeam = api.menu_opponent_id ? api.menu_opponent_id() : cpuTeam;
  const wins = api.tournament_wins ? api.tournament_wins() : 0;

  const bx = api.ball_x();
  const by = api.ball_y();
  const bz = api.ball_z ? api.ball_z() : 0;
  const bspin = api.ball_spin ? api.ball_spin() : Math.floor(api.game_tick_count() / 6);
  const bspecial = api.ball_special_timer ? api.ball_special_timer() : 0;
  const view = drawField(screenW, screenH, worldW, worldH, bx);
  drawWeather(api, view, screenW, screenH);
  const controlled = api.controlled_player ? api.controlled_player() : 0;
  const count = api.player_count ? api.player_count() : 1;
  for (let i = 0; i < count; i++) {
    if (api.player_active && !api.player_active(i)) continue;
    const p = worldToScreen(view, api.player_x(i), api.player_y(i));
    drawCircle(p.x + 3, p.y + 5, api.player_radius(i), "rgba(0,0,0,.20)", "transparent");
    const injury = api.player_injury ? api.player_injury(i) : 0;
    if (injury > 0) {
      ctx.strokeStyle = `rgba(255,70,70,${Math.min(0.85, 0.25 + injury / 130)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y - 18, 8 + injury / 12, 0, Math.PI * 2); ctx.stroke();
    }
  }
  const entities = [{ type: "ball", groundY: by }];
  for (let i = 0; i < count; i++) {
    if (api.player_active && !api.player_active(i)) continue;
    entities.push({ type: "player", index: i, groundY: api.player_y(i) });
  }
  entities.sort((a, b) => a.groundY - b.groundY);

  for (const entity of entities) {
    if (entity.type === "ball") {
      const b = worldToScreen(view, bx, by);
      const banim = api.original_ball_animation ? api.original_ball_animation() : null;
      drawOriginalBall(b.x, b.y, bz, bspin, bspecial, banim);
      continue;
    }
    const i = entity.index;
    const vx = api.player_vx ? api.player_vx(i) : 0;
    const vy = api.player_vy ? api.player_vy(i) : 0;
    const action = api.player_action ? api.player_action(i) : ACTION.STAND;
    const moving = Math.abs(vx) + Math.abs(vy) > 1;
    const facingX = api.player_facing_x ? api.player_facing_x(i) : (api.player_team && api.player_team(i) ? -1 : 1);
    const p = worldToScreen(view, api.player_x(i), api.player_y(i));
    const originalAnimation = api.original_player_animation ? api.original_player_animation(i) : null;
    drawOriginalPlayer(p.x, p.y, api.player_team ? api.player_team(i) : 0, i === controlled, Math.floor(api.game_tick_count() / 10) + i, moving, facingX, action, originalAnimation);
    if (action === ACTION.CELEBRATE) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,230,70,.85)";
      ctx.lineWidth = 2;
      const pulse = 10 + Math.sin(api.game_tick_count() / 4 + i) * 3;
      ctx.beginPath(); ctx.arc(p.x, p.y - 38, pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#ffe64a";
      ctx.font = "bold 12px ui-monospace, Consolas, monospace";
      ctx.textAlign = "center";
      ctx.fillText("GO!", p.x, p.y - 48);
      ctx.restore();
    } else if (action === ACTION.DEJECT) {
      ctx.save();
      ctx.fillStyle = "rgba(120,170,255,.9)";
      ctx.font = "bold 13px ui-monospace, Consolas, monospace";
      ctx.textAlign = "center";
      ctx.fillText("...", p.x, p.y - 44);
      ctx.restore();
    }
  }
  drawScore(api, screenW);

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

  if (phase === PHASE.TITLE) drawOverlay("熱血足球リーグ", ["WASM 高保真复刻工程", "按 J / Z / Enter 开始"]);
  if (phase === PHASE.MENU) drawMenuOverlay(api);
  if (phase === PHASE.MATCH_INTRO) drawMatchIntroOverlay(api);
  if (phase === PHASE.KICKOFF) drawOverlay("KICK OFF", ["按 J / Z 开球"]);
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
  if (phase === PHASE.HALFTIME) drawOverlay("HALF TIME", ["换边，下半场准备", "按 J / Z 继续"]);
  if (phase === PHASE.FULL_TIME) drawOverlay("FULL TIME", [`最终比分 ${api.score_left()} - ${api.score_right()}`, api.score_left() > api.score_right() ? "胜利：下场对手升级" : "败北/平局：重新挑战", "按 J / Z 返回菜单"]);
  if (phase === PHASE.THROW_IN) drawOverlay("THROW IN", ["按 J / Z 继续"]);
  if (phase === PHASE.GOAL_KICK) drawOverlay("GOAL KICK", ["按 J / Z 继续"]);
  if (phase === PHASE.CORNER_KICK) drawOverlay("CORNER KICK", ["按 J / Z 继续"]);
  if (phase === PHASE.FREE_KICK) drawOverlay("FREE KICK", [`犯规队 ${api.foul_team ? TEAM_NAMES[api.foul_team()] || api.foul_team() : "?"}`, "按 J / Z 继续"]);
  if (phase === PHASE.PENALTY_KICK) drawOverlay("PENALTY KICK", [`禁区犯规：${api.foul_team ? TEAM_NAMES[api.foul_team()] || api.foul_team() : "?"}`, "按 J / Z 射门"]);
  if (phase === PHASE.PAUSE) drawOverlay("PAUSE", ["Start / J / Z 继续", "Sprint + Start：比赛中切换控制球员"]);

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
    stats.textContent = `phase=${phase} input=$${touch.lastBits.toString(16).padStart(2, "0")} stick=${touch.axisX}/${touch.axisY} btn=${btnHold}/${btnPress} script=$${script} pauseRet=${pauseReturn} period=${period} swap=${swapped} cpu=${cpuTeam} menu=${menuTeam} wins=${wins} weather=${weather} hazards=${hazards} wind=${wind} score=${api.score_left()}-${api.score_right()} goal=${goalInfo} fouls=${fouls} foulTeam=${foulTeam} injuries=${injuries} lastHurt=${lastHurt} spShots=${specialShots} lastSp=${lastSpecial} time=${api.match_seconds_left()} tick=${api.game_tick_count()} players=${count} role=${roleInfo} pOrig=${playerOrig}@${playerDispatch}/${playerMainDispatch}/${playerAnimDispatch} pRam=${playerRam} ballObj=$${ballObj}@${ballDispatch} ballRam=${ballRam} ballState=${ballState} ballAnim=${ballAnim} ballSpeed=${ballSpeedRam} owner=${originalOwner} ball=(${bx},${by},z=${bz}) curve=${curve} special=${special} act=${action} charge=${charge} keeper=${keeper}/${hold} touch=${lastTouch}/${lastTouchPlayer} restart=${restart}`;
  }
}

async function main() {
  const [api, chr, chrAlt, field, metasprites] = await Promise.all([
    loadWasm(),
    withFallback("chr_sprite_pal_01.png", originalAssetUrl("chr_sprite_pal_01.png"), originalFallbackUrl("chr_sprite_pal_01.png"), loadImage),
    withFallback("chr_sprite_pal_08.png", originalAssetUrl("chr_sprite_pal_08.png"), originalFallbackUrl("chr_sprite_pal_08.png"), loadImage),
    withFallback("field_grass.png", originalAssetUrl("field_grass.png"), originalFallbackUrl("field_grass.png"), loadImage),
    withFallback("metasprites.json", originalAssetUrl("metasprites.json"), originalFallbackUrl("metasprites.json"), loadJson),
  ]);
  originalAssets.chr = chr;
  originalAssets.chrAlt = chrAlt;
  originalAssets.field = field;
  originalAssets.metasprites = metasprites.frames || [];
  api.game_init();
  sfx.lastScore = `${api.score_left()}-${api.score_right()}`;
  sfx.lastPhase = api.game_phase ? api.game_phase() : PHASE.TITLE;

  let last = performance.now();
  let acc = 0;
  const stepMs = 1000 / 60;
  function frame(now) {
    if (keys.has("KeyR")) api.game_init();
    acc += now - last; last = now; acc = Math.min(acc, stepMs * 8);
    while (acc >= stepMs) { api.game_tick(inputBits()); acc -= stepMs; }
    render(api);
    updateSfx(api);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch((err) => { console.error(err); stats.hidden = false; stats.textContent = `启动失败：${err.message}`; });