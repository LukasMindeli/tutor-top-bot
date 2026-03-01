const { Markup } = require("telegraf");
const { fmtDate } = require("./helpers");

function registerAdminTopGive(bot, deps) {
  const { store, getSession } = deps;
  const ADMIN_ID = String(process.env.ADMIN_TELEGRAM_ID || "");

  function isAdminAuthed(ctx) {
    if (!ADMIN_ID) return false;
    if (String(ctx.from?.id) !== String(ADMIN_ID)) return false;
    const s = getSession(ctx.from.id);
    return Number.isFinite(s.adminAuthedUntil) && s.adminAuthedUntil > Date.now();
  }

  // /topgive <teacherId> <days>
  bot.command("topgive", async (ctx) => {
    if (!isAdminAuthed(ctx)) return ctx.reply("Адмін: спочатку /admin і пароль.");

    const parts = (ctx.message.text || "").trim().split(/\s+/);
    const teacherId = parts[1];
    const days = parseInt(parts[2], 10);

    if (!teacherId || !Number.isFinite(days) || days <= 0) {
      return ctx.reply("Формат: /topgive <teacherId> <days>\nНапр: /topgive 123456789 7");
    }

    const subjects = await store.listTeacherSubjects(teacherId);
    if (!subjects.length) return ctx.reply("У вчителя немає предметів.");

    const s = getSession(ctx.from.id);
    s.topGive = { teacherId, days, subjects };

    const rows = subjects.slice(0, 20).map((subj, i) => [Markup.button.callback(subj, `A_TOPGIVE_${i}`)]);
    await ctx.reply(`Обери предмет для ТОП (вчитель ${teacherId}, ${days} днів):`, Markup.inlineKeyboard(rows));
  });

  bot.action(/A_TOPGIVE_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!isAdminAuthed(ctx)) return ctx.reply("Адмін: спочатку /admin і пароль.");

    const s = getSession(ctx.from.id);
    if (!s.topGive) return;

    const i = parseInt(ctx.match[1], 10);
    const subj = s.topGive.subjects?.[i];
    if (!subj) return;

    const expiresAt = new Date(Date.now() + s.topGive.days * 24 * 60 * 60 * 1000).toISOString();
    await store.addPromo(String(s.topGive.teacherId), String(subj), expiresAt, "admin_free");

    await ctx.reply(`✅ ТОП видано\nВчитель: ${s.topGive.teacherId}\nПредмет: ${subj}\nДо: ${fmtDate(expiresAt)}`);
    s.topGive = null;
  });
}

module.exports = { registerAdminTopGive };
