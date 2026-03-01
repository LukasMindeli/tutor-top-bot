const { Markup } = require("telegraf");
const { supabase } = require("./supabase");
const { fmtDate } = require("./helpers");

function cleanUserArg(raw) {
  let s = String(raw || "").trim();
  if (!s) return "";
  s = s.replace(/^https?:\/\/t\.me\//i, "");
  s = s.replace(/^t\.me\//i, "");
  s = s.replace(/^@/, "");
  return s.trim();
}

async function resolveTeacherId(arg) {
  const raw = String(arg || "").trim();
  if (!raw) return null;

  // 1) если это цифры — уже telegram_id
  if (/^\d+$/.test(raw)) return raw;

  // 2) иначе это username / @username / t.me/username
  const uname = cleanUserArg(raw);
  if (!uname) return null;

  // username в users хранится без @
  let { data, error } = await supabase
    .from("users")
    .select("telegram_id, username")
    .ilike("username", uname)  // case-insensitive
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("resolveTeacherId error:", error.message);
    return null;
  }

  return data?.telegram_id || null;
}

async function listTeacherSubjectsWithFallback(teacherId) {
  // 1) пробуем нормальную таблицу many-to-many
  const { data, error } = await supabase
    .from("teacher_subjects")
    .select("subject")
    .eq("teacher_id", String(teacherId))
    .order("subject", { ascending: true });

  if (error) {
    console.error("listTeacherSubjects error:", error.message);
    return [];
  }

  const subs = (data || []).map(r => r.subject).filter(Boolean);
  if (subs.length) return subs;

  // 2) fallback: старое поле teacher_profiles.subject (если вдруг учитель ещё не добавлял через 📚 Предмети)
  const { data: prof, error: pErr } = await supabase
    .from("teacher_profiles")
    .select("subject")
    .eq("telegram_id", String(teacherId))
    .maybeSingle();

  if (pErr) {
    console.error("fallback teacher_profiles.subject error:", pErr.message);
    return [];
  }

  const one = String(prof?.subject || "").trim();
  if (!one) return [];

  // сразу мигрируем в teacher_subjects, чтобы дальше всё работало
  try {
    await supabase.from("teacher_subjects").insert({ teacher_id: String(teacherId), subject: one });
  } catch (e) {}

  return [one];
}

async function addPromo(teacherId, subject, expiresAt) {
  const { error } = await supabase.from("teacher_promos").insert({
    telegram_id: String(teacherId),
    subject,
    expires_at: expiresAt,
    charge_id: "admin_free",
  });
  if (error) console.error("addPromo error:", error.message);
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

  // /topgive <teacherId|@username|t.me/username> <days>
  bot.command("topgive", async (ctx) => {
    if (!isAdminAuthed(ctx)) return ctx.reply("Адмін: спочатку /admin і пароль.");

    const parts = (ctx.message.text || "").trim().split(/\s+/);
    const who = parts[1];
    const days = parseInt(parts[2], 10);

    if (!who || !Number.isFinite(days) || days <= 0) {
      return ctx.reply(
        "Формат:\n" +
        "/topgive <teacherId|@username|t.me/username> <days>\n" +
        "Приклади:\n" +
        "/topgive 123456789 7\n" +
        "/topgive @Trongll 7"
      );
    }

    const teacherId = await resolveTeacherId(who);
    if (!teacherId) {
      return ctx.reply("Не знайшов вчителя за цим ID/username. Переконайся, що він вже взаємодіяв з ботом.");
    }

    const subs = await listTeacherSubjectsWithFallback(teacherId);
    if (!subs.length) {
      return ctx.reply(
        "У вчителя немає предметів.\n" +
        "Нехай він додасть їх у «📚 Предмети» (або заповнить анкету), і повтори команду."
      );
    }

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
