const { Markup } = require("telegraf");
const { tgUserLink } = require("./helpers");

function registerRequests(bot, deps) {
  const { store, ui, getUserSession, LIMITS } = deps;
  const MONO_LEAD_URL = String(process.env.MONO_LEAD_URL || "");

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

  bot.action(/T_REQ_ACCEPT_([0-9a-fA-F-]{36})/, async (ctx) => {
    const reqId = ctx.match[1];
    await ctx.answerCbQuery();

    const updated = await store.updateRequestStatus(reqId, ctx.from.id, "accepted");
    if (!updated) return ctx.reply("Заявка вже оброблена або це не твоя заявка.");

    const teacherMeta = await store.getUserMeta(ctx.from.id);
    const teacherLink = tgUserLink(ctx.from.id, teacherMeta?.username);

    const studentMeta = await store.getUserMeta(updated.student_id);
    const studentLink = tgUserLink(updated.student_id, studentMeta?.username);

    // ученик получает контакт учителя сразу
    try {
      await bot.telegram.sendMessage(
        updated.student_id,
        `✅ Вчитель прийняв заявку!\nПредмет: ${updated.subject || "—"}\n\nКонтакт вчителя: ${teacherLink}`
      );
    } catch (e) {}

    // учитель: контакт ученика + Monobank URL + скрин
    const rows = [];

    if (MONO_LEAD_URL) {
      rows.push([Markup.button.url("💳 Оплатити Monobank (100 грн)", MONO_LEAD_URL)]);
      rows.push([Markup.button.callback("📷 Надіслати скрін оплати", `T_LEAD_PROOF_${reqId}`)]);
    } else {
      rows.push([Markup.button.callback("⚠️ MONO_LEAD_URL не налаштовано", "IGNORE")]);
    }

    rows.push([Markup.button.callback("⬅️ В меню", "BACK_MENU")]);

    await ctx.editMessageText(
      `✅ Прийнято\n\nКонтакт учня: ${studentLink}\n\n` +
      `Оплата ЛІДа: після підтвердження скріну отримаєш бали та +1 учень.`,
      Markup.inlineKeyboard(rows)
    );
  });

  bot.action(/T_REQ_DECLINE_([0-9a-fA-F-]{36})/, async (ctx) => {
    const reqId = ctx.match[1];
    await ctx.answerCbQuery();

    const req = await store.getRequestById(reqId);
    if (!req) return ctx.reply("Заявку не знайдено.");
    if (String(req.teacher_id) !== String(ctx.from.id)) return ctx.reply("Це не твоя заявка.");
    if (req.status !== "pending") return ctx.reply("Ця заявка вже оброблена.");

    await store.updateRequestStatus(reqId, ctx.from.id, "declined");

    try {
      await bot.telegram.sendMessage(
        req.student_id,
        `❌ Вчитель відхилив заявку.\nПредмет: ${req.subject || "—"}`
      );
    } catch (e) {}

    await ctx.editMessageText("❌ Відхилено");
  });

  bot.action("IGNORE", async (ctx) => ctx.answerCbQuery());
}

module.exports = { registerRequests };
