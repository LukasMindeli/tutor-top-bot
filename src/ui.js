const { Markup } = require("telegraf");

function modeKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("👨‍🏫 Режим: Вчитель", "MODE_TEACHER")],
    [Markup.button.callback("🎓 Режим: Учень", "MODE_STUDENT")],
  ]);
}

function backMenuKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback("⬅️ В меню", "BACK_MENU")]]);
}

function mainMenu(mode) {
  if (mode === "teacher") {
    return Markup.inlineKeyboard([
      [Markup.button.callback("Заповнити/змінити анкету", "T_PROFILE")],
      [Markup.button.callback("Моя анкета", "T_SHOW_PROFILE")],
      [Markup.button.callback("Активна/Пауза", "T_TOGGLE_ACTIVE")],
      [Markup.button.callback("Видалити анкету", "T_DELETE_PROFILE")],
      [Markup.button.callback("Просування (ТОП)", "T_PROMO")],
      [Markup.button.callback("🔁 Змінити режим", "CHOOSE_MODE")],
    ]);
  }

  if (mode === "student") {
    return Markup.inlineKeyboard([
      [Markup.button.callback("Знайти репетитора", "S_SEARCH")],
      [Markup.button.callback("🔁 Змінити режим", "CHOOSE_MODE")],
    ]);
  }

  return modeKeyboard();
}

function subjectsKeyboard(subjects, prefix, extraButtons = []) {
  return Markup.inlineKeyboard([
    ...subjects.map((s) => [Markup.button.callback(s.label, `${prefix}_${s.key}`)]),
    ...extraButtons,
  ]);
}

function promoPacksKeyboard(promoPacks) {
  return Markup.inlineKeyboard([
    ...promoPacks.map((p) => [Markup.button.callback(`${p.days} днів`, `PROMO_DAYS_${p.days}`)]),
    [Markup.button.callback("⬅️ В меню", "BACK_MENU")],
  ]);
}

function promoPayKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Оплатити ⭐ Stars", "PROMO_PAY_STARS")],
    [Markup.button.callback("Оплатити 💳 карткою", "PROMO_PAY_CARD")],
    [Markup.button.callback("⬅️ Назад", "T_PROMO")],
  ]);
}

function confirmDeleteKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Так, видалити", "T_DELETE_CONFIRM")],
    [Markup.button.callback("❌ Скасувати", "BACK_MENU")],
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
  backMenuKeyboard,
  mainMenu,
  subjectsKeyboard,
  promoPacksKeyboard,
  promoPayKeyboard,
  confirmDeleteKeyboard,
  requestDecisionKeyboard,
};
