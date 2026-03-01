const { replyBottom } = require("./respond");

function registerTeacherNotify(bot, deps) {
  const { store, ui, getSession } = deps;
  const ADMIN_ID = String(process.env.ADMIN_TELEGRAM_ID || "");

  bot.action("T_TOGGLE_ACTIVE", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { try { await ctx.answerCbQuery(); } catch {} ; return; }

    const prof = await store.getTeacherProfile(ctx.from.id);

    // анкета должна быть заполнена
    if (!prof?.subject || !prof?.price || !prof?.bio) {
      await replyBottom(ctx, "Спочатку заповни анкету (предмет, ціна, опис), тоді можна вмикати Активна.", ui.mainMenu("teacher"));
      return;
    }

    const newActive = !prof.is_active;
    await store.updateTeacherProfile(ctx.from.id, { is_active: newActive });

    // уведомление админу — только первый раз когда анкета стала активной
    if (newActive && ADMIN_ID && prof.admin_notified === false) {
      const meta = await store.getUserMeta(ctx.from.id);
      const uname = meta?.username ? `@${meta.username}` : "—";
      try {
        await bot.telegram.sendMessage(
          ADMIN_ID,
          `🆕 Створено анкету (Вчитель)\nID: ${ctx.from.id}\nІм'я: ${meta?.first_name || "—"}\nUsername: ${uname}\nПредмет: ${prof.subject}\nЦіна: ${prof.price} грн`
        );
      } catch (e) {}

      await store.updateTeacherProfile(ctx.from.id, { admin_notified: true });
    }

    await replyBottom(
      ctx,
      newActive ? "✅ Анкета активна. Тепер учні можуть тебе знаходити." : "⏸ Анкета на паузі. У пошуку ти не показуєшся.",
      ui.mainMenu("teacher")
    );
  });
}

module.exports = { registerTeacherNotify };
