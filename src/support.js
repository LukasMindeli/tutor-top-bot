function registerSupport(bot, deps) {
  const { ui, getSession } = deps;

  const ADMIN_ID = String(process.env.ADMIN_TELEGRAM_ID || "");

  bot.action("SUPPORT", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);

    s.step = "SUPPORT_WAIT_TEXT";

    await ctx.editMessageText(
      "🆘 Підтримка\n\nНапиши одним повідомленням, що сталося. Я отримаю і відповім.",
      ui.backMenuKeyboard()
    );
  });

  bot.on("text", async (ctx, next) => {
    const s = getSession(ctx.from.id);
    if (s.step !== "SUPPORT_WAIT_TEXT") return next();

    const text = (ctx.message.text || "").trim();
    if (!text || text.startsWith("/")) {
      await ctx.reply("Напиши повідомлення звичайним текстом (не команду).");
      return;
    }

    s.step = null;

    if (!ADMIN_ID) {
      await ctx.reply("Підтримка тимчасово недоступна (ADMIN_TELEGRAM_ID не налаштовано).", ui.backMenuKeyboard());
      return;
    }

    const name = ctx.from.first_name || "—";
    const username = ctx.from.username ? `@${ctx.from.username}` : "—";
    const role = s.mode === "teacher" ? "Вчитель" : (s.mode === "student" ? "Учень" : "—");

    const msg =
      `🆘 Нове звернення\n` +
      `Роль: ${role}\n` +
      `ID: ${ctx.from.id}\n` +
      `Ім'я: ${name}\n` +
      `Username: ${username}\n\n` +
      `Повідомлення:\n${text}`;

    try { await bot.telegram.sendMessage(ADMIN_ID, msg); } catch (e) {}

    await ctx.reply("✅ Надіслано. Дякую! Я відповім тобі в Telegram.", ui.backMenuKeyboard());
  });
}

module.exports = { registerSupport };
