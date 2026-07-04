const INPUT = {
  UP: 1 << 0,
  DOWN: 1 << 1,
  LEFT: 1 << 2,
  RIGHT: 1 << 3,
  KICK: 1 << 4,
  SPRINT: 1 << 5,
};
const keys = new Set();
const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const stats = document.querySelector("#stats");
const stick = document.querySelector("#stick");
const knob = document.querySelector("#knob");
const btnKick = document.querySelector("#btnKick");
const btnSprint = document.querySelector("#btnSprint");
const touch = {
  stickPointer: null,
  axisX: 0,
  axisY: 0,
  kick: false,
  sprint: false,
};
window.addEventListener("keydown", (event) => {
  keys.add(event.code);
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
    event.preventDefault();
  }
});
window.addEventListener("keyup", (event) => keys.delete(event.code));
function setTouchButton(button, prop) {
  const down = (event) => {
    event.preventDefault();
    button.setPointerCapture?.(event.pointerId);
    touch[prop] = true;
    button.classList.add("active");
  };
  const up = (event) => {
    event.preventDefault();
    touch[prop] = false;
    button.classList.remove("active");
  };
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
  if (len > max) {
    dx = dx / len * max;
    dy = dy / len * max;
  }
  touch.axisX = Math.abs(dx) < max * 0.22 ? 0 : Math.sign(dx);
  touch.axisY = Math.abs(dy) < max * 0.22 ? 0 : Math.sign(dy);
  knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
}
stick.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  touch.stickPointer = event.pointerId;
  stick.setPointerCapture?.(event.pointerId);
  updateStick(event);
});
stick.addEventListener("pointermove", (event) => {
  if (touch.stickPointer === event.pointerId) {
    event.preventDefault();
    updateStick(event);
  }
});
for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
  stick.addEventListener(name, (event) => {
    if (touch.stickPointer === event.pointerId || name === "lostpointercapture") {
      event.preventDefault();
      resetStick();
    }
  });
}
function inputBits() {
  let bits = 0;
  const left = keys.has("ArrowLeft") || keys.has("KeyA") || touch.axisX < 0;
  const right = keys.has("ArrowRight") || keys.has("KeyD") || touch.axisX > 0;
  const up = keys.has("ArrowUp") || keys.has("KeyW") || touch.axisY < 0;
  const down = keys.has("ArrowDown") || keys.has("KeyS") || touch.axisY > 0;
  if (up) bits |= INPUT.UP;
  if (down) bits |= INPUT.DOWN;
  if (left) bits |= INPUT.LEFT;
  if (right) bits |= INPUT.RIGHT;
  if (keys.has("KeyJ") || keys.has("KeyZ") || touch.kick) bits |= INPUT.KICK;
  if (keys.has("KeyK") || keys.has("KeyX") || touch.sprint) bits |= INPUT.SPRINT;
  return bits;
}
async function loadWasm() {
  const response = await fetch("./game_core.wasm");
  const bytes = await response.arrayBuffer();
  const result = await WebAssembly.instantiate(bytes, {});
  return result.instance.exports;
}
function drawField(width, height) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#166f39";
  ctx.fillRect(0, 0, width, height);
  for (let x = 0; x < width; x += 80) {
    ctx.fillStyle = x % 160 === 0 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.035)";
    ctx.fillRect(x, 0, 80, height);
  }
  ctx.strokeStyle = "rgba(255,255,255,.75)";
  ctx.lineWidth = 3;
  ctx.strokeRect(30, 30, width - 60, height - 60);
  ctx.beginPath();
  ctx.moveTo(width / 2, 30);
  ctx.lineTo(width / 2, height - 30);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, 72, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeRect(30, height / 2 - 82, 88, 164);
  ctx.strokeRect(width - 118, height / 2 - 82, 88, 164);
}
function drawCircle(x, y, r, fill, stroke = "rgba(0,0,0,.35)") {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}
function render(api) {
  const w = api.game_field_w();
  const h = api.game_field_h();
  drawField(w, h);
  const px = api.player_x(0);
  const py = api.player_y(0);
  const pr = api.player_radius(0);
  const bx = api.ball_x();
  const by = api.ball_y();
  const br = api.ball_radius();
  drawCircle(px + 3, py + 5, pr, "rgba(0,0,0,.20)", "transparent");
  drawCircle(px, py, pr, "#2f80ff", "#d8e7ff");
  drawCircle(bx, by, br, "#f5f2dc", "#252525");
  const stamina = api.player_stamina(0);
  ctx.fillStyle = "rgba(0,0,0,.45)";
  ctx.fillRect(16, 16, 132, 16);
  ctx.fillStyle = stamina > 30 ? "#62e572" : "#ffcc4d";
  ctx.fillRect(18, 18, Math.max(0, stamina) * 1.28, 12);
  stats.textContent = `tick=${api.game_tick_count()} player=(${px},${py}) ball=(${bx},${by}) stamina=${stamina}`;
}
async function main() {
  const api = await loadWasm();
  api.game_init();
  let last = performance.now();
  let acc = 0;
  const stepMs = 1000 / 60;
  function frame(now) {
    if (keys.has("KeyR")) api.game_init();
    acc += now - last;
    last = now;
    acc = Math.min(acc, stepMs * 8);
    while (acc >= stepMs) {
      api.game_tick(inputBits());
      acc -= stepMs;
    }
    render(api);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
main().catch((err) => {
  console.error(err);
  stats.textContent = `启动失败：${err.message}`;
});
