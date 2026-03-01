async function markRequestSent(ctx) {
  const msg = ctx.callbackQuery?.message;
  const SENT_TEXT = "✅ Заявка надіслана";

  try { await ctx.answerCbQuery(); } catch {}

  try {
    if (msg && typeof msg.caption === "string") {
      const base = msg.caption || "";
      const next = base.includes(SENT_TEXT) ? base : `${base}\n\n${SENT_TEXT}`;
      await ctx.editMessageCaption(next, { reply_markup: { inline_keyboard: [] } });
      return;
    }

    if (msg && typeof msg.text === "string") {
      const base = msg.text || "";
      const next = base.includes(SENT_TEXT) ? base : `${base}\n\n${SENT_TEXT}`;
      await ctx.editMessageText(next, { reply_markup: { inline_keyboard: [] } });
      return;
    }

    await ctx.reply(SENT_TEXT);
  } catch (e) {
    try { await ctx.reply(SENT_TEXT); } catch {}
  }
}

module.exports = { markRequestSent };
