const { Markup } = require("telegraf");
const { teacherCardForStudentUA, isPromoActive } = require("./helpers");

function buildMatchesKeyboard(prefixPick, moreCb, matchesPage, hasMore) {
  const rows = matchesPage.map((m) => [Markup.button.callback(m.label, `${prefixPick}_${m.idx}`)]);
  if (hasMore) rows.push([Markup.button.callback("Показати ще", moreCb)]);
  rows.push([Markup.button.callback("⬅️ В меню", "BACK_MENU")]);
  return Markup.inlineKeyboard(rows);
}

function registerStudent(bot, deps) {
  const { db, ui, getSession, SUBJECT_LABELS, searchSubjects } = deps;

  function renderSubjectMatchesText(query, offset, total) {
    return `Введи предмет (текстом). Наприклад: математика / англ / хімія\n\n` +
      `Запит: “${query}”\n` +
      `Знайдено: ${total}\n` +
      `Показую: ${offset + 1}–${Math.min(offset + 10, total)}\n\n` +
      `Обери зі списку:`;
  }

  bot.action("S_SEARCH", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "student") { await ctx.answerCbQuery(); return; }

    s.step = "S_SUBJECT_QUERY";
    s.subjQuery = "";
    s.subjOffset = 0;

    await ctx.answerCbQuery();
    await ctx.editMessageText(
      "Введи предмет (текстом). Наприклад: математика / англ / хімія",
      ui.backMenuKeyboard()
    );
  });

  bot.on("text", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "student") return;

    if (s.step !== "S_SUBJECT_QUERY") return;

    const text = (ctx.message.text || "").trim();
    if (text.length < 2) {
      await ctx.reply("Напиши хоча б 2 символи для пошуку.");
      return;
    }

    s.subjQuery = text;
    s.subjOffset = 0;

    const all = searchSubjects(SUBJECT_LABELS, s.subjQuery);
    if (!all.length) {
      await ctx.reply("Нічого не знайшов. Спробуй інший запит.");
      return;
    }

    const page = all.slice(s.subjOffset, s.subjOffset + 10);
    const hasMore = (s.subjOffset + 10) < all.length;

    await ctx.reply(
      renderSubjectMatchesText(s.subjQuery, s.subjOffset, all.length),
      buildMatchesKeyboard("S_SUBJECT_PICK", "S_SUBJECT_MORE", page, hasMore)
    );
  });

  bot.action("S_SUBJECT_MORE", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "student") { await ctx.answerCbQuery(); return; }

    const all = searchSubjects(SUBJECT_LABELS, s.subjQuery || "");
    await ctx.answerCbQuery();

    if (!all.length) {
      await ctx.reply("Немає результатів. Введи новий запит текстом.");
      return;
    }

    s.subjOffset = (s.subjOffset || 0) + 10;
    if (s.subjOffset >= all.length) s.subjOffset = 0;

    const page = all.slice(s.subjOffset, s.subjOffset + 10);
    const hasMore = (s.subjOffset + 10) < all.length;

    await ctx.editMessageText(
      renderSubjectMatchesText(s.subjQuery, s.subjOffset, all.length),
      buildMatchesKeyboard("S_SUBJECT_PICK", "S_SUBJECT_MORE", page, hasMore)
    );
  });

  function listTeachersBySubject(subjectLabel) {
    const all = Object.entries(db.users).map(([id, u]) => ({ id, u }));

    const teachers = all
      .filter(({ u }) => u.teacher?.isActive)
      .filter(({ u }) => u.teacher?.subject === subjectLabel)
      .filter(({ u }) => u.teacher?.price && u.teacher?.bio);

    const top = teachers.filter(({ u }) => isPromoActive(u, subjectLabel));
    const regular = teachers.filter(({ u }) => !isPromoActive(u, subjectLabel));

    return { top, regular };
  }

  bot.action(/S_SUBJECT_PICK_(\d+)/, async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "student") { await ctx.answerCbQuery(); return; }

    const idx = parseInt(ctx.match[1], 10);
    const label = SUBJECT_LABELS[idx];

    await ctx.answerCbQuery();
    if (!label) return ctx.reply("Помилка вибору предмета. Спробуй пошук ще раз.");

    s.step = null;
    s.lastStudentSubject = label;

    const { top, regular } = listTeachersBySubject(label);
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

    await ctx.editMessageText(
      `Результати по предмету: ${label}\n\nОбери вчителя:`,
      Markup.inlineKeyboard(buttons)
    );
  });

  bot.action("S_IGNORE", async (ctx) => ctx.answerCbQuery());

  bot.action(/S_VIEW_(\d+)/, async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "student") { await ctx.answerCbQuery(); return; }

    const teacherId = String(ctx.match[1]);
    const teacher = db.users[teacherId];

    await ctx.answerCbQuery();
    if (!teacher) return ctx.editMessageText("Вчителя не знайдено.", ui.backMenuKeyboard());

    const text = teacherCardForStudentUA(teacher);

    await ctx.editMessageText(
      text,
      Markup.inlineKeyboard([
        [Markup.button.callback("Надіслати заявку", `S_REQ_${teacherId}`)],
        [Markup.button.callback("⬅️ Назад до списку", "BACK_MENU")],
      ])
    );
  });
}

module.exports = { registerStudent };
