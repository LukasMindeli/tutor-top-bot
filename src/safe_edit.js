async function markRequestSent(ctx) {
  const msg = ctx.callbackQuery?.message;

  try { await ctx.answerCbQuery(); } catch {}

  const SENT_TEXT = "✅ Заявка надіслана";

  try {
    // если это сообщение с caption (фото/медиа)
    if (msg && typeof msg.caption === "string") {
      const base = msg.caption || "";
      const next = base.includes(SENT_TEXT) ? base : `${base}\n\n${SENT_TEXT}`;
      await ctx.editMessageCaption(next, { reply_markup: { inline_keyboard: [] } });
      return;
    }

    // если это текстовое сообщение
    if (msg && typeof msg.text === "string") {
      const next = msg.text.includes(SENT_TEXT) ? msg.text : `${msg.text}\n\n${SENT_TEXT}`;
      await ctx.editMessageText(next, { reply_markup: { inline_keyboard: [] } });
      return;
    }

    // fallback
    await ctx.reply(SENT_TEXT);
  } catch (e) {
    try { await ctx.reply(SENT_TEXT); } catch {}
  }
}

module.exports = { markRequestSent };
