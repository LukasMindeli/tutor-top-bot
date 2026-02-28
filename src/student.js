const { Markup } = require("telegraf");
const { fmtDate, truncate } = require("./helpers");

function buildMatchesKeyboard(prefixPick, moreCb, page, hasMore) {
  const rows = page.map((m) => [Markup.button.callback(m.label, `${prefixPick}_${m.idx}`)]);
  if (hasMore) rows.push([Markup.button.callback("Показати ще", moreCb)]);
  rows.push([Markup.button.callback("⬅️ В меню", "BACK_MENU")]);
  return Markup.inlineKeyboard(rows);
}

function teacherTextUA(t) {
  const topLine = t.is_top && t.top_until ? `⭐ ТОП активний до ${fmtDate(t.top_until)}\n` : (t.is_top ? "⭐ ТОП\n" : "");
  const name = t.first_name || "Вчитель";
  const price = t.price ? `${t.price} грн / 60 хв` : "—";
  const bio = truncate(t.bio || "—", 450);
  const photo = t.photo_file_id ? "✅ Є" : "—";
  const points = Number.isFinite(t.points) ? t.points : 0;

  return (
    `${topLine}` +
    `👤 ${name}\n` +
    `Предмет: ${t.subject}\n` +
    `Ціна: ${price}\n` +
    `Фото: \nБали: \n\n` +
    `Опис:\n${bio}`
  );
}

function registerStudent(bot, deps) {
  const { store, ui, getSession, SUBJECT_LABELS, searchSubjects } = deps;

  function renderSubjectMatchesText(query, offset, total) {
    return (
      `Введи предмет (текстом). Наприклад: математика / англ / хімія\n\n` +
      `Запит: “${query}”\n` +
      `Знайдено: ${total}\n` +
      `Показую: ${offset + 1}–${Math.min(offset + 10, total)}\n\n` +
      `Обери зі списку:`
    );
  }

  bot.action("S_SEARCH", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "student") { await ctx.answerCbQuery(); return; }

    s.step = "S_SUBJECT_QUERY";
    s.subjQuery = "";
    s.subjOffset = 0;

    await ctx.answerCbQuery();
    await ctx.editMessageText("Введи предмет (текстом). Наприклад: математика / англ / хімія", ui.backMenuKeyboard());
  });

  bot.action("S_SUBJECT_MORE", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "student") { await ctx.answerCbQuery(); return; }

    const all = searchSubjects(SUBJECT_LABELS, s.subjQuery || "");
    await ctx.answerCbQuery();
    if (!all.length) return ctx.reply("Немає результатів. Введи новий запит текстом.");

    s.subjOffset = (s.subjOffset || 0) + 10;
    if (s.subjOffset >= all.length) s.subjOffset = 0;

    const page = all.slice(s.subjOffset, s.subjOffset + 10);
    const hasMore = (s.subjOffset + 10) < all.length;

    await ctx.editMessageText(
      renderSubjectMatchesText(s.subjQuery, s.subjOffset, all.length),
      buildMatchesKeyboard("S_SUBJECT_PICK", "S_SUBJECT_MORE", page, hasMore)
    );
  });

  async function sendTutorsPage(ctx, subjectLabel) {
    const s = getSession(ctx.from.id);

    const list = s.tutorList?.subject === subjectLabel
      ? s.tutorList.items
      : await store.listTeachersBySubject(subjectLabel);

    s.tutorList = s.tutorList?.subject === subjectLabel
      ? s.tutorList
      : { subject: subjectLabel, items: list, offset: 0 };

    const offset = s.tutorList.offset || 0;
    const pageItems = list.slice(offset, offset + 7);

    if (!pageItems.length) {
      await ctx.reply("Більше репетиторів немає.", Markup.inlineKeyboard([
        [Markup.button.callback("🔎 Змінити предмет", "S_SEARCH")],
        [Markup.button.callback("⬅️ В меню", "BACK_MENU")],
      ]));
      return;
    }

    for (const t of pageItems) {
      const text = teacherTextUA(t);
      const kb = Markup.inlineKeyboard([[Markup.button.callback("Надіслати заявку", `S_REQ_${t.telegram_id}`)]]);

      if (t.photo_file_id) {
        await ctx.replyWithPhoto(t.photo_file_id, { caption: text, ...kb });
      } else {
        await ctx.reply(text, kb);
      }
    }

    s.tutorList.offset = offset + pageItems.length;

    const hasMore = s.tutorList.offset < list.length;
    const controls = [];
    if (hasMore) controls.push([Markup.button.callback("Показати ще 7", "S_MORE_7")]);
    controls.push([Markup.button.callback("🔎 Змінити предмет", "S_SEARCH")]);
    controls.push([Markup.button.callback("⬅️ В меню", "BACK_MENU")]);

    await ctx.reply("Далі:", Markup.inlineKeyboard(controls));
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
    s.tutorList = null;

    try { await ctx.editMessageText(`Показую перших 7 репетиторів по предмету: ${label} ✅`); } catch {}

    const list = await store.listTeachersBySubject(label);
    if (!list.length) {
      await ctx.reply("Поки що немає активних анкет по цьому предмету.", Markup.inlineKeyboard([
        [Markup.button.callback("🔎 Змінити предмет", "S_SEARCH")],
        [Markup.button.callback("⬅️ В меню", "BACK_MENU")],
      ]));
      return;
    }

    s.tutorList = { subject: label, items: list, offset: 0 };
    await sendTutorsPage(ctx, label);
  });

  bot.action("S_MORE_7", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "student") { await ctx.answerCbQuery(); return; }

    await ctx.answerCbQuery();

    const subject = s.tutorList?.subject || s.lastStudentSubject;
    if (!subject) return ctx.reply("Спочатку обери предмет.", ui.backMenuKeyboard());

    await sendTutorsPage(ctx, subject);
  });

  bot.on("text", async (ctx, next) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "student") return next();
    if (s.step !== "S_SUBJECT_QUERY") return next();

    const text = (ctx.message.text || "").trim();
    if (text.length < 2) return ctx.reply("Напиши хоча б 2 символи для пошуку.");

    s.subjQuery = text;
    s.subjOffset = 0;

    const all = searchSubjects(SUBJECT_LABELS, s.subjQuery);
    if (!all.length) return ctx.reply("Нічого не знайшов. Спробуй інший запит.");

    const page = all.slice(0, 10);
    const hasMore = all.length > 10;

    await ctx.reply(
      renderSubjectMatchesText(s.subjQuery, 0, all.length),
      buildMatchesKeyboard("S_SUBJECT_PICK", "S_SUBJECT_MORE", page, hasMore)
    );
  });
}

module.exports = { registerStudent };
