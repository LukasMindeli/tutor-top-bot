const { Markup } = require("telegraf");
const { tgUserLink } = require("./helpers");

const SENT_TEXT = "✅ Заявка надіслана";

async function markRequestSent(ctx) {
  const msg = ctx.callbackQuery?.message;

  try { await ctx.answerCbQuery(); } catch {}

  // photo card -> caption
  try {
    if (msg && typeof msg.caption === "string") {
      const base = msg.caption || "";
      const next = base.includes(SENT_TEXT) ? base : `${base}\n\n${SENT_TEXT}`;
      await ctx.editMessageCaption(next, { reply_markup: { inline_keyboard: [] } });
      return;
    }
  } catch {}

  // text card
  try {
    if (msg && typeof msg.text === "string") {
      const base = msg.text || "";
      const next = base.includes(SENT_TEXT) ? base : `${base}\n\n${SENT_TEXT}`;
      await ctx.editMessageText(next, { reply_markup: { inline_keyboard: [] } });
      return;
    }
  } catch {}

  try { await ctx.reply(SENT_TEXT); } catch {}
}

function registerRequests(bot, deps) {
  const { store, ui, getUserSession, LIMITS } = deps;
  const MONO_LEAD_URL = String(process.env.MONO_LEAD_URL || "").trim();

  // STUDENT -> send request
  bot.action(/S_REQ_(\d+)/, async (ctx) => {
    const s = getUserSession(ctx.from.id);
    if (s.mode !== "student") { try { await ctx.answerCbQuery(); } catch {}; return; }
    try { await ctx.answerCbQuery(); } catch {}

    const teacherId = String(ctx.match[1]);
    const subject = s.lastStudentSubject || null;

    const cnt = await store.countStudentRequestsLastHour(ctx.from.id);
    if (cnt >= LIMITS.REQ_LIMIT_PER_HOUR) {
      await ctx.reply("Забагато заявок за годину. Спробуй пізніше.");
      return;
    }

    // ✅ создаём "один раз"
    const r = await store.createRequestOnce(teacherId, ctx.from.id, subject);
    if (!r || !r.id) {
      await ctx.reply("Помилка. Не вдалося створити заявку.");
      return;
    }

    // ✅ если already exists -> НЕ шлем учителю повторно
    if (!r.created) {
      await markRequestSent(ctx);
      return;
    }

    // created=true -> шлем учителю 1 раз
    const studentMeta = await store.getUserMeta(ctx.from.id);
    const studentName = studentMeta?.first_name || "Учень";

    try {
      await bot.telegram.sendMessage(
        teacherId,
        `📩 Нова заявка\nВід: ${studentName}\nПредмет: ${subject || "—"}\n\nПрийняти заявку?`,
        ui.requestDecisionKeyboard(r.id)
      );
    } catch {}

    await markRequestSent(ctx);
  });

  // TEACHER -> accept
  bot.action(/T_REQ_ACCEPT_([0-9a-fA-F-]{36})/, async (ctx) => {
    const reqId = ctx.match[1];
    try { await ctx.answerCbQuery(); } catch {}

    const updated = await store.updateRequestStatus(reqId, ctx.from.id, "accepted");
    if (!updated) {
      await ctx.reply("Заявка вже оброблена або це не твоя заявка.");
      return;
    }

    const teacherMeta = await store.getUserMeta(ctx.from.id);
    const teacherUrl = tgUserLink(ctx.from.id, teacherMeta?.username);

    const studentMeta = await store.getUserMeta(updated.student_id);
    const studentUrl = tgUserLink(updated.student_id, studentMeta?.username);

    // student gets teacher contact (кнопкой — так надёжнее)
    try {
      await bot.telegram.sendMessage(
        updated.student_id,
        `✅ Вчитель прийняв заявку!\nПредмет: ${updated.subject || "—"}\n\nНатисни кнопку нижче, щоб написати вчителю:`,
        Markup.inlineKeyboard([
          [Markup.button.url("✉️ Написати вчителю", teacherUrl)],
        ])
      );
    } catch {}

    // teacher gets student contact + lead payment buttons
    const rows = [];

    // ✅ контакт учня — кнопка
    rows.push([Markup.button.url("✉️ Написати учню", studentUrl)]);

    // ✅ оплата ліда (через банку + скрін)
    if (MONO_LEAD_URL) {
      rows.push([Markup.button.url("💳 Оплатити Monobank (100 грн)", MONO_LEAD_URL)]);
      rows.push([Markup.button.callback("📷 Надіслати скрін оплати", `T_LEAD_PROOF_${reqId}`)]);
    }

    rows.push([Markup.button.callback("⬅️ В меню", "BACK_MENU")]);

    const text =
      `✅ Прийнято\n\n` +
      `Оплата ЛІДа: після підтвердження скріну отримаєш бали та +1 учень.`;

    try {
      await ctx.editMessageText(text, Markup.inlineKeyboard(rows));
    } catch {
      await ctx.reply(text, Markup.inlineKeyboard(rows));
    }
  });

  // TEACHER -> decline
  bot.action(/T_REQ_DECLINE_([0-9a-fA-F-]{36})/, async (ctx) => {
    const reqId = ctx.match[1];
    try { await ctx.answerCbQuery(); } catch {}

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
    } catch {}

    try { await ctx.editMessageText("❌ Відхилено"); }
    catch { await ctx.reply("❌ Відхилено"); }
  });

  bot.action("IGNORE", async (ctx) => { try { await ctx.answerCbQuery(); } catch {} });
}

module.exports = { registerRequests };