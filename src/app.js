const { Telegraf } = require("telegraf");
const ui = require("./ui");
const store = require("./store");
const { PROMO_PACKS, LIMITS } = require("./constants");
const { SUBJECT_LABELS } = require("./subjects");
const { searchSubjects } = require("./subjectSearch");

const { registerAdmin } = require("./admin");
const { registerTeacher } = require("./teacher");
const { registerStudent } = require("./student");
const { registerRequests } = require("./requests");
const { registerProofs } = require("./proofs");
const { registerPayments } = require("./payments");
const { cleanupMiddleware, registerCleanCommands } = require("./clean");

const bot = new Telegraf(process.env.BOT_TOKEN);
const CARD_PROVIDER_TOKEN = process.env.CARD_PROVIDER_TOKEN || "";

// runtime session
const session = new Map();
function getSession(userIdRaw) {
  const userId = String(userIdRaw);
  session.set(userId, session.get(userId) || {});
  return session.get(userId);
}

// middleware: сохраняем meta в supabase
bot.use(async (ctx, next) => {
  if (ctx.from?.id) {
    await store.upsertUserMeta(ctx.from.id, ctx.from.first_name, ctx.from.username);
  }
  return next();
});

bot.use(cleanupMiddleware(getSession));


bot.command("myid", async (ctx) => {
  await ctx.reply(`Твій Telegram ID: ${ctx.from.id}`);

registerCleanCommands(bot, getSession);

});

bot.start(async (ctx) => {
  await ctx.reply("Хто ти зараз? Обери режим:", ui.modeKeyboard());
});

bot.action("CHOOSE_MODE", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText("Хто ти зараз? Обери режим:", ui.modeKeyboard());
});

bot.action("MODE_TEACHER", async (ctx) => {
  const s = getSession(ctx.from.id);
  s.mode = "teacher";
  await store.setLastMode(ctx.from.id, "teacher");

  await ctx.answerCbQuery();
  await ctx.editMessageText("Режим: Вчитель ✅\n\nГоловне меню:", ui.mainMenu("teacher"));
});

bot.action("MODE_STUDENT", async (ctx) => {
  const s = getSession(ctx.from.id);
  s.mode = "student";
  await store.setLastMode(ctx.from.id, "student");

  await ctx.answerCbQuery();
  await ctx.editMessageText("Режим: Учень ✅\n\nГоловне меню:", ui.mainMenu("student"));
});

bot.action("BACK_MENU", async (ctx) => {
  const s = getSession(ctx.from.id);
  await ctx.answerCbQuery();

  if (!s.mode) {
    await ctx.editMessageText("Хто ти зараз? Обери режим:", ui.modeKeyboard());
    return;
  }

  await ctx.editMessageText("Головне меню:", ui.mainMenu(s.mode));
});

// админ первым
registerAdmin(bot, { store, ui, getSession, SUBJECT_LABELS, searchSubjects, PROMO_PACKS });

registerProofs(bot, { store, ui, getSession });

// остальное
registerTeacher(bot, { store, ui, PROMO_PACKS, LIMITS, CARD_PROVIDER_TOKEN, getSession, SUBJECT_LABELS, searchSubjects });
registerStudent(bot, { store, ui, getSession, SUBJECT_LABELS, searchSubjects });
registerRequests(bot, { store, ui, getUserSession: getSession, LIMITS, CARD_PROVIDER_TOKEN });
registerPayments(bot, { store, ui, getSession, CARD_PROVIDER_TOKEN });

bot.launch();
console.log("Bot is running...");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
