const { Markup } = require("telegraf");
const { tgUserLink } = require("./helpers");
const { sendLeadInvoiceStars, sendLeadInvoiceCard } = require("./payments");

function registerRequests(bot, deps) {
  const { store, ui, getUserSession, LIMITS, CARD_PROVIDER_TOKEN } = deps;

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

    // учитель видит контакт ученика + кнопки добровольной оплаты
    await ctx.editMessageText(
      `✅ Прийнято\n\nКонтакт учня: ${studentLink}\n\nХочеш отримати бали та збільшити лічильник учнів?\nОплати лід (добровільно):`,
      Markup.inlineKeyboard([
        [Markup.button.callback("Оплатити ⭐ Stars", `T_LEAD_PAY_STARS_${reqId}`)],
        [Markup.button.callback("Оплатити 💳 карткою", `T_LEAD_PAY_CARD_${reqId}`)],
      ])
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

  bot.action(/T_LEAD_PAY_STARS_([0-9a-fA-F-]{36})/, async (ctx) => {
    const reqId = ctx.match[1];
    await ctx.answerCbQuery();

    const req = await store.getRequestById(reqId);
    if (!req) return ctx.reply("Заявку не знайдено.");
    if (String(req.teacher_id) !== String(ctx.from.id)) return ctx.reply("Це не твоя заявка.");
    if (req.lead_paid) return ctx.reply("Цей лід вже оплачено ✅");
    if (req.status !== "accepted") return ctx.reply("Оплата доступна лише після прийняття заявки.");

    await sendLeadInvoiceStars(ctx, reqId);
  });

  bot.action(/T_LEAD_PAY_CARD_([0-9a-fA-F-]{36})/, async (ctx) => {
    const reqId = ctx.match[1];
    await ctx.answerCbQuery();

    if (!CARD_PROVIDER_TOKEN) {
      await ctx.reply("Оплата карткою поки не налаштована (CARD_PROVIDER_TOKEN).");
      return;
    }

    const req = await store.getRequestById(reqId);
    if (!req) return ctx.reply("Заявку не знайдено.");
    if (String(req.teacher_id) !== String(ctx.from.id)) return ctx.reply("Це не твоя заявка.");
    if (req.lead_paid) return ctx.reply("Цей лід вже оплачено ✅");
    if (req.status !== "accepted") return ctx.reply("Оплата доступна лише після прийняття заявки.");

    await sendLeadInvoiceCard(ctx, reqId, CARD_PROVIDER_TOKEN);
  });
}

module.exports = { registerRequests };
