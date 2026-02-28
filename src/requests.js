const { Markup } = require("telegraf");
const { tgUserLink } = require("./helpers");
const ext = require("./store_ext");

function registerRequests(bot, deps) {
  const { store, ui, getUserSession, LIMITS } = deps;

  // студент надсилає заявку
  bot.action(/S_REQ_(\d+)/, async (ctx) => {
    const s = getUserSession(ctx.from.id);
    if (s.mode !== "student") { await ctx.answerCbQuery(); return; }

    await ctx.answerCbQuery();

    const teacherId = String(ctx.match[1]);
    const subject = s.lastStudentSubject || null;

    const cnt = await store.countStudentRequestsLastHour(ctx.from.id);
    if (cnt >= LIMITS.REQ_LIMIT_PER_HOUR) {
      await ctx.reply("Забагато заявок за годину. Спробуй пізніше.");
      return;
    }

    const reqId = await store.createRequest(teacherId, ctx.from.id, subject);
    if (!reqId) {
      await ctx.reply("Помилка. Не вдалося створити заявку.");
      return;
    }

    const studentMeta = await store.getUserMeta(ctx.from.id);
    const studentName = studentMeta?.first_name || "Учень";

    try {
      await bot.telegram.sendMessage(
        teacherId,
        `📩 Нова заявка\nВід: ${studentName}\nПредмет: ${subject || "—"}\n\nПрийняти заявку?`,
        ui.requestDecisionKeyboard(reqId)
      );
    } catch (e) {}

    await ctx.editMessageText("Заявку надіслано ✅", ui.backMenuKeyboard());
  });

  // учитель прийняв → +1 бал → учню кнопки "урок був/не домовились"
  bot.action(/T_REQ_ACCEPT_([0-9a-fA-F-]{36})/, async (ctx) => {
    const reqId = ctx.match[1];
    await ctx.answerCbQuery();

    // меняем статус строго pending -> accepted
    const updated = await ext.updateRequestStatusGuard(reqId, "teacher_id", ctx.from.id, "pending", "accepted");
    if (!updated) return ctx.reply("Заявка вже оброблена або це не твоя заявка.");

    // +1 бал за прийняття
    await ext.incrementTeacherPoints(ctx.from.id, 1);

    const teacherMeta = await store.getUserMeta(ctx.from.id);
    const teacherLink = tgUserLink(ctx.from.id, teacherMeta?.username);

    // ученику — 2 кнопки подтверждения результата
    try {
      await bot.telegram.sendMessage(
        updated.student_id,
        `✅ Вчитель прийняв заявку!\nПредмет: ${updated.subject || "—"}\n\nНапиши вчителю: ${teacherLink}\n\nПотім натисни результат:`,
        Markup.inlineKeyboard([
          [Markup.button.callback("✅ Урок відбувся (+3 бали вчителю)", `S_REQ_DONE_${reqId}`)],
          [Markup.button.callback("❌ Не домовились (0 балів)", `S_REQ_CANCEL_${reqId}`)],
        ])
      );
    } catch (e) {}

    await ctx.editMessageText("✅ Прийнято (+1 бал)");
  });

  // учитель відхилив
  bot.action(/T_REQ_DECLINE_([0-9a-fA-F-]{36})/, async (ctx) => {
    const reqId = ctx.match[1];
    await ctx.answerCbQuery();

    const updated = await ext.updateRequestStatusGuard(reqId, "teacher_id", ctx.from.id, "pending", "declined");
    if (!updated) return ctx.reply("Заявка вже оброблена або це не твоя заявка.");

    try {
      await bot.telegram.sendMessage(
        updated.student_id,
        `❌ Вчитель відхилив заявку.\nПредмет: ${updated.subject || "—"}`
      );
    } catch (e) {}

    await ctx.editMessageText("❌ Відхилено");
  });

  // ученик подтверждает: урок был → accepted -> completed → учителю +3
  bot.action(/S_REQ_DONE_([0-9a-fA-F-]{36})/, async (ctx) => {
    const reqId = ctx.match[1];
    await ctx.answerCbQuery();

    const updated = await ext.updateRequestStatusGuard(reqId, "student_id", ctx.from.id, "accepted", "completed");
    if (!updated) return ctx.reply("Цю дію вже виконано або заявка не в статусі 'accepted'.");

    await ext.incrementTeacherPoints(updated.teacher_id, 3);

    // уведомим учителя
    try {
      await bot.telegram.sendMessage(
        updated.teacher_id,
        `🎉 Учень підтвердив: урок відбувся.\nПредмет: ${updated.subject || "—"}\n(+3 бали)`
      );
    } catch (e) {}

    await ctx.editMessageText("Дякую ✅ Позначив як: урок відбувся.");
  });

  // ученик подтверждает: не договорились → accepted -> cancelled → 0 баллов
  bot.action(/S_REQ_CANCEL_([0-9a-fA-F-]{36})/, async (ctx) => {
    const reqId = ctx.match[1];
    await ctx.answerCbQuery();

    const updated = await ext.updateRequestStatusGuard(reqId, "student_id", ctx.from.id, "accepted", "cancelled");
    if (!updated) return ctx.reply("Цю дію вже виконано або заявка не в статусі 'accepted'.");

    try {
      await bot.telegram.sendMessage(
        updated.teacher_id,
        `ℹ️ Учень позначив: не домовились.\nПредмет: ${updated.subject || "—"}`
      );
    } catch (e) {}

    await ctx.editMessageText("Ок. Позначив як: не домовились.");
  });
}

module.exports = { registerRequests };
