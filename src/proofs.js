const { Markup } = require("telegraf");
const proofsStore = require("./store_proofs");
const { LEAD_PRICE_UAH } = require("./constants");

function registerProofs(bot, deps) {
  const { store, getSession } = deps;

  const ADMIN_ID = String(process.env.ADMIN_TELEGRAM_ID || "");

  function isAdmin(ctx) {
    return ADMIN_ID && String(ctx.from?.id) === ADMIN_ID;
  }

  function isAdminAuthed(ctx) {
    if (!isAdmin(ctx)) return false;
    const s = getSession(ctx.from.id);
    return Number.isFinite(s.adminAuthedUntil) && s.adminAuthedUntil > Date.now();
  }

  // Учитель: включаем режим ожидания скрина
  bot.action(/T_LEAD_PROOF_([0-9a-fA-F-]{36})/, async (ctx) => {
    const reqId = ctx.match[1];
    await ctx.answerCbQuery();

    const s = getSession(ctx.from.id);
    s.step = "T_WAIT_LEAD_PAYPROOF";
    s.leadProofReqId = reqId;

    await ctx.reply("Надішли ОДНЕ фото (скрін оплати) сюди в чат 📷");
  });

  // Учитель: ловим фото, создаём proof и отправляем админу
  bot.on("photo", async (ctx, next) => {
    const s = getSession(ctx.from.id);
    if (s.step !== "T_WAIT_LEAD_PAYPROOF") return next();

    const reqId = s.leadProofReqId;
    s.step = null;
    s.leadProofReqId = null;

    const req = await store.getRequestById(reqId);
    if (!req) return ctx.reply("Не знайшов заявку. Спробуй ще раз.");
    if (String(req.teacher_id) !== String(ctx.from.id)) return ctx.reply("Це не твоя заявка.");
    if (req.lead_paid) return ctx.reply("Цей лід вже оплачено ✅");
    if (req.status !== "accepted") return ctx.reply("Скрін можна надсилати тільки після прийняття заявки.");

    const photos = ctx.message.photo || [];
    const best = photos[photos.length - 1];
    if (!best?.file_id) return ctx.reply("Не зміг прочитати фото. Спробуй ще раз.");

    const result = await proofsStore.createProof({
      kind: "lead",
      teacher_id: String(ctx.from.id),
      request_id: reqId,
      amount_uah: LEAD_PRICE_UAH,
      photo_file_id: best.file_id,
      status: "pending",
    });

    if (!result.id) {
      await ctx.reply(
        `❌ Помилка: не вдалося зберегти скрін.\nПричина: ${result.error || "невідома"}`
      );
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
              `🧾 Підтвердження оплати (ЛІД)\n\n` +
              `Proof: ${result.id}\n` +
              `Teacher: ${ctx.from.id}\n` +
              `Request: ${reqId}\n` +
              `Сума: ${LEAD_PRICE_UAH} грн`,
            reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback("✅ Підтвердити", `A_PROOF_OK_${result.id}`)],
              [Markup.button.callback("❌ Відхилити", `A_PROOF_NO_${result.id}`)],
            ]).reply_markup,
          }
        );
      } catch (e) {}
    }
  });

  // Админ: approve
  bot.action(/A_PROOF_OK_([0-9a-fA-F-]{36})/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!isAdminAuthed(ctx)) return ctx.reply("Адмін: спочатку /admin і пароль.");

    const proofId = ctx.match[1];
    const proof = await proofsStore.getProofById(proofId);
    if (!proof) return ctx.reply("Proof не знайдено.");
    if (proof.status !== "pending") return ctx.reply("Вже оброблено.");

    const res = await store.markLeadPaid(String(proof.request_id), String(proof.teacher_id), "mono_screenshot", proofId);
    if (!res) {
      await proofsStore.setProofStatus(proofId, "rejected", ctx.from.id, "Cannot apply (already paid?)");
      return ctx.reply("Не вдалося застосувати (можливо вже оплачено).");
    }

    await proofsStore.setProofStatus(proofId, "approved", ctx.from.id, null);

    try {
      await bot.telegram.sendMessage(
        String(proof.teacher_id),
        `✅ Оплату підтверджено\nНараховано бали ✅\n\n<b>Учнів: ${res.nextCnt}</b>`,
        { parse_mode: "HTML" }
      );
    } catch (e) {}

    try {
      await ctx.editMessageCaption((ctx.callbackQuery.message.caption || "") + "\n\n✅ ПІДТВЕРДЖЕНО", {
        reply_markup: Markup.inlineKeyboard([]).reply_markup,
      });
    } catch (e) {}
  });

  // Админ: reject
  bot.action(/A_PROOF_NO_([0-9a-fA-F-]{36})/, async (ctx) => {
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
        "❌ Скрін оплати відхилено адміністратором. Якщо це помилка — надішли інший скрін."
      );
    } catch (e) {}

    try {
      await ctx.editMessageCaption((ctx.callbackQuery.message.caption || "") + "\n\n❌ ВІДХИЛЕНО", {
        reply_markup: Markup.inlineKeyboard([]).reply_markup,
      });
    } catch (e) {}
  });
}

module.exports = { registerProofs };
