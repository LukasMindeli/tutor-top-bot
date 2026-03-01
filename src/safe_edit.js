async function markRequestSent(ctx) {
  const msg = ctx.callbackQuery?.message;

  // убираем "часики"
  try { await ctx.answerCbQuery(); } catch {}

  try {
    // если это фото/медиа с caption
    if (msg && typeof msg.caption === "string") {
      const base = msg.caption || "";
      const next = base.includes("✅ Заявку надіслано")
        ? base
        : `${base}\n\n✅ Заявку надіслано ✅`;

      await ctx.editMessageCaption(next, { reply_markup: { inline_keyboard: [] } });
      return;
    }

    // если это текстовое сообщение
    if (msg && typeof msg.text === "string") {
      await ctx.editMessageText("Заявку надіслано ✅", { reply_markup: { inline_keyboard: [] } });
      return;
    }

    // fallback
    await ctx.reply("Заявку надіслано ✅");
  } catch (e) {
    // fallback если edit запрещён/сломался
    try { await ctx.reply("Заявку надіслано ✅"); } catch {}
  }
}

module.exports = { markRequestSent };
