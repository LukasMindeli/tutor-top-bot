const { parseNumber, isPromoActive, fmtDate, teacherCardUA, subjLabel } = require("./helpers");
const { sendStarsInvoice, sendCardInvoice } = require("./payments");

function registerTeacher(bot, deps) {
  const { db, persist, ui, SUBJECTS, PROMO_PACKS, LIMITS, CARD_PROVIDER_TOKEN, getUser, getSession } = deps;

  bot.action("T_PROFILE", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") {
      await ctx.answerCbQuery();
      return;
    }

    await ctx.answerCbQuery();
    await ctx.editMessageText(
      "Анкета вчителя — обери предмет:",
      ui.subjectsKeyboard(SUBJECTS, "T_SUBJECT", [[require("telegraf").Markup.button.callback("⬅️ В меню", "BACK_MENU")]])
    );
  });

  bot.action(/T_SUBJECT_(.+)/, async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") return;

    const subject = ctx.match[1];
    const user = getUser(ctx.from.id);

    user.teacher.subject = subject;
    persist();

    s.step = "T_WAIT_PRICE";

    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `Предмет: ${subjLabel(subject)} ✅\n\nВведи ціну за 60 хв (число). Діапазон ${LIMITS.PRICE_MIN}–${LIMITS.PRICE_MAX}.`,
      ui.backMenuKeyboard()
    );
  });

  bot.action("T_SHOW_PROFILE", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") return;

    const user = getUser(ctx.from.id);
    await ctx.answerCbQuery();
    await ctx.editMessageText(teacherCardUA(user), ui.backMenuKeyboard());
  });

  bot.action("T_TOGGLE_ACTIVE", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") return;

    const user = getUser(ctx.from.id);

    // не даємо активувати незаповнену анкету
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
    if (s.mode !== "teacher") return;

    await ctx.answerCbQuery();
    await ctx.editMessageText(
      "⚠️ Видалити анкету?\n\nБуде видалено:\n- предмет, ціна, опис\n- статус активності\n- усі ТОП-статуси\n\nДію не можна скасувати.",
      ui.confirmDeleteKeyboard()
    );
  });

  bot.action("T_DELETE_CONFIRM", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") return;

    const user = getUser(ctx.from.id);

    user.teacher = { subject: null, price: null, bio: null, isActive: false };
    user.promos = {};
    // чистимо заявки на цього вчителя
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
    if (s.mode !== "teacher") return;

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
      `ТОП (як у Buki)\n\nПредмет: ${subjLabel(subject)}\n${line}\n\nОбери термін:`,
      ui.promoPacksKeyboard(PROMO_PACKS)
    );
  });

  bot.action(/PROMO_DAYS_(\d+)/, async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") return;

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
      `Покупка ТОП\n\nПредмет: ${subjLabel(s.pendingPromo.subject)}\nТермін: ${pack.days} днів\nЦіна: ${pack.priceUah} грн або ${pack.priceStars} ⭐\n\nОбери оплату:`,
      ui.promoPayKeyboard()
    );
  });

  bot.action("PROMO_PAY_STARS", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") return;

    await ctx.answerCbQuery();
    if (!s.pendingPromo) return ctx.reply("Спочатку обери термін ТОП.");

    await sendStarsInvoice(ctx, s.pendingPromo);
  });

  bot.action("PROMO_PAY_CARD", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") return;

    await ctx.answerCbQuery();
    if (!s.pendingPromo) return ctx.reply("Спочатку обери термін ТОП.");

    if (!CARD_PROVIDER_TOKEN) {
      await ctx.reply("Оплата карткою поки не налаштована (CARD_PROVIDER_TOKEN).");
      return;
    }

    await sendCardInvoice(ctx, CARD_PROVIDER_TOKEN, s.pendingPromo);
  });

  // текстові кроки анкети (ціна/опис)
  bot.on("text", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") return;

    const user = getUser(ctx.from.id);
    const text = (ctx.message.text || "").trim();

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
}

module.exports = { registerTeacher };
