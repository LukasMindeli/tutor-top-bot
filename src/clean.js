async function safeDelete(ctx, chatId, messageId) {
  try {
    await ctx.telegram.deleteMessage(chatId, messageId);
  } catch (e) {
    // молча (48h лимит и прочие ограничения)
  }
}

function cleanupMiddleware(getSession) {
  return async (ctx, next) => {
    await next();

    if (!ctx.from?.id || !ctx.chat?.id) return;
    const s = getSession(ctx.from.id);

    if (!s.cleanMode) return;
    if (!ctx.message?.message_id) return;

    // команды оставляем (чтобы не путать)
    const text = (ctx.message.text || "").trim();
    if (text.startsWith("/")) return;

    await safeDelete(ctx, ctx.chat.id, ctx.message.message_id);
  };
}

function registerCleanCommands(bot, getSession) {
  bot.command("clean", async (ctx) => {
    const s = getSession(ctx.from.id);
    s.cleanMode = !s.cleanMode;
    await ctx.reply(`🧹 Режим прибирання: ${s.cleanMode ? "УВІМКНЕНО ✅" : "ВИМКНЕНО ❌"}`);
  });

  bot.command("clean_on", async (ctx) => {
    const s = getSession(ctx.from.id);
    s.cleanMode = true;
    await ctx.reply("🧹 Режим прибирання: УВІМКНЕНО ✅");
  });

  bot.command("clean_off", async (ctx) => {
    const s = getSession(ctx.from.id);
    s.cleanMode = false;
    await ctx.reply("🧹 Режим прибирання: ВИМКНЕНО ❌");
  });
}

module.exports = { cleanupMiddleware, registerCleanCommands };
