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
};
const ACTION = {
  STAND: 0,
  RUN: 1,
  KICK: 2,
  TACKLE: 3,
  FALL: 4,
  KEEPER_SAVE: 5,
  HEADER: 6,
};
const keys = new Set();
const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const stats = document.querySelector("#stats");
const stick = document.querySelector("#stick");
const knob = document.querySelector("#knob");
const btnKick = document.querySelector("#btnKick");
const btnSprint = document.querySelector("#btnSprint");
const touch = { stickPointer: null, axisX: 0, axisY: 0, kick: false, sprint: false };
const originalAssets = { chr: null, chrAlt: null, field: null, tileSize: 16, columns: 128, metasprites: [] };
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
window.addEventListener("keydown", (event) => {
  keys.add(event.code);
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
});
window.addEventListener("keyup", (event) => keys.delete(event.code));
function setTouchButton(button, prop) {
  const down = (event) => { event.preventDefault(); button.setPointerCapture?.(event.pointerId); touch[prop] = true; button.classList.add("active"); };
  const up = (event) => { event.preventDefault(); touch[prop] = false; button.classList.remove("active"); };
  button.addEventListener("pointerdown", down);
  button.addEventListener("pointerup", up);
  button.addEventListener("pointercancel", up);
  button.addEventListener("lostpointercapture", up);
}
setTouchButton(btnKick, "kick");
setTouchButton(btnSprint, "sprint");
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
stick.addEventListener("pointerdown", (event) => { event.preventDefault(); touch.stickPointer = event.pointerId; stick.setPointerCapture?.(event.pointerId); updateStick(event); });
stick.addEventListener("pointermove", (event) => { if (touch.stickPointer === event.pointerId) { event.preventDefault(); updateStick(event); } });
for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
  stick.addEventListener(name, (event) => { if (touch.stickPointer === event.pointerId || name === "lostpointercapture") { event.preventDefault(); resetStick(); } });
}
function inputBits() {
  let bits = 0;
  if (keys.has("ArrowUp") || keys.has("KeyW") || touch.axisY < 0) bits |= INPUT.UP;
  if (keys.has("ArrowDown") || keys.has("KeyS") || touch.axisY > 0) bits |= INPUT.DOWN;
  if (keys.has("ArrowLeft") || keys.has("KeyA") || touch.axisX < 0) bits |= INPUT.LEFT;
  if (keys.has("ArrowRight") || keys.has("KeyD") || touch.axisX > 0) bits |= INPUT.RIGHT;
  if (keys.has("KeyJ") || keys.has("KeyZ") || touch.kick) bits |= INPUT.KICK;
  if (keys.has("KeyK") || keys.has("KeyX") || touch.sprint) bits |= INPUT.SPRINT;
  if (keys.has("Enter") || keys.has("Space")) bits |= INPUT.START;
  return bits;
}
async function loadWasm() {
  const response = await fetch("/game_core.wasm");
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
function drawMetaSprite(frame, x, y, team, controlled = false, flip = false) {
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
    const mirror = flip || team === 1;
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
function drawOriginalPlayer(x, y, team, controlled = false, frameHint = 0, moving = false, facingX = 1, action = ACTION.STAND) {
  const frames = originalAssets.metasprites;
  if (frames.length) {
    const runFrames = [0, 1, 2, 1];
    let idx = moving ? runFrames[Math.abs(frameHint) % runFrames.length] : 0;
    if (action === ACTION.KICK) idx = 3;
    if (action === ACTION.TACKLE) idx = 8;
    if (action === ACTION.FALL) idx = 4;
    if (action === ACTION.KEEPER_SAVE) idx = 10;
    if (action === ACTION.HEADER) idx = 6;
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
function drawOriginalBall(x, y, z = 0, spin = 0, special = 0) {
  const visualY = y - z;
  const shadowScale = Math.max(0.35, 1 - z / 90);
  ctx.save();
  ctx.fillStyle = `rgba(0,0,0,${0.30 * shadowScale})`;
  ctx.beginPath();
  ctx.ellipse(Math.round(x), Math.round(y + 5), 9 * shadowScale, 4 * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const tile = 0x1AEC;
  const size = (z > 0 ? 18 : 16) + (special > 0 ? 4 : 0);
  const bob = z > 0 ? Math.sin(spin * 0.9) * 1.5 : 0;
  if (special > 0) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,245,120,.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(Math.round(x), Math.round(visualY + bob), size * 0.8 + Math.sin(spin) * 2, 0, Math.PI * 2);
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
function drawScore(api, w) {
  const leftScore = api.score_left();
  const rightScore = api.score_right();
  const seconds = api.match_seconds_left ? api.match_seconds_left() : 0;
  const period = api.current_period ? api.current_period() : 1;
  const mm = String(Math.floor(seconds / 60)).padStart(1, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  ctx.fillStyle = "rgba(0,0,0,.62)";
  ctx.fillRect(w / 2 - 92, 10, 184, 42);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 22px ui-monospace, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.fillText(`${leftScore} - ${rightScore}`, w / 2, 33);
  ctx.font = "12px ui-monospace, Consolas, monospace";
  ctx.fillText(`${period}H  ${mm}:${ss}`, w / 2, 48);
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
function render(api) {
  const worldW = api.game_field_w();
  const worldH = api.game_field_h();
  const screenW = canvas.width;
  const screenH = canvas.height;
  const phase = api.game_phase ? api.game_phase() : PHASE.PLAYING;
  const bx = api.ball_x();
  const by = api.ball_y();
  const bz = api.ball_z ? api.ball_z() : 0;
  const bspin = api.ball_spin ? api.ball_spin() : Math.floor(api.game_tick_count() / 6);
  const bspecial = api.ball_special_timer ? api.ball_special_timer() : 0;
  const view = drawField(screenW, screenH, worldW, worldH, bx);
  const controlled = api.controlled_player ? api.controlled_player() : 0;
  const count = api.player_count ? api.player_count() : 1;
  for (let i = 0; i < count; i++) {
    if (api.player_active && !api.player_active(i)) continue;
    const p = worldToScreen(view, api.player_x(i), api.player_y(i));
    drawCircle(p.x + 3, p.y + 5, api.player_radius(i), "rgba(0,0,0,.20)", "transparent");
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
      drawOriginalBall(b.x, b.y, bz, bspin, bspecial);
      continue;
    }
    const i = entity.index;
    const vx = api.player_vx ? api.player_vx(i) : 0;
    const vy = api.player_vy ? api.player_vy(i) : 0;
    const action = api.player_action ? api.player_action(i) : ACTION.STAND;
    const moving = Math.abs(vx) + Math.abs(vy) > 1;
    const facingX = api.player_facing_x ? api.player_facing_x(i) : (api.player_team && api.player_team(i) ? -1 : 1);
    const p = worldToScreen(view, api.player_x(i), api.player_y(i));
    drawOriginalPlayer(p.x, p.y, api.player_team ? api.player_team(i) : 0, i === controlled, Math.floor(api.game_tick_count() / 10) + i, moving, facingX, action);
  }
  drawScore(api, screenW);
  const stamina = api.player_stamina(controlled);
  ctx.fillStyle = "rgba(0,0,0,.45)";
  ctx.fillRect(16, 16, 132, 16);
  ctx.fillStyle = stamina > 30 ? "#62e572" : "#ffcc4d";
  ctx.fillRect(18, 18, Math.max(0, stamina) * 1.28, 12);
  if (phase === PHASE.TITLE) drawOverlay("熱血足球リーグ", ["WASM 高保真复刻工程", "按 J / Z / Enter 开始"]);
  if (phase === PHASE.MENU) drawOverlay("MATCH", ["1P vs CPU", "按 J / Z / Enter 开赛"]);
  if (phase === PHASE.KICKOFF) drawOverlay("KICK OFF", ["按 J / Z 开球"]);
  if (phase === PHASE.GOAL) drawOverlay("GOAL!", [`比分 ${api.score_left()} - ${api.score_right()}`]);
  if (phase === PHASE.HALFTIME) drawOverlay("HALF TIME", ["换边，下半场准备", "按 J / Z 继续"]);
  if (phase === PHASE.FULL_TIME) drawOverlay("FULL TIME", [`最终比分 ${api.score_left()} - ${api.score_right()}`, "按 J / Z 返回菜单"]);
  if (phase === PHASE.THROW_IN) drawOverlay("THROW IN", ["按 J / Z 继续"]);
  if (phase === PHASE.GOAL_KICK) drawOverlay("GOAL KICK", ["按 J / Z 继续"]);
  if (phase === PHASE.CORNER_KICK) drawOverlay("CORNER KICK", ["按 J / Z 继续"]);
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
  stats.textContent = `phase=${phase} period=${period} swap=${swapped} score=${api.score_left()}-${api.score_right()} time=${api.match_seconds_left()} tick=${api.game_tick_count()} players=${count} ball=(${bx},${by},z=${bz}) curve=${curve} special=${special} act=${action} charge=${charge} keeper=${keeper}/${hold} touch=${lastTouch} restart=${restart}`;
}
async function main() {
  const [api, chr, chrAlt, field, metasprites] = await Promise.all([
    loadWasm(),
    loadImage("/original/chr_sprite_pal_01.png"),
    loadImage("/original/chr_sprite_pal_08.png"),
    loadImage("/original/field_grass.png"),
    loadJson("/original/metasprites.json"),
  ]);
  originalAssets.chr = chr;
  originalAssets.chrAlt = chrAlt;
  originalAssets.field = field;
  originalAssets.metasprites = metasprites.frames || [];
  api.game_init();
  let last = performance.now();
  let acc = 0;
  const stepMs = 1000 / 60;
  function frame(now) {
    if (keys.has("KeyR")) api.game_init();
    acc += now - last; last = now; acc = Math.min(acc, stepMs * 8);
    while (acc >= stepMs) { api.game_tick(inputBits()); acc -= stepMs; }
    render(api);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
main().catch((err) => { console.error(err); stats.textContent = `启动失败：${err.message}`; });