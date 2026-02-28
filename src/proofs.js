const { Markup } = require("telegraf");
const proofsStore = require("./store_proofs");
const { LEAD_PRICE_UAH } = require("./constants");

function registerProofs(bot, deps) {
  const { store, ui, getSession } = deps;

  const ADMIN_ID = String(process.env.ADMIN_TELEGRAM_ID || "");
  const MONO_LEAD_URL = String(process.env.MONO_LEAD_URL || "");

  function isAdmin(ctx) {
    return ADMIN_ID && String(ctx.from?.id) === ADMIN_ID;
  }

  function isAdminAuthed(ctx) {
    if (!isAdmin(ctx)) return false;
    const s = getSession(ctx.from.id);
    return Number.isFinite(s.adminAuthedUntil) && s.adminAuthedUntil > Date.now();
  }

  // Учитель: "Оплатити через Monobank" (просто открыть ссылку)
  bot.action(/T_LEAD_MONO_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!MONO_LEAD_URL) {
      await ctx.reply("MONO_LEAD_URL не налаштовано в Railway.");
      return;
    }

    const reqId = ctx.match[1];

    await ctx.reply(
      `💳 Оплата через Monobank\n\n1) Натисни кнопку та оплати 100 грн\n2) Повернись сюди та надішли скрін оплати`,
      Markup.inlineKeyboard([
        [Markup.button.url("Відкрити Monobank", MONO_LEAD_URL)],
        [Markup.button.callback("📷 Надіслати скрін оплати", `T_LEAD_PROOF_${reqId}`)],
      ])
    );
  });

  // Учитель: включаем режим ожидания скрина
  bot.action(/T_LEAD_PROOF_(.+)/, async (ctx) => {
    const reqId = ctx.match[1];
    await ctx.answerCbQuery();

    const s = getSession(ctx.from.id);
    s.step = "T_WAIT_LEAD_PAYPROOF";
    s.leadProofReqId = reqId;

    await ctx.reply("Надішли ОДНЕ фото (скрін оплати) сюди в чат 📷");
  });

  // Учитель: ловим фото, создаём proof и отправляем админу
  bot.on("photo", async (ctx) => {
    const s = getSession(ctx.from.id);

    if (s.step !== "T_WAIT_LEAD_PAYPROOF") return;

    const reqId = s.leadProofReqId;
    s.step = null;
    s.leadProofReqId = null;

    // проверим заявку
    const req = await store.getRequestById(reqId);
    if (!req) {
      await ctx.reply("Не знайшов заявку. Спробуй ще раз.");
      return;
    }
    if (String(req.teacher_id) !== String(ctx.from.id)) {
      await ctx.reply("Це не твоя заявка.");
      return;
    }
    if (req.lead_paid) {
      await ctx.reply("Цей лід вже оплачено ✅");
      return;
    }
    if (req.status !== "accepted") {
      await ctx.reply("Скрін можна надсилати тільки після прийняття заявки (accepted).");
      return;
    }

    const photos = ctx.message.photo || [];
    const best = photos[photos.length - 1];
    if (!best?.file_id) {
      await ctx.reply("Не зміг прочитати фото. Спробуй ще раз.");
      return;
    }

    const proofId = await proofsStore.createProof({
      kind: "lead",
      teacher_id: String(ctx.from.id),
      request_id: reqId,
      amount_uah: LEAD_PRICE_UAH,
      photo_file_id: best.file_id,
      status: "pending",
    });

    if (!proofId) {
      await ctx.reply("Помилка: не зміг зберегти скрін. Спробуй ще раз.");
      return;
    }

    await ctx.reply("✅ Скрін відправлено. Очікуй підтвердження адміністратора.");

    // отправим админу
    if (ADMIN_ID) {
      try {
        await bot.telegram.sendPhoto(
          ADMIN_ID,
          best.file_id,
          {
            caption:
              `🧾 Підтвердження оплати (ЛІД)\n\n` +
              `Proof: ${proofId}\n` +
              `Teacher: ${ctx.from.id}\n` +
              `Request: ${reqId}\n` +
              `Сума: ${LEAD_PRICE_UAH} грн\n\n` +
              `Після /admin (пароль) можна підтвердити кнопками нижче.`,
            reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback("✅ Підтвердити", `A_PROOF_OK_${proofId}`)],
              [Markup.button.callback("❌ Відхилити", `A_PROOF_NO_${proofId}`)],
            ]).reply_markup,
          }
        );
      } catch (e) {}
    }
  });

  // Админ: approve
  bot.action(/A_PROOF_OK_([0-9a-fA-F-]{36})/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!isAdminAuthed(ctx)) {
      await ctx.reply("Адмін: спочатку /admin і пароль.");
      return;
    }

    const proofId = ctx.match[1];
    const proof = await proofsStore.getProofById(proofId);
    if (!proof) return ctx.reply("Proof не знайдено.");
    if (proof.status !== "pending") return ctx.reply("Вже оброблено.");

    if (proof.kind !== "lead") return ctx.reply("Цей proof не lead.");

    // начисляем через markLeadPaid (оно: lead_paid=true + points + students_count)
    const res = await store.markLeadPaid(
      String(proof.request_id),
      String(proof.teacher_id),
      "mono_screenshot",
      proofId
    );

    if (!res) {
      await proofsStore.setProofStatus(proofId, "rejected", ctx.from.id, "Cannot apply (already paid?)");
      await ctx.reply("Не вдалося застосувати (можливо вже оплачено).");
      return;
    }

    await proofsStore.setProofStatus(proofId, "approved", ctx.from.id, null);

    // уведомим учителя
    try {
      await bot.telegram.sendMessage(
        String(proof.teacher_id),
        `✅ Оплату підтверджено\nНараховано бали ✅\n\n<b>Учнів: ${res.nextCnt}</b>`,
        { parse_mode: "HTML" }
      );
    } catch (e) {}

    // отметим под фото админу
    try {
      await ctx.editMessageCaption(
        (ctx.callbackQuery.message.caption || "") + `\n\n✅ ПІДТВЕРДЖЕНО`,
        { reply_markup: Markup.inlineKeyboard([]).reply_markup }
      );
    } catch (e) {}
  });

  // Админ: reject
  bot.action(/A_PROOF_NO_([0-9a-fA-F-]{36})/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!isAdminAuthed(ctx)) {
      await ctx.reply("Адмін: спочатку /admin і пароль.");
      return;
    }

    const proofId = ctx.match[1];
    const proof = await proofsStore.getProofById(proofId);
    if (!proof) return ctx.reply("Proof не знайдено.");
    if (proof.status !== "pending") return ctx.reply("Вже оброблено.");

    await proofsStore.setProofStatus(proofId, "rejected", ctx.from.id, "Rejected by admin");

    // учителю
    try {
      await bot.telegram.sendMessage(
        String(proof.teacher_id),
        "❌ Скрін оплати відхилено адміністратором. Якщо це помилка — надішли інший скрін."
      );
    } catch (e) {}

    try {
      await ctx.editMessageCaption(
        (ctx.callbackQuery.message.caption || "") + `\n\n❌ ВІДХИЛЕНО`,
        { reply_markup: Markup.inlineKeyboard([]).reply_markup }
      );
    } catch (e) {}
  });
}

module.exports = { registerProofs };
