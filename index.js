require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");

const bot = new Telegraf(process.env.BOT_TOKEN);

// временно в памяти (потом БД)
const state = new Map(); // tg_user_id -> { role, subject, step, teacher: { price, bio } }

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

function subjLabel(key) {
  return SUBJECTS.find((s) => s.key === key)?.label || key || "—";
}

function teacherCard(data) {
  const t = data.teacher || {};
  const subject = subjLabel(data.subject);
  const price = t.price ? `${t.price} грн / 60 мин` : "—";
  const bio = t.bio ? t.bio : "—";

  return `🧑‍🏫 Моя анкета\n\n` +
    `Предмет: ${subject}\n` +
    `Цена: ${price}\n\n` +
    `Описание:\n${bio}`;
}

function mainMenu(role) {
  if (role === "teacher") {
    return Markup.inlineKeyboard([
      [Markup.button.callback("Заполнить анкету", "T_PROFILE")],
      [Markup.button.callback("Моя анкета", "T_SHOW_PROFILE")],
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

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `Ок. Предмет: ${subjLabel(subject)} ✅\n\n(Следующий шаг: фильтры + выдача + ТОП-блок)`,
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

  state.set(userId, {
    ...data,
    subject,
    step: "T_WAIT_PRICE",
    teacher: { ...(data.teacher || {}) },
  });

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `Анкета: предмет — ${subjLabel(subject)} ✅\n\nТеперь введи цену за 60 минут (только число, грн). Например: 400`,
    Markup.inlineKeyboard([[Markup.button.callback("⬅️ В меню", "BACK_MENU")]])
  );
});

// ===== Учитель: показать анкету =====
bot.action("T_SHOW_PROFILE", async (ctx) => {
  const { data } = getUser(ctx);
  await ctx.answerCbQuery();

  await ctx.editMessageText(
    teacherCard(data),
    Markup.inlineKeyboard([[Markup.button.callback("⬅️ В меню", "BACK_MENU")]])
  );
});

// ловим текст для цены/описания
bot.on("text", async (ctx) => {
  const { userId, data } = getUser(ctx);
  const text = (ctx.message.text || "").trim();

  // 1) цена
  if (data.step === "T_WAIT_PRICE") {
    const num = parseInt(text.replace(/[^\d]/g, ""), 10);

    if (!Number.isFinite(num) || num <= 0) {
      await ctx.reply("Не понял цену. Напиши только число, например: 400");
      return;
    }

    state.set(userId, {
      ...data,
      step: "T_WAIT_BIO",
      teacher: { ...(data.teacher || {}), price: num },
    });

    await ctx.reply(
      `Цена сохранена ✅ ${num} грн / 60 мин\n\nТеперь напиши коротко о себе (1–3 предложения).`
    );
    return;
  }

  // 2) описание
  if (data.step === "T_WAIT_BIO") {
    if (text.length < 10) {
      await ctx.reply("Слишком коротко. Напиши хотя бы 1–2 предложения (от 10 символов).");
      return;
    }
    if (text.length > 600) {
      await ctx.reply("Слишком длинно. Уложись до 600 символов.");
      return;
    }

    state.set(userId, {
      ...data,
      step: undefined,
      teacher: { ...(data.teacher || {}), bio: text },
    });

    await ctx.reply("Описание сохранено ✅", mainMenu("teacher"));
    return;
  }
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