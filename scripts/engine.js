// Движок замен: чистые функции, без обращений к Foundry. Его же использует проверка на выгрузке.
// В модуле нет текста приключения - только правила «старое имя -> новое имя».

const L = "А-Яа-яЁё";
export const B0 = `(?<![${L}])`;
export const B1 = `(?![${L}-])`;

/** Правило: регулярное выражение с границами слова и функция замены. */
export function rule(body, fn, opts = {}) {
  return { re: new RegExp(B0 + "(?:" + body + ")" + B1, "g"), fn, ...opts };
}

/** Таблица окончаний: e({"": "ь", "а": "я"}) -> функция. */
export const e = (map) => (end) => map[end ?? ""] ?? map[""] ?? "";
/** То же склонение: окончание переносится как есть. */
export const same = (stem) => (m, end) => stem + (end ?? "");

/** Слова перед совпадением, в нижнем регистре, от ближнего к дальнему. */
export function prevWords(str, offset, n = 4) {
  const head = str.slice(Math.max(0, offset - 90), offset).replace(/[«»"'„“(]/g, " ");
  return head.trim().split(/\s+/).filter(Boolean).reverse().slice(0, n).map((w) => w.toLowerCase().replace(/[.,;:!?]+$/, ""));
}

const MOTION = /(прибы|приход|приезж|приш[её]?л|ид[ёу]т|ид[её]м|отправ|направ|вед[ёу]т|ведущ|дорог|пут[ьи]|возвращ|верн|войти|войд|вход|попа[сд]|добра|доб[ие]р|достав|привез|привод|прив[её]л|бежа|сбежа|переех|проник|въезж|въех|пуска|впуска|путешеств)/;

/**
 * Склонение по предлогу для случая, когда старое имя не склонялось, а новое склоняется.
 * forms: { nom, gen, dat, acc, ins, prep }
 */
export function byContext(forms, genHeads = "") {
  const GEN = new RegExp(`^(из|от|до|у|для|без|около|возле|вокруг|внутри|вне|близ|мимо|вдоль|после|против|кроме|жител\\S*|улиц\\S*|ворот\\S*|врат\\S*|стен\\S*|бургомистр\\S*|барон\\S*|стражник\\S*|страж\\S*|площад\\S*|окраин\\S*|окрестност\\S*|церк\\S*|народ\\S*|люд\\S*|обитател\\S*|област\\S*|карт\\S*|земл\\S*|земель|границ\\S*|дорог\\S*|истори\\S*|правител\\S*|хозя\\S*|власт\\S*|защит\\S*|западу|востоку|северу|югу|центр\\S*|част\\S*|руин\\S*|развалин\\S*|простолюдин\\S*|обывател\\S*|разведчик\\S*|разбойник\\S*|ревенант\\S*|ведьм\\S*${genHeads ? "|" + genHeads : ""})$`);
  return (m, off, str) => {
    const prev = prevWords(str, off, 5);
    const p = prev[0] ?? "";
    if (/^(город|городе|города|городу|городом|деревн\S*|сел[оауе]|селом|замок|замка|замку|замке|замком|поселени\S*)$/.test(p)) return forms.nom;
    if (GEN.test(p)) return forms.gen;
    if (/^(к|ко|по)$/.test(p)) return forms.dat;
    if (/^(над|под|за|перед|с|со|между)$/.test(p)) return forms.ins;
    if (/^(о|об|при)$/.test(p)) return forms.prep;
    if (/^(в|во|на)$/.test(p)) return MOTION.test(prev.slice(1).join(" ")) ? forms.acc : forms.prep;
    if (/^(через|про|сквозь)$/.test(p)) return forms.acc;
    return forms.nom;
  };
}

/** Применить правила к простому тексту. */
export function convertPlain(text, rules, stats) {
  let out = text;
  for (const r of rules) {
    out = out.replace(r.re, (...args) => {
      const m = args[0];
      const tail = args.slice(-2);
      const groups = typeof tail[1] === "string" ? args.slice(1, -2) : args.slice(1, -3);
      const off = typeof tail[1] === "string" ? tail[0] : args[args.length - 3];
      const str = typeof tail[1] === "string" ? tail[1] : args[args.length - 2];
      let res = r.fn(m, ...groups, off, str);
      if (res === null || res === undefined) return m;
      if (m.length > 3 && m === m.toUpperCase() && m !== m.toLowerCase()) res = res.toUpperCase();
      else if (r.common && m[0] === m[0].toLowerCase()) res = res[0].toLowerCase() + res.slice(1);
      else if (r.common && m[0] !== m[0].toLowerCase()) res = res[0].toUpperCase() + res.slice(1);
      if (stats && res !== m) stats[r.id] = (stats[r.id] ?? 0) + 1;
      return res;
    });
  }
  return out;
}

// Куски, которые трогать нельзя: HTML-теги, ссылки @UUID[...], броски [[...]], справки &Reference[...]
const SKIP = /(<[^>]*>|@\w+\[[^\]]*\]|&[Rr]eference\[[^\]]*\]|\[\[[^\]]*\]\])/g;

/** Применить правила к HTML: меняется только видимый текст. */
export function convertHTML(html, rules, stats) {
  if (!html) return html;
  return String(html).split(SKIP).map((part, i) => (i % 2 ? part : convertPlain(part, rules, stats))).join("");
}
