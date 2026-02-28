const { Markup } = require("telegraf");
const { parseNumber, isPromoActive, fmtDate, teacherCardUA, subjLabel } = require("./helpers");
const { sendStarsInvoice, sendCardInvoice } = require("./payments");

function buildMatchesKeyboard(prefixPick, moreCb, matchesPage, hasMore) {
  const rows = matchesPage.map((m) => [Markup.button.callback(m.label, `${prefixPick}_${m.idx}`)]);
  if (hasMore) rows.push([Markup.button.callback("Показати ще", moreCb)]);
  rows.push([Markup.button.callback("⬅️ В меню", "BACK_MENU")]);
  return Markup.inlineKeyboard(rows);
}

function registerTeacher(bot, deps) {
  const { db, persist, ui, PROMO_PACKS, LIMITS, CARD_PROVIDER_TOKEN, getUser, getSession, SUBJECT_LABELS, searchSubjects } = deps;

  function renderSubjectMatchesText(query, offset, total) {
    return `Введи предмет (текстом). Наприклад: математика / англ / хімія\n\n` +
      `Запит: “${query}”\n` +
      `Знайдено: ${total}\n` +
      `Показую: ${offset + 1}–${Math.min(offset + 10, total)}\n\n` +
      `Обери зі списку:`;
  }

  // ===== Фото меню =====
  bot.action("T_PHOTO_MENU", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    const user = getUser(ctx.from.id);
    const has = !!user.teacher.photoFileId;

    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `Фото анкети\n\nСтатус: ${has ? "✅ Є фото" : "— Немає фото"}\n\nЩо робимо?`,
      Markup.inlineKeyboard([
        [Markup.button.callback(has ? "🔄 Замінити фото" : "➕ Додати фото", "T_PHOTO_ADD")],
        ...(has ? [[Markup.button.callback("👁️ Подивитись фото", "T_PHOTO_SHOW")]] : []),
        ...(has ? [[Markup.button.callback("🗑️ Видалити фото", "T_PHOTO_DELETE")]] : []),
        [Markup.button.callback("⬅️ В меню", "BACK_MENU")],
      ])
    );
  });

  bot.action("T_PHOTO_ADD", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    s.step = "T_WAIT_PHOTO";

    await ctx.answerCbQuery();
    await ctx.editMessageText(
      "Надішли одне фото сюди в чат (як звичайне фото в Telegram).",
      ui.backMenuKeyboard()
    );
  });

  bot.action("T_PHOTO_DELETE", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    const user = getUser(ctx.from.id);
    user.teacher.photoFileId = null;
    persist();

    await ctx.answerCbQuery();
    await ctx.editMessageText("Фото видалено ✅", ui.mainMenu("teacher"));
  });

  bot.action("T_PHOTO_SHOW", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    const user = getUser(ctx.from.id);
    await ctx.answerCbQuery();

    if (!user.teacher.photoFileId) {
      await ctx.reply("Фото ще не додано.");
      return;
    }

    await ctx.replyWithPhoto(user.teacher.photoFileId, { caption: "Фото з анкети" });
  });

  // Приём фото
  bot.on("photo", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") return next();
    if (s.step !== "T_WAIT_PHOTO") return;

    const user = getUser(ctx.from.id);
    const arr = ctx.message.photo || [];
    const best = arr[arr.length - 1];
    if (!best?.file_id) {
      await ctx.reply("Не зміг прочитати фото. Спробуй ще раз.");
      return;
    }

    user.teacher.photoFileId = best.file_id;
    persist();

    s.step = null;
    await ctx.reply("Фото збережено ✅", ui.mainMenu("teacher"));
  });

  // ===== анкета — предмет через текст =====
  bot.action("T_PROFILE", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    s.step = "T_SUBJECT_QUERY";
    s.subjQuery = "";
    s.subjOffset = 0;

    await ctx.answerCbQuery();
    await ctx.editMessageText(
      "Введи предмет (текстом). Наприклад: математика / англ / хімія",
      ui.backMenuKeyboard()
    );
  });

  // прийом тексту (пошук предмета / ціна / опис)
  bot.on("text", async (ctx, next) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") return;

    const user = getUser(ctx.from.id);
    const text = (ctx.message.text || "").trim();

    // якщо чекаємо фото — текст ігноруємо
    if (s.step === "T_WAIT_PHOTO") { await ctx.reply("Зараз очікую фото. Надішли фото повідомленням 📷"); return; }

    // 1) пошук предмета
    if (s.step === "T_SUBJECT_QUERY") {
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
        buildMatchesKeyboard("T_SUBJECT_PICK", "T_SUBJECT_MORE", page, hasMore)
      );
      return;
    }

    // 2) ціна
    if (s.step === "T_WAIT_PRICE") {
      const num = parseNumber(text);
      if (num === null) return ctx.reply("Не зрозумів ціну. Напиши число (наприклад 400).");
      if (num < LIMITS.PRICE_MIN || num > LIMITS.PRICE_MAX) {
        return ctx.reply(`Ціна має бути ${LIMITS.PRICE_MIN}–${LIMITS.PRICE_MAX} грн. Напиши ще раз.`);
      }

      user.teacher.price = num;
      persist();

      s.step = "T_WAIT_BIO";
      await ctx.reply(`Ціну збережено ✅ ${num} грн / 60 хв\n\nТепер напиши короткий опис (1–3 речення).`);
      return;
    }

    // 3) опис
    if (s.step === "T_WAIT_BIO") {
      if (text.length < LIMITS.BIO_MIN) return ctx.reply(`Занадто коротко. Мінімум ${LIMITS.BIO_MIN} символів.`);
      if (text.length > LIMITS.BIO_MAX) return ctx.reply(`Занадто довго. Максимум ${LIMITS.BIO_MAX} символів.`);

      user.teacher.bio = text;
      persist();

      s.step = null;
      await ctx.reply("Опис збережено ✅\n\nНатисни «Активна/Пауза», щоб увімкнути анкету в пошуку.", ui.mainMenu("teacher"));
      return;
    }
  });

  // показати ще по пошуку предметів
  bot.action("T_SUBJECT_MORE", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

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
      buildMatchesKeyboard("T_SUBJECT_PICK", "T_SUBJECT_MORE", page, hasMore)
    );
  });

  // вибір предмета
  bot.action(/T_SUBJECT_PICK_(\d+)/, async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    const idx = parseInt(ctx.match[1], 10);
    const label = SUBJECT_LABELS[idx];
    const user = getUser(ctx.from.id);

    await ctx.answerCbQuery();

    if (!label) {
      await ctx.reply("Помилка вибору предмета. Спробуй пошук ще раз.");
      return;
    }

    user.teacher.subject = label;
    persist();

    s.step = "T_WAIT_PRICE";
    await ctx.editMessageText(
      `Предмет: ${label} ✅\n\nВведи ціну за 60 хв (число). Діапазон ${LIMITS.PRICE_MIN}–${LIMITS.PRICE_MAX}.`,
      ui.backMenuKeyboard()
    );
  });

  bot.action("T_SHOW_PROFILE", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    const user = getUser(ctx.from.id);
    await ctx.answerCbQuery();
    await ctx.editMessageText(teacherCardUA(user), ui.backMenuKeyboard());
  });

  bot.action("T_TOGGLE_ACTIVE", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    const user = getUser(ctx.from.id);

    if (!user.teacher.subject || !user.teacher.price || !user.teacher.bio) {
      await ctx.answerCbQuery();
      await ctx.reply("Спочатку заповни анкету (предмет, ціна, опис).");
      return;
    }

    user.teacher.isActive = !user.teacher.isActive;
    persist();

    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `Готово ✅\nАнкета: ${user.teacher.isActive ? "✅ Активна" : "⏸ Пауза"}\n\nГоловне меню:`,
      ui.mainMenu("teacher")
    );
  });

  // видалення анкети
  bot.action("T_DELETE_PROFILE", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    await ctx.answerCbQuery();
    await ctx.editMessageText(
      "⚠️ Видалити анкету?\n\nБуде видалено:\n- предмет, ціна, опис\n- фото\n- статус активності\n- усі ТОП-статуси\n\nДію не можна скасувати.",
      ui.confirmDeleteKeyboard()
    );
  });

  bot.action("T_DELETE_CONFIRM", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    const user = getUser(ctx.from.id);

    user.teacher = { subject: null, price: null, bio: null, isActive: false, photoFileId: null };
    user.promos = {};
    for (const [id, r] of Object.entries(db.requests || {})) {
      if (String(r.teacherId) === String(ctx.from.id)) delete db.requests[id];
    }

    s.step = null;
    persist();

    await ctx.answerCbQuery();
    await ctx.editMessageText("Анкету видалено ✅\n\nГоловне меню:", ui.mainMenu("teacher"));
  });

  // ТОП
  bot.action("T_PROMO", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    const user = getUser(ctx.from.id);
    await ctx.answerCbQuery();

    if (!user.teacher.subject) {
      await ctx.editMessageText("Щоб купити ТОП, спочатку обери предмет в анкеті.", ui.backMenuKeyboard());
      return;
    }

    const subject = user.teacher.subject;
    const line = isPromoActive(user, subject)
      ? `Зараз ТОП активний до: ${fmtDate(user.promos[subject].expiresAt)}`
      : "ТОП зараз не активний";

    await ctx.editMessageText(
      `ТОП (як у Buki)\n\nПредмет: ${subject}\n${line}\n\nОбери термін:`,
      ui.promoPacksKeyboard(PROMO_PACKS)
    );
  });

  bot.action(/PROMO_DAYS_(\d+)/, async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    const days = parseInt(ctx.match[1], 10);
    const pack = PROMO_PACKS.find((p) => p.days === days);
    const user = getUser(ctx.from.id);

    await ctx.answerCbQuery();
    if (!pack || !user.teacher.subject) return ctx.reply("Помилка вибору пакета.");

    s.pendingPromo = {
      subject: user.teacher.subject,
      days: pack.days,
      priceUah: pack.priceUah,
      priceStars: pack.priceStars,
    };

    await ctx.editMessageText(
      `Покупка ТОП\n\nПредмет: ${s.pendingPromo.subject}\nТермін: ${pack.days} днів\nЦіна: ${pack.priceUah} грн або ${pack.priceStars} ⭐\n\nОбери оплату:`,
      ui.promoPayKeyboard()
    );
  });

  bot.action("PROMO_PAY_STARS", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    await ctx.answerCbQuery();
    if (!s.pendingPromo) return ctx.reply("Спочатку обери термін ТОП.");

    await sendStarsInvoice(ctx, s.pendingPromo);
  });

  bot.action("PROMO_PAY_CARD", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    await ctx.answerCbQuery();
    if (!s.pendingPromo) return ctx.reply("Спочатку обери термін ТОП.");

    if (!CARD_PROVIDER_TOKEN) {
      await ctx.reply("Оплата карткою поки не налаштована (CARD_PROVIDER_TOKEN).");
      return;
    }

    await sendCardInvoice(ctx, CARD_PROVIDER_TOKEN, s.pendingPromo);
  });
}

module.exports = { registerTeacher };
