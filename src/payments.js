const { subjLabel } = require("./helpers");

function registerPayments(bot, deps) {
  const { db, persist, ui, getSession } = deps;

  bot.on("pre_checkout_query", async (ctx) => {
    await ctx.answerPreCheckoutQuery(true);
  });

  bot.on("successful_payment", async (ctx) => {
    const sp = ctx.message.successful_payment;
    const payload = sp.invoice_payload || "";
    const parts = payload.split("|");

    // promo|userId|subject|days|method|timestamp
    if (parts[0] !== "promo") {
      await ctx.reply("Оплату отримано ✅");
      return;
    }

    const userId = String(parts[1]);
    const subject = parts[2];
    const days = parseInt(parts[3], 10);

    const user = db.users[userId];
    if (!user) {
      await ctx.reply("Оплату отримано ✅");
      return;
    }

    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    user.promos ||= {};
    user.promos[subject] = { expiresAt, chargeId: sp.telegram_payment_charge_id };
    persist();

    await ctx.reply(
      `Оплата успішна ✅\nТОП активний: ${subjLabel(subject)}\nДо: ${new Date(expiresAt).toLocaleString("uk-UA")}`,
      ui.mainMenu("teacher")
    );

    // чистимо pendingPromo
    const s = getSession(ctx.from.id);
    s.pendingPromo = null;
  });
}

function sendStarsInvoice(ctx, pendingPromo) {
  const payload = `promo|${ctx.from.id}|${pendingPromo.subject}|${pendingPromo.days}|stars|${Date.now()}`;

  return ctx.replyWithInvoice({
    title: "ТОП репетитора",
    description: `ТОП по предмету: ${subjLabel(pendingPromo.subject)} на ${pendingPromo.days} днів`,
    payload,
    provider_token: "", // Stars
    currency: "XTR",
    prices: [{ label: `ТОП ${pendingPromo.days} днів`, amount: pendingPromo.priceStars }],
  });
}

function sendCardInvoice(ctx, providerToken, pendingPromo) {
  const payload = `promo|${ctx.from.id}|${pendingPromo.subject}|${pendingPromo.days}|card|${Date.now()}`;

  return ctx.replyWithInvoice({
    title: "ТОП репетитора",
    description: `ТОП по предмету: ${subjLabel(pendingPromo.subject)} на ${pendingPromo.days} днів`,
    payload,
    provider_token: providerToken,
    currency: "UAH",
    prices: [{ label: `ТОП ${pendingPromo.days} днів`, amount: pendingPromo.priceUah * 100 }],
  });
}

module.exports = { registerPayments, sendStarsInvoice, sendCardInvoice };
