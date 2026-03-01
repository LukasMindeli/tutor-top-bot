async function markRequestSent(ctx) {
  const msg = ctx.callbackQuery?.message;

  try { await ctx.answerCbQuery(); } catch {}

  try {
    if (msg && typeof msg.caption === "string") {
      const base = msg.caption || "";
      const next = base.includes("✅ Заявку надіслано")
        ? base
        : `${base}\n\n✅ Заявку надіслано ✅`;
      await ctx.editMessageCaption(next, { reply_markup: { inline_keyboard: [] } });
      return;
    }

    if (msg && typeof msg.text === "string") {
      await ctx.editMessageText("✅ Заявку надіслано ✅", { reply_markup: { inline_keyboard: [] } });
      return;
    }

    await ctx.reply("✅ Заявку надіслано ✅");
  } catch (e) {
    try { await ctx.reply("✅ Заявку надіслано ✅"); } catch {}
  }
}

module.exports = { markRequestSent };
