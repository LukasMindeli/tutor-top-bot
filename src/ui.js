const { Markup } = require("telegraf");

function normalizeHttpUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^https?:\/\/.+/i.test(s)) return s;
  if (/^t\.me\/.+/i.test(s)) return `https://${s}`;
  return "";
}

const DONATE_URL =
  normalizeHttpUrl(process.env.ZSU_DONATE_URL) ||
  "https://savelife.in.ua/donate/";

function modeKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("👨‍🏫 Вчитель", "MODE_TEACHER")],
    [Markup.button.callback("🎓 Учень", "MODE_STUDENT")],
  ]);
}

// opts: { isActive?: boolean }
function mainMenu(mode, opts = {}) {
  if (mode === "teacher") {
    const activeLabel =
      typeof opts.isActive === "boolean"
        ? (opts.isActive ? "⏯ Активна ✅" : "⏯ Пауза ⏸")
        : "⏯ Активна / Пауза";

    return Markup.inlineKeyboard([
      [Markup.button.callback("🟥 ПРАВИЛА (читати)", "RULES")],
      [Markup.button.callback("📝 Заповнити/змінити анкету", "T_PROFILE")],
      [Markup.button.callback("👁️ Моя анкета", "T_SHOW_PROFILE")],
      [Markup.button.callback("📷 Фото анкети", "T_PHOTO_MENU")],
      [Markup.button.callback(activeLabel, "T_TOGGLE_ACTIVE")],
      [Markup.button.callback("⭐ ТОП", "T_PROMO")],
      [Markup.button.callback("🆘 Підтримка", "SUPPORT"), Markup.button.url("💙 Допомога ЗСУ", DONATE_URL)],
      [Markup.button.callback("🗑️ Видалити анкету", "T_DELETE_PROFILE")],
      [Markup.button.callback("🔁 Змінити роль", "CHOOSE_MODE")],
    ]);
  }

  return Markup.inlineKeyboard([
    [Markup.button.callback("🔎 Знайти репетитора", "S_SEARCH")],
    [Markup.button.callback("🆘 Підтримка", "SUPPORT"), Markup.button.url("💙 Допомога ЗСУ", DONATE_URL)],
    [Markup.button.callback("🔁 Змінити роль", "CHOOSE_MODE")],
  ]);
}

function backMenuKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback("⬅️ В меню", "BACK_MENU")]]);
}

function confirmDeleteKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Так, видалити", "T_DELETE_CONFIRM")],
    [Markup.button.callback("❌ Скасувати", "BACK_MENU")],
  ]);
}

function promoPacksKeyboard(PROMO_PACKS) {
  const rows = PROMO_PACKS.map((p) => [Markup.button.callback(`${p.days} днів`, `PROMO_DAYS_${p.days}`)]);
  rows.push([Markup.button.callback("⬅️ В меню", "BACK_MENU")]);
  return Markup.inlineKeyboard(rows);
}

function promoPayKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Оплатити ⭐ Stars", "PROMO_PAY_STARS")],
    [Markup.button.callback("Оплатити 💳 карткою", "PROMO_PAY_CARD")],
    [Markup.button.callback("⬅️ Назад", "T_PROMO")],
  ]);
}

function requestDecisionKeyboard(reqId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Прийняти", `T_REQ_ACCEPT_${reqId}`)],
    [Markup.button.callback("❌ Відхилити", `T_REQ_DECLINE_${reqId}`)],
  ]);
}

module.exports = {
  modeKeyboard,
  mainMenu,
  backMenuKeyboard,
  confirmDeleteKeyboard,
  promoPacksKeyboard,
  promoPayKeyboard,
  requestDecisionKeyboard,
};
