const { Markup } = require("telegraf");

function registerPhotos(bot, deps) {
  const { store, ui, getSession } = deps;

  bot.action("T_PHOTO_MENU", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") return;

    const prof = await store.getTeacherProfile(ctx.from.id);
    const has = !!prof?.photo_file_id;

    const rows = [
      [Markup.button.callback(has ? "🔄 Замінити фото" : "➕ Додати фото", "T_PHOTO_ADD")],
    ];
    if (has) rows.push([Markup.button.callback("👁️ Подивитись фото", "T_PHOTO_SHOW")]);
    if (has) rows.push([Markup.button.callback("🗑️ Видалити фото", "T_PHOTO_DELETE")]);
    rows.push([Markup.button.callback("⬅️ В меню", "BACK_MENU")]);

    await ctx.editMessageText(
      `📷 Фото анкети\n\nСтатус: ${has ? "✅ Є фото" : "— Немає фото"}\n\nЩо робимо?`,
      Markup.inlineKeyboard(rows)
    );
  });

  bot.action("T_PHOTO_ADD", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") return;

    s.step = "T_WAIT_PROFILE_PHOTO";
    await ctx.editMessageText("Надішли ОДНЕ фото сюди в чат (як звичайне фото в Telegram).", ui.backMenuKeyboard());
  });

  bot.action("T_PHOTO_DELETE", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") return;

    await store.updateTeacherProfile(ctx.from.id, { photo_file_id: null });
    await ctx.editMessageText("Фото видалено ✅", ui.backMenuKeyboard());
  });

  bot.action("T_PHOTO_SHOW", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") return;

    const prof = await store.getTeacherProfile(ctx.from.id);
    if (!prof?.photo_file_id) return ctx.reply("Фото ще не додано.", ui.backMenuKeyboard());
    await ctx.replyWithPhoto(prof.photo_file_id, { caption: "Фото з анкети" });
  });

  // важно: next() — чтобы не мешать скринам оплат
  bot.on("photo", async (ctx, next) => {
    const s = getSession(ctx.from.id);
    if (s.step !== "T_WAIT_PROFILE_PHOTO") return next();

    const arr = ctx.message.photo || [];
    const best = arr[arr.length - 1];
    if (!best?.file_id) {
      await ctx.reply("Не зміг прочитати фото. Спробуй ще раз.", ui.backMenuKeyboard());
      return;
    }

    await store.updateTeacherProfile(ctx.from.id, { photo_file_id: best.file_id });
    s.step = null;

    await ctx.reply("Фото збережено ✅", ui.backMenuKeyboard());
  });
}

module.exports = { registerPhotos };
