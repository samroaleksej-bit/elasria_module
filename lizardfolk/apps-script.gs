/**
 * Анкеты игроков «Скрытые земли людоящеров» → Google-таблица мастера.
 * Вставьте этот код в Расширения → Apps Script своей таблицы и опубликуйте как веб-приложение
 * (Выполнять от имени: Я · Доступ: Все).
 */
const SHEET_NAME = "Анкеты";

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Сохранить анкету: одна строка на код героя, повторная отправка перезаписывает строку. */
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const d = JSON.parse(e.postData.contents);
    const id = String(d.id || "").toUpperCase();
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(id)) return json_({ ok: false, error: "bad id" });
    const cols = (d.columns || []).filter(c => c && c.id && c.label);
    const answers = d.answers || {};
    const sh = sheet_();

    // Заголовки: ID, Обновлено, затем вопросы. Новые вопросы дописываются справа.
    if (sh.getLastRow() === 0) {
      sh.appendRow(["Код героя", "Обновлено"].concat(cols.map(c => c.label)));
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight("bold");
    }
    let header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    cols.forEach(c => {
      if (header.indexOf(c.label) === -1) {
        header.push(c.label);
        sh.getRange(1, header.length).setValue(c.label).setFontWeight("bold");
      }
    });

    const byLabel = {};
    cols.forEach(c => { byLabel[c.label] = String(answers[c.id] == null ? "" : answers[c.id]).slice(0, 5000); });
    const row = header.map(h => h === "Код героя" ? id : h === "Обновлено" ? new Date() : (byLabel[h] || ""));

    const last = sh.getLastRow();
    const ids = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().map(r => String(r[0])) : [];
    const i = ids.indexOf(id);
    if (i >= 0) sh.getRange(i + 2, 1, 1, row.length).setValues([row]);
    else sh.appendRow(row);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** Открыть свою анкету по коду героя (чтобы дописать с другого устройства). */
function doGet(e) {
  const id = String((e.parameter && e.parameter.id) || "").toUpperCase();
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(id)) return json_({ ok: false });
  const sh = sheet_();
  const last = sh.getLastRow();
  if (last < 2) return json_({ ok: false });
  const data = sh.getRange(1, 1, last, sh.getLastColumn()).getValues();
  const header = data[0];
  const row = data.slice(1).find(r => String(r[0]) === id);
  if (!row) return json_({ ok: false });
  const byLabel = {};
  header.forEach((h, k) => { byLabel[h] = row[k]; });
  return json_({ ok: true, byLabel: byLabel });
}
