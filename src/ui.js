const { Markup } = require("telegraf");

function modeKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("👨‍🏫 Режим: Учитель", "MODE_TEACHER")],
    [Markup.button.callback("🎓 Режим: Ученик", "MODE_STUDENT")],
  ]);
}

function backMenuKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback("⬅️ В меню", "BACK_MENU")]]);
}

function mainMenu(mode) {
  if (mode === "teacher") {
    return Markup.inlineKeyboard([
      [Markup.button.callback("Заполнить/изменить анкету", "T_PROFILE")],
      [Markup.button.callback("Моя анкета", "T_SHOW_PROFILE")],
      [Markup.button.callback("Активна/Пауза", "T_TOGGLE_ACTIVE")],
      [Markup.button.callback("Удалить анкету", "T_DELETE_PROFILE")],
      [Markup.button.callback("Продвижение (ТОП)", "T_PROMO")],
      [Markup.button.callback("🔁 Сменить режим", "CHOOSE_MODE")],
    ]);
  }

  if (mode === "student") {
    return Markup.inlineKeyboard([
      [Markup.button.callback("Найти репетитора", "S_SEARCH")],
      [Markup.button.callback("🔁 Сменить режим", "CHOOSE_MODE")],
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
    ...promoPacks.map((p) => [Markup.button.callback(`${p.days} дней`, `PROMO_DAYS_${p.days}`)]),
    [Markup.button.callback("⬅️ В меню", "BACK_MENU")],
  ]);
}

function promoPayKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Оплатить ⭐ Stars", "PROMO_PAY_STARS")],
    [Markup.button.callback("Оплатить 💳 картой", "PROMO_PAY_CARD")],
    [Markup.button.callback("⬅️ Назад", "T_PROMO")],
  ]);
}

module.exports = {
  modeKeyboard,
  mainMenu,
  backMenuKeyboard,
  subjectsKeyboard,
  promoPacksKeyboard,
  promoPayKeyboard,
};
