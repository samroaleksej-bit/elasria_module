const ID = "amatus-balance";
const MAX = 10;
const STAGES = [
  { at: -10, name: "Чистый Свет", text: "Тьма в Аматусе умолкла. Свет заливает всё — даже то, что хотело бы остаться в тени." },
  { at: -5, name: "Рассвет", text: "Свет берёт верх. Тени вокруг Аматуса становятся короче." },
  { at: 0, name: "Равновесие", text: "Свет и Тьма снова держат друг друга за горло. Весы замерли." },
  { at: 5, name: "Сумерки", text: "Тьма берёт верх. Голос Аматуса звучит чуть ниже, чем раньше." },
  { at: 10, name: "Чистая Тьма", text: "Свет в Аматусе погас. Остался только холодный фиолетовый взгляд." }
];
const stageOf = v => v <= -10 ? STAGES[0] : v <= -5 ? STAGES[1] : v < 5 ? STAGES[2] : v < 10 ? STAGES[3] : STAGES[4];
const clamp = v => Math.max(-MAX, Math.min(MAX, Math.round(Number(v) || 0)));

let el, lastValue = null;

Hooks.once("init", () => {
  game.settings.register(ID, "value", { scope: "world", config: false, type: Number, default: 0, onChange: v => render(v, true) });
  game.settings.register(ID, "visible", { name: "Показывать весы игрокам", scope: "world", config: true, type: Boolean, default: true, onChange: () => render(get()) });
  game.settings.register(ID, "position", { name: "Положение весов", scope: "client", config: true, type: String, default: "top", choices: { top: "Сверху", bottom: "Снизу" }, onChange: () => render(get()) });
  game.settings.register(ID, "split", { scope: "world", config: false, type: String, default: "none", onChange: v => onSplit(v) });
  game.settings.register(ID, "splitLock", { name: "Раскол блокирует потерянную сторону", hint: "Пока Свет у Порога, весы не уходят в Свет (и наоборот).", scope: "world", config: true, type: Boolean, default: true });
  game.settings.register(ID, "splitOverlay", { name: "Обесцвечивать потерянную половину экрана", scope: "client", config: true, type: Boolean, default: true, onChange: () => paintSplit(getSplit()) });
  game.settings.register(ID, "chat", { name: "Сообщать о смене стадии в чат", scope: "world", config: true, type: Boolean, default: true });
});

const get = () => clamp(game.settings.get(ID, "value"));

async function set(v, reason = "") {
  if (!game.user.isGM) return ui.notifications.warn("Весы двигает только мастер.");
  const prev = get();
  let next = clamp(v);
  const sp = getSplit();
  if (sp !== "none" && game.settings.get(ID, "splitLock")) {
    if (sp === "light" && next < 0) { next = Math.max(next, Math.min(prev, 0)); ui.notifications.info("Свет остался у Порога — весы не идут в Свет."); }
    if (sp === "dark" && next > 0) { next = Math.min(next, Math.max(prev, 0)); ui.notifications.info("Тьма осталась у Порога — весы не идут во Тьму."); }
  }
  if (prev === next) return next;
  await game.settings.set(ID, "value", next);
  const delta = next - prev;
  const what = delta < 0 ? `Свет ${delta}` : `Тьма +${delta}`;
  const ps = stageOf(prev), ns = stageOf(next);
  if (game.settings.get(ID, "chat") && (reason || ps !== ns)) {
    let content = `<div class="ab-card ${delta < 0 ? "l" : "d"}"><b>${what}</b>${reason ? ` — ${esc(reason)}` : ""}`;
    if (ps !== ns) content += `<div class="ab-stage"><span>${ns.name}</span><p>${ns.text}</p></div>`;
    content += `</div>`;
    ChatMessage.create({ content, speaker: { alias: "Весы Аматуса" } });
  }
  return next;
}
const shift = (n, reason) => set(get() + Number(n || 0), reason);

/* ---------- Раскол ---------- */
const getSplit = () => { const v = game.settings.get(ID, "split"); return v === "light" || v === "dark" ? v : "none"; };
const SIDE = { light: { lost: "Свет", left: "Тьма" }, dark: { lost: "Тьма", left: "Свет" } };
let splitPrev = null, overlay;

async function split(side = "light", reason = "") {
  if (!game.user.isGM) return ui.notifications.warn("Раскалывает только мастер.");
  side = side === "dark" ? "dark" : "light";
  if (getSplit() === side) return;
  await game.settings.set(ID, "split", side);
  ChatMessage.create({ speaker: { alias: "Весы Аматуса" }, content:
    `<div class="ab-card split"><b>Раскол</b>${reason ? ` — ${esc(reason)}` : ""}<div class="ab-stage"><span>${SIDE[side].lost} остаётся у Порога</span><p>Аматус входит в город наполовину. ${SIDE[side].left} — всё, что у него сейчас есть.</p></div></div>` });
}
async function merge(reason = "") {
  if (!game.user.isGM) return ui.notifications.warn("Соединяет только мастер.");
  const was = getSplit(); if (was === "none") return;
  await game.settings.set(ID, "split", "none");
  ChatMessage.create({ speaker: { alias: "Весы Аматуса" }, content:
    `<div class="ab-card merge"><b>Целое</b>${reason ? ` — ${esc(reason)}` : ""}<div class="ab-stage"><span>${SIDE[was].lost} вернулся</span><p>Две половины снова держат друг друга за горло.</p></div></div>` });
}
const esc = t => foundry.utils.escapeHTML ? foundry.utils.escapeHTML(t) : String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function onSplit(v) {
  v = v === "light" || v === "dark" ? v : "none";
  const prev = splitPrev; splitPrev = v;
  if (prev === null || prev === v) return paintSplit(v);
  if (v === "none") playMerge(prev); else playSplit(v);
}

function crackPath(h = 1000) {
  let d = "M500,0", y = 0, x = 500;
  while (y < h) { y += 40 + Math.random() * 60; x = 500 + (Math.random() - .5) * 70; d += ` L${x.toFixed(0)},${Math.min(y, h).toFixed(0)}`; }
  return d;
}

function paintSplit(v) {
  if (!overlay) { overlay = document.createElement("div"); overlay.id = "ab-split"; document.body.appendChild(overlay); }
  const on = v !== "none";
  overlay.className = on ? `on ${v}` : "";
  overlay.classList.toggle("dim", on && game.settings.get(ID, "splitOverlay"));
  if (on && !overlay.firstChild) overlay.innerHTML = `<div class="half"></div><svg viewBox="0 0 1000 1000" preserveAspectRatio="none"><path d="${crackPath()}"/></svg>`;
  if (!on) overlay.innerHTML = "";
  if (el) { el.dataset.split = v; el.querySelector(".ab-lost").textContent = on ? `${SIDE[v].lost} — у Порога` : ""; }
}

function shake() {
  const b = document.getElementById("board"); if (!b) return;
  b.classList.remove("ab-shake"); void b.offsetWidth; b.classList.add("ab-shake");
  setTimeout(() => b.classList.remove("ab-shake"), 900);
}

function playSplit(v) {
  const fx = document.createElement("div");
  fx.className = `ab-fx split ${v}`;
  const shards = Array.from({ length: 26 }, () => {
    const l = v === "light", dx = (l ? -1 : 1) * (120 + Math.random() * 520), dy = (Math.random() - .5) * 600, r = (Math.random() - .5) * 720;
    return `<i style="top:${(Math.random() * 100).toFixed(1)}%;--dx:${dx.toFixed(0)}px;--dy:${dy.toFixed(0)}px;--r:${r.toFixed(0)}deg;--s:${(.5 + Math.random()).toFixed(2)};animation-delay:${(1.1 + Math.random() * .4).toFixed(2)}s"></i>`;
  }).join("");
  fx.innerHTML = `
    <div class="flash"></div>
    <div class="side l"></div><div class="side d"></div>
    <svg viewBox="0 0 1000 1000" preserveAspectRatio="none"><path d="${crackPath()}"/></svg>
    <div class="shards">${shards}</div>
    <div class="title"><b>РАСКОЛ</b><span>${SIDE[v].lost} остаётся у Порога</span></div>`;
  document.body.appendChild(fx);
  setTimeout(shake, 700);
  setTimeout(() => paintSplit(v), 3200);
  setTimeout(() => fx.remove(), 5200);
}

function playMerge(prev) {
  const fx = document.createElement("div");
  fx.className = `ab-fx merge ${prev}`;
  fx.innerHTML = `
    <div class="side l"></div><div class="side d"></div>
    <svg viewBox="0 0 1000 1000" preserveAspectRatio="none"><path d="${crackPath()}"/></svg>
    <div class="flash"></div>
    <div class="title"><b>ЦЕЛОЕ</b><span>${SIDE[prev].lost} вернулся</span></div>`;
  document.body.appendChild(fx);
  setTimeout(() => paintSplit("none"), 1400);
  setTimeout(shake, 1400);
  setTimeout(() => fx.remove(), 4600);
}

function build() {
  el = document.createElement("div");
  el.id = "ab-balance";
  el.innerHTML = `
    <button class="ab-btn ab-l" data-d="-1" title="Свет −1 (Shift: −2)">◐</button>
    <div class="ab-body">
      <div class="ab-labels"><span>Свет</span><b class="ab-stage-name"></b><span>Тьма</span></div>
      <div class="ab-track"><div class="ab-ticks"></div><i class="ab-dot"></i></div>
    </div>
    <button class="ab-btn ab-d" data-d="1" title="Тьма +1 (Shift: +2)">◑</button>
    <div class="ab-float"></div>
    <div class="ab-lost"></div>`;
  el.querySelector(".ab-ticks").innerHTML = Array.from({ length: 21 }, (_, i) => `<i class="${(i - 10) % 5 === 0 ? "big" : ""}"></i>`).join("");
  el.addEventListener("click", e => {
    const b = e.target.closest(".ab-btn"); if (!b) return;
    shift(Number(b.dataset.d) * (e.shiftKey ? 2 : 1));
  });
  el.addEventListener("contextmenu", e => { if (game.user.isGM && e.target.closest(".ab-track")) { e.preventDefault(); set(0, "весы сброшены"); } });
  document.body.appendChild(el);
}

function render(v, animate = false) {
  if (!el) return;
  v = clamp(v);
  const show = game.user.isGM || game.settings.get(ID, "visible");
  el.hidden = !show;
  el.classList.toggle("gm", game.user.isGM);
  el.classList.toggle("bottom", game.settings.get(ID, "position") === "bottom");
  el.querySelector(".ab-dot").style.left = `${(v + MAX) / (2 * MAX) * 100}%`;
  const st = stageOf(v);
  el.querySelector(".ab-stage-name").textContent = `${st.name} · ${v > 0 ? "+" + v : v}`;
  el.dataset.side = v < 0 ? "l" : v > 0 ? "d" : "n";
  if (animate && lastValue !== null && lastValue !== v) {
    const d = v - lastValue, f = document.createElement("span");
    f.className = `ab-pop ${d < 0 ? "l" : "d"}`;
    f.textContent = d < 0 ? `Свет ${d}` : `Тьма +${d}`;
    el.querySelector(".ab-float").appendChild(f);
    setTimeout(() => f.remove(), 1600);
    el.classList.remove("pulse"); void el.offsetWidth; el.classList.add("pulse");
  }
  lastValue = v;
}

Hooks.once("ready", () => {
  build(); render(get());
  splitPrev = getSplit(); paintSplit(splitPrev);
  game.amatusBalance = { get, set, shift, light: (n = 1, r) => shift(-Math.abs(n), r), dark: (n = 1, r) => shift(Math.abs(n), r),
    split, merge, getSplit, previewSplit: (v = "light") => playSplit(v === "dark" ? "dark" : "light"), previewMerge: (v = "light") => playMerge(v === "dark" ? "dark" : "light") };
});
