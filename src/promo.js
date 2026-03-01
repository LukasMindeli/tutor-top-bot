const { Markup } = require("telegraf");
const { supabase } = require("./supabase");
const proofsStore = require("./store_proofs");
const { PROMO_PACKS } = require("./constants");
const { fmtDate } = require("./helpers");

async function listTeacherSubjects(teacherId) {
  const { data, error } = await supabase
    .from("teacher_subjects")
    .select("subject")
    .eq("teacher_id", String(teacherId))
    .order("subject", { ascending: true });

  if (error) {
    console.error("listTeacherSubjects error:", error.message);
    return [];
  }
  return (data || []).map(r => r.subject).filter(Boolean);
}

async function getActivePromo(teacherId, subject) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("teacher_promos")
    .select("expires_at")
    .eq("telegram_id", String(teacherId))
    .eq("subject", subject)
    .gt("expires_at", now)
    .order("expires_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("getActivePromo error:", error.message);
    return null;
  }
  return data?.expires_at || null;
}

async function addPromo(teacherId, subject, expiresAt, chargeId) {
  const { error } = await supabase.from("teacher_promos").insert({
    telegram_id: String(teacherId),
    subject,
    expires_at: expiresAt,
    charge_id: chargeId || null,
  });
  if (error) console.error("addPromo error:", error.message);
}

function registerPromo(bot, deps) {
  const { ui, getSession } = deps;

  const ADMIN_ID = String(process.env.ADMIN_TELEGRAM_ID || "");
  const MONO_TOP_URL = String(process.env.MONO_TOP_URL || "");

  function isAdminAuthed(ctx) {
    if (!ADMIN_ID) return false;
    if (String(ctx.from?.id) !== String(ADMIN_ID)) return false;
    const s = getSession(ctx.from.id);
    return Number.isFinite(s.adminAuthedUntil) && s.adminAuthedUntil > Date.now();
  }

  bot.action("T_PROMO", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (s.mode !== "teacher") return;

    const subjects = await listTeacherSubjects(ctx.from.id);
    if (!subjects.length) {
      await ctx.editMessageText(
        "Щоб купити ТОП — спочатку додай хоча б 1 предмет у «📚 Предмети».",
        Markup.inlineKeyboard([
          [Markup.button.callback("📚 Предмети", "T_SUBJECTS_MENU")],
          [Markup.button.callback("⬅️ В меню", "BACK_MENU")],
        ])
      );
      return;
    }

    s.topSubjects = subjects;

    const rows = subjects.slice(0, 25).map((subj, i) => [Markup.button.callback(subj, `TOP_SUBJ_${i}`)]);
    rows.push([Markup.button.callback("⬅️ В меню", "BACK_MENU")]);

    await ctx.editMessageText("⭐ Обери предмет, по якому ти хочеш ТОП:", Markup.inlineKeyboard(rows));
  });

  bot.action(/TOP_SUBJ_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    const i = parseInt(ctx.match[1], 10);
    const subject = s.topSubjects?.[i];
    if (!subject) return;

    s.topSubject = subject;

    const promoUntil = await getActivePromo(ctx.from.id, subject);
    const promoLine = promoUntil ? `⭐ ТОП активний до ${fmtDate(promoUntil)}` : "⭐ ТОП: —";

    const rows = PROMO_PACKS.map((p) => [
      Markup.button.callback(`${p.days} днів — ${p.priceUah} грн або ${p.priceStars} ⭐`, `TOP_BUY_${p.days}`)
    ]);
    rows.push([Markup.button.callback("⬅️ Назад", "T_PROMO")]);

    await ctx.editMessageText(
      `⭐ ТОП репетитора\n\nПредмет: ${subject}\n${promoLine}\n\nОбери пакет:`,
      Markup.inlineKeyboard(rows)
    );
  });

  bot.action(/TOP_BUY_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (!s.topSubject) return;

    const days = parseInt(ctx.match[1], 10);
    const pack = PROMO_PACKS.find((p) => p.days === days);
    if (!pack) return;

    s.topBuy = { subject: s.topSubject, days, priceUah: pack.priceUah, priceStars: pack.priceStars };

    await ctx.reply(
      `⭐ ТОП\nПредмет: ${s.topBuy.subject}\nТермін: ${days} днів\nЦіна: ${pack.priceUah} грн або ${pack.priceStars} ⭐\n\nОбери оплату:`,
      Markup.inlineKeyboard([
        [Markup.button.callback(`Оплатити ⭐ Stars (${pack.priceStars})`, "TOP_PAY_STARS")],
        [Markup.button.callback("Оплатити 💳 карткою (Monobank)", "TOP_PAY_CARD")],
        [Markup.button.callback("⬅️ Назад", "T_PROMO")],
      ])
    );
  });

  // Stars
  bot.action("TOP_PAY_STARS", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (!s.topBuy) return;

    const payload = `TOP:${ctx.from.id}:${s.topBuy.days}:${Date.now()}:${s.topBuy.subject}`;

    await ctx.replyWithInvoice({
      title: "ТОП репетитора (TutorUA)",
      description: `Предмет: ${s.topBuy.subject}\nТермін: ${s.topBuy.days} днів`,
      payload,
      provider_token: "",
      currency: "XTR",
      prices: [{ label: `ТОП на ${s.topBuy.days} днів`, amount: s.topBuy.priceStars }],
    });
  });

  bot.on("pre_checkout_query", async (ctx, next) => {
    const q = ctx.update.pre_checkout_query;
    if (!q?.invoice_payload?.startsWith("TOP:")) return next();
    try { await ctx.answerPreCheckoutQuery(true); } catch (e) {}
  });

  bot.on("successful_payment", async (ctx, next) => {
    const sp = ctx.message.successful_payment;
    if (!sp || sp.currency !== "XTR") return next();

    const payload = sp.invoice_payload || "";
    if (!payload.startsWith("TOP:")) return next();

    const parts = payload.split(":");
    const teacherId = parts[1];
    const days = parseInt(parts[2], 10);
    const subject = parts.slice(4).join(":");

    if (String(ctx.from.id) !== String(teacherId)) return;

    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    await addPromo(String(teacherId), String(subject), expiresAt, sp.telegram_payment_charge_id);

    await ctx.reply(`✅ ТОП активовано\nПредмет: ${subject}\nДо: ${fmtDate(expiresAt)}`, ui.backMenuKeyboard());
  });

  // Monobank + screenshot (manual)
  bot.action("TOP_PAY_CARD", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (!s.topBuy) return;
    if (!MONO_TOP_URL) return ctx.reply("MONO_TOP_URL не налаштовано в Railway.");

    await ctx.reply(
      `💳 Оплата ТОП через Monobank\n\n1) Натисни кнопку та оплати суму\n2) Повернись сюди та надішли скрін оплати`,
      Markup.inlineKeyboard([
        [Markup.button.url(`Відкрити Monobank (${s.topBuy.priceUah} грн)`, MONO_TOP_URL)],
        [Markup.button.callback("📷 Надіслати скрін оплати", "TOP_SEND_PROOF")],
      ])
    );
  });

  bot.action("TOP_SEND_PROOF", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (!s.topBuy) return;

    s.step = "T_WAIT_TOP_PAYPROOF";
    await ctx.reply("Надішли ОДНЕ фото (скрін оплати) сюди в чат 📷");
  });

  // фото для ТОП-скрину (важливо: next!)
  bot.on("photo", async (ctx, next) => {
    const s = getSession(ctx.from.id);
    if (s.step !== "T_WAIT_TOP_PAYPROOF") return next();

    const top = s.topBuy;
    s.step = null;

    const arr = ctx.message.photo || [];
    const best = arr[arr.length - 1];
    if (!best?.file_id) return ctx.reply("Не зміг прочитати фото.");

    const result = await proofsStore.createProof({
      kind: "top",
      teacher_id: String(ctx.from.id),
      subject: top.subject,
      days: top.days,
      amount_uah: top.priceUah,
      photo_file_id: best.file_id,
      status: "pending",
    });

    if (!result.id) return ctx.reply(`❌ Не вдалося зберегти скрін: ${result.error || "невідома помилка"}`);

    await ctx.reply("✅ Скрін відправлено. Очікуй підтвердження адміністратора.");

    if (ADMIN_ID) {
      await bot.telegram.sendPhoto(
        ADMIN_ID,
        best.file_id,
        {
          caption:
            `🧾 Підтвердження оплати (ТОП)\n\n` +
            `Proof: ${result.id}\nTeacher: ${ctx.from.id}\nПредмет: ${top.subject}\nТермін: ${top.days} днів\nСума: ${top.priceUah} грн`,
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback("✅ Підтвердити ТОП", `A_TOP_OK_${result.id}`)],
            [Markup.button.callback("❌ Відхилити", `A_TOP_NO_${result.id}`)],
          ]).reply_markup,
        }
      );
    }
  });

  bot.action(/A_TOP_OK_([0-9a-fA-F-]{36})/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!isAdminAuthed(ctx)) return ctx.reply("Адмін: спочатку /admin і пароль.");

    const proofId = ctx.match[1];
    const proof = await proofsStore.getProofById(proofId);
    if (!proof || proof.status !== "pending") return;

    const expiresAt = new Date(Date.now() + Number(proof.days) * 24 * 60 * 60 * 1000).toISOString();
    await addPromo(String(proof.teacher_id), String(proof.subject), expiresAt, proofId);
    await proofsStore.setProofStatus(proofId, "approved", ctx.from.id, null);

    await bot.telegram.sendMessage(String(proof.teacher_id), `✅ ТОП активовано\nПредмет: ${proof.subject}\nДо: ${fmtDate(expiresAt)}`);
    try { await ctx.editMessageCaption((ctx.callbackQuery.message.caption || "") + "\n\n✅ ПІДТВЕРДЖЕНО", { reply_markup: { inline_keyboard: [] } }); } catch {}
  });

  bot.action(/A_TOP_NO_([0-9a-fA-F-]{36})/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!isAdminAuthed(ctx)) return ctx.reply("Адмін: спочатку /admin і пароль.");

    const proofId = ctx.match[1];
    const proof = await proofsStore.getProofById(proofId);
    if (!proof || proof.status !== "pending") return;

    await proofsStore.setProofStatus(proofId, "rejected", ctx.from.id, "Rejected by admin");
    await bot.telegram.sendMessage(String(proof.teacher_id), "❌ Скрін оплати ТОП відхилено.");
    try { await ctx.editMessageCaption((ctx.callbackQuery.message.caption || "") + "\n\n❌ ВІДХИЛЕНО", { reply_markup: { inline_keyboard: [] } }); } catch {}
  });
}

module.exports = { registerPromo };
