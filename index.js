require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");

const bot = new Telegraf(process.env.BOT_TOKEN);

// временное хранение (потом заменим на БД)
const state = new Map(); // key: tg_user_id -> { role, subject, teacher: { price } }

const SUBJECTS = [
  { key: "math", label: "Математика" },
  { key: "english", label: "Английский" },
  { key: "ukrainian", label: "Украинский язык" },
  { key: "physics", label: "Физика" },
  { key: "piano", label: "Пианино" },
];

function getUser(ctx) {
  const userId = ctx.from.id;
  const data = state.get(userId) || {};
  state.set(userId, data);
  return { userId, data };
}

function mainMenu(role) {
  if (role === "teacher") {
    return Markup.inlineKeyboard([
      [Markup.button.callback("Заполнить анкету", "T_PROFILE")],
      [Markup.button.callback("Продвижение (ТОП)", "T_PROMO")],
    ]);
  }
  if (role === "student") {
    return Markup.inlineKeyboard([[Markup.button.callback("Найти репетитора", "S_SEARCH")]]);
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
  const { data } = getUser(ctx);
  await ctx.reply("Главное меню:", mainMenu(data.role));
});

bot.action("ROLE_TEACHER", async (ctx) => {
  const { userId, data } = getUser(ctx);
  state.set(userId, { ...data, role: "teacher" });

  await ctx.answerCbQuery();
  await ctx.editMessageText("Роль сохранена: Учитель ✅\n\nГлавное меню:", mainMenu("teacher"));
});

bot.action("ROLE_STUDENT", async (ctx) => {
  const { userId, data } = getUser(ctx);
  state.set(userId, { ...data, role: "student" });

  await ctx.answerCbQuery();
  await ctx.editMessageText("Роль сохранена: Ученик ✅\n\nГлавное меню:", mainMenu("student"));
});

// ===== Ученик: поиск =====
bot.action("S_SEARCH", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText("Выбери предмет:", subjectsKeyboard("S_SUBJECT"));
});

bot.action(/S_SUBJECT_(.+)/, async (ctx) => {
  const { userId, data } = getUser(ctx);
  const subject = ctx.match[1];
  state.set(userId, { ...data, subject });

  const subjLabel = SUBJECTS.find((s) => s.key === subject)?.label || subject;

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `Ок. Предмет: ${subjLabel} ✅\n\n(Следующий шаг: фильтры + выдача + ТОП-блок)`,
    Markup.inlineKeyboard([[Markup.button.callback("⬅️ В меню", "BACK_MENU")]])
  );
});

// ===== Учитель: анкета =====
bot.action("T_PROFILE", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText("Анкета учителя — выбери основной предмет:", subjectsKeyboard("T_SUBJECT"));
});

bot.action(/T_SUBJECT_(.+)/, async (ctx) => {
  const { userId, data } = getUser(ctx);
  const subject = ctx.match[1];

  const next = {
    ...data,
    subject,
    step: "T_WAIT_PRICE",
    teacher: { ...(data.teacher || {}) },
  };
  state.set(userId, next);

  const subjLabel = SUBJECTS.find((s) => s.key === subject)?.label || subject;

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `Анкета: предмет — ${subjLabel} ✅\n\nТеперь введи цену за 60 минут (только число, грн). Например: 400`,
    Markup.inlineKeyboard([[Markup.button.callback("⬅️ В меню", "BACK_MENU")]])
  );
});

// Ловим текст, когда ожидаем цену
bot.on("text", async (ctx) => {
  const { userId, data } = getUser(ctx);

  // если мы не в шаге цены — игнорируем
  if (data.step !== "T_WAIT_PRICE") return;

  const raw = (ctx.message.text || "").trim();

  // достаём число (разрешим "400", "400 грн", "400uah")
  const num = parseInt(raw.replace(/[^\d]/g, ""), 10);

  if (!Number.isFinite(num) || num <= 0) {
    await ctx.reply("Не понял цену. Напиши только число, например: 400");
    return;
  }

  const updated = {
    ...data,
    step: undefined,
    teacher: { ...(data.teacher || {}), price: num },
  };
  state.set(userId, updated);

  await ctx.reply(
    `Цена сохранена ✅ ${num} грн / 60 мин\n\n(Следующий шаг: описание + опыт + расписание)`,
    mainMenu("teacher")
  );
});

// ===== Продвижение (заглушка) =====
bot.action("T_PROMO", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    "Продвижение (ТОП)\n\n(Следующий шаг: выбрать предмет → выбрать срок 7/30/90 → оплата Stars/карта)",
    Markup.inlineKeyboard([[Markup.button.callback("⬅️ В меню", "BACK_MENU")]])
  );
});

bot.action("BACK_MENU", async (ctx) => {
  const { data } = getUser(ctx);
  await ctx.answerCbQuery();
  await ctx.editMessageText("Главное меню:", mainMenu(data.role));
});

bot.launch();
console.log("Bot is running...");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));