const { Markup } = require("telegraf");
const { PROMO_PACKS } = require("./constants");
const { fmtDate } = require("./helpers");

function registerPromo(bot, deps) {
  const { store, ui, getSession } = deps;

  bot.action("T_PROMO", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") return;

    const subjects = await store.listTeacherSubjects(ctx.from.id);
    if (!subjects.length) {
      await ctx.editMessageText(
        "Щоб купити ТОП — спочатку додай хоча б 1 предмет у «📚 Предмети».",
        Markup.inlineKeyboard([
          [Markup.button.callback("📚 Предмети", "T_SUBJECTS_MENU")],
          [Markup.button.callback("⬅️ В меню", "BACK_MENU")],
        ])
      );
      return;
    }

    s.topSubjects = subjects;

    const rows = subjects.slice(0, 20).map((subj, i) => [Markup.button.callback(subj, `TOP_SUBJ_${i}`)]);
    rows.push([Markup.button.callback("⬅️ В меню", "BACK_MENU")]);

    await ctx.editMessageText("⭐ Обери предмет, по якому ти хочеш ТОП:", Markup.inlineKeyboard(rows));
  });

  bot.action(/TOP_SUBJ_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    const i = parseInt(ctx.match[1], 10);
    const subject = s.topSubjects?.[i];
    if (!subject) return;

    s.topSubject = subject;

    const promoUntil = await store.getActivePromoForTeacher(ctx.from.id, subject);
    const promoLine = promoUntil ? `⭐ ТОП активний до ${fmtDate(promoUntil)}` : "⭐ ТОП: —";

    const rows = PROMO_PACKS.map((p) => [
      Markup.button.callback(`${p.days} днів — ${p.priceUah} грн або ${p.priceStars} ⭐`, `TOP_BUY_${p.days}`)
    ]);
    rows.push([Markup.button.callback("⬅️ Назад", "T_PROMO")]);

    await ctx.editMessageText(
      `⭐ ТОП репетитора\n\nПредмет: ${subject}\n${promoLine}\n\nОбери пакет:`,
      Markup.inlineKeyboard(rows)
    );
  });

  bot.action(/TOP_BUY_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (!s.topSubject) return ctx.reply("Спочатку обери предмет для ТОП.");

    const days = parseInt(ctx.match[1], 10);
    const pack = PROMO_PACKS.find((p) => p.days === days);
    if (!pack) return;

    s.topBuy = { subject: s.topSubject, days, priceUah: pack.priceUah, priceStars: pack.priceStars };

    await ctx.reply(
      `⭐ ТОП\nПредмет: ${s.topBuy.subject}\nТермін: ${days} днів\nЦіна: ${pack.priceUah} грн або ${pack.priceStars} ⭐\n\nОбери оплату:`,
      Markup.inlineKeyboard([
        [Markup.button.callback(`Оплатити ⭐ Stars (${pack.priceStars})`, "TOP_PAY_STARS")],
        [Markup.button.callback("Оплатити 💳 карткою (Monobank)", "TOP_PAY_CARD")],
        [Markup.button.callback("⬅️ Назад", "T_PROMO")],
      ])
    );
  });

  bot.action("TOP_PAY_STARS", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (!s.topBuy) return;

    const payload = `TOP:${ctx.from.id}:${s.topBuy.days}:${Date.now()}:${s.topBuy.subject}`;

    await ctx.replyWithInvoice({
      title: "ТОП репетитора (TutorUA)",
      description: `Предмет: ${s.topBuy.subject}\nТермін: ${s.topBuy.days} днів`,
      payload,
      provider_token: "",
      currency: "XTR",
      prices: [{ label: `ТОП на ${s.topBuy.days} днів`, amount: s.topBuy.priceStars }],
    });
  });

  bot.on("pre_checkout_query", async (ctx, next) => {
    const q = ctx.update.pre_checkout_query;
    if (!q?.invoice_payload?.startsWith("TOP:")) return next();
    try { await ctx.answerPreCheckoutQuery(true); } catch (e) {}
  });

  bot.on("successful_payment", async (ctx, next) => {
    const sp = ctx.message.successful_payment;
    if (!sp || sp.currency !== "XTR") return next();
    const payload = sp.invoice_payload || "";
    if (!payload.startsWith("TOP:")) return next();

    const parts = payload.split(":");
    const teacherId = parts[1];
    const days = parseInt(parts[2], 10);
    const subject = parts.slice(4).join(":"); // subject may contain ":" (safe)

    if (String(ctx.from.id) !== String(teacherId)) return;

    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    await store.addPromo(String(teacherId), String(subject), expiresAt, sp.telegram_payment_charge_id);

    await ctx.reply(`✅ ТОП активовано\nПредмет: ${subject}\nДо: ${fmtDate(expiresAt)}`, ui.backMenuKeyboard());
  });
}

module.exports = { registerPromo };
