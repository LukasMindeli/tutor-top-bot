const { Markup } = require("telegraf");
const { supabase } = require("./supabase");
const { fmtDate } = require("./helpers");

async function listTeacherSubjects(teacherId) {
  const { data, error } = await supabase
    .from("teacher_subjects")
    .select("subject")
    .eq("teacher_id", String(teacherId))
    .order("subject", { ascending: true });
  if (error) return [];
  return (data || []).map(r => r.subject).filter(Boolean);
}

async function addPromo(teacherId, subject, expiresAt) {
  await supabase.from("teacher_promos").insert({
    telegram_id: String(teacherId),
    subject,
    expires_at: expiresAt,
    charge_id: "admin_free",
  });
}

function registerAdminTopGive(bot, deps) {
  const { getSession } = deps;
  const ADMIN_ID = String(process.env.ADMIN_TELEGRAM_ID || "");

  function isAdminAuthed(ctx) {
    if (!ADMIN_ID) return false;
    if (String(ctx.from?.id) !== String(ADMIN_ID)) return false;
    const s = getSession(ctx.from.id);
    return Number.isFinite(s.adminAuthedUntil) && s.adminAuthedUntil > Date.now();
  }

  bot.command("topgive", async (ctx) => {
    if (!isAdminAuthed(ctx)) return ctx.reply("Адмін: спочатку /admin і пароль.");

    const parts = (ctx.message.text || "").trim().split(/\s+/);
    const teacherId = parts[1];
    const days = parseInt(parts[2], 10);

    if (!teacherId || !Number.isFinite(days) || days <= 0) {
      return ctx.reply("Формат: /topgive <teacherId> <days>\nНапр: /topgive 123456789 7");
    }

    const subs = await listTeacherSubjects(teacherId);
    if (!subs.length) return ctx.reply("У вчителя немає предметів.");

    const s = getSession(ctx.from.id);
    s._topgive = { teacherId, days, subs };

    const rows = subs.slice(0, 25).map((subj, i) => [Markup.button.callback(subj, `A_TOPGIVE_${i}`)]);
    await ctx.reply(`Обери предмет для ТОП (вчитель ${teacherId}, ${days} днів):`, Markup.inlineKeyboard(rows));
  });

  bot.action(/A_TOPGIVE_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!isAdminAuthed(ctx)) return ctx.reply("Адмін: спочатку /admin і пароль.");

    const s = getSession(ctx.from.id);
    if (!s._topgive) return;

    const i = parseInt(ctx.match[1], 10);
    const subj = s._topgive.subs?.[i];
    if (!subj) return;

    const expiresAt = new Date(Date.now() + s._topgive.days * 24 * 60 * 60 * 1000).toISOString();
    await addPromo(s._topgive.teacherId, subj, expiresAt);

    await ctx.reply(`✅ ТОП видано\nВчитель: ${s._topgive.teacherId}\nПредмет: ${subj}\nДо: ${fmtDate(expiresAt)}`);
    s._topgive = null;
  });
}

module.exports = { registerAdminTopGive };
