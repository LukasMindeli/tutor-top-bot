require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");

const bot = new Telegraf(process.env.BOT_TOKEN);

// временное хранение (потом заменим на БД)
const state = new Map(); // key: tg_user_id -> { role, subject }

const SUBJECTS = [
  { key: "math", label: "Математика" },
  { key: "english", label: "Английский" },
  { key: "ukrainian", label: "Украинский язык" },
  { key: "physics", label: "Физика" },
  { key: "piano", label: "Пианино" },
];

function mainMenu(role) {
  if (role === "teacher") {
    return Markup.inlineKeyboard([
      [Markup.button.callback("Заполнить анкету", "T_PROFILE")],
      [Markup.button.callback("Продвижение (ТОП)", "T_PROMO")],
    ]);
  }
  if (role === "student") {
    return Markup.inlineKeyboard([
      [Markup.button.callback("Найти репетитора", "S_SEARCH")],
    ]);
  }
  return Markup.inlineKeyboard([
    [Markup.button.callback("Я учитель", "ROLE_TEACHER")],
    [Markup.button.callback("Я ученик", "ROLE_STUDENT")],
  ]);
}

function subjectsKeyboard(prefix) {
  return Markup.inlineKeyboard(
    SUBJECTS.map((s) => [Markup.button.callback(s.label, `${prefix}_${s.key}`)])
  );
}

bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const data = state.get(userId) || {};
  state.set(userId, data);

  await ctx.reply("Главное меню:", mainMenu(data.role));
});

bot.action("ROLE_TEACHER", async (ctx) => {
  const userId = ctx.from.id;
  state.set(userId, { ...(state.get(userId) || {}), role: "teacher" });

  await ctx.answerCbQuery();
  await ctx.editMessageText("Роль сохранена: Учитель ✅\n\nГлавное меню:", mainMenu("teacher"));
});

bot.action("ROLE_STUDENT", async (ctx) => {
  const userId = ctx.from.id;
  state.set(userId, { ...(state.get(userId) || {}), role: "student" });

  await ctx.answerCbQuery();
  await ctx.editMessageText("Роль сохранена: Ученик ✅\n\nГлавное меню:", mainMenu("student"));
});

// === Ученик: поиск ===
bot.action("S_SEARCH", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText("Выбери предмет:", subjectsKeyboard("S_SUBJECT"));
});

bot.action(/S_SUBJECT_(.+)/, async (ctx) => {
  const userId = ctx.from.id;
  const subject = ctx.match[1];
  state.set(userId, { ...(state.get(userId) || {}), subject });

  const subjLabel = SUBJECTS.find((s) => s.key === subject)?.label || subject;

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `Ок. Предмет: ${subjLabel} ✅\n\n(Следующий шаг: фильтры + выдача + ТОП-блок)`,
    Markup.inlineKeyboard([[Markup.button.callback("⬅️ В меню", "BACK_MENU")]])
  );
});

// === Учитель: анкета (пока только выбор предмета) ===
bot.action("T_PROFILE", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText("Анкета учителя — выбери основной предмет:", subjectsKeyboard("T_SUBJECT"));
});

bot.action(/T_SUBJECT_(.+)/, async (ctx) => {
  const userId = ctx.from.id;
  const subject = ctx.match[1];
  state.set(userId, { ...(state.get(userId) || {}), subject });

  const subjLabel = SUBJECTS.find((s) => s.key === subject)?.label || subject;

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `Анкета: предмет установлен — ${subjLabel} ✅\n\n(Следующий шаг: цена, описание, график)`,
    Markup.inlineKeyboard([[Markup.button.callback("⬅️ В меню", "BACK_MENU")]])
  );
});

// === Продвижение (заглушка) ===
bot.action("T_PROMO", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    "Продвижение (ТОП)\n\n(Следующий шаг: выбрать предмет → выбрать срок 7/30/90 → оплата Stars/карта)",
    Markup.inlineKeyboard([[Markup.button.callback("⬅️ В меню", "BACK_MENU")]])
  );
});

bot.action("BACK_MENU", async (ctx) => {
  const userId = ctx.from.id;
  const role = state.get(userId)?.role;

  await ctx.answerCbQuery();
  await ctx.editMessageText("Главное меню:", mainMenu(role));
});

bot.launch();
console.log("Bot is running...");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));