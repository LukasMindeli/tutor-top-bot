const { Markup } = require("telegraf");
const storeAdmin = require("./store_admin");
const { fmtDate, truncate } = require("./helpers");

function teacherCardTextUA(t) {
  const topLine = (t.is_top && t.top_until) ? `⭐ ТОП до ${fmtDate(t.top_until)}\n` : (t.is_top ? "⭐ ТОП\n" : "");
  const name = t.first_name || "Вчитель";
  const price = t.price != null ? `${t.price} грн / 60 хв` : "—";
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

function registerAdminBrowse(bot, deps) {
  const { store, ui, getSession, SUBJECT_LABELS, searchSubjects, PROMO_PACKS } = deps;

  const ADMIN_ID = String(process.env.ADMIN_TELEGRAM_ID || "");

  const isAdmin = (ctx) => ADMIN_ID && String(ctx.from?.id) === ADMIN_ID;
  const isAuthed = (s) => Number.isFinite(s.adminAuthedUntil) && s.adminAuthedUntil > Date.now();

  const collapsedKb = (tid) => Markup.inlineKeyboard([[Markup.button.callback("🛠 Дія", `A_ACT_${tid}`)]]);

  const expandedKb = (tid, isBlocked) => {
    const blockLabel = isBlocked ? "✅ Розблокувати" : "⛔ Заблокувати";
    return Markup.inlineKeyboard([
      [Markup.button.callback("🎯 Бали +10", `A_P_${tid}_10`), Markup.button.callback("🎯 Бали -10", `A_P_${tid}_-10`)],
      [Markup.button.callback("👥 Учні +1", `A_S_${tid}_1`), Markup.button.callback("👥 Учні -1", `A_S_${tid}_-1`)],
      [Markup.button.callback("⭐ Дати ТОП", `A_TOPG_${tid}`), Markup.button.callback("🧹 Зняти ТОП", `A_UNTOP_${tid}`)],
      [Markup.button.callback(blockLabel, `A_BLOCK_${tid}`)],
      [Markup.button.callback("💬 Написати", `A_MSG_${tid}`)],
      [Markup.button.callback("🗑️ Видалити анкету", `A_DEL_${tid}`)],
      [Markup.button.callback("⬅️ Згорнути", `A_ACT_BACK_${tid}`)],
    ]);
  };

  async function sendPage(ctx, subjectLabel) {
    const s = getSession(ctx.from.id);

    const list = s.adminBrowseList?.subject === subjectLabel
      ? s.adminBrowseList.items
      : await store.listTeachersBySubject(subjectLabel);

    s.adminBrowseList = s.adminBrowseList?.subject === subjectLabel
      ? s.adminBrowseList
      : { subject: subjectLabel, items: list, offset: 0 };

    const offset = s.adminBrowseList.offset || 0;
    const pageItems = list.slice(offset, offset + 7);

    if (!pageItems.length) {
      await ctx.reply("Більше репетиторів немає.", Markup.inlineKeyboard([
        [Markup.button.callback("🔄 Оновити список", "A_BROWSE_REFRESH")],
        [Markup.button.callback("🔎 Змінити предмет", "A_BROWSE_START")],
        [Markup.button.callback("⬅️ В адмін-меню", "A_MENU")],
      ]));
      return;
    }

    for (const t of pageItems) {
      const text = teacherCardTextUA(t);
      const kb = collapsedKb(t.telegram_id);
      if (t.photo_file_id) await ctx.replyWithPhoto(t.photo_file_id, { caption: text, ...kb });
      else await ctx.reply(text, kb);
    }

    s.adminBrowseList.offset = offset + pageItems.length;

    const hasMore = s.adminBrowseList.offset < list.length;
    const controls = [];
    if (hasMore) controls.push([Markup.button.callback("Показати ще 7", "A_BROWSE_MORE_7")]);
    controls.push([Markup.button.callback("🔄 Оновити список", "A_BROWSE_REFRESH")]);
    controls.push([Markup.button.callback("🔎 Змінити предмет", "A_BROWSE_START")]);
    controls.push([Markup.button.callback("⬅️ В адмін-меню", "A_MENU")]);

    await ctx.reply("Далі:", Markup.inlineKeyboard(controls));
  }

  // --- START BROWSE ---
  bot.action("A_BROWSE_START", async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }

    s.adminStep = "A_BROWSE_QUERY";
    s.subjQuery = "";
    s.subjOffset = 0;
    s.adminBrowseList = null;

    await ctx.answerCbQuery();
    await ctx.reply("Введи предмет (текстом). Наприклад: математика / англ / хімія", ui.backMenuKeyboard());
  });

  // admin text handler
  bot.on("text", async (ctx, next) => {
    if (!isAdmin(ctx)) return next();
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) return next();

    // Пошук предмета
    if (s.adminStep === "A_BROWSE_QUERY") {
      const q = (ctx.message.text || "").trim();
      if (q.length < 2) return ctx.reply("Напиши хоча б 2 символи.");

      s.subjQuery = q;
      s.subjOffset = 0;

      const all = searchSubjects(SUBJECT_LABELS, q);
      if (!all.length) return ctx.reply("Нічого не знайшов. Спробуй інший запит.");

      const page = all.slice(0, 10);
      const hasMore = all.length > 10;

      const rows = page.map((m) => [Markup.button.callback(m.label, `A_SUBJ_${m.idx}`)]);
      if (hasMore) rows.push([Markup.button.callback("Показати ще", "A_SUBJ_MORE")]);
      rows.push([Markup.button.callback("⬅️ В адмін-меню", "A_MENU")]);

      await ctx.reply(`Обери предмет (запит: “${q}”)`, Markup.inlineKeyboard(rows));
      return;
    }

    // Повідомлення користувачу
    if (s.adminStep === "A_WAIT_MSG" && s.adminMsgTarget) {
      const tid = String(s.adminMsgTarget);
      const msg = (ctx.message.text || "").trim();
      if (!msg) return;

      s.adminStep = null;
      s.adminMsgTarget = null;

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

  bot.action("A_SUBJ_MORE", async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }

    const all = searchSubjects(SUBJECT_LABELS, s.subjQuery || "");
    await ctx.answerCbQuery();
    if (!all.length) return ctx.reply("Немає результатів.");

    s.subjOffset = (s.subjOffset || 0) + 10;
    if (s.subjOffset >= all.length) s.subjOffset = 0;

    const page = all.slice(s.subjOffset, s.subjOffset + 10);
    const hasMore = (s.subjOffset + 10) < all.length;

    const rows = page.map((m) => [Markup.button.callback(m.label, `A_SUBJ_${m.idx}`)]);
    if (hasMore) rows.push([Markup.button.callback("Показати ще", "A_SUBJ_MORE")]);
    rows.push([Markup.button.callback("⬅️ В адмін-меню", "A_MENU")]);

    await ctx.reply(`Обери предмет (запит: “${s.subjQuery}”)`, Markup.inlineKeyboard(rows));
  });

  bot.action(/A_SUBJ_(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }

    const idx = parseInt(ctx.match[1], 10);
    const label = SUBJECT_LABELS[idx];
    await ctx.answerCbQuery();
    if (!label) return ctx.reply("Помилка вибору предмета.");

    s.adminStep = null;
    s.lastBrowseSubject = label;
    s.adminBrowseList = null;

    await ctx.reply(`Показую перших 7 репетиторів по предмету: ${label} ✅`);
    await sendPage(ctx, label);
  });

  bot.action("A_BROWSE_MORE_7", async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }
    await ctx.answerCbQuery();

    const subject = s.adminBrowseList?.subject || s.lastBrowseSubject;
    if (!subject) return ctx.reply("Спочатку обери предмет.");
    await sendPage(ctx, subject);
  });

  bot.action("A_BROWSE_REFRESH", async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }
    await ctx.answerCbQuery();

    const subject = s.adminBrowseList?.subject || s.lastBrowseSubject;
    if (!subject) return ctx.reply("Спочатку обери предмет.");

    s.adminBrowseList = null;
    const list = await store.listTeachersBySubject(subject);
    s.adminBrowseList = { subject, items: list, offset: 0 };
    await ctx.reply("🔄 Оновлено.");
    await sendPage(ctx, subject);
  });

  // --- ACTION MENU ---
  bot.action(/A_ACT_(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }

    const tid = String(ctx.match[1]);
    const meta = await store.getUserMeta(tid);
    const blocked = !!meta?.is_blocked;

    await ctx.answerCbQuery();
    try { await ctx.editMessageReplyMarkup(expandedKb(tid, blocked).reply_markup); } catch {}
  });

  bot.action(/A_ACT_BACK_(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }

    const tid = String(ctx.match[1]);
    await ctx.answerCbQuery();
    try { await ctx.editMessageReplyMarkup(collapsedKb(tid).reply_markup); } catch {}
  });

  bot.action(/A_P_(\d+)_(-?\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }

    const tid = String(ctx.match[1]);
    const delta = parseInt(ctx.match[2], 10);

    const prof = await store.getTeacherProfile(tid);
    const cur = Number.isFinite(prof?.points) ? prof.points : 0;
    const next = cur + delta;

    await store.updateTeacherProfile(tid, { points: next });
    await ctx.answerCbQuery(`Бали: ${cur} → ${next}`);
  });

  bot.action(/A_S_(\d+)_(-?\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }

    const tid = String(ctx.match[1]);
    const delta = parseInt(ctx.match[2], 10);

    const prof = await store.getTeacherProfile(tid);
    const cur = Number.isFinite(prof?.paid_students_count) ? prof.paid_students_count : 0;
    const next = Math.max(0, cur + delta);

    await store.updateTeacherProfile(tid, { paid_students_count: next });
    await ctx.answerCbQuery(`Учні: ${cur} → ${next}`);
  });

  // give TOP
  bot.action(/A_TOPG_(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }

    const tid = String(ctx.match[1]);
    const subs = await store.listTeacherSubjects(tid);
    if (!subs.length) return ctx.reply("У цього вчителя немає предметів.");

    s.actTop = { tid, subs };

    await ctx.answerCbQuery();
    await ctx.reply("⭐ Обери предмет для ТОП:", Markup.inlineKeyboard([
      ...subs.slice(0, 25).map((subj, i) => [Markup.button.callback(subj, `A_TOPSUB_${i}`)]),
      [Markup.button.callback("⬅️ В адмін-меню", "A_MENU")],
    ]));
  });

  bot.action(/A_TOPSUB_(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s) || !s.actTop?.tid) { await ctx.answerCbQuery(); return; }

    const i = parseInt(ctx.match[1], 10);
    const subject = s.actTop.subs?.[i];
    if (!subject) return;

    s.actTop.subject = subject;

    await ctx.answerCbQuery();
    await ctx.reply(`⭐ ТОП\nВчитель: ${s.actTop.tid}\nПредмет: ${subject}\n\nОбери термін:`,
      Markup.inlineKeyboard([
        ...PROMO_PACKS.map(p => [Markup.button.callback(`${p.days} днів`, `A_TOPD_${p.days}`)]),
        [Markup.button.callback("⬅️ В адмін-меню", "A_MENU")],
      ])
    );
  });

  bot.action(/A_TOPD_(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s) || !s.actTop?.tid || !s.actTop?.subject) { await ctx.answerCbQuery(); return; }

    const days = parseInt(ctx.match[1], 10);
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    await store.addPromo(s.actTop.tid, s.actTop.subject, expiresAt, "admin");
    await ctx.answerCbQuery("ТОП видано ✅");
    await ctx.reply(`✅ ТОП видано\nПредмет: ${s.actTop.subject}\nДо: ${fmtDate(expiresAt)}`);
  });

  // remove TOP
  bot.action(/A_UNTOP_(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }

    const tid = String(ctx.match[1]);
    const subs = await store.listTeacherSubjects(tid);
    if (!subs.length) return ctx.reply("У цього вчителя немає предметів.");

    s.actUnTop = { tid, subs };

    await ctx.answerCbQuery();
    await ctx.reply("🧹 Обери предмет для зняття ТОП:", Markup.inlineKeyboard([
      ...subs.slice(0, 25).map((subj, i) => [Markup.button.callback(subj, `A_UNTOPSUB_${i}`)]),
      [Markup.button.callback("⬅️ В адмін-меню", "A_MENU")],
    ]));
  });

  bot.action(/A_UNTOPSUB_(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s) || !s.actUnTop?.tid) { await ctx.answerCbQuery(); return; }

    const i = parseInt(ctx.match[1], 10);
    const subject = s.actUnTop.subs?.[i];
    if (!subject) return;

    await store.removePromoSubject(s.actUnTop.tid, subject);
    await ctx.answerCbQuery("ТОП знято ✅");
    await ctx.reply(`✅ ТОП знято\nПредмет: ${subject}`);
  });

  // block/unblock
  bot.action(/A_BLOCK_(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }

    const tid = String(ctx.match[1]);
    const meta = await store.getUserMeta(tid);
    const next = !meta?.is_blocked;

    await storeAdmin.setUserBlocked(tid, next);

    await ctx.answerCbQuery(next ? "Заблоковано ⛔" : "Розблоковано ✅");
    try { await ctx.editMessageReplyMarkup(expandedKb(tid, next).reply_markup); } catch {}
  });

  // message
  bot.action(/A_MSG_(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }

    s.adminStep = "A_WAIT_MSG";
    s.adminMsgTarget = String(ctx.match[1]);

    await ctx.answerCbQuery();
    await ctx.reply("✍️ Напиши текст повідомлення одним повідомленням. Я надішлю його користувачу.");
  });

  // delete profile confirm
  bot.action(/A_DEL_(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }

    const tid = String(ctx.match[1]);
    await ctx.answerCbQuery();

    await ctx.reply(`🗑️ Видалити анкету?\nID: ${tid}`, Markup.inlineKeyboard([
      [Markup.button.callback("✅ Так, видалити", `A_DEL_OK_${tid}`)],
      [Markup.button.callback("❌ Скасувати", "A_MENU")],
    ]));
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
