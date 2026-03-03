const { Markup } = require("telegraf");
const { parseNumber, fmtDate, containsPhoneNumber } = require("./helpers");
const { sendStarsInvoice, sendCardInvoice } = require("./payments");

function buildMatchesKeyboard(prefixPick, moreCb, page, hasMore) {
  const rows = page.map((m) => [Markup.button.callback(m.label, `${prefixPick}_${m.idx}`)]);
  if (hasMore) rows.push([Markup.button.callback("Показати ще", moreCb)]);
  rows.push([Markup.button.callback("⬅️ В меню", "BACK_MENU")]);
  return Markup.inlineKeyboard(rows);
}

function registerTeacher(bot, deps) {
  const { store, ui, PROMO_PACKS, LIMITS, CARD_PROVIDER_TOKEN, getSession, SUBJECT_LABELS, searchSubjects } = deps;

  function renderSubjectMatchesText(query, offset, total) {
    return (
      `Введи предмет (текстом). Наприклад: математика / англ / хімія\n\n` +
      `Запит: “${query}”\n` +
      `Знайдено: ${total}\n` +
      `Показую: ${offset + 1}–${Math.min(offset + 10, total)}\n\n` +
      `Обери зі списку:`
    );
  }

  // Фото меню
  bot.action("T_PHOTO_MENU", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    const prof = await store.getTeacherProfile(ctx.from.id);
    const has = !!prof?.photo_file_id;

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
    await ctx.editMessageText("Надішли одне фото сюди в чат (як звичайне фото в Telegram).", ui.backMenuKeyboard());
  });

  bot.action("T_PHOTO_DELETE", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    await store.updateTeacherProfile(ctx.from.id, { photo_file_id: null });

    await ctx.answerCbQuery();
    await ctx.editMessageText("Фото видалено ✅", ui.mainMenu("teacher"));
  });

  bot.action("T_PHOTO_SHOW", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    const prof = await store.getTeacherProfile(ctx.from.id);
    await ctx.answerCbQuery();

    if (!prof?.photo_file_id) return ctx.reply("Фото ще не додано.");
    await ctx.replyWithPhoto(prof.photo_file_id, { caption: "Фото з анкети" });
  });

  bot.on("photo", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") return;
    if (s.step !== "T_WAIT_PHOTO") return;

    const arr = ctx.message.photo || [];
    const best = arr[arr.length - 1];
    if (!best?.file_id) return ctx.reply("Не зміг прочитати фото. Спробуй ще раз.");

    await store.updateTeacherProfile(ctx.from.id, { photo_file_id: best.file_id });

    s.step = null;
    await ctx.reply("Фото збережено ✅", ui.mainMenu("teacher"));
  });

  // анкета — предмет
  bot.action("T_PROFILE", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    s.step = "T_SUBJECT_QUERY";
    s.subjQuery = "";
    s.subjOffset = 0;

    await ctx.answerCbQuery();
    await ctx.editMessageText("Введи предмет (текстом). Наприклад: математика / англ / хімія", ui.backMenuKeyboard());
  });

  bot.action("T_SUBJECT_MORE", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    const all = searchSubjects(SUBJECT_LABELS, s.subjQuery || "");
    await ctx.answerCbQuery();
    if (!all.length) return ctx.reply("Немає результатів. Введи новий запит текстом.");

    s.subjOffset = (s.subjOffset || 0) + 10;
    if (s.subjOffset >= all.length) s.subjOffset = 0;

    const page = all.slice(s.subjOffset, s.subjOffset + 10);
    const hasMore = (s.subjOffset + 10) < all.length;

    await ctx.editMessageText(
      renderSubjectMatchesText(s.subjQuery, s.subjOffset, all.length),
      buildMatchesKeyboard("T_SUBJECT_PICK", "T_SUBJECT_MORE", page, hasMore)
    );
  });

  bot.action(/T_SUBJECT_PICK_(\d+)/, async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    const idx = parseInt(ctx.match[1], 10);
    const label = SUBJECT_LABELS[idx];

    await ctx.answerCbQuery();
    if (!label) return ctx.reply("Помилка вибору предмета. Спробуй пошук ще раз.");

    await store.updateTeacherProfile(ctx.from.id, { subject: label });

    s.step = "T_WAIT_PRICE";
    await ctx.editMessageText(
      `Предмет: ${label} ✅\n\nВведи ціну за 60 хв (число). Діапазон ${LIMITS.PRICE_MIN}–${LIMITS.PRICE_MAX}.`,
      ui.backMenuKeyboard()
    );
  });

  bot.action("T_SHOW_PROFILE", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    const meta = await store.getUserMeta(ctx.from.id);
    const prof = await store.getTeacherProfile(ctx.from.id);

    const photo = prof?.photo_file_id ? "✅ Є" : "—";
    const status = prof?.is_active ? "✅ Активна (у пошуку)" : "⏸ Пауза (прихована)";
    const price = prof?.price ? `${prof.price} грн / 60 хв` : "—";
    const bio = prof?.bio ? prof.bio : "—";
    const subject = prof?.subject || "—";
    const points = Number.isFinite(prof?.points) ? prof.points : 0;

    const promoUntil = prof?.subject ? await store.getActivePromoForTeacher(ctx.from.id, prof.subject) : null;
    const promoLine = promoUntil ? `⭐ ТОП активний до ${fmtDate(promoUntil)}` : "⭐ ТОП: —";

    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `🧑‍🏫 Моя анкета\n\n` +
      `Ім'я: ${meta?.first_name || "—"}\n` +
      `Статус: ${status}\n` +
      `Предмет: ${subject}\n` +
      `Ціна: ${price}\n` +
      `Фото: ${photo}\n` +
      `Бали: ${points}\n` +
      `${promoLine}\n\n` +
      `Опис:\n${bio}`,
      ui.backMenuKeyboard()
    );
  });

  bot.action("T_TOGGLE_ACTIVE", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    const prof = await store.getTeacherProfile(ctx.from.id);
    if (!prof?.subject || !prof?.price || !prof?.bio) {
      await ctx.answerCbQuery();
      await ctx.reply("Спочатку заповни анкету (предмет, ціна, опис).");
      return;
    }

    const nextActive = !prof.is_active;
    await store.updateTeacherProfile(ctx.from.id, { is_active: nextActive });

    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `Готово ✅\nАнкета: ${nextActive ? "✅ Активна" : "⏸ Пауза"}\n\nГоловне меню:`,
      ui.mainMenu("teacher")
    );
  });

  bot.action("T_DELETE_PROFILE", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    await ctx.answerCbQuery();
    await ctx.editMessageText(
      "⚠️ Видалити анкету?\n\nБуде видалено:\n- предмет, ціна, опис\n- фото\n- статус активності\n- усі ТОП-статуси\n- бали\n\nДію не можна скасувати.",
      ui.confirmDeleteKeyboard()
    );
  });

  bot.action("T_DELETE_CONFIRM", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    await store.deleteTeacherProfile(ctx.from.id);

    s.step = null;

    await ctx.answerCbQuery();
    await ctx.editMessageText("Анкету видалено ✅\n\nГоловне меню:", ui.mainMenu("teacher"));
  });

  // ТОП
  bot.action("T_PROMO", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    const prof = await store.getTeacherProfile(ctx.from.id);
    await ctx.answerCbQuery();

    if (!prof?.subject) return ctx.editMessageText("Щоб купити ТОП, спочатку обери предмет в анкеті.", ui.backMenuKeyboard());

    const promoUntil = await store.getActivePromoForTeacher(ctx.from.id, prof.subject);
    const line = promoUntil ? `Зараз ТОП активний до: ${fmtDate(promoUntil)}` : "ТОП зараз не активний";

    await ctx.editMessageText(
      `ТОП (як у Buki)\n\nПредмет: ${prof.subject}\n${line}\n\nОбери термін:`,
      ui.promoPacksKeyboard(PROMO_PACKS)
    );
  });

  bot.action(/PROMO_DAYS_(\d+)/, async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    const prof = await store.getTeacherProfile(ctx.from.id);
    const days = parseInt(ctx.match[1], 10);
    const pack = PROMO_PACKS.find((p) => p.days === days);

    await ctx.answerCbQuery();
    if (!pack || !prof?.subject) return ctx.reply("Помилка вибору пакета.");

    s.pendingPromo = { subject: prof.subject, days: pack.days, priceUah: pack.priceUah, priceStars: pack.priceStars };

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

    if (!CARD_PROVIDER_TOKEN) return ctx.reply("Оплата карткою поки не налаштована (CARD_PROVIDER_TOKEN).");
    await sendCardInvoice(ctx, CARD_PROVIDER_TOKEN, s.pendingPromo);
  });

  // text middleware (teacher)
  bot.on("text", async (ctx, next) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") return next();

    if (s.step === "T_WAIT_PHOTO") {
      await ctx.reply("Зараз очікую фото 📷. Надішли фото повідомленням.");
      return;
    }

    const text = (ctx.message.text || "").trim();

    if (s.step === "T_SUBJECT_QUERY") {
      if (text.length < 2) return ctx.reply("Напиши хоча б 2 символи для пошуку.");

      s.subjQuery = text;
      s.subjOffset = 0;

      const all = searchSubjects(SUBJECT_LABELS, s.subjQuery);
      if (!all.length) return ctx.reply("Нічого не знайшов. Спробуй інший запит.");

      const page = all.slice(0, 10);
      const hasMore = all.length > 10;

      await ctx.reply(
        renderSubjectMatchesText(s.subjQuery, 0, all.length),
        buildMatchesKeyboard("T_SUBJECT_PICK", "T_SUBJECT_MORE", page, hasMore)
      );
      return;
    }

    if (s.step === "T_WAIT_PRICE") {
      const num = parseNumber(text);
      if (num === null) return ctx.reply("Не зрозумів ціну. Напиши число (наприклад 400).");
      if (num < LIMITS.PRICE_MIN || num > LIMITS.PRICE_MAX) return ctx.reply(`Ціна має бути ${LIMITS.PRICE_MIN}–${LIMITS.PRICE_MAX} грн. Напиши ще раз.`);

      await store.updateTeacherProfile(ctx.from.id, { price: num });

      s.step = "T_WAIT_BIO";
      await ctx.reply(`Ціну збережено ✅ ${num} грн / 60 хв\n\nТепер напиши короткий опис (1–3 речення).`);
      return;
    }

    if (s.step === "T_WAIT_BIO") {
      if (containsPhoneNumber(text)) {
        return ctx.reply("❌ У описі не можна залишати номер телефону. Прибери телефон і напиши опис ще раз.");
      }
      if (text.length < LIMITS.BIO_MIN) return ctx.reply(`Занадто коротко. Мінімум ${LIMITS.BIO_MIN} символів.`);
      if (text.length > LIMITS.BIO_MAX) return ctx.reply(`Занадто довго. Максимум ${LIMITS.BIO_MAX} символів.`);

      await store.updateTeacherProfile(ctx.from.id, { bio: text });

      s.step = null;
      await ctx.reply("Опис збережено ✅\n\nНатисни «Активна/Пауза», щоб увімкнути анкету в пошуку.", ui.mainMenu("teacher"));
      return;
    }

    return next();
  });
}

module.exports = { registerTeacher };
