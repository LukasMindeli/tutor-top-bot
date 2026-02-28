const { tgUserLink } = require("./helpers");

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

  // учитель прийняв
  bot.action(/T_REQ_ACCEPT_([0-9a-fA-F-]{36})/, async (ctx) => {
    const reqId = ctx.match[1];
    await ctx.answerCbQuery();

    const current = await store.getRequestById(reqId);
    if (!current) return ctx.reply("Заявку не знайдено.");
    if (String(current.teacher_id) !== String(ctx.from.id)) return ctx.reply("Це не твоя заявка.");
    if (current.status !== "pending") return ctx.reply("Ця заявка вже оброблена.");

    const req = await store.updateRequestStatus(reqId, ctx.from.id, "accepted");
    if (!req) return ctx.reply("Не вдалося оновити заявку.");

    // +1 бал за прийняття заявки
    const prof = await store.getTeacherProfile(ctx.from.id);
    const curPts = Number.isFinite(prof?.points) ? prof.points : 0;
    await store.updateTeacherProfile(ctx.from.id, { points: curPts + 1 });

    const teacherMeta = await store.getUserMeta(ctx.from.id);
    const teacherLink = tgUserLink(ctx.from.id, teacherMeta?.username);

    try {
      await bot.telegram.sendMessage(
        req.student_id,
        `✅ Вчитель прийняв заявку!\nПредмет: ${req.subject || "—"}\n\nНапиши вчителю: ${teacherLink}`
      );
    } catch (e) {}

    await ctx.editMessageText(`✅ Прийнято\n(+1 бал)`);
  });

  // учитель відхилив
  bot.action(/T_REQ_DECLINE_([0-9a-fA-F-]{36})/, async (ctx) => {
    const reqId = ctx.match[1];
    await ctx.answerCbQuery();

    const current = await store.getRequestById(reqId);
    if (!current) return ctx.reply("Заявку не знайдено.");
    if (String(current.teacher_id) !== String(ctx.from.id)) return ctx.reply("Це не твоя заявка.");
    if (current.status !== "pending") return ctx.reply("Ця заявка вже оброблена.");

    const req = await store.updateRequestStatus(reqId, ctx.from.id, "declined");
    if (!req) return ctx.reply("Не вдалося оновити заявку.");

    try {
      await bot.telegram.sendMessage(
        req.student_id,
        `❌ Вчитель відхилив заявку.\nПредмет: ${req.subject || "—"}`
      );
    } catch (e) {}

    await ctx.editMessageText("❌ Відхилено");
  });
}

module.exports = { registerRequests };
