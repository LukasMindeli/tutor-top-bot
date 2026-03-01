const { Markup } = require("telegraf");
const { supabase } = require("./supabase");

function normalizeList(x) {
  if (Array.isArray(x)) return x;
  if (!x) return [];
  return [];
}

async function listTeacherSubjects(teacherId) {
  const { data, error } = await supabase
    .from("teacher_subjects")
    .select("subject")
    .eq("teacher_id", String(teacherId))
    .order("subject", { ascending: true });

  if (error) {
    console.error("listTeacherSubjects error:", error.message);
    return [];
  }
  return (data || []).map(r => r.subject).filter(Boolean);
}

async function addTeacherSubject(teacherId, subject) {
  const tid = String(teacherId);
  const subj = String(subject || "").trim();
  if (!subj) return;

  const { error } = await supabase
    .from("teacher_subjects")
    .insert({ teacher_id: tid, subject: subj });

  // игнорируем дубль
  if (error && !String(error.message).toLowerCase().includes("duplicate")) {
    console.error("addTeacherSubject error:", error.message);
  }
}

async function removeTeacherSubject(teacherId, subject) {
  const tid = String(teacherId);
  const subj = String(subject || "").trim();
  if (!subj) return;

  await supabase.from("teacher_subjects").delete().eq("teacher_id", tid).eq("subject", subj);
  // убираем ТОП по этому предмету, чтобы не висел "мертвый"
  await supabase.from("teacher_promos").delete().eq("telegram_id", tid).eq("subject", subj);
}

function registerSubjectsManage(bot, deps) {
  const { ui, getSession, SUBJECT_LABELS, searchSubjects } = deps;

  bot.action("T_SUBJECTS_MENU", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") return;

    const list = await listTeacherSubjects(ctx.from.id);
    s._subjList = list;

    const rows = [];
    if (list.length) {
      list.slice(0, 25).forEach((subj, i) => rows.push([Markup.button.callback(`🗑 ${subj}`, `T_SUBJ_RM_${i}`)]));
    }
    rows.push([Markup.button.callback("➕ Додати предмет", "T_SUBJ_ADD")]);
    rows.push([Markup.button.callback("⬅️ В меню", "BACK_MENU")]);

    await ctx.editMessageText(
      `📚 Мої предмети\n\n${list.length ? "Натисни на предмет, щоб прибрати його." : "Поки що немає предметів."}`,
      Markup.inlineKeyboard(rows)
    );
  });

  bot.action("T_SUBJ_ADD", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") return;

    s.step = "T_SUBJ_QUERY";
    await ctx.editMessageText("Введи предмет текстом (наприклад: «Математика», «Програмування»):", ui.backMenuKeyboard());
  });

  bot.on("text", async (ctx, next) => {
    const s = getSession(ctx.from.id);
    if (s.step !== "T_SUBJ_QUERY") return next();

    const q = (ctx.message.text || "").trim();
    if (!q || q.startsWith("/")) return;

    const matches = (searchSubjects ? normalizeList(searchSubjects(q)) : [])
      .slice(0, 12);

    const fallback = (matches.length ? matches : (normalizeList(SUBJECT_LABELS).filter(x =>
      String(x).toLowerCase().includes(q.toLowerCase())
    ).slice(0, 12)));

    s.step = null;
    s._subjMatches = fallback;

    if (!fallback.length) {
      await ctx.reply("Не знайшов предмет. Спробуй іншу назву.", ui.backMenuKeyboard());
      return;
    }

    const rows = fallback.map((subj, i) => [Markup.button.callback(subj, `T_SUBJ_PICK_${i}`)]);
    rows.push([Markup.button.callback("⬅️ Назад", "T_SUBJECTS_MENU")]);
    await ctx.reply("Обери предмет зі списку:", Markup.inlineKeyboard(rows));
  });

  bot.action(/T_SUBJ_PICK_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") return;

    const i = parseInt(ctx.match[1], 10);
    const subj = s._subjMatches?.[i];
    if (!subj) return ctx.reply("Помилка. Спробуй ще раз.");

    await addTeacherSubject(ctx.from.id, subj);
    await ctx.reply(`✅ Додано предмет: ${subj}`, ui.backMenuKeyboard());
  });

  bot.action(/T_SUBJ_RM_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") return;

    const i = parseInt(ctx.match[1], 10);
    const subj = s._subjList?.[i];
    if (!subj) return;

    await removeTeacherSubject(ctx.from.id, subj);
    // перерисуем экран
    const list = await listTeacherSubjects(ctx.from.id);
    s._subjList = list;

    const rows = [];
    if (list.length) list.slice(0, 25).forEach((x, j) => rows.push([Markup.button.callback(`🗑 ${x}`, `T_SUBJ_RM_${j}`)]));
    rows.push([Markup.button.callback("➕ Додати предмет", "T_SUBJ_ADD")]);
    rows.push([Markup.button.callback("⬅️ В меню", "BACK_MENU")]);

    await ctx.editMessageText(
      `📚 Мої предмети\n\n${list.length ? "Натисни на предмет, щоб прибрати його." : "Поки що немає предметів."}`,
      Markup.inlineKeyboard(rows)
    );
  });
}

module.exports = { registerSubjectsManage };
