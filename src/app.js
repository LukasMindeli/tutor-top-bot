const { Telegraf } = require("telegraf");
const ui = require("./ui");
const store = require("./store");

async function teacherMenu(userId) {
  const p = await store.getTeacherProfile(userId);
  return ui.mainMenu("teacher", { isActive: !!p?.is_active });
}
const { PROMO_PACKS, LIMITS } = require("./constants");
const { SUBJECT_LABELS } = require("./subjects");
const { searchSubjects } = require("./subjectSearch");

const { replyBottom } = require("./respond");

const { registerAdmin } = require("./admin");
const { registerTeacher } = require("./teacher");
const { registerStudent } = require("./student");
const { registerRequests } = require("./requests");
const { registerPayments } = require("./payments");
const { registerSupport } = require("./support");
const { registerPhotos } = require("./photos");
const { registerProofs } = require("./proofs");
const { registerPromo } = require("./promo");
const { registerTeacherNotify } = require("./teacher_notify");
const { registerRules } = require("./rules");
const { cleanupMiddleware, registerCleanCommands } = require("./clean");

const bot = new Telegraf(process.env.BOT_TOKEN);
const CARD_PROVIDER_TOKEN = process.env.CARD_PROVIDER_TOKEN || "";

// чтобы бот не "падал молча"
bot.catch((err) => console.error("BOT_ERROR", err));

// runtime session
const session = new Map();
function getSession(userIdRaw) {
  const userId = String(userIdRaw);
  session.set(userId, session.get(userId) || {});
  return session.get(userId);
}

// сохраняем meta
bot.use(async (ctx, next) => {
  if (ctx.from?.id) {
    await store.upsertUserMeta(ctx.from.id, ctx.from.first_name, ctx.from.username);
  }
  return next();
});

// уборка чата (если включено /clean)
bot.use(cleanupMiddleware(getSession));
registerCleanCommands(bot, getSession);

// util
bot.command("myid", async (ctx) => {
  await ctx.reply(`Твій Telegram ID: ${ctx.from.id}`);
});

// старт
bot.start(async (ctx) => {
  const name = ctx.from?.first_name ? `, ${ctx.from.first_name}` : "";
  const text =
    `Привіт${name}! 👋 Я TutorUA.\n\n` +
    `Допоможу знайти репетитора або створити анкету вчителя.\n` +
    `Обери роль нижче — і я проведу тебе крок за кроком 😊`;
  await ctx.reply(text);
  await ctx.reply("Хто ти зараз? Обери режим:", ui.modeKeyboard());
});

// смена роли — ответ всегда снизу
bot.action("CHOOSE_MODE", async (ctx) => {
  await replyBottom(ctx, "Хто ти зараз? Обери режим:", ui.modeKeyboard());
});

// teacher mode — ответ снизу
bot.action("MODE_TEACHER", async (ctx) => {
  const s = getSession(ctx.from.id);
  s.mode = "teacher";
  await store.setLastMode(ctx.from.id, "teacher");

  await replyBottom(ctx, "Режим: Вчитель ✅\n\nГоловне меню:", await teacherMenu(ctx.from.id));
});

// student mode — ответ снизу
bot.action("MODE_STUDENT", async (ctx) => {
  const s = getSession(ctx.from.id);
  s.mode = "student";
  await store.setLastMode(ctx.from.id, "student");

  await replyBottom(ctx, "Режим: Учень ✅\n\nГоловне меню:", ui.mainMenu("student"));
});

// back menu — снизу
bot.action("BACK_MENU", async (ctx) => {
  const s = getSession(ctx.from.id);
  if (!s.mode) {
    await replyBottom(ctx, "Хто ти зараз? Обери режим:", ui.modeKeyboard());
    return;
  }
  await replyBottom(ctx, "Головне меню:", ui.mainMenu(s.mode));
});

// модули
registerAdmin(bot, { store, ui, getSession, SUBJECT_LABELS, searchSubjects, PROMO_PACKS });
registerSupport(bot, { ui, getSession });
registerRules(bot, { ui, getSession });
registerPhotos(bot, { store, ui, getSession });
registerProofs(bot, { store, ui, getSession });
registerPromo(bot, { store, ui, getSession });
registerTeacherNotify(bot, { store, ui, getSession });

registerTeacher(bot, { store, ui, PROMO_PACKS, LIMITS, CARD_PROVIDER_TOKEN, getSession, SUBJECT_LABELS, searchSubjects });
registerStudent(bot, { store, ui, getSession, SUBJECT_LABELS, searchSubjects });
registerRequests(bot, { store, ui, getUserSession: getSession, LIMITS, CARD_PROVIDER_TOKEN });
registerPayments(bot, { store, ui, getSession, CARD_PROVIDER_TOKEN });

bot.launch();
console.log("Bot is running...");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
