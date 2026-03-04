const crypto = require("crypto");
const { Markup } = require("telegraf");
const storeAdmin = require("./store_admin");
const { fmtDate } = require("./helpers");

function sha256Hex(s) {
  return crypto.createHash("sha256").update(String(s || ""), "utf8").digest("hex");
}

function registerAdmin(bot, deps) {
  const { store, ui, getSession, SUBJECT_LABELS, searchSubjects, PROMO_PACKS } = deps;

  const ADMIN_ID = String(process.env.ADMIN_TELEGRAM_ID || "");
  const ADMIN_HASH = String(process.env.ADMIN_PASSWORD_SHA256 || "");
  const AUTH_MINUTES = 60;

  function isAdmin(ctx) {
    return ADMIN_ID && String(ctx.from?.id) === ADMIN_ID;
  }
  function isConfigured() {
    return !!(ADMIN_ID && ADMIN_HASH);
  }
  function isAuthed(s) {
    return Number.isFinite(s.adminAuthedUntil) && s.adminAuthedUntil > Date.now();
  }

  async function getTargetSummary(targetId) {
    const meta = await store.getUserMeta(targetId);
    const prof = await store.getTeacherProfile(targetId);

    const name = meta?.first_name || "—";
    const username = meta?.username ? `@${meta.username}` : "—";
    const mode = meta?.last_mode || "—";

    const subject = prof?.subject || "—";
    const price = prof?.price != null ? `${prof.price} грн / 60 хв` : "—";
    const active = prof?.is_active ? "✅ так" : "❌ ні";
    const points = Number.isFinite(prof?.points) ? prof.points : 0;
    const photo = prof?.photo_file_id ? "✅ є" : "—";

    return { meta, prof, name, username, mode, subject, price, active, points, photo };
  }

  async function showAdminMenu(ctx, edit = false) {
    const s = getSession(ctx.from.id);

    let targetBlock = "Ціль: не обрано";
    if (s.adminTargetId) {
      const t = await getTargetSummary(s.adminTargetId);
      targetBlock =
        `Ціль: ${s.adminTargetId}\n` +
        `Ім'я: ${t.name} (${t.username})\n` +
        `Роль: ${t.mode}\n` +
        `Анкета: ${t.subject} | ${t.price} | активна: ${t.active}\n` +
        `Фото: ${t.photo} | Бали: ${t.points}`;
    }

    const text =
      `🛡️ Адмін-кабінет\n\n` +
      `Авторизація: ✅\n` +
      `${targetBlock}\n\n` +
      `Оберіть дію:`;

    const kb = Markup.inlineKeyboard([
  [Markup.button.callback("👨‍🏫 Репетитори", "A_BROWSE_START")],
  [Markup.button.callback("🔎 Обрати користувача", "A_PICK_USER")],
  [Markup.button.callback("🎯 Бали", "A_POINTS")],
  [Markup.button.callback("⭐ Дати ТОП безкоштовно", "A_TOP")],
  [Markup.button.callback("🗑️ Видалити акаунт", "A_DELETE")],
  [Markup.button.callback("🚪 Вийти", "A_LOGOUT")],
  [Markup.button.callback("⬅️ В меню бота", "BACK_MENU")],
]);

    if (edit && ctx.editMessageText) return ctx.editMessageText(text, kb);
    return ctx.reply(text, kb);
  }

  // ===== /admin =====
  bot.command("admin", async (ctx) => {
    if (!isAdmin(ctx)) return;

    if (!isConfigured()) {
      await ctx.reply("Адмін не налаштований. Додай ADMIN_TELEGRAM_ID і ADMIN_PASSWORD_SHA256 у Railway Variables.");
      return;
    }

    const s = getSession(ctx.from.id);
    if (isAuthed(s)) {
      await showAdminMenu(ctx, false);
      return;
    }

    s.adminStep = "WAIT_PASSWORD";
    await ctx.reply("Введи пароль адміністратора одним повідомленням:");
  });

  bot.command("admin_logout", async (ctx) => {
    if (!isAdmin(ctx)) return;
    const s = getSession(ctx.from.id);
    s.adminAuthedUntil = 0;
    s.adminStep = null;
    s.adminTargetId = null;
    await ctx.reply("Вийшов ✅");
  });

  // ===== callbacks =====
  bot.action("A_LOGOUT", async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    s.adminAuthedUntil = 0;
    s.adminStep = null;
    s.adminTargetId = null;
    await ctx.answerCbQuery();
    await ctx.editMessageText("Вийшов ✅");
  });

  bot.action("A_PICK_USER", async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }

    s.adminStep = "WAIT_TARGET";
    await ctx.answerCbQuery();
    await ctx.editMessageText("Відправ Telegram ID (цифри) або @username користувача:");
  });

  bot.action("A_POINTS", async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }
    if (!s.adminTargetId) { await ctx.answerCbQuery(); return ctx.reply("Спочатку обери користувача (🔎)."); }

    const t = await getTargetSummary(s.adminTargetId);

    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `🎯 Бали\n\nЦіль: ${s.adminTargetId}\nПоточні бали: ${t.points}\n\nОбери дію:`,
      Markup.inlineKeyboard([
        [Markup.button.callback("➕ +1", "A_PADD_1"), Markup.button.callback("➕ +10", "A_PADD_10")],
        [Markup.button.callback("➖ -1", "A_PADD_-1"), Markup.button.callback("➖ -10", "A_PADD_-10")],
        [Markup.button.callback("✍️ Встановити число", "A_PSET")],
        [Markup.button.callback("⬅️ Назад", "A_MENU")],
      ])
    );
  });

  bot.action("A_PSET", async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s) || !s.adminTargetId) { await ctx.answerCbQuery(); return; }

    s.adminStep = "WAIT_SETPOINTS";
    await ctx.answerCbQuery();
    await ctx.editMessageText("Введи число балів (наприклад 0 або 25 або -10):");
  });

  bot.action(/A_PADD_(-?\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s) || !s.adminTargetId) { await ctx.answerCbQuery(); return; }

    const delta = parseInt(ctx.match[1], 10);
    const prof = await store.getTeacherProfile(s.adminTargetId);
    const cur = Number.isFinite(prof?.points) ? prof.points : 0;
    const next = cur + delta;

    await store.updateTeacherProfile(s.adminTargetId, { points: next });

    await ctx.answerCbQuery();
    await ctx.editMessageText(`✅ Готово\nЦіль: ${s.adminTargetId}\nБуло: ${cur}\nСтало: ${next}`, Markup.inlineKeyboard([
      [Markup.button.callback("⬅️ До балів", "A_POINTS")],
      [Markup.button.callback("🏠 Адмін меню", "A_MENU")],
    ]));
  });

  bot.action("A_MENU", async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }

    await ctx.answerCbQuery();
    await showAdminMenu(ctx, true);
  });

  // ===== TOP (free) =====
  bot.action("A_TOP", async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }
    if (!s.adminTargetId) { await ctx.answerCbQuery(); return ctx.reply("Спочатку обери користувача (🔎)."); }

    s.adminStep = "WAIT_TOP_QUERY";
    s.topSubjQuery = "";
    s.topSubjOffset = 0;

    await ctx.answerCbQuery();
    await ctx.editMessageText("Введи предмет для ТОП (текстом):");
  });

  function topMatchesKeyboard(page, hasMore) {
    const rows = page.map((m) => [Markup.button.callback(m.label, `A_TOP_PICK_${m.idx}`)]);
    if (hasMore) rows.push([Markup.button.callback("Показати ще", "A_TOP_MORE")]);
    rows.push([Markup.button.callback("⬅️ Назад", "A_MENU")]);
    return Markup.inlineKeyboard(rows);
  }

  bot.action("A_TOP_MORE", async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s) || !s.adminTargetId) { await ctx.answerCbQuery(); return; }

    const all = searchSubjects(SUBJECT_LABELS, s.topSubjQuery || "");
    await ctx.answerCbQuery();
    if (!all.length) return ctx.reply("Немає результатів. Введи інший запит.");

    s.topSubjOffset = (s.topSubjOffset || 0) + 10;
    if (s.topSubjOffset >= all.length) s.topSubjOffset = 0;

    const page = all.slice(s.topSubjOffset, s.topSubjOffset + 10);
    const hasMore = (s.topSubjOffset + 10) < all.length;

    await ctx.editMessageText(
      `Обери предмет для ТОП:\nЗапит: “${s.topSubjQuery}”`,
      topMatchesKeyboard(page, hasMore)
    );
  });

  bot.action(/A_TOP_PICK_(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s) || !s.adminTargetId) { await ctx.answerCbQuery(); return; }

    const idx = parseInt(ctx.match[1], 10);
    const label = SUBJECT_LABELS[idx];
    await ctx.answerCbQuery();
    if (!label) return ctx.reply("Помилка вибору. Спробуй ще раз.");

    s.topSubject = label;

    // выбор срока из PROMO_PACKS
    const rows = PROMO_PACKS.map((p) => [Markup.button.callback(`${p.days} днів`, `A_TOP_DAYS_${p.days}`)]);
    rows.push([Markup.button.callback("⬅️ Назад", "A_TOP")]);

    await ctx.editMessageText(
      `⭐ ТОП безкоштовно\n\nЦіль: ${s.adminTargetId}\nПредмет: ${label}\n\nОбери термін:`,
      Markup.inlineKeyboard(rows)
    );
  });

  bot.action(/A_TOP_DAYS_(\d+)/, async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s) || !s.adminTargetId || !s.topSubject) { await ctx.answerCbQuery(); return; }

    const days = parseInt(ctx.match[1], 10);
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    await store.addPromo(s.adminTargetId, s.topSubject, expiresAt, "free_admin");

    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `✅ ТОП видано\nЦіль: ${s.adminTargetId}\nПредмет: ${s.topSubject}\nДо: ${fmtDate(expiresAt)}`,
      Markup.inlineKeyboard([[Markup.button.callback("🏠 Адмін меню", "A_MENU")]])
    );
  });

  // ===== Delete =====
  bot.action("A_DELETE", async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s)) { await ctx.answerCbQuery(); return; }
    if (!s.adminTargetId) { await ctx.answerCbQuery(); return ctx.reply("Спочатку обери користувача (🔎)."); }

    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `🗑️ Видалити акаунт?\n\nЦіль: ${s.adminTargetId}\n\nЦе видалить користувача, анкету, промо та заявки (cascade).`,
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ Так, видалити", "A_DELETE_CONFIRM")],
        [Markup.button.callback("❌ Скасувати", "A_MENU")],
      ])
    );
  });

  bot.action("A_DELETE_CONFIRM", async (ctx) => {
    if (!isAdmin(ctx)) { await ctx.answerCbQuery(); return; }
    const s = getSession(ctx.from.id);
    if (!isAuthed(s) || !s.adminTargetId) { await ctx.answerCbQuery(); return; }

    const ok = await storeAdmin.deleteUser(s.adminTargetId);
    const deletedId = s.adminTargetId;
    s.adminTargetId = null;

    await ctx.answerCbQuery();
    await ctx.editMessageText(ok ? `✅ Видалено: ${deletedId}` : `❌ Не вдалося видалити: ${deletedId}`);
  });

  // ===== Admin text middleware (НЕ ЛОМАЕТ ученик/учитель) =====
  bot.on("text", async (ctx, next) => {
    if (!isAdmin(ctx)) return next();

    const s = getSession(ctx.from.id);
    if (!s.adminStep) return next();

    // пароль
    if (s.adminStep === "WAIT_PASSWORD") {
      const input = (ctx.message.text || "").trim();
      const hash = sha256Hex(input);

      if (hash !== ADMIN_HASH) {
        await ctx.reply("❌ Невірний пароль. Спробуй ще раз або /admin для перезапуску.");
        return;
      }

      s.adminStep = null;
      s.adminAuthedUntil = Date.now() + AUTH_MINUTES * 60 * 1000;

      await ctx.reply(`✅ Доступ надано (${AUTH_MINUTES} хв)`);
      await showAdminMenu(ctx, false);
      return;
    }

    // выбор цели
    if (s.adminStep === "WAIT_TARGET") {
      const raw = (ctx.message.text || "").trim();

      let targetId = null;
      if (/^@/.test(raw)) {
        targetId = await storeAdmin.findUserIdByUsername(raw);
      } else if (/^\d+$/.test(raw)) {
        targetId = raw;
      }

      if (!targetId) {
        await ctx.reply("Не зрозумів. Відправ цифри (Telegram ID) або @username.");
        return;
      }

      // проверим, существует ли пользователь
      const meta = await store.getUserMeta(targetId);
      if (!meta) {
        await ctx.reply("Користувача не знайдено в базі. Він має хоча б 1 раз написати цьому боту.");
        return;
      }

      s.adminTargetId = String(targetId);
      s.adminStep = null;

      await ctx.reply(`✅ Ціль обрана: ${s.adminTargetId}`);
      await showAdminMenu(ctx, false);
      return;
    }

    // set points exact
    if (s.adminStep === "WAIT_SETPOINTS") {
      if (!s.adminTargetId) {
        s.adminStep = null;
        await ctx.reply("Немає цілі. Спочатку обери користувача.");
        return;
      }

      const pts = parseInt((ctx.message.text || "").trim(), 10);
      if (!Number.isFinite(pts)) {
        await ctx.reply("Потрібне число. Наприклад: 0 або 25 або -10.");
        return;
      }

      await store.updateTeacherProfile(s.adminTargetId, { points: pts });

      s.adminStep = null;
      await ctx.reply(`✅ Готово. Бали для ${s.adminTargetId}: ${pts}`);
      await showAdminMenu(ctx, false);
      return;
    }

    // top subject query
    if (s.adminStep === "WAIT_TOP_QUERY") {
      if (!s.adminTargetId) {
        s.adminStep = null;
        await ctx.reply("Немає цілі. Спочатку обери користувача.");
        return;
      }

      const q = (ctx.message.text || "").trim();
      if (q.length < 2) {
        await ctx.reply("Напиши хоча б 2 символи для пошуку предмета.");
        return;
      }

      s.topSubjQuery = q;
      s.topSubjOffset = 0;

      const all = searchSubjects(SUBJECT_LABELS, q);
      if (!all.length) {
        await ctx.reply("Нічого не знайшов. Спробуй інший запит.");
        return;
      }

      const page = all.slice(0, 10);
      const hasMore = all.length > 10;

      await ctx.reply(
        `Обери предмет для ТОП:\nЗапит: “${q}”`,
        topMatchesKeyboard(page, hasMore)
      );
      return;
    }

    return next();
  });
}

module.exports = { registerAdmin };
