const { Telegraf } = require("telegraf");
const ui = require("./ui");
const { wrapStoreWithAdminNotifications } = require("./admin_notify");
const { registerTeacherProfileCard } = require("./profile_multisubject");
const store = require("./store");
const { PROMO_PACKS, LIMITS } = require("./constants");
const { SUBJECT_LABELS } = require("./subjects");
const { searchSubjects } = require("./subjectSearch");

const { registerAdmin } = require("./admin");
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

const bot = new Telegraf(process.env.BOT_TOKEN);
const CARD_PROVIDER_TOKEN = process.env.CARD_PROVIDER_TOKEN || "";
const ADMIN_ID = String(process.env.ADMIN_TELEGRAM_ID || "");

bot.catch((err) => console.error("BOT_ERROR", err));

// runtime session
const session = new Map();
function getSession(userIdRaw) {
  const userId = String(userIdRaw);
  session.set(userId, session.get(userId) || {});
  return session.get(userId);
}

registerTeacherProfileCard(bot, { store, ui, getSession });


async function teacherMenu(userId) {
  const p = await store.getTeacherProfile(userId);
  return ui.mainMenu("teacher", { isActive: !!p?.is_active });
}


// сохраняем meta
bot.use(async (ctx, next) => {
  if (ctx.from?.id) {
    await store.upsertUserMeta(ctx.from.id, ctx.from.first_name, ctx.from.username);
  }
  return next();
});

// уборка (если включено /clean)
bot.use(cleanupMiddleware(getSession));
registerCleanCommands(bot, getSession);

// start
bot.start(async (ctx) => {
  const name = ctx.from?.first_name ? `, ${ctx.from.first_name}` : "";
  await ctx.reply(`Привіт${name}! 👋 Я TutorUA.\n\nДопоможу знайти репетитора або створити анкету вчителя.`);
  await ctx.reply("Хто ти зараз? Обери режим:", ui.modeKeyboard());
});

bot.action("CHOOSE_MODE", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText("Хто ти зараз? Обери режим:", ui.modeKeyboard());
});

bot.action("MODE_TEACHER", async (ctx) => {
  await ctx.answerCbQuery();
  const s = getSession(ctx.from.id);
  s.mode = "teacher";
  await store.setLastMode(ctx.from.id, "teacher");

  // ✅ если анкета уже заполнена — уведомим (и только один раз)

  await ctx.editMessageText("Режим: Вчитель ✅\n\nГоловне меню:", await teacherMenu(ctx.from.id));
});

bot.action("MODE_STUDENT", async (ctx) => {
  await ctx.answerCbQuery();
  const s = getSession(ctx.from.id);
  s.mode = "student";
  await store.setLastMode(ctx.from.id, "student");
  await ctx.editMessageText("Режим: Учень ✅\n\nГоловне меню:", ui.mainMenu("student"));
});

bot.action("BACK_MENU", async (ctx) => {
  await ctx.answerCbQuery();
  const s = getSession(ctx.from.id);

  if (!s.mode) {
    await ctx.editMessageText("Хто ти зараз? Обери режим:", ui.modeKeyboard());
    return;
  }

  if (s.mode === "teacher") {
    // ✅ после заполнения анкеты обычно нажимают "В меню" — тут и прилетит уведомление
    await ctx.editMessageText("Головне меню:", await teacherMenu(ctx.from.id));
  } else {
    await ctx.editMessageText("Головне меню:", ui.mainMenu("student"));
  }
});

// ✅ Уведомление при удалении анкеты (ловим подтверждение и смотрим что удалилось)
bot.action("T_DELETE_CONFIRM", async (ctx, next) => {
  const userId = String(ctx.from.id);
  const meta = await store.getUserMeta(userId);
  const profBefore = await store.getTeacherProfile(userId);

  if (next) await next();

  const profAfter = await store.getTeacherProfile(userId);
  if (!profAfter && ADMIN_ID) {
    const uname = meta?.username ? `@${meta.username}` : "—";
    const subj = profBefore?.subject || "—";
    try {
      await bot.telegram.sendMessage(
        ADMIN_ID,
        `🗑️ Видалено анкету (Вчитель)\nID: ${userId}\nІм'я: ${meta?.first_name || "—"}\nUsername: ${uname}\nПредмет: ${subj}`
      );
    } catch (e) {}
  }
});

// modules
registerAdmin(bot, { store, ui, getSession, SUBJECT_LABELS, searchSubjects, PROMO_PACKS });
registerSupport(bot, { ui, getSession });
registerRules(bot, { ui, getSession });
registerSubjectsManage(bot, { store, ui, getSession, SUBJECT_LABELS, searchSubjects });
registerPromo(bot, { store, ui, getSession });
registerAdminTopGive(bot, { store, ui, getSession });
registerPhotos(bot, { store, ui, getSession });
registerProofs(bot, { store, ui, getSession });

registerPromo(bot, { store, ui, getSession });
registerSubjectsManage(bot, { store, ui, getSession, SUBJECT_LABELS, searchSubjects });
registerAdminTopGive(bot, { store, ui, getSession });

registerTeacher(bot, { store, ui, PROMO_PACKS, LIMITS, CARD_PROVIDER_TOKEN, getSession, SUBJECT_LABELS, searchSubjects });
registerStudent(bot, { store, ui, getSession, SUBJECT_LABELS, searchSubjects });
registerRequests(bot, { store, ui, getUserSession: getSession, LIMITS, CARD_PROVIDER_TOKEN });
registerPayments(bot, { store, ui, getSession, CARD_PROVIDER_TOKEN });

bot.launch();
console.log("Bot is running...");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
