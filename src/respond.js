async function safeDeleteCallbackMessage(ctx) {
  try {
    const msg = ctx.callbackQuery?.message;
    if (!msg) return;
    await ctx.telegram.deleteMessage(msg.chat.id, msg.message_id);
  } catch (e) {
    // молча (Telegram может запретить/48h/и т.д.)
  }
}

async function replyBottom(ctx, text, extra) {
  // если это кнопка — сначала закрываем "часики"
  try { await ctx.answerCbQuery(); } catch (e) {}

  // всегда пишем НОВОЕ сообщение (оно будет снизу)
  await ctx.reply(text, extra);

  // чтобы не было "грязно" — удаляем старое меню (сообщение с кнопками)
  await safeDeleteCallbackMessage(ctx);
}

module.exports = { replyBottom };
