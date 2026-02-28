const { LEAD_PRICE_UAH, LEAD_PRICE_STARS } = require("./constants");
const { fmtDate } = require("./helpers");

function registerPayments(bot, deps) {
  const { store, ui, getSession, CARD_PROVIDER_TOKEN } = deps;

  bot.on("pre_checkout_query", async (ctx) => {
    await ctx.answerPreCheckoutQuery(true);
  });

  bot.on("successful_payment", async (ctx) => {
    const sp = ctx.message.successful_payment;
    const payload = sp.invoice_payload || "";
    const parts = payload.split("|");

    // promo|userId|subject|days|method|timestamp
    if (parts[0] === "promo") {
      const teacherId = parts[1];
      const subject = parts[2];
      const days = parseInt(parts[3], 10);

      const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      await store.addPromo(teacherId, subject, expiresAt, sp.telegram_payment_charge_id);

      const s = getSession(ctx.from.id);
      s.pendingPromo = null;

      await ctx.reply(`Оплата успішна ✅\nТОП активовано: ${subject}\nДо: ${fmtDate(expiresAt)}`, ui.mainMenu("teacher"));
      return;
    }

    // lead|reqId|teacherId|method|timestamp
    if (parts[0] === "lead") {
      const reqId = parts[1];
      const teacherId = parts[2];
      const method = parts[3] || "unknown";

      // защита: платить должен тот же учитель
      if (String(ctx.from.id) !== String(teacherId)) {
        await ctx.reply("Помилка: оплата не співпадає з акаунтом вчителя.");
        return;
      }

      const res = await store.markLeadPaid(reqId, teacherId, method, sp.telegram_payment_charge_id);
      if (!res) {
        await ctx.reply("Лід вже оплачено або заявка не знайдена.");
        return;
      }

      await ctx.reply(
        `✅ Оплату прийнято\nНараховано бали ✅\n\n<b>Учнів: ${res.nextCnt}</b>`,
        { parse_mode: "HTML", ...ui.mainMenu("teacher") }
      );
      return;
    }

    await ctx.reply("Оплату отримано ✅");
  });
}

// ===== ЛІД: інвойси =====
function sendLeadInvoiceStars(ctx, reqId) {
  const payload = `lead|${reqId}|${ctx.from.id}|stars|${Date.now()}`;
  return ctx.replyWithInvoice({
    title: "Оплата за учня (лід)",
    description: "Добровільна оплата. Після оплати нарахуються бали та збільшиться лічильник учнів.",
    payload,
    provider_token: "", // Stars
    currency: "XTR",
    prices: [{ label: "Лід", amount: LEAD_PRICE_STARS }],
  });
}

function sendLeadInvoiceCard(ctx, reqId, providerToken) {
  const payload = `lead|${reqId}|${ctx.from.id}|card|${Date.now()}`;
  return ctx.replyWithInvoice({
    title: "Оплата за учня (лід)",
    description: "Добровільна оплата. Після оплати нарахуються бали та збільшиться лічильник учнів.",
    payload,
    provider_token: providerToken,
    currency: "UAH",
    prices: [{ label: "Лід", amount: LEAD_PRICE_UAH * 100 }],
  });
}

module.exports = { registerPayments, sendLeadInvoiceStars, sendLeadInvoiceCard };
