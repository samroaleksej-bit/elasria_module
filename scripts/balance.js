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
  game.settings.register(ID, "chat", { name: "Сообщать о смене стадии в чат", scope: "world", config: true, type: Boolean, default: true });
});

const get = () => clamp(game.settings.get(ID, "value"));

async function set(v, reason = "") {
  if (!game.user.isGM) return ui.notifications.warn("Весы двигает только мастер.");
  const prev = get(), next = clamp(v);
  if (prev === next) return next;
  await game.settings.set(ID, "value", next);
  const delta = next - prev;
  const what = delta < 0 ? `Свет ${delta}` : `Тьма +${delta}`;
  const ps = stageOf(prev), ns = stageOf(next);
  if (game.settings.get(ID, "chat") && (reason || ps !== ns)) {
    let content = `<div class="ab-card ${delta < 0 ? "l" : "d"}"><b>${what}</b>${reason ? ` — ${foundry.utils.escapeHTML ? foundry.utils.escapeHTML(reason) : reason}` : ""}`;
    if (ps !== ns) content += `<div class="ab-stage"><span>${ns.name}</span><p>${ns.text}</p></div>`;
    content += `</div>`;
    ChatMessage.create({ content, speaker: { alias: "Весы Аматуса" } });
  }
  return next;
}
const shift = (n, reason) => set(get() + Number(n || 0), reason);

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
    <div class="ab-float"></div>`;
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
  game.amatusBalance = { get, set, shift, light: (n = 1, r) => shift(-Math.abs(n), r), dark: (n = 1, r) => shift(Math.abs(n), r) };
});
