// Привой · Штаб (HOMELINE). Магазин штаба: улучшения за HQ IP и декор за эдди из общака.
// Механика улучшений пересказана по бесплатному DLC «No Place Like Home» (R. Talsorian Games).
const MID = "privoy-hq";
const COST = 40;

/* max = сколько всего уровней (1 = только установка, 2 = установка + апгрейд). */
const ROOMS = [
  { id: "garage", ic: "fa-warehouse", name: "Гараж", who: "вся команда", max: 2,
    t: "Командная малолитражка. Её можно тюнинговать, но нельзя продать. Машину уничтожили - улучшение потеряно.",
    up: "Номад за неделю простоя перебирает свои машины и апгрейды заново." },
  { id: "workshop", ic: "fa-screwdriver-wrench", name: "Мастерская", who: "техник", max: 2,
    t: "Работая над проектом, техник засчитывает столько же времени второму проекту.",
    up: "Время засчитывается и третьему проекту." },
  { id: "medbay", ic: "fa-kit-medical", name: "Медблок", who: "вся команда, медтех", max: 2,
    t: "Все лечатся, как будто ТЕЛ на 2 выше. Медтеху +2 к первой помощи, парамедику и хирургии.",
    up: "Медтех варит, улучшает и изобретает уличные препараты, как техник." },
  { id: "server", ic: "fa-server", name: "Серверная", who: "нетраннер", max: 2,
    t: "У штаба своя NET-архитектура. На оборону выдаётся 20 000 eb, остаток не возвращается.",
    up: "Нетраннер собирает и улучшает деки, железо и программы, как техник." },
  { id: "training", ic: "fa-dumbbell", name: "Тренировочная зона", who: "вся команда, соло", max: 2,
    t: "Неделя простоя: +1 к одному боевому навыку до следующей миссии.",
    up: "Соло тренирует два навыка сразу." },
  { id: "lounge", ic: "fa-martini-glass", name: "Лаунж", who: "фиксер", max: 2,
    t: "На встречах в штабе фиксеру +2 к переговорным навыкам.",
    up: "Фиксеру и медиа +2, чтобы устроить личную встречу с контактом." },
  { id: "evidence", ic: "fa-thumbtack", name: "Стена улик", who: "законник, медиа", max: 2,
    t: "Законнику и медиа +2 к навыкам расследования по текущему делу.",
    up: "Законнику +3. У медиа растёт убедительность материала по этому делу." },
  { id: "studio", ic: "fa-music", name: "Студия", who: "рокербой", max: 2,
    t: "В студии рокербою +2 к творческим навыкам.",
    up: "Неделя доработки проекта даёт +2, бонус копится от недели к неделе. Выпала 1 - всё сгорает." },
  { id: "lockup", ic: "fa-dungeon", name: "Камера", who: "вся команда, законник", max: 2,
    t: "Звукоизолированная камера на одного пленника. Без ТЕЛ 13 не выбраться.",
    up: "Три камеры. Законнику +2 к допросу того, кто просидел хотя бы день." },
  { id: "workstation", ic: "fa-briefcase", name: "Рабочая станция", who: "экзек", max: 2,
    t: "Один подчинённый экзека становится полноценным членом команды: получает очки и долю.",
    up: "Он остаётся верен без проверок лояльности, пока экзек его не предаст." },
  { id: "rent", ic: "fa-file-invoice-dollar", name: "Снижение аренды", who: "кто живёт в штабе", max: 5,
    t: "Аренда считается на категорию ниже по таблице жилья.",
    up: "Каждый апгрейд - ещё одна кровать без роста аренды, пока мест не станет вдвое больше." },
  { id: "morale", ic: "fa-couch", name: "Уют", who: "вся команда", max: 11,
    t: "Обжитое место: расходы на образ жизни -50 eb в месяц каждому.",
    ups: [
      "Раз в месяц каждый восстанавливает 1d6/2 человечности.",
      "Все лечатся, как будто ТЕЛ ещё на 1 выше.",
      "УДАЧА всей команды +1.",
      "Человечность раз в месяц: уже 1d6 вместо 1d6/2.",
      "Фиксеру +2 к торгу за оплату. Остальные торгуются за +20%, как фиксер 5 ранга.",
      "На подработке бросаешь дважды и берёшь лучший результат.",
      "УДАЧА всей команды ещё +1.",
      "На подработке бросаешь дважды и получаешь доход с обоих бросков.",
      "Человечность раз в месяц: 1d6 дважды, берёшь больший.",
      "Свой бонус: придумайте его вместе с мастером."
    ] }
];

const DECOR = [
  { id: "sofa", name: "Диван с распродажи", price: 50, t: "Продавлен ровно там, где надо. Чей-то любимый." },
  { id: "neon", name: "Неоновая вывеска", price: 100, t: "Название команды розовым. Одна буква мигает." },
  { id: "arcade", name: "Аркадный автомат", price: 500, t: "Рекорд держит тот, кого уже нет в городе." },
  { id: "coffee", name: "Кофемашина", price: 100, t: "Варит что-то коричневое и горячее. Вопросов не задают." },
  { id: "posters", name: "Постеры на стены", price: 20, t: "Рок-группы, реклама хрома и один календарь за 2041-й." },
  { id: "aquarium", name: "Голо-аквариум", price: 500, t: "Рыбы ненастоящие. Зато не дохнут." },
  { id: "rug", name: "Ковёр", price: 50, t: "Прикрывает пятно. Не спрашивай, от чего." },
  { id: "bar", name: "Барная стойка", price: 1000, t: "Из двери фургона и трёх бочек. Наливают своим." },
  { id: "projector", name: "Проектор и белая стена", price: 100, t: "Кино по пятницам. Выбирает тот, кто последним выжил." },
  { id: "plants", name: "Синт-растения", price: 50, t: "Пластик, но Гриму нравится их поливать." },
  { id: "mural", name: "Мурал во всю стену", price: 500, t: "Знакомый художник, три ночи, банка краски в подарок." },
  { id: "jukebox", name: "Музыкальный автомат", price: 500, t: "Играет чиптюн и одну застрявшую балладу." },
  { id: "vinyl", name: "Проигрыватель и ящик винила", price: 100, t: "Довоенные пластинки. Половина целая." },
  { id: "fridge", name: "Холодильник с пивом", price: 100, t: "Полка у каждого своя. Чужое не трогать." },
  { id: "lights", name: "Гирлянды", price: 20, t: "Висят с прошлого Нового года. И с позапрошлого." },
  { id: "flag", name: "Флаг команды", price: 50, t: "Эмблему придумывайте сами. Шьёт соседка." },
  { id: "mannequin", name: "Манекен", price: 20, t: "В бронежилете и чужой шляпе. У него есть имя." },
  { id: "pingpong", name: "Стол для пинг-понга", price: 100, t: "Сетка из троса. Споры решают здесь." },
  { id: "bag", name: "Боксёрская груша", price: 50, t: "С нарисованным лицом. Лицо меняют по настроению." },
  { id: "robocat", name: "Робокот", price: 1000, t: "Не ловит мышей, зато мурчит и роняет вещи со стола." },
  { id: "hammock", name: "Гамак", price: 20, t: "Натянут между двух колонн. Занят всегда." },
  { id: "trophy", name: "Полка трофеев", price: 50, t: "Сюда ставят память о заказах. Первой будет гильза." }
];

const DEF = { hqip: 0, eb: 0, rooms: {}, decor: {}, log: [], auto: false };
const getS = () => foundry.utils.mergeObject(foundry.utils.deepClone(DEF), game.settings.get(MID, "state") ?? {});
const setS = (s) => game.settings.set(MID, "state", s);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const activeGM = () => game.users.activeGM ?? game.users.find((u) => u.isGM && u.active);
const iAmActiveGM = () => game.user.isGM && activeGM()?.id === game.user.id;
const roomUpText = (r, lvl) => (r.ups ? r.ups[lvl - 1] : r.up);

function stamp(s, text) {
  s.log.unshift({ t: Date.now(), text });
  s.log = s.log.slice(0, 40);
}
function say(text) {
  ChatMessage.create({ content: `<div style="border-left:3px solid #fcee0a;padding-left:8px"><b>HOMELINE</b><br>${text}</div>` });
}

/* ---------- действия (выполняются у активного мастера) ---------- */
async function doAction(a, userId) {
  const user = game.users.get(userId);
  const who = user?.name ?? "Кто-то";
  const s = getS();
  if (a.type === "room") {
    const r = ROOMS.find((x) => x.id === a.id);
    const lvl = s.rooms[a.id] ?? 0;
    if (!r || lvl >= r.max) return "Это улучшение уже на максимуме.";
    if (s.hqip < COST) return `Не хватает очков штаба: нужно ${COST}, есть ${s.hqip}.`;
    s.hqip -= COST; s.rooms[a.id] = lvl + 1;
    const what = lvl === 0 ? `установлено улучшение «${r.name}»` : `«${r.name}»: апгрейд ${lvl}`;
    stamp(s, `${who}: ${what} (-${COST} HQ IP)`);
    await setS(s);
    say(`${esc(who)} оформляет заказ: <b>${esc(what)}</b>.<br><small>${esc(lvl === 0 ? r.t : roomUpText(r, lvl))}</small>`);
    return null;
  }
  if (a.type === "decor") {
    const d = DECOR.find((x) => x.id === a.id);
    if (!d) return "Нет такого товара.";
    if (s.eb < d.price) return `В общаке не хватает: нужно ${d.price} eb, есть ${s.eb}.`;
    s.eb -= d.price; s.decor[a.id] = (s.decor[a.id] ?? 0) + 1;
    stamp(s, `${who}: куплено «${d.name}» (-${d.price} eb)`);
    await setS(s);
    say(`${esc(who)} заказывает в штаб: <b>${esc(d.name)}</b>.<br><small>${esc(d.t)}</small>`);
    return null;
  }
  if (a.type === "donate") {
    const amt = Math.floor(Number(a.amount));
    if (!(amt > 0)) return "Сумма должна быть больше нуля.";
    const actor = user?.character;
    const cur = actor?.system?.wealth?.value;
    if (actor && typeof cur === "number") {
      if (cur < amt) return `У ${actor.name} только ${cur} eb.`;
      await actor.update({ "system.wealth.value": cur - amt });
      s.eb += amt; stamp(s, `${who}: взнос в общак +${amt} eb (со счёта ${actor.name})`);
    } else {
      s.eb += amt; stamp(s, `${who}: взнос в общак +${amt} eb (спиши с листа вручную)`);
    }
    await setS(s);
    say(`${esc(who)} скидывает в общак <b>${amt} eb</b>.`);
    return null;
  }
  return "Неизвестное действие.";
}

function describe(a) {
  if (a.type === "room") { const r = ROOMS.find((x) => x.id === a.id); return `улучшение «${r?.name}» за ${COST} HQ IP`; }
  if (a.type === "decor") { const d = DECOR.find((x) => x.id === a.id); return `«${d?.name}» за ${d?.price} eb из общака`; }
  if (a.type === "donate") return `взнос в общак ${a.amount} eb`;
  return "действие";
}

async function gmHandle(a, userId) {
  const s = getS();
  const fromPlayer = userId !== game.user.id;
  if (fromPlayer && !s.auto && a.type !== "donate") {
    const ok = await Dialog.confirm({
      title: "HOMELINE: заказ от игрока",
      content: `<p><b>${esc(game.users.get(userId)?.name)}</b> хочет оформить: ${esc(describe(a))}.</p><p>Одобрить?</p>`
    });
    if (!ok) return reply(userId, "Мастер отклонил заказ.");
  }
  const err = await doAction(a, userId);
  if (err) reply(userId, err);
}
function reply(userId, text) {
  if (userId === game.user.id) ui.notifications.warn(text);
  else game.socket.emit(`module.${MID}`, { op: "reply", to: userId, text });
}
function request(a) {
  if (iAmActiveGM()) return gmHandle(a, game.user.id);
  if (!activeGM()) return ui.notifications.warn("Мастер не в сети: заказ некому подтвердить.");
  game.socket.emit(`module.${MID}`, { op: "req", a, user: game.user.id });
  ui.notifications.info("Заказ отправлен мастеру.");
}

/* ---------- окно ---------- */
const view = { tab: "rooms" };
function buildHtml(inAgent = false) {
  const self = view;
  {
    const s = getS();
    const tabs = [["rooms", "Улучшения"], ["decor", "Декор"], ["hq", "Наш штаб"]];
    if (game.user.isGM) tabs.push(["gm", "Мастер"]);
    let body = "";
    if (self.tab === "rooms") {
      body += `<div class="phq-note">Очки штаба команда получает вместе с групповыми очками развития за миссию. Любое улучшение и любой апгрейд стоят ${COST} HQ IP. Тратит вся команда вместе.</div>`;
      for (const r of ROOMS) {
        const lvl = s.rooms[r.id] ?? 0, maxed = lvl >= r.max;
        const nextUp = lvl > 0 && !maxed ? roomUpText(r, lvl) : null;
        body += `<div class="phq-card ${lvl ? (maxed ? "max" : "own") : ""}"><i class="ic fas ${r.ic}"></i>
          <h4>${esc(r.name)} <em>${esc(r.who)}</em></h4><p>${esc(r.t)}</p>
          ${lvl === 0 && r.max > 1 ? `<p class="up"><b>Апгрейд:</b> ${esc(roomUpText(r, 1))}</p>` : ""}
          ${nextUp ? `<p class="up"><b>Следующий апгрейд:</b> ${esc(nextUp)}</p>` : ""}
          <div class="phq-row" style="grid-column:2"><span class="tag">${lvl ? (maxed ? "Установлено, максимум" : `Установлено${lvl > 1 ? `, апгрейд ${lvl - 1}` : ""}`) : ""}</span>
          ${maxed ? "" : `<button class="buy" data-room="${r.id}" ${s.hqip < COST ? "disabled" : ""}>${lvl ? "Апгрейд" : "Установить"} · ${COST} HQ IP</button>`}</div></div>`;
      }
    } else if (self.tab === "decor") {
      body += `<div class="phq-note">Декор ничего не даёт по правилам, это просто ваше место. Платится из общака.</div>`;
      for (const d of DECOR) {
        const n = s.decor[d.id] ?? 0;
        body += `<div class="phq-card ${n ? "own" : ""}"><i class="ic fas fa-tag"></i><h4>${esc(d.name)} <em>${n ? `в штабе: ${n}` : ""}</em></h4><p>${esc(d.t)}</p>
          <div class="phq-row" style="grid-column:2"><span></span><button class="buy eb" data-decor="${d.id}" ${s.eb < d.price ? "disabled" : ""}>Купить · ${d.price} eb</button></div></div>`;
      }
    } else if (self.tab === "hq") {
      const own = ROOMS.filter((r) => s.rooms[r.id]);
      body += `<h3>Улучшения</h3>` + (own.length ? `<ul class="phq-list">${own.map((r) => {
        const lvl = s.rooms[r.id]; const ups = []; for (let i = 1; i < lvl; i++) ups.push(roomUpText(r, i));
        return `<li><span><b>${esc(r.name)}</b><br><small>${esc(r.t)}${ups.length ? "<br>+ " + ups.map(esc).join("<br>+ ") : ""}</small></span>${game.user.isGM ? `<a class="x" data-rm-room="${r.id}" title="Снять один уровень">−</a>` : ""}</li>`; }).join("")}</ul>` : `<div class="phq-note">Пока ничего. Первое улучшение делает место штабом.</div>`);
      const dec = DECOR.filter((d) => s.decor[d.id]);
      body += `<h3>Декор</h3>` + (dec.length ? `<ul class="phq-list">${dec.map((d) => `<li><span>${esc(d.name)}${s.decor[d.id] > 1 ? ` ×${s.decor[d.id]}` : ""}</span>${game.user.isGM ? `<a class="x" data-rm-decor="${d.id}" title="Убрать одну штуку">−</a>` : ""}</li>`).join("")}</ul>` : `<div class="phq-note">Голые стены и эхо.</div>`);
      body += `<h3>Общак</h3><div class="phq-gm"><input type="number" min="1" step="50" value="100" data-f="don"><button data-act="donate">Скинуть в общак</button></div>
        <div class="phq-note">Сумма спишется со счёта твоего персонажа, если он назначен.</div>`;
      body += `<h3>Журнал</h3><div class="phq-log">${s.log.slice(0, 15).map((l) => `<span>${new Date(l.t).toLocaleDateString("ru-RU")} · ${esc(l.text)}</span>`).join("") || "Пусто."}</div>`;
    } else if (self.tab === "gm") {
      body += `<h3>Очки штаба</h3><div class="phq-gm"><input type="number" step="10" value="40" data-f="ip"><button data-act="ip">Начислить</button><button data-act="ip-">Списать</button></div>
        <h3>Общак</h3><div class="phq-gm"><input type="number" step="50" value="500" data-f="eb"><button data-act="eb">Добавить</button><button data-act="eb-">Убрать</button></div>
        <h3>Заказы игроков</h3><div class="phq-gm"><label><input type="checkbox" data-act="auto" ${s.auto ? "checked" : ""}> проводить без моего подтверждения</label></div>
        <h3>Сброс</h3><div class="phq-gm"><button data-act="reset">Обнулить штаб</button><button data-act="reset-yes" hidden>Точно обнулить всё</button></div>
        <div class="phq-note">Сброс убирает улучшения, декор, очки, общак и журнал. Минус на вкладке «Наш штаб» снимает один уровень без возврата очков.</div>`;
    }
    return `<div class="phq${inAgent ? " in-agent" : ""}"><div class="phq-top"><div><b>HOMELINE</b><small>всё для вашей норы · доставка по Найт-Сити</small></div>
      <div class="phq-bal"><span>${s.hqip} HQ IP</span><span class="eb">${s.eb} eb</span></div></div>
      <div class="phq-tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${self.tab === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="phq-body">${body}</div></div>`;
  }
}
function bindHtml(root, rerender) {
  {
    const html = $(root);
    html.find("[data-tab]").on("click", (e) => { view.tab = e.currentTarget.dataset.tab; rerender(); });
    html.find("[data-room]").on("click", (e) => request({ type: "room", id: e.currentTarget.dataset.room }));
    html.find("[data-decor]").on("click", (e) => request({ type: "decor", id: e.currentTarget.dataset.decor }));
    html.find("[data-act=donate]").on("click", () => request({ type: "donate", amount: Number(html.find("[data-f=don]").val()) }));
    if (!game.user.isGM) return;
    const edit = async (fn, text) => { const s = getS(); fn(s); if (text) stamp(s, text); await setS(s); };
    const num = (f) => Math.floor(Number(html.find(`[data-f=${f}]`).val())) || 0;
    html.find("[data-act=ip]").on("click", () => { const n = num("ip"); edit((s) => { s.hqip += n; }, `Мастер: +${n} HQ IP`); });
    html.find("[data-act=ip-]").on("click", () => { const n = num("ip"); edit((s) => { s.hqip = Math.max(0, s.hqip - n); }, `Мастер: -${n} HQ IP`); });
    html.find("[data-act=eb]").on("click", () => { const n = num("eb"); edit((s) => { s.eb += n; }, `Мастер: общак +${n} eb`); });
    html.find("[data-act=eb-]").on("click", () => { const n = num("eb"); edit((s) => { s.eb = Math.max(0, s.eb - n); }, `Мастер: общак -${n} eb`); });
    html.find("[data-act=auto]").on("change", (e) => edit((s) => { s.auto = e.currentTarget.checked; }));
    html.find("[data-act=reset]").on("click", () => html.find("[data-act=reset-yes]").prop("hidden", false));
    html.find("[data-act=reset-yes]").on("click", () => setS(foundry.utils.deepClone(DEF)));
    html.find("[data-rm-room]").on("click", (e) => { const id = e.currentTarget.dataset.rmRoom; edit((s) => { s.rooms[id] = (s.rooms[id] ?? 1) - 1; if (s.rooms[id] <= 0) delete s.rooms[id]; }, `Мастер: снят уровень «${ROOMS.find((r) => r.id === id)?.name}»`); });
    html.find("[data-rm-decor]").on("click", (e) => { const id = e.currentTarget.dataset.rmDecor; edit((s) => { s.decor[id] = (s.decor[id] ?? 1) - 1; if (s.decor[id] <= 0) delete s.decor[id]; }, `Мастер: убрано «${DECOR.find((d) => d.id === id)?.name}»`); });
  }
}
class HQApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { id: "privoy-hq", title: "HOMELINE", classes: ["phq-app"], width: 440, height: 680, resizable: true });
  }
  async _renderInner() { return $(buildHtml(false)); }
  activateListeners(html) { super.activateListeners(html); bindHtml(html[0], () => this.render()); }
}
/* ---------- вкладка в телефоне Агента (модуль night-city-map 0.30.2+) ---------- */
const NCM = "night-city-map";
const ncmApi = () => { const m = game.modules.get(NCM); return m?.active ? m.api : null; };
const refreshAll = () => { if (app?.rendered) app.render(); ncmApi()?.refreshAgentApp?.(MID); };
function registerInAgent(api) {
  if (!api?.registerAgentApp) return false;
  return api.registerAgentApp({ id: MID, icon: "fas fa-house-signal", label: "Дом",
    render: () => buildHtml(true), bind: (el) => bindHtml(el, () => api.refreshAgentApp(MID)) });
}
let app = null;
const openWindow = () => { app ??= new HQApp(); app.render(true); return app; };
const inAgent = () => !!ncmApi()?.openAgentApp && agentHas;
let agentHas = false;
const open = () => (inAgent() ? ncmApi().openAgentApp(MID) : openWindow());
const toggle = () => (inAgent() ? open() : app?.rendered ? app.close() : openWindow());

Hooks.once("init", () => {
  game.settings.register(MID, "state", { scope: "world", config: false, type: Object, default: DEF, onChange: () => refreshAll() });
  game.keybindings.register(MID, "open", { name: "Открыть HOMELINE (магазин штаба)", editable: [{ key: "KeyH", modifiers: ["Shift"] }], onDown: () => { toggle(); return true; } });
});
Hooks.once("ready", () => {
  agentHas = registerInAgent(ncmApi());
  game.modules.get(MID).api = { open, toggle, openWindow, state: getS, addHQIP: async (n) => { const s = getS(); s.hqip += Number(n) || 0; stamp(s, `Мастер: +${n} HQ IP`); await setS(s); } };
  game.socket.on(`module.${MID}`, (m) => {
    if (m.op === "req" && iAmActiveGM()) gmHandle(m.a, m.user);
    if (m.op === "reply" && m.to === game.user.id) ui.notifications.warn(m.text);
  });
});
Hooks.on("nightCityMapAgentReady", (api) => { agentHas = registerInAgent(api) || agentHas; });
Hooks.on("getSceneControlButtons", (controls) => {
  const tok = Array.isArray(controls) ? controls.find((c) => c.name === "token") : controls?.tokens;
  const tool = { name: "privoy-hq", title: "HOMELINE - магазин штаба (Shift+H)", icon: "fas fa-house-signal", button: true, onClick: () => toggle() };
  if (Array.isArray(tok?.tools)) tok.tools.push(tool);
});
