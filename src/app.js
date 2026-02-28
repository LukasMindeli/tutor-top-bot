const { Telegraf } = require("telegraf");
const ui = require("./ui");
const { loadDB, saveDB } = require("./db");
const { SUBJECTS, PROMO_PACKS, LIMITS } = require("./constants");
const { SUBJECT_LABELS } = require("./subjects");
const { searchSubjects } = require("./subjectSearch");
const { ensureUser } = require("./helpers");

const { registerTeacher } = require("./teacher");
const { registerStudent } = require("./student");
const { registerPayments } = require("./payments");
const { registerRequests } = require("./requests");

const bot = new Telegraf(process.env.BOT_TOKEN);

// оплата карткою (опціонально)
const CARD_PROVIDER_TOKEN = process.env.CARD_PROVIDER_TOKEN || "";

// DB
const db = loadDB();
function persist() { saveDB(db); }

// runtime session
const session = new Map(); // userId -> { mode, step, pendingPromo, lastStudentSubject }
function getSession(userIdRaw) {
  const userId = String(userIdRaw);
  session.set(userId, session.get(userId) || {});
  return session.get(userId);
}
function getUser(userIdRaw) {
  const u = ensureUser(db, userIdRaw);
  return u;
}

// зберігаємо meta
bot.use(async (ctx, next) => {
  if (ctx.from?.id) {
    const u = getUser(ctx.from.id);
    u.meta.first_name = ctx.from.first_name || u.meta.first_name;
    u.meta.username = ctx.from.username || u.meta.username;
    persist();
  }
  return next();
});

// /start завжди питає режим
bot.start(async (ctx) => {
  await ctx.reply("Хто ти зараз? Обери режим:", ui.modeKeyboard());
});

// кнопка зміни режиму
bot.action("CHOOSE_MODE", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText("Хто ти зараз? Обери режим:", ui.modeKeyboard());
});

// вибір режиму
bot.action("MODE_TEACHER", async (ctx) => {
  const s = getSession(ctx.from.id);
  s.mode = "teacher";

  const u = getUser(ctx.from.id);
  u.lastMode = "teacher";
  persist();

  await ctx.answerCbQuery();
  await ctx.editMessageText("Режим: Вчитель ✅\n\nГоловне меню:", ui.mainMenu("teacher"));
});

bot.action("MODE_STUDENT", async (ctx) => {
  const s = getSession(ctx.from.id);
  s.mode = "student";

  const u = getUser(ctx.from.id);
  u.lastMode = "student";
  persist();

  await ctx.answerCbQuery();
  await ctx.editMessageText("Режим: Учень ✅\n\nГоловне меню:", ui.mainMenu("student"));
});

// повернення в меню поточного режиму
bot.action("BACK_MENU", async (ctx) => {
  const s = getSession(ctx.from.id);
  const u = getUser(ctx.from.id);

  await ctx.answerCbQuery();

  const mode = s.mode || u.lastMode;
  if (!mode) {
    await ctx.editMessageText("Хто ти зараз? Обери режим:", ui.modeKeyboard());
    return;
  }

  await ctx.editMessageText("Головне меню:", ui.mainMenu(mode));
});

// реєстрація модулів
registerTeacher(bot, {
  db, persist, ui, SUBJECTS, PROMO_PACKS, LIMITS, CARD_PROVIDER_TOKEN, getUser, getSession, SUBJECT_LABELS, searchSubjects
});
registerStudent(bot, { db, ui, getSession, SUBJECT_LABELS, searchSubjects });
registerRequests(bot, { db, persist, ui, getUser, getSession, LIMITS });
registerPayments(bot, { db, persist, ui, getSession });

bot.launch();
console.log("Bot is running...");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
