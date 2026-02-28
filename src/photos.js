const { Markup } = require("telegraf");

function registerPhotos(bot, deps) {
  const { store, ui, getSession } = deps;

  bot.action("T_PHOTO_MENU", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    const prof = await store.getTeacherProfile(ctx.from.id);
    const has = !!prof?.photo_file_id;

    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `📷 Фото анкети\n\nСтатус: ${has ? "✅ Є фото" : "— Немає фото"}\n\nЩо робимо?`,
      Markup.inlineKeyboard([
        [Markup.button.callback(has ? "🔄 Замінити фото" : "➕ Додати фото", "T_PHOTO_ADD")],
        ...(has ? [[Markup.button.callback("👁️ Подивитись фото", "T_PHOTO_SHOW")]] : []),
        ...(has ? [[Markup.button.callback("🗑️ Видалити фото", "T_PHOTO_DELETE")]] : []),
        [Markup.button.callback("⬅️ В меню", "BACK_MENU")],
      ])
    );
  });

  bot.action("T_PHOTO_ADD", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    s.step = "T_WAIT_PROFILE_PHOTO";
    await ctx.answerCbQuery();
    await ctx.editMessageText("Надішли ОДНЕ фото сюди в чат (як звичайне фото в Telegram).", ui.backMenuKeyboard());
  });

  bot.action("T_PHOTO_DELETE", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    await store.updateTeacherProfile(ctx.from.id, { photo_file_id: null });

    await ctx.answerCbQuery();
    await ctx.editMessageText("Фото видалено ✅", ui.mainMenu("teacher"));
  });

  bot.action("T_PHOTO_SHOW", async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") { await ctx.answerCbQuery(); return; }

    const prof = await store.getTeacherProfile(ctx.from.id);
    await ctx.answerCbQuery();

    if (!prof?.photo_file_id) return ctx.reply("Фото ще не додано.");
    await ctx.replyWithPhoto(prof.photo_file_id, { caption: "Фото з анкети" });
  });

  // ВАЖНО: next() чтобы не ломать другие photo-обработчики (скрины оплаты)
  bot.on("photo", async (ctx, next) => {
    const s = getSession(ctx.from.id);
    if (s.step !== "T_WAIT_PROFILE_PHOTO") return next();

    const arr = ctx.message.photo || [];
    const best = arr[arr.length - 1];
    if (!best?.file_id) {
      await ctx.reply("Не зміг прочитати фото. Спробуй ще раз.");
      return;
    }

    await store.updateTeacherProfile(ctx.from.id, { photo_file_id: best.file_id });

    s.step = null;
    await ctx.reply("Фото збережено ✅", ui.mainMenu("teacher"));
  });
}

module.exports = { registerPhotos };
