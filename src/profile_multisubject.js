function registerTeacherProfileCard(bot, deps) {
  const { store, ui, getSession } = deps;

  bot.action("T_SHOW_PROFILE", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") return;

    const prof = await store.getTeacherProfile(ctx.from.id);
    const subs = (await store.listTeacherSubjects(ctx.from.id)) || [];

    const active = prof?.is_active ? "✅ Активна" : "⏸ Пауза";
    const price = prof?.price != null ? `${prof.price} грн / 60 хв` : "—";
    const points = Number.isFinite(prof?.points) ? prof.points : 0;
    const students = Number.isFinite(prof?.paid_students_count) ? prof.paid_students_count : 0;
    const bio = prof?.bio ? prof.bio : "—";
    const photo = prof?.photo_file_id ? "✅ Є" : "— Немає";

    const subjText = subs.length ? subs.map(x => `• ${x}`).join("\n") : "— (додай у «📚 Предмети»)";

    const text =
      `👤 <b>Моя анкета</b>\n\n` +
      `<b>Статус:</b> ${active}\n` +
      `<b>Предмети:</b>\n${subjText}\n\n` +
      `<b>Ціна:</b> ${price}\n` +
      `<b>Фото:</b> ${photo}\n` +
      `<b>Учнів:</b> <b>${students}</b>\n` +
      `<b>Бали:</b> ${points}\n\n` +
      `<b>Опис:</b>\n${bio}`;

    await ctx.editMessageText(text, { parse_mode: "HTML", ...ui.backMenuKeyboard() });
  });
}

module.exports = { registerTeacherProfileCard };
