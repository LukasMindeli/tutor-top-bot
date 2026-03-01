const { Markup } = require("telegraf");
const { PROMO_PACKS } = require("./constants");
const { fmtDate } = require("./helpers");

function registerPromo(bot, deps) {
  const { store, ui, getSession } = deps;

  // показываем меню ТОП
  bot.action("T_PROMO", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") return;

    const prof = await store.getTeacherProfile(ctx.from.id);
    const subject = prof?.subject;

    if (!subject) {
      await ctx.reply("Спочатку заповни анкету (предмет), щоб купити ТОП.", ui.mainMenu("teacher"));
      return;
    }

    const promoUntil = await store.getActivePromoForTeacher(ctx.from.id, subject);
    const promoLine = promoUntil ? `⭐ ТОП активний до ${fmtDate(promoUntil)}` : "⭐ ТОП: —";

    const rows = PROMO_PACKS.map((p) => [
      Markup.button.callback(
        `${p.days} днів — ${p.priceUah} грн або ${p.priceStars} ⭐`,
        `TOP_BUY_${p.days}`
      ),
    ]);
    rows.push([Markup.button.callback("⬅️ В меню", "BACK_MENU")]);

    await ctx.reply(
      `⭐ ТОП репетитора\n\nПредмет: ${subject}\n${promoLine}\n\nОбери пакет:`,
      Markup.inlineKeyboard(rows)
    );
  });

  // выбор пакета
  bot.action(/TOP_BUY_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") return;

    const days = parseInt(ctx.match[1], 10);
    const pack = PROMO_PACKS.find((p) => p.days === days);
    if (!pack) return ctx.reply("Пакет не знайдено.");

    const prof = await store.getTeacherProfile(ctx.from.id);
    const subject = prof?.subject;
    if (!subject) return ctx.reply("Спочатку заповни анкету (предмет).");

    s.topBuy = { subject, days, priceUah: pack.priceUah, priceStars: pack.priceStars };

    await ctx.reply(
      `⭐ ТОП\nПредмет: ${subject}\nТермін: ${days} днів\nЦіна: ${pack.priceUah} грн або ${pack.priceStars} ⭐\n\nОбери оплату:`,
      Markup.inlineKeyboard([
        [Markup.button.callback(`Оплатити ⭐ Stars (${pack.priceStars})`, "TOP_PAY_STARS")],
        [Markup.button.callback("Оплатити 💳 карткою (Monobank)", "TOP_PAY_CARD")],
        [Markup.button.callback("⬅️ Назад", "T_PROMO")],
      ])
    );
  });

  // ===== Stars invoice =====
  bot.action("TOP_PAY_STARS", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (!s.topBuy) return ctx.reply("Спочатку обери пакет ТОП ще раз.");

    const payload = `TOP:${ctx.from.id}:${s.topBuy.days}:${Date.now()}`;

    // ВАЖНО: currency = XTR, provider_token пустой для Stars
    await ctx.replyWithInvoice({
      title: "ТОП репетитора (TutorUA)",
      description: `Предмет: ${s.topBuy.subject}\nТермін: ${s.topBuy.days} днів`,
      payload,
      provider_token: "",
      currency: "XTR",
      prices: [{ label: `ТОП на ${s.topBuy.days} днів`, amount: s.topBuy.priceStars }],
    });
  });

  // отвечаем на pre_checkout_query (для Stars)
  bot.on("pre_checkout_query", async (ctx, next) => {
    const q = ctx.update.pre_checkout_query;
    if (!q?.invoice_payload?.startsWith("TOP:")) return next();

    try {
      await ctx.answerPreCheckoutQuery(true);
    } catch (e) {}
  });

  // успешная оплата Stars -> активируем ТОП сразу
  bot.on("successful_payment", async (ctx, next) => {
    const sp = ctx.message.successful_payment;
    if (!sp || sp.currency !== "XTR") return next();

    const payload = sp.invoice_payload || "";
    if (!payload.startsWith("TOP:")) return next();

    const parts = payload.split(":");
    const teacherId = parts[1];
    const days = parseInt(parts[2], 10);

    // безопасность: оплачивать должен тот же пользователь
    if (String(ctx.from.id) !== String(teacherId)) return;

    const prof = await store.getTeacherProfile(teacherId);
    if (!prof?.subject) {
      await ctx.reply("Оплату отримано, але предмет анкети не знайдено. Заповни анкету й напиши в підтримку.");
      return;
    }

    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    await store.addPromo(String(teacherId), String(prof.subject), expiresAt, sp.telegram_payment_charge_id);

    await ctx.reply(`✅ ТОП активовано\nПредмет: ${prof.subject}\nДо: ${fmtDate(expiresAt)}`, ui.mainMenu("teacher"));
  });

  // ===== Monobank jar for TOP (ручной скрин) =====
  bot.action("TOP_PAY_CARD", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    const MONO_TOP_URL = String(process.env.MONO_TOP_URL || "");

    if (!s.topBuy) return ctx.reply("Спочатку обери пакет ТОП ще раз.");
    if (!MONO_TOP_URL) return ctx.reply("MONO_TOP_URL не налаштовано в Railway.");

    await ctx.reply(
      `💳 Оплата ТОП через Monobank\n\n1) Натисни кнопку та оплати суму\n2) Повернись сюди та надішли скрін оплати`,
      Markup.inlineKeyboard([
        [Markup.button.url(`Відкрити Monobank (${s.topBuy.priceUah} грн)`, MONO_TOP_URL)],
        [Markup.button.callback("📷 Надіслати скрін оплати", "TOP_SEND_PROOF")],
      ])
    );
  });

  bot.action("TOP_SEND_PROOF", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (!s.topBuy) return ctx.reply("Спочатку обери пакет ТОП ще раз.");

    s.step = "T_WAIT_TOP_PAYPROOF";
    await ctx.reply("Надішли ОДНЕ фото (скрін оплати) сюди в чат 📷");
  });
}

module.exports = { registerPromo };
