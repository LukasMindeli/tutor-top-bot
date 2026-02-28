const { teacherCardForStudentUA, isPromoActive } = require("./helpers");
const { Markup } = require("telegraf");

function registerStudent(bot, deps) {
  const { db, ui, SUBJECTS, getSession } = deps;

  bot.action("S_SEARCH", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "student") {
      await ctx.answerCbQuery();
      return;
    }

    await ctx.answerCbQuery();
    await ctx.editMessageText(
      "Обери предмет:",
      ui.subjectsKeyboard(SUBJECTS, "S_SUBJECT", [[Markup.button.callback("⬅️ В меню", "BACK_MENU")]])
    );
  });

  function listTeachersBySubject(subjectKey) {
    const all = Object.entries(db.users).map(([id, u]) => ({ id, u }));

    const teachers = all
      .filter(({ u }) => u.teacher?.isActive)
      .filter(({ u }) => u.teacher?.subject === subjectKey)
      .filter(({ u }) => u.teacher?.price && u.teacher?.bio);

    const top = teachers.filter(({ u }) => isPromoActive(u, subjectKey));
    const regular = teachers.filter(({ u }) => !isPromoActive(u, subjectKey));

    return { top, regular };
  }

  bot.action(/S_SUBJECT_(.+)/, async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "student") return;

    const subject = ctx.match[1];
    s.lastStudentSubject = subject;

    await ctx.answerCbQuery();

    const { top, regular } = listTeachersBySubject(subject);
    const buttons = [];

    if (top.length) {
      buttons.push([Markup.button.callback("⭐ ТОП репетитори", "S_IGNORE")]);
      top.slice(0, 5).forEach(({ id, u }) => {
        const name = u.meta?.first_name || "Вчитель";
        const price = u.teacher?.price ? `${u.teacher.price}грн` : "";
        buttons.push([Markup.button.callback(`⭐ ${name} — ${price}`, `S_VIEW_${id}`)]);
      });
    }

    if (regular.length) {
      buttons.push([Markup.button.callback("Звичайні", "S_IGNORE")]);
      regular.slice(0, 10).forEach(({ id, u }) => {
        const name = u.meta?.first_name || "Вчитель";
        const price = u.teacher?.price ? `${u.teacher.price}грн` : "";
        buttons.push([Markup.button.callback(`${name} — ${price}`, `S_VIEW_${id}`)]);
      });
    }

    if (!top.length && !regular.length) {
      await ctx.editMessageText("Поки що немає активних анкет по цьому предмету.", ui.backMenuKeyboard());
      return;
    }

    buttons.push([Markup.button.callback("⬅️ В меню", "BACK_MENU")]);

    await ctx.editMessageText("Результати. Обери вчителя:", Markup.inlineKeyboard(buttons));
  });

  bot.action("S_IGNORE", async (ctx) => ctx.answerCbQuery());

  bot.action(/S_VIEW_(\d+)/, async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "student") return;

    const teacherId = String(ctx.match[1]);
    const teacher = db.users[teacherId];

    await ctx.answerCbQuery();
    if (!teacher) return ctx.editMessageText("Вчителя не знайдено.", ui.backMenuKeyboard());

    const text = teacherCardForStudentUA(teacher);

    await ctx.editMessageText(
      text,
      Markup.inlineKeyboard([
        [Markup.button.callback("Надіслати заявку", `S_REQ_${teacherId}`)],
        [Markup.button.callback("⬅️ Назад до списку", `S_SUBJECT_${s.lastStudentSubject || teacher.teacher.subject}`)],
        [Markup.button.callback("⬅️ В меню", "BACK_MENU")],
      ])
    );
  });
}

module.exports = { registerStudent };
