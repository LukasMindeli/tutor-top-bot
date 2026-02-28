const { makeReqId, canSendRequest, tgUserLink, subjLabel } = require("./helpers");

function registerRequests(bot, deps) {
  const { db, persist, ui, getUser, getSession } = deps;

  // студент натискає "Надіслати заявку"
  bot.action(/S_REQ_(\d+)/, async (ctx) => {
    const s = getSession(ctx.from.id);
    if (s.mode !== "student") {
      await ctx.answerCbQuery();
      return;
    }

    const teacherId = String(ctx.match[1]);
    const teacher = db.users[teacherId];

    await ctx.answerCbQuery();
    if (!teacher) return ctx.reply("Вчителя не знайдено.");

    const student = getUser(ctx.from.id);

    if (!canSendRequest(student, deps.LIMITS.REQ_LIMIT_PER_HOUR)) {
      return ctx.reply("Забагато заявок за годину. Спробуй пізніше.");
    }

    const reqId = makeReqId();
    const subject = s.lastStudentSubject || teacher.teacher.subject;

    db.requests ||= {};
    db.requests[reqId] = {
      id: reqId,
      teacherId,
      studentId: String(ctx.from.id),
      subject,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    persist();

    // повідомлення вчителю з кнопками
    const studentName = student.meta?.first_name || "Учень";
    const studentUsername = student.meta?.username || "";

    try {
      await bot.telegram.sendMessage(
        teacherId,
        `📩 Нова заявка (${reqId})\nВід: ${studentName}\nПредмет: ${subjLabel(subject)}\n\nПрийняти заявку?`,
        ui.requestDecisionKeyboard(reqId)
      );
    } catch (e) {
      // якщо вчитель ніколи не писав боту — Telegram не дозволить
    }

    await ctx.editMessageText(
      "Заявку надіслано ✅\n\nЯкщо вчитель уже писав цьому боту — він отримає повідомлення.",
      ui.backMenuKeyboard()
    );
  });

  // вчитель приймає
  bot.action(/T_REQ_ACCEPT_(req_.+)/, async (ctx) => {
    const reqId = ctx.match[1];
    const req = db.requests?.[reqId];

    await ctx.answerCbQuery();
    if (!req) return ctx.reply("Заявку не знайдено.");
    if (String(req.teacherId) !== String(ctx.from.id)) return ctx.reply("Це не твоя заявка.");
    if (req.status !== "pending") return ctx.reply(`Заявка вже оброблена: ${req.status}`);

    req.status = "accepted";
    req.updatedAt = new Date().toISOString();
    persist();

    const teacher = getUser(ctx.from.id);
    const teacherLink = tgUserLink(ctx.from.id, teacher.meta?.username);

    // повідомлення учню
    try {
      await bot.telegram.sendMessage(
        req.studentId,
        `✅ Вчитель прийняв заявку!\nПредмет: ${subjLabel(req.subject)}\n\nНапиши вчителю: ${teacherLink}`
      );
    } catch (e) {}

    await ctx.editMessageText(`✅ Прийнято\nЗаявка: ${reqId}`);
  });

  // вчитель відхиляє
  bot.action(/T_REQ_DECLINE_(req_.+)/, async (ctx) => {
    const reqId = ctx.match[1];
    const req = db.requests?.[reqId];

    await ctx.answerCbQuery();
    if (!req) return ctx.reply("Заявку не знайдено.");
    if (String(req.teacherId) !== String(ctx.from.id)) return ctx.reply("Це не твоя заявка.");
    if (req.status !== "pending") return ctx.reply(`Заявка вже оброблена: ${req.status}`);

    req.status = "declined";
    req.updatedAt = new Date().toISOString();
    persist();

    try {
      await bot.telegram.sendMessage(req.studentId, `❌ Вчитель відхилив заявку.\nПредмет: ${subjLabel(req.subject)}`);
    } catch (e) {}

    await ctx.editMessageText(`❌ Відхилено\nЗаявка: ${reqId}`);
  });
}

module.exports = { registerRequests };
