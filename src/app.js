const { Telegraf } = require("telegraf");

const ui = require("./ui");
const store = require("./store");

const { PROMO_PACKS, LIMITS } = require("./constants");
const { SUBJECT_LABELS } = require("./subjects");
const { searchSubjects } = require("./subjectSearch");

const { wrapStoreRequestNotifications } = require("./admin_requests_notify");
const { wrapStoreWithAdminNotifications } = require("./admin_notify");

const { registerAdmin } = require("./admin");
const { registerAdminBrowse } = require("./admin_browse"); // ✅ має існувати файл src/admin_browse.js
const { registerTeacher } = require("./teacher");
const { registerStudent } = require("./student");
const { registerRequests } = require("./requests");
const { registerPayments } = require("./payments");
const { registerSupport } = require("./support");
const { registerPhotos } = require("./photos");
const { registerProofs } = require("./proofs");
const { registerRules } = require("./rules");
const { registerPromo } = require("./promo");
const { registerSubjectsManage } = require("./subjects_manage");
const { registerAdminTopGive } = require("./admin_topgive");
const { cleanupMiddleware, registerCleanCommands } = require("./clean");
const { registerTeacherProfileCard } = require("./profile_multisubject");

const ADMIN_ID = String(process.env.ADMIN_TELEGRAM_ID || "");
const CARD_PROVIDER_TOKEN = process.env.CARD_PROVIDER_TOKEN || "";

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.catch((err) => console.error("BOT_ERROR", err));

// ✅ уведомления create/edit/delete анкеты (без дублей)
wrapStoreWithAdminNotifications({ store, bot, adminId: ADMIN_ID });

// ✅ уведомления о заявках в админ-чат
wrapStoreRequestNotifications({ store, bot });

// runtime session
const session = new Map();
function getSession(userIdRaw) {
  const userId = String(userIdRaw);
  session.set(userId, session.get(userId) || {});
  return session.get(userId);
}

// ✅ Сброс любых "режимов ожидания ввода" (чтобы админка не перехватывала ввод Учня)
function resetTransientState(s) {
  // student flow
  s.step = null;
  s.subjQuery = null;
  s.subjOffset = 0;
  s.tutorList = null;
  s.lastStudentSubject = null;

  // promo flow
  s.topSubjQuery = null;
  s.topSubjOffset = 0;
  s.topSubjects = null;
  s.topBuy = null;
  s.topSubject = null;
  s.pendingPromo = null;

  // proof/photo
  s.leadProofReqId = null;

  // admin flow (ВАЖНО!)
  s.adminStep = null;
  s.adminTargetId = null;

  // caches
  s._subjList = null;
  s._subjMatches = null;
  s._topgive = null;

  // admin browse
  s.adminBrowse = null;
}

registerTeacherProfileCard(bot, { store, ui, getSession });

// сохраняем meta + блокировка
bot.use(async (ctx, next) => {
  if (!ctx.from?.id) return next();

  await store.upsertUserMeta(ctx.from.id, ctx.from.first_name, ctx.from.username);

  // кешируем на 60 сек
  const s = getSession(ctx.from.id);
  const now = Date.now();
  if (!s._blockedCheckAt || (now - s._blockedCheckAt) > 60000) {
    const meta = await store.getUserMeta(ctx.from.id);
    s.is_blocked = !!meta?.is_blocked;
    s._blockedCheckAt = now;
  }

  if (s.is_blocked && String(ctx.from.id) !== ADMIN_ID) {
    try { await ctx.reply("⛔ Ви заблоковані адміністратором."); } catch {}
    return;
  }

  return next();
});

// уборка (если включено /clean)
bot.use(cleanupMiddleware(getSession));
registerCleanCommands(bot, getSession);

// start
bot.start(async (ctx) => {
  const s = getSession(ctx.from.id);
  resetTransientState(s);
  s.mode = null;

  const name = ctx.from?.first_name ? `, ${ctx.from.first_name}` : "";
  await ctx.reply(`Привіт${name}! 👋 Я TutorUA.\n\nДопоможу знайти репетитора або створити анкету вчителя.`);
  await ctx.reply("Хто ти зараз? Обери режим:", ui.modeKeyboard());
});

bot.action("CHOOSE_MODE", async (ctx) => {
  await ctx.answerCbQuery();
  const s = getSession(ctx.from.id);
  resetTransientState(s);
  s.mode = null;

  await ctx.editMessageText("Хто ти зараз? Обери режим:", ui.modeKeyboard());
});

bot.action("MODE_TEACHER", async (ctx) => {
  await ctx.answerCbQuery();
  const s = getSession(ctx.from.id);
  resetTransientState(s);
  s.mode = "teacher";

  await store.setLastMode(ctx.from.id, "teacher");
  await ctx.editMessageText("Режим: Вчитель ✅\n\nГоловне меню:", ui.mainMenu("teacher"));
});

bot.action("MODE_STUDENT", async (ctx) => {
  await ctx.answerCbQuery();
  const s = getSession(ctx.from.id);
  resetTransientState(s);
  s.mode = "student";

  await store.setLastMode(ctx.from.id, "student");
  await ctx.editMessageText("Режим: Учень ✅\n\nГоловне меню:", ui.mainMenu("student"));
});

bot.action("BACK_MENU", async (ctx) => {
  await ctx.answerCbQuery();
  const s = getSession(ctx.from.id);

  if (!s.mode) {
    resetTransientState(s);
    await ctx.editMessageText("Хто ти зараз? Обери режим:", ui.modeKeyboard());
    return;
  }

  // важливо: прибираємо адмінські "очікування", щоб не красти ввод предметів
  const mode = s.mode;
  resetTransientState(s);
  s.mode = mode;

  await ctx.editMessageText("Головне меню:", ui.mainMenu(mode));
});

// modules
registerAdmin(bot, { store, ui, getSession, SUBJECT_LABELS, searchSubjects, PROMO_PACKS });
registerAdminBrowse(bot, { store, ui, getSession, SUBJECT_LABELS, searchSubjects, PROMO_PACKS });

registerSupport(bot, { ui, getSession });
registerRules(bot, { ui, getSession });
registerSubjectsManage(bot, { store, ui, getSession, SUBJECT_LABELS, searchSubjects });
registerPromo(bot, { store, ui, getSession });
registerAdminTopGive(bot, { store, ui, getSession });
registerPhotos(bot, { store, ui, getSession });
registerProofs(bot, { store, ui, getSession });

registerTeacher(bot, { store, ui, PROMO_PACKS, LIMITS, CARD_PROVIDER_TOKEN, getSession, SUBJECT_LABELS, searchSubjects });
registerStudent(bot, { store, ui, getSession, SUBJECT_LABELS, searchSubjects });
registerRequests(bot, { store, ui, getUserSession: getSession, LIMITS, CARD_PROVIDER_TOKEN });
registerPayments(bot, { store, ui, getSession, CARD_PROVIDER_TOKEN });

bot.command("chatid", async (ctx) => {
  await ctx.reply(`Chat ID: ${ctx.chat.id}`);
});

module.exports.bot = bot;