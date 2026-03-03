const { Markup } = require("telegraf");
const { supabase } = require("./supabase");
const storeAdmin = require("./store_admin");
const { fmtDate, truncate } = require("./helpers");

function registerAdminBrowse(bot, deps) {
  const { store, ui, getSession, SUBJECT_LABELS, searchSubjects, PROMO_PACKS } = deps;

  const ADMIN_ID = String(process.env.ADMIN_TELEGRAM_ID || "");

  function isAdmin(ctx) {
    return ADMIN_ID && String(ctx.from?.id) === ADMIN_ID;
  }
  function isAuthed(s) {
    return Number.isFinite(s.adminAuthedUntil) && s.adminAuthedUntil > Date.now();
  }

  function teacherTextUA(t) {
    const topLine = t.is_top && t.top_until
      ? `⭐ ТОП активний до ${fmtDate(t.top_until)}\n`
      : (t.is_top ? "⭐ ТОП\n" : "");
    const name = t.first_name || "Вчитель";
    const price = (t.price != null) ? `${t.price} грн / 60 хв` : "—";
    const bio = truncate(t.bio || "—", 450);
    const points = Number.isFinite(t.points) ? t.points : 0;
    const students = Number.isFinite(t.paid_students_count) ? t.paid_students_count : 0;

    return (
      `${topLine}` +
      `👤 ${name}\n` +
      `Предмет: ${t.subject}\n` +
      `Ціна: ${price}\n` +
      `Учнів: ${students}\n` +
      `Бали: ${points}\n\n` +
      `Опис:\n${bio}\n\n` +
      `ID: ${t.telegram_id}`
    );
  }

  function buildMatchesKeyboard(page, hasMore) {
    const rows = page.map((m) => [Markup.button.callback(m.label, `A_BROWSE_PICK_${m.idx}`)]);
    if (hasMore) rows.push([Markup.button.callback("Показати ще", "A_BROWSE_MORE")]);
    rows.push([Markup.button.callback("⬅️ Адмін-меню", "A_MENU")]);
    return Markup.inlineKeyboard(rows);
  }

  function actionKbCollapsed(tid) {
    return Markup.inlineKeyboard([[Markup.button.callback("⚙️ Дія", `A_ACT_${tid}`)]]);
  }

  function actionKbExpanded(tid, isBlocked) {
    const blockLabel = isBlocked ? "✅ Розблокувати" : "⛔ Заблокувати";
    return Markup.inlineKeyboard([
      [Markup.button.callback("🎯 +10 балів", `A_PTS_${tid}_10`), Markup.button.callback("🎯 -10 балів", `A_PTS_${tid}_-10`)],
      [Markup.button.callback("👥 +1 учень", `A_STU_${tid}_1`), Markup.button.callback("👥 -1 учень", `A_STU_${tid}_-1`)],
      ...PROMO_PACKS.map(p => [Markup.button.callback(`⭐ ТОП ${p.days} дн`, `A_TOP_${tid}_${p.days}`)]),
      [Markup.button.callback("🧹 Зняти ТОП", `A_UNTOP_${tid}`)],
      [Markup.button.callback(blockLabel, `A_BLOCK_${tid}`)],
      [Markup.button.callback("✉️ Написати", `A_MSG_${tid}`)],
      [Markup.button.callback("🗑️ Видалити анкету", `A_DEL_${tid}`)],
      [Markup.button.callback("⬅️ Згорнути", `A_ACT_BACK_${tid}`)],
    ]);
  }

  async function sendTutorsPage(ctx, subjectLabel) {
    const s = getSession(ctx.from.id);
    s.adminBrowseSubject = subjectLabel;

    const list = s.adminTutorList?.subject === subjectLabel
      ? s.adminTutorList.items
      : await store.listTeachersBySubject(subjectLabel);

    s.adminTutorList = s.adminTutorList?.subject === subjectLabel
      ? s.adminTutorList
      : { subject: subjectLabel, items: list, offset: 0 };

    const offset = s.adminTutorList.offset || 0;
    const pageItems = list.slice(offset, offset + 7);

    if (!pageItems.length) {
      await ctx.reply("Більше репетиторів немає.", Markup.inlineKeyboard([
        [Markup.button.callback("🔎 Змінити предмет", "A_BROWSE_START")],
        [Markup.button.callback("⬅️ Адмін-меню", "A_MENU")],
      ]));
      return;
    }

    for (const t of pageItems) {
      const text = teacherTextUA(t);
      const kb = actionKbCollapsed(t.telegram_id);
      if (t.photo_file_id) await ctx.replyWithPhoto(t.photo_file_id, { caption: text, ...kb });
      else await ctx.reply(text, kb);
    }

    s.adminTutorList.offset = offset + pageItems.length;

    const hasMore = s.adminTutorList.offset < list.length;
    const controls = [];
    if (hasMore) controls.push([Markup.button.callback("Показати ще 7", "A_BROWSE_MORE_7")]);
    controls.push([Markup.button.callback("🔎 Змінити предмет", "A_BROWSE_START")]);
    controls.push([Markup.button.callback("⬅️ Адмін-меню", "A_MENU")]);

    await ctx.reply("Далі:", Markup.inlineKeyboard(controls));
  }

  // ====== START ======
  bot.action("A_BROWSE_START", async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }

    s.adminStep = "A_WAIT_SUBJECT_QUERY";
    s.subjQuery = "";
    s.subjOffset = 0;
    s.adminTutorList = null;

    await ctx.answerCbQuery();
    await ctx.reply("Введи предмет (текстом). Наприклад: математика / англ / хімія", ui.backMenuKeyboard());
  });

  // text handler for subject query + admin messages
  bot.on("text", async (ctx, next) => {
    if (!isAdmin(ctx)) return next();
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) return next();
    if (!s.adminStep) return next();

    // 1) subject search
    if (s.adminStep === "A_WAIT_SUBJECT_QUERY") {
      const q = (ctx.message.text || "").trim();
      if (q.length < 2) {
        await ctx.reply("Напиши хоча б 2 символи.");
        return;
      }

      s.subjQuery = q;
      s.subjOffset = 0;

      const all = searchSubjects(SUBJECT_LABELS, q);
      if (!all.length) {
        await ctx.reply("Нічого не знайшов. Спробуй інший запит.");
        return;
      }

      const page = all.slice(0, 10);
      const hasMore = all.length > 10;

      await ctx.reply(`Обери предмет (запит: “${q}”)`, buildMatchesKeyboard(page, hasMore));
      return;
    }

    // 2) admin message to user
    if (s.adminStep === "A_WAIT_MSG" && s.adminMsgTarget) {
      const tid = String(s.adminMsgTarget);
      const msg = (ctx.message.text || "").trim();
      s.adminStep = null;
      s.adminMsgTarget = null;

      if (!msg) {
        await ctx.reply("Скасовано.");
        return;
      }

      try {
        await bot.telegram.sendMessage(tid, `📩 Повідомлення від адміністратора:\n\n${msg}`);
        await ctx.reply("✅ Надіслано.");
      } catch {
        await ctx.reply("❌ Не вдалося надіслати (можливо, користувач заблокував бота).");
      }
      return;
    }

    return next();
  });

  bot.action("A_BROWSE_MORE", async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }

    const all = searchSubjects(SUBJECT_LABELS, s.subjQuery || "");
    await ctx.answerCbQuery();
    if (!all.length) return;

    s.subjOffset = (s.subjOffset || 0) + 10;
    if (s.subjOffset >= all.length) s.subjOffset = 0;

    const page = all.slice(s.subjOffset, s.subjOffset + 10);
    const hasMore = (s.subjOffset + 10) < all.length;

    await ctx.reply(`Обери предмет (запит: “${s.subjQuery}”)`, buildMatchesKeyboard(page, hasMore));
  });

  bot.action(/A_BROWSE_PICK_(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }

    const idx = parseInt(ctx.match[1], 10);
    const label = SUBJECT_LABELS[idx];

    await ctx.answerCbQuery();
    if (!label) return ctx.reply("Помилка вибору предмета. Спробуй ще раз.");

    s.adminStep = null;
    s.adminTutorList = null;

    await ctx.reply(`Показую перших 7 репетиторів по предмету: ${label} ✅`);
    await sendTutorsPage(ctx, label);
  });

  bot.action("A_BROWSE_MORE_7", async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }
    await ctx.answerCbQuery();

    const subject = s.adminTutorList?.subject || s.adminBrowseSubject;
    if (!subject) return ctx.reply("Спочатку обери предмет.");
    await sendTutorsPage(ctx, subject);
  });

  // ====== ACTIONS ======
  bot.action(/A_ACT_(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }

    const tid = String(ctx.match[1]);
    const { data } = await supabase.from("users").select("is_blocked").eq("telegram_id", tid).maybeSingle();
    const blocked = !!data?.is_blocked;

    await ctx.answerCbQuery();
    try {
      await ctx.editMessageReplyMarkup(actionKbExpanded(tid, blocked).reply_markup);
    } catch {}
  });

  bot.action(/A_ACT_BACK_(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }

    const tid = String(ctx.match[1]);
    await ctx.answerCbQuery();
    try { await ctx.editMessageReplyMarkup(actionKbCollapsed(tid).reply_markup); } catch {}
  });

  bot.action(/A_PTS_(\d+)_(-?\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }

    const tid = String(ctx.match[1]);
    const delta = parseInt(ctx.match[2], 10);

    const { data: prof } = await supabase
      .from("teacher_profiles")
      .select("points")
      .eq("telegram_id", tid)
      .maybeSingle();

    const cur = Number.isFinite(prof?.points) ? prof.points : 0;
    const next = Math.max(0, cur + delta);

    await supabase.from("teacher_profiles").update({ points: next, updated_at: new Date().toISOString() }).eq("telegram_id", tid);
    await ctx.answerCbQuery(`Бали: ${cur} → ${next}`);
  });

  bot.action(/A_STU_(\d+)_(-?\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }

    const tid = String(ctx.match[1]);
    const delta = parseInt(ctx.match[2], 10);

    const { data: prof } = await supabase
      .from("teacher_profiles")
      .select("paid_students_count")
      .eq("telegram_id", tid)
      .maybeSingle();

    const cur = Number.isFinite(prof?.paid_students_count) ? prof.paid_students_count : 0;
    const next = Math.max(0, cur + delta);

    await supabase.from("teacher_profiles").update({ paid_students_count: next, updated_at: new Date().toISOString() }).eq("telegram_id", tid);
    await ctx.answerCbQuery(`Учні: ${cur} → ${next}`);
  });

  bot.action(/A_TOP_(\d+)_(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }

    const tid = String(ctx.match[1]);
    const days = parseInt(ctx.match[2], 10);

    const subject = s.adminBrowseSubject || s.adminTutorList?.subject;
    if (!subject) { await ctx.answerCbQuery("Спочатку обери предмет"); return; }

    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    await store.addPromo(tid, subject, expiresAt, "admin");

    await ctx.answerCbQuery(`ТОП ${days} дн ✅`);
  });

  bot.action(/A_UNTOP_(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }

    const tid = String(ctx.match[1]);
    const subject = s.adminBrowseSubject || s.adminTutorList?.subject;
    if (!subject) { await ctx.answerCbQuery("Спочатку обери предмет"); return; }

    await supabase.from("teacher_promos").delete().eq("telegram_id", tid).eq("subject", subject);
    await ctx.answerCbQuery("ТОП знято ✅");
  });

  bot.action(/A_BLOCK_(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }

    const tid = String(ctx.match[1]);

    const { data } = await supabase.from("users").select("is_blocked").eq("telegram_id", tid).maybeSingle();
    const next = !data?.is_blocked;

    // set flag
    if (storeAdmin.setUserBlocked) await storeAdmin.setUserBlocked(tid, next);
    else await supabase.from("users").update({ is_blocked: next }).eq("telegram_id", tid);

    // hide from search when blocked
    if (next) {
      await supabase.from("teacher_profiles").update({ is_active: false, updated_at: new Date().toISOString() }).eq("telegram_id", tid);
    } else {
      // if unblocked and profile complete -> activate
      const { data: prof } = await supabase
        .from("teacher_profiles")
        .select("price,bio")
        .eq("telegram_id", tid)
        .maybeSingle();
      const { data: subs } = await supabase
        .from("teacher_subjects")
        .select("subject")
        .eq("teacher_id", tid)
        .limit(1);

      const completed = !!(prof?.price != null && prof?.bio && (subs || []).length);
      if (completed) await supabase.from("teacher_profiles").update({ is_active: true, updated_at: new Date().toISOString() }).eq("telegram_id", tid);
    }

    await ctx.answerCbQuery(next ? "Заблоковано ⛔" : "Розблоковано ✅");
  });

  bot.action(/A_MSG_(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }

    s.adminStep = "A_WAIT_MSG";
    s.adminMsgTarget = String(ctx.match[1]);

    await ctx.answerCbQuery();
    await ctx.reply("✍️ Напиши текст повідомлення одним повідомленням. Я надішлю його користувачу.");
  });

  bot.action(/A_DEL_(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }

    const tid = String(ctx.match[1]);
    await ctx.answerCbQuery();

    await ctx.reply(
      `🗑️ Видалити анкету?\nID: ${tid}`,
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ Так, видалити", `A_DEL_OK_${tid}`)],
        [Markup.button.callback("❌ Скасувати", "A_MENU")],
      ])
    );
  });

  bot.action(/A_DEL_OK_(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }

    const tid = String(ctx.match[1]);
    await store.deleteTeacherProfile(tid);

    await ctx.answerCbQuery("Видалено ✅");
    await ctx.reply(`✅ Анкету видалено\nID: ${tid}`);
  });
}

module.exports = { registerAdminBrowse };
