const { Markup } = require("telegraf");
const proofsStore = require("./store_proofs");
const { PROMO_PACKS } = require("./constants");
const { fmtDate } = require("./helpers");
const { replyBottom } = require("./respond");

function registerPromo(bot, deps) {
  const { store, ui, getSession } = deps;

  const ADMIN_ID = String(process.env.ADMIN_TELEGRAM_ID || "");
  const MONO_TOP_URL = String(process.env.MONO_TOP_URL || "");

  function isAdmin(ctx) {
    return ADMIN_ID && String(ctx.from?.id) === ADMIN_ID;
  }
  function isAdminAuthed(ctx) {
    if (!isAdmin(ctx)) return false;
    const s = getSession(ctx.from.id);
    return Number.isFinite(s.adminAuthedUntil) && s.adminAuthedUntil > Date.now();
  }

  bot.action("T_PROMO", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") return ctx.answerCbQuery();

    const prof = await store.getTeacherProfile(ctx.from.id);
    const subject = prof?.subject;
    if (!subject) {
      await replyBottom(ctx, "Спочатку заповни анкету (предмет), щоб купити ТОП.", ui.mainMenu("teacher"));
      return;
    }

    const promoUntil = await store.getActivePromoForTeacher(ctx.from.id, subject);
    const promoLine = promoUntil ? `⭐ ТОП активний до ${fmtDate(promoUntil)}` : "⭐ ТОП: —";

    const rows = PROMO_PACKS.map((p) => [
      Markup.button.callback(`Купити ТОП: ${p.days} днів — ${p.priceUah} грн`, `TOP_BUY_${p.days}`)
    ]);
    rows.push([Markup.button.callback("⬅️ В меню", "BACK_MENU")]);

    await replyBottom(
      ctx,
      `⭐ ТОП репетитора\n\nПредмет: ${subject}\n${promoLine}\n\nОбери термін:`,
      Markup.inlineKeyboard(rows)
    );
  });

  bot.action(/TOP_BUY_(\d+)/, async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") return ctx.answerCbQuery();

    const days = parseInt(ctx.match[1], 10);
    const pack = PROMO_PACKS.find((p) => p.days === days);
    if (!pack) return replyBottom(ctx, "Пакет не знайдено.", ui.mainMenu("teacher"));

    const prof = await store.getTeacherProfile(ctx.from.id);
    const subject = prof?.subject;
    if (!subject) return replyBottom(ctx, "Спочатку заповни анкету (предмет).", ui.mainMenu("teacher"));

    s.topBuy = { subject, days, priceUah: pack.priceUah, priceStars: pack.priceStars };

    await replyBottom(
      ctx,
      `⭐ ТОП\nПредмет: ${subject}\nТермін: ${days} днів\nЦіна: ${pack.priceUah} грн\n\nОбери оплату:`,
      Markup.inlineKeyboard([
        [Markup.button.callback(`Оплатити ⭐ Stars (${pack.priceStars})`, "TOP_PAY_STARS")],
        [Markup.button.callback("Оплатити 💳 карткою (Monobank)", "TOP_PAY_CARD")],
        [Markup.button.callback("⬅️ Назад", "T_PROMO")],
      ])
    );
  });

  // Stars (если у тебя есть обработчик invoices promo — можно подключить позже; пока просто отключим или оставим заглушку)
  bot.action("TOP_PAY_STARS", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply("Оплата Stars для ТОП буде додана пізніше. Зараз доступна оплата карткою через Monobank.");
  });

  // Card => Monobank jar + screenshot
  bot.action("TOP_PAY_CARD", async (ctx) => {
    const s = getSession(ctx.from.id);
    await ctx.answerCbQuery();

    if (!s.topBuy) return ctx.reply("Спочатку обери термін ТОП ще раз.");
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
    const s = getSession(ctx.from.id);
    await ctx.answerCbQuery();
    if (!s.topBuy) return ctx.reply("Спочатку обери термін ТОП ще раз.");

    s.step = "T_WAIT_TOP_PAYPROOF";
    await ctx.reply("Надішли ОДНЕ фото (скрін оплати) сюди в чат 📷");
  });

  // photo handler для ТОП (через next, чтобы не ломать другие фото)
  bot.on("photo", async (ctx, next) => {
    const s = getSession(ctx.from.id);
    if (s.step !== "T_WAIT_TOP_PAYPROOF") return next();

    const top = s.topBuy;
    s.step = null;

    const photos = ctx.message.photo || [];
    const best = photos[photos.length - 1];
    if (!best?.file_id) return ctx.reply("Не зміг прочитати фото. Спробуй ще раз.");

    const result = await proofsStore.createProof({
      kind: "top",
      teacher_id: String(ctx.from.id),
      subject: top.subject,
      days: top.days,
      amount_uah: top.priceUah,
      photo_file_id: best.file_id,
      status: "pending",
    });

    if (!result.id) {
      await ctx.reply(`❌ Помилка: не вдалося зберегти скрін.\nПричина: ${result.error || "невідома"}`);
      return;
    }

    await ctx.reply("✅ Скрін відправлено. Очікуй підтвердження адміністратора.");

    if (ADMIN_ID) {
      try {
        await bot.telegram.sendPhoto(
          ADMIN_ID,
          best.file_id,
          {
            caption:
              `🧾 Підтвердження оплати (ТОП)\n\n` +
              `Proof: ${result.id}\n` +
              `Teacher: ${ctx.from.id}\n` +
              `Предмет: ${top.subject}\n` +
              `Термін: ${top.days} днів\n` +
              `Сума: ${top.priceUah} грн`,
            reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback("✅ Підтвердити ТОП", `A_TOP_OK_${result.id}`)],
              [Markup.button.callback("❌ Відхилити", `A_TOP_NO_${result.id}`)],
            ]).reply_markup,
          }
        );
      } catch (e) {}
    }
  });

  bot.action(/A_TOP_OK_([0-9a-fA-F-]{36})/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!isAdminAuthed(ctx)) return ctx.reply("Адмін: спочатку /admin і пароль.");

    const proofId = ctx.match[1];
    const proof = await proofsStore.getProofById(proofId);
    if (!proof) return ctx.reply("Proof не знайдено.");
    if (proof.status !== "pending") return ctx.reply("Вже оброблено.");

    const expiresAt = new Date(Date.now() + Number(proof.days) * 24 * 60 * 60 * 1000).toISOString();
    await store.addPromo(String(proof.teacher_id), String(proof.subject), expiresAt, proofId);

    await proofsStore.setProofStatus(proofId, "approved", ctx.from.id, null);

    try {
      await bot.telegram.sendMessage(
        String(proof.teacher_id),
        `✅ ТОП активовано\nПредмет: ${proof.subject}\nДо: ${fmtDate(expiresAt)}`
      );
    } catch (e) {}

    try {
      await ctx.editMessageCaption((ctx.callbackQuery.message.caption || "") + "\n\n✅ ПІДТВЕРДЖЕНО", {
        reply_markup: Markup.inlineKeyboard([]).reply_markup,
      });
    } catch (e) {}
  });

  bot.action(/A_TOP_NO_([0-9a-fA-F-]{36})/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!isAdminAuthed(ctx)) return ctx.reply("Адмін: спочатку /admin і пароль.");

    const proofId = ctx.match[1];
    const proof = await proofsStore.getProofById(proofId);
    if (!proof) return ctx.reply("Proof не знайдено.");
    if (proof.status !== "pending") return ctx.reply("Вже оброблено.");

    await proofsStore.setProofStatus(proofId, "rejected", ctx.from.id, "Rejected by admin");

    try {
      await bot.telegram.sendMessage(
        String(proof.teacher_id),
        "❌ Скрін оплати ТОП відхилено. Якщо це помилка — надішли інший скрін."
      );
    } catch (e) {}

    try {
      await ctx.editMessageCaption((ctx.callbackQuery.message.caption || "") + "\n\n❌ ВІДХИЛЕНО", {
        reply_markup: Markup.inlineKeyboard([]).reply_markup,
      });
    } catch (e) {}
  });
}

module.exports = { registerPromo };
