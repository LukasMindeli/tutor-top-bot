const { Markup } = require("telegraf");
const { isPromoActive, fmtDate } = require("./helpers");

function buildMatchesKeyboard(prefixPick, moreCb, page, hasMore) {
  const rows = page.map((m) => [Markup.button.callback(m.label, `${prefixPick}_${m.idx}`)]);
  if (hasMore) rows.push([Markup.button.callback("Показати ще", moreCb)]);
  rows.push([Markup.button.callback("⬅️ В меню", "BACK_MENU")]);
  return Markup.inlineKeyboard(rows);
}

function truncateBio(bio, maxLen = 450) {
  const s = String(bio || "").trim();
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + "…";
}

function teacherCardForStudentUA(teacherUser) {
  const name = teacherUser.meta?.first_name || "Вчитель";
  const subj = teacherUser.teacher?.subject || "—";
  const price = teacherUser.teacher?.price ? `${teacherUser.teacher.price} грн / 60 хв` : "—";
  const bio = truncateBio(teacherUser.teacher?.bio || "—");

  const photo = teacherUser.teacher?.photoFileId ? "✅ Є" : "—";

  const isTop = subj ? isPromoActive(teacherUser, subj) : false;
  const until = isTop ? teacherUser.promos?.[subj]?.expiresAt : null;
  const topLine = isTop && until ? `⭐ ТОП активний до ${fmtDate(until)}\n` : (isTop ? "⭐ ТОП\n" : "");

  return (
    `${topLine}` +
    `👤 ${name}\n` +
    `Предмет: ${subj}\n` +
    `Ціна: ${price}\n` +
    `Фото: ${photo}\n\n` +
    `Опис:\n${bio}`
  );
}

function registerStudent(bot, deps) {
  const { db, ui, getSession, SUBJECT_LABELS, searchSubjects } = deps;

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
    await ctx.editMessageText(
      "Введи предмет (текстом). Наприклад: математика / англ / хімія",
      ui.backMenuKeyboard()
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

  function buildSortedTeacherIds(subjectLabel) {
    const all = Object.entries(db.users).map(([id, u]) => ({ id, u }));

    // базовый фильтр: активные анкеты + совпадение предмета + заполнено
    const candidates = all
      .filter(({ u }) => u.teacher?.isActive)
      .filter(({ u }) => u.teacher?.subject === subjectLabel)
      .filter(({ u }) => u.teacher?.price && u.teacher?.bio);

    const items = candidates.map(({ id, u }) => {
      const isTop = isPromoActive(u, subjectLabel);
      const points = Number.isFinite(u.teacher?.points) ? u.teacher.points : 0; // на будущее
      const name = (u.meta?.first_name || "").toLowerCase();
      return { id, u, isTop, points, name };
    });

    // сортировка: ТОП всегда выше, потом points (пока 0), потом по имени (стабильно)
    items.sort((a, b) =>
      (b.isTop - a.isTop) ||
      (b.points - a.points) ||
      a.name.localeCompare(b.name, "uk")
    );

    return items;
  }

  async function sendTutorsPage(ctx, subjectLabel) {
    const s = getSession(ctx.from.id);

    const list = s.tutorList?.subject === subjectLabel
      ? s.tutorList.items
      : buildSortedTeacherIds(subjectLabel);

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

    // шлём 7 карточек в чат
    for (const it of pageItems) {
      const u = it.u;
      const text = teacherCardForStudentUA(u);

      const kb = Markup.inlineKeyboard([
        [Markup.button.callback("Надіслати заявку", `S_REQ_${it.id}`)],
      ]);

      if (u.teacher?.photoFileId) {
        // caption у фото ограничен, поэтому bio уже урезан
        await ctx.replyWithPhoto(u.teacher.photoFileId, { caption: text, ...kb });
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

  // клик по предмету → сразу выдаём 7 репетиторов в чат
  bot.action(/S_SUBJECT_PICK_(\d+)/, async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "student") { await ctx.answerCbQuery(); return; }

    const idx = parseInt(ctx.match[1], 10);
    const label = SUBJECT_LABELS[idx];

    await ctx.answerCbQuery();
    if (!label) return ctx.reply("Помилка вибору предмета. Спробуй пошук ще раз.");

    s.step = null;
    s.lastStudentSubject = label;
    s.tutorList = null; // сброс пагинации

    // меняем сообщение со списком предметов
    try {
      await ctx.editMessageText(`Показую перших 7 репетиторів по предмету: ${label} ✅`);
    } catch {}

    // если нет анкет — покажем сообщение
    const list = buildSortedTeacherIds(label);
    if (!list.length) {
      await ctx.reply("Поки що немає активних анкет по цьому предмету.", Markup.inlineKeyboard([
        [Markup.button.callback("🔎 Змінити предмет", "S_SEARCH")],
        [Markup.button.callback("⬅️ В меню", "BACK_MENU")],
      ]));
      return;
    }

    // сохраняем список в сессию и шлём первую страницу
    s.tutorList = { subject: label, items: list, offset: 0 };
    await sendTutorsPage(ctx, label);
  });

  // показать следующие 7
  bot.action("S_MORE_7", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "student") { await ctx.answerCbQuery(); return; }

    await ctx.answerCbQuery();

    const subject = s.tutorList?.subject || s.lastStudentSubject;
    if (!subject) {
      await ctx.reply("Спочатку обери предмет.", Markup.inlineKeyboard([
        [Markup.button.callback("🔎 Змінити предмет", "S_SEARCH")],
        [Markup.button.callback("⬅️ В меню", "BACK_MENU")],
      ]));
      return;
    }

    await sendTutorsPage(ctx, subject);
  });

  // ===== text middleware: обработчик ввода предмета =====
  bot.on("text", async (ctx, next) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "student") return next();
    if (s.step !== "S_SUBJECT_QUERY") return next();

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

    const page = all.slice(0, 10);
    const hasMore = all.length > 10;

    await ctx.reply(
      renderSubjectMatchesText(s.subjQuery, 0, all.length),
      buildMatchesKeyboard("S_SUBJECT_PICK", "S_SUBJECT_MORE", page, hasMore)
    );
  });
}

module.exports = { registerStudent };
