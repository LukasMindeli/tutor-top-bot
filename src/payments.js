const { subjLabel } = require("./constants");
const { fmtDate } = require("./helpers");

function registerPayments(bot, deps) {
  const { store, ui, getSession } = deps;

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

    const teacherId = parts[1];
    const subject = parts[2];
    const days = parseInt(parts[3], 10);

    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    await store.addPromo(teacherId, subject, expiresAt, sp.telegram_payment_charge_id);

    const s = getSession(ctx.from.id);
    s.pendingPromo = null;

    await ctx.reply(
      `Оплата успішна ✅\nТОП активний: ${subject}\nДо: ${fmtDate(expiresAt)}`,
      ui.mainMenu("teacher")
    );
  });
}

function sendStarsInvoice(ctx, pendingPromo) {
  const payload = `promo|${ctx.from.id}|${pendingPromo.subject}|${pendingPromo.days}|stars|${Date.now()}`;

  return ctx.replyWithInvoice({
    title: "ТОП репетитора",
    description: `ТОП по предмету: ${pendingPromo.subject} на ${pendingPromo.days} днів`,
    payload,
    provider_token: "",
    currency: "XTR",
    prices: [{ label: `ТОП ${pendingPromo.days} днів`, amount: pendingPromo.priceStars }],
  });
}

function sendCardInvoice(ctx, providerToken, pendingPromo) {
  const payload = `promo|${ctx.from.id}|${pendingPromo.subject}|${pendingPromo.days}|card|${Date.now()}`;

  return ctx.replyWithInvoice({
    title: "ТОП репетитора",
    description: `ТОП по предмету: ${pendingPromo.subject} на ${pendingPromo.days} днів`,
    payload,
    provider_token: providerToken,
    currency: "UAH",
    prices: [{ label: `ТОП ${pendingPromo.days} днів`, amount: pendingPromo.priceUah * 100 }],
  });
}

module.exports = { registerPayments, sendStarsInvoice, sendCardInvoice };
