require("dotenv").config();
const { loadDB, saveDB } = require("./db");
const { Telegraf, Markup } = require("telegraf");

const bot = new Telegraf(process.env.BOT_TOKEN);
const CARD_PROVIDER_TOKEN = process.env.CARD_PROVIDER_TOKEN || "";

// ====== Простая "БД" в файле ======
const db = loadDB();

function persist() { saveDB(db); }

// runtime-сессии
const session = new Map(); // userId -> { mode, step, pendingPromo, lastStudentSubject }

// ====== Константы ======
const SUBJECTS = [
  { key: "math", label: "Математика" },
  { key: "english", label: "Английский" },
  { key: "ukrainian", label: "Украинский язык" },
  { key: "physics", label: "Физика" },
  { key: "piano", label: "Пианино" },
];

const PROMO_PACKS = [
  { days: 7, priceUah: 199, priceStars: 120 },
  { days: 30, priceUah: 499, priceStars: 300 },
  { days: 90, priceUah: 1199, priceStars: 800 },
];

const PRICE_MIN = 50;
const PRICE_MAX = 5000;
const BIO_MIN = 10;
const BIO_MAX = 600;

// антиспам заявок
const REQ_LIMIT_PER_HOUR = 10;

function subjLabel(key) {
  return SUBJECTS.find((s) => s.key === key)?.label || key || "—";
}
function nowMs() {
  return Date.now();
}
function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString("uk-UA");
  } catch {
    return iso;
  }
}

function getUser(userId) {
  db.users[userId] ||= {
    meta: { first_name: "", username: "" },
    lastMode: null,
    teacher: { subject: null, price: null, bio: null, isActive: false },
    student: {},
    promos: {},
  };
  return db.users[userId];
}
function getSession(userId) {
  session.set(userId, session.get(userId) || {});
  return session.get(userId);
}

function isPromoActive(user, subjectKey) {
  const p = user?.promos?.[subjectKey];
  if (!p?.expiresAt) return false;
  return new Date(p.expiresAt).getTime() > nowMs();
}

// ====== HELPERS: заявки ======
function makeReqId() {
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function canSendRequest(studentId) {
  const user = getUser(studentId);
  user.student.reqLog ||= [];

  const hourAgo = nowMs() - 60 * 60 * 1000;
  user.student.reqLog = user.student.reqLog.filter((t) => t > hourAgo);

  if (user.student.reqLog.length >= REQ_LIMIT_PER_HOUR) return false;

  user.student.reqLog.push(nowMs());
  return true;
}

// ====== HELPERS: удаление анкеты ======
function resetTeacherProfile(user) {
  // удаляем анкету
  user.teacher = { subject: null, price: null, bio: null, isActive: false };

  // удаляем ТОП-статусы (если были)
  user.promos = {};

  // удаляем заявки на этого учителя (чтобы база не пухла)
  for (const [reqId, req] of Object.entries(db.requests || {})) {
    if (String(req.teacherId) === String(user._id)) {
      delete db.requests[reqId];
    }
  }
}

// сохраняем имя/юзернейм
bot.use(async (ctx, next) => {
  if (ctx.from?.id) {
    const u = getUser(ctx.from.id);
    // сохраняем id внутрь объекта (для resetTeacherProfile)
    u._id = String(ctx.from.id);

    u.meta.first_name = ctx.from.first_name || u.meta.first_name;
    u.meta.username = ctx.from.username || u.meta.username;
    persist();
  }
  return next();
});

// ====== UI ======
function modeKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("👨‍🏫 Режим: Учитель", "MODE_TEACHER")],
    [Markup.button.callback("🎓 Режим: Ученик", "MODE_STUDENT")],
  ]);
}

function mainMenu(mode) {
  if (mode === "teacher") {
    return Markup.inlineKeyboard([
      [Markup.button.callback("Заполнить/изменить анкету", "T_PROFILE")],
      [Markup.button.callback("Моя анкета", "T_SHOW_PROFILE")],
      [Markup.button.callback("Активна/Пауза", "T_TOGGLE_ACTIVE")],
      [Markup.button.callback("Удалить анкету", "T_DELETE_PROFILE")],
      [Markup.button.callback("Продвижение (ТОП)", "T_PROMO")],
      [Markup.button.callback("🔁 Сменить режим", "CHOOSE_MODE")],
    ]);
  }
  if (mode === "student") {
    return Markup.inlineKeyboard([
      [Markup.button.callback("Найти репетитора", "S_SEARCH")],
      [Markup.button.callback("🔁 Сменить режим", "CHOOSE_MODE")],
    ]);
  }
  return modeKeyboard();
}

function subjectsKeyboard(prefix, extraButtons = []) {
  return Markup.inlineKeyboard([
    ...SUBJECTS.map((s) => [Markup.button.callback(s.label, `${prefix}_${s.key}`)]),
    ...extraButtons,
  ]);
}

function promoPacksKeyboard() {
  return Markup.inlineKeyboard([
    ...PROMO_PACKS.map((p) => [Markup.button.callback(`${p.days} дней`, `PROMO_DAYS_${p.days}`)]),
    [Markup.button.callback("⬅️ В меню", "BACK_MENU")],
  ]);
}

function promoPayKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Оплатить ⭐ Stars", "PROMO_PAY_STARS")],
    [Markup.button.callback("Оплатить 💳 картой", "PROMO_PAY_CARD")],
    [Markup.button.callback("⬅️ Назад", "T_PROMO")],
  ]);
}

function backMenuKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback("⬅️ В меню", "BACK_MENU")]]);
}

function teacherCard(user) {
  const t = user.teacher || {};
  const subject = subjLabel(t.subject);
  const price = t.price ? `${t.price} грн / 60 мин` : "—";
  const bio = t.bio ? t.bio : "—";
  const status = t.isActive ? "✅ Активна (в поиске)" : "⏸ Пауза (скрыта из поиска)";

  const promoLine =
    t.subject && isPromoActive(user, t.subject)
      ? `⭐ ТОП активен до ${fmtDate(user.promos[t.subject].expiresAt)}`
      : "⭐ ТОП: —";

  return (
    `🧑‍🏫 Моя анкета\n\n` +
    `Статус: ${status}\n` +
    `Предмет: ${subject}\n` +
    `Цена: ${price}\n` +
    `${promoLine}\n\n` +
    `Описание:\n${bio}`
  );
}

// ====== /start ======
bot.start(async (ctx) => {
  await ctx.reply("Кто ты сейчас? Выбери режим:", modeKeyboard());
});

bot.action("CHOOSE_MODE", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText("Кто ты сейчас? Выбери режим:", modeKeyboard());
});

// ====== режимы ======
bot.action("MODE_TEACHER", async (ctx) => {
  const user = getUser(ctx.from.id);
  const s = getSession(ctx.from.id);
  s.mode = "teacher";
  user.lastMode = "teacher";
  persist();

  await ctx.answerCbQuery();
  await ctx.editMessageText("Режим: Учитель ✅\n\nГлавное меню:", mainMenu("teacher"));
});

bot.action("MODE_STUDENT", async (ctx) => {
  const user = getUser(ctx.from.id);
  const s = getSession(ctx.from.id);
  s.mode = "student";
  user.lastMode = "student";
  persist();

  await ctx.answerCbQuery();
  await ctx.editMessageText("Режим: Ученик ✅\n\nГлавное меню:", mainMenu("student"));
});

bot.action("BACK_MENU", async (ctx) => {
  const s = getSession(ctx.from.id);
  await ctx.answerCbQuery();
  await ctx.editMessageText("Главное меню:", mainMenu(s.mode));
});

// ====== Учитель: анкета ======
bot.action("T_PROFILE", async (ctx) => {
  const s = getSession(ctx.from.id);
  if (s.mode !== "teacher") return;

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    "Анкета учителя — выбери предмет:",
    subjectsKeyboard("T_SUBJECT", [[Markup.button.callback("⬅️ В меню", "BACK_MENU")]])
  );
});

bot.action(/T_SUBJECT_(.+)/, async (ctx) => {
  const s = getSession(ctx.from.id);
  if (s.mode !== "teacher") return;

  const subject = ctx.match[1];
  const user = getUser(ctx.from.id);

  user.teacher.subject = subject;
  persist();

  s.step = "T_WAIT_PRICE";

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `Анкета: предмет — ${subjLabel(subject)} ✅\n\nВведи цену за 60 минут (${PRICE_MIN}–${PRICE_MAX}).`,
    backMenuKeyboard()
  );
});

bot.action("T_SHOW_PROFILE", async (ctx) => {
  const s = getSession(ctx.from.id);
  if (s.mode !== "teacher") return;

  const user = getUser(ctx.from.id);
  await ctx.answerCbQuery();
  await ctx.editMessageText(teacherCard(user), backMenuKeyboard());
});

bot.action("T_TOGGLE_ACTIVE", async (ctx) => {
  const s = getSession(ctx.from.id);
  if (s.mode !== "teacher") return;

  const user = getUser(ctx.from.id);
  user.teacher.isActive = !user.teacher.isActive;
  persist();

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `Готово ✅\nТеперь анкета: ${user.teacher.isActive ? "✅ Активна" : "⏸ На паузе"}\n\nГлавное меню:`,
    mainMenu("teacher")
  );
});

// ====== Удаление анкеты: подтверждение ======
bot.action("T_DELETE_PROFILE", async (ctx) => {
  const s = getSession(ctx.from.id);
  if (s.mode !== "teacher") return;

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    "⚠️ Удалить анкету?\n\nБудут удалены:\n- предмет, цена, описание\n- статус (активна/пауза)\n- все купленные ТОП-статусы\n\nЭто действие нельзя отменить.",
    Markup.inlineKeyboard([
      [Markup.button.callback("✅ Да, удалить", "T_DELETE_CONFIRM")],
      [Markup.button.callback("❌ Отмена", "BACK_MENU")],
    ])
  );
});

bot.action("T_DELETE_CONFIRM", async (ctx) => {
  const s = getSession(ctx.from.id);
  if (s.mode !== "teacher") return;

  const user = getUser(ctx.from.id);

  // очистка анкеты
  user.teacher = { subject: null, price: null, bio: null, isActive: false };
  user.promos = {};
  persist();

  // сбрасываем шаги анкеты, чтобы не зависло
  s.step = null;

  await ctx.answerCbQuery();
  await ctx.editMessageText("Анкета удалена ✅\n\nГлавное меню:", mainMenu("teacher"));
});

// ====== Учитель: ТОП ======
bot.action("T_PROMO", async (ctx) => {
  const s = getSession(ctx.from.id);
  if (s.mode !== "teacher") return;

  const user = getUser(ctx.from.id);
  await ctx.answerCbQuery();

  if (!user.teacher.subject) {
    await ctx.editMessageText(
      "Чтобы купить ТОП, сначала выбери предмет в анкете.",
      Markup.inlineKeyboard([
        [Markup.button.callback("Заполнить анкету", "T_PROFILE")],
        [Markup.button.callback("⬅️ В меню", "BACK_MENU")],
      ])
    );
    return;
  }

  const subject = user.teacher.subject;
  const line = isPromoActive(user, subject)
    ? `Сейчас ТОП активен до: ${fmtDate(user.promos[subject].expiresAt)}`
    : `ТОП сейчас не активен`;

  await ctx.editMessageText(
    `ТОП как у Buki\n\nПредмет: ${subjLabel(subject)}\n${line}\n\nВыбери срок:`,
    promoPacksKeyboard()
  );
});

bot.action(/PROMO_DAYS_(\d+)/, async (ctx) => {
  const s = getSession(ctx.from.id);
  if (s.mode !== "teacher") return;

  const days = parseInt(ctx.match[1], 10);
  const pack = PROMO_PACKS.find((p) => p.days === days);
  const user = getUser(ctx.from.id);

  await ctx.answerCbQuery();

  if (!pack || !user.teacher.subject) {
    await ctx.editMessageText("Ошибка выбора пакета.", mainMenu("teacher"));
    return;
  }

  s.pendingPromo = {
    subject: user.teacher.subject,
    days: pack.days,
    priceUah: pack.priceUah,
    priceStars: pack.priceStars,
  };

  await ctx.editMessageText(
    `Покупка ТОП\n\nПредмет: ${subjLabel(s.pendingPromo.subject)}\nСрок: ${pack.days} дней\nЦена: ${pack.priceUah} грн или ${pack.priceStars} ⭐\n\nВыбери оплату:`,
    promoPayKeyboard()
  );
});

bot.action("PROMO_PAY_STARS", async (ctx) => {
  const s = getSession(ctx.from.id);
  if (s.mode !== "teacher") return;

  await ctx.answerCbQuery();
  if (!s.pendingPromo) return ctx.reply("Сначала выбери срок ТОП.");

  const p = s.pendingPromo;
  const payload = `promo|${ctx.from.id}|${p.subject}|${p.days}|stars|${Date.now()}`;

  await ctx.replyWithInvoice({
    title: "ТОП репетитора",
    description: `ТОП по предмету: ${subjLabel(p.subject)} на ${p.days} дней`,
    payload,
    provider_token: "",
    currency: "XTR",
    prices: [{ label: `ТОП ${p.days} дней`, amount: p.priceStars }],
  });
});

bot.action("PROMO_PAY_CARD", async (ctx) => {
  const s = getSession(ctx.from.id);
  if (s.mode !== "teacher") return;

  await ctx.answerCbQuery();

  if (!CARD_PROVIDER_TOKEN) {
    await ctx.reply("Оплата картой не настроена. Позже добавим CARD_PROVIDER_TOKEN в .env.");
    return;
  }
  if (!s.pendingPromo) return ctx.reply("Сначала выбери срок ТОП.");

  const p = s.pendingPromo;
  const payload = `promo|${ctx.from.id}|${p.subject}|${p.days}|card|${Date.now()}`;

  await ctx.replyWithInvoice({
    title: "ТОП репетитора",
    description: `ТОП по предмету: ${subjLabel(p.subject)} на ${p.days} дней`,
    payload,
    provider_token: CARD_PROVIDER_TOKEN,
    currency: "UAH",
    prices: [{ label: `ТОП ${p.days} дней`, amount: p.priceUah * 100 }],
  });
});

bot.on("pre_checkout_query", async (ctx) => {
  await ctx.answerPreCheckoutQuery(true);
});

bot.on("successful_payment", async (ctx) => {
  const sp = ctx.message.successful_payment;
  const payload = sp.invoice_payload || "";
  const parts = payload.split("|");
  if (parts[0] !== "promo") return ctx.reply("Оплата получена ✅");

  const userId = parts[1];
  const subject = parts[2];
  const days = parseInt(parts[3], 10);

  const user = getUser(userId);
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  user.promos[subject] = { expiresAt, chargeId: sp.telegram_payment_charge_id };
  persist();

  await ctx.reply(`Оплата прошла ✅\nТОП активен: ${subjLabel(subject)}\nДо: ${fmtDate(expiresAt)}`, mainMenu("teacher"));
});

// ====== Ученик: поиск ======
bot.action("S_SEARCH", async (ctx) => {
  const s = getSession(ctx.from.id);
  if (s.mode !== "student") return;

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    "Выбери предмет:",
    subjectsKeyboard("S_SUBJECT", [[Markup.button.callback("⬅️ В меню", "BACK_MENU")]])
  );
});

function listTeachersBySubject(subjectKey) {
  const all = Object.entries(db.users).map(([id, u]) => ({ id, u }));

  const teachers = all
    .filter(({ u }) => u.teacher?.isActive)
    .filter(({ u }) => u.teacher?.subject === subjectKey)
    .filter(({ u }) => u.teacher?.price && u.teacher?.bio);

  const top = teachers.filter(({ u }) => isPromoActive(u, subjectKey));
  const regular = teachers.filter(({ u }) => !isPromoActive(u, subjectKey));

  return { top, regular };
}

bot.action(/S_SUBJECT_(.+)/, async (ctx) => {
  const s = getSession(ctx.from.id);
  if (s.mode !== "student") return;

  const subject = ctx.match[1];
  s.lastStudentSubject = subject;

  await ctx.answerCbQuery();

  const { top, regular } = listTeachersBySubject(subject);
  const buttons = [];

  if (top.length) {
    buttons.push([Markup.button.callback("⭐ ТОП репетиторы", "S_IGNORE")]);
    top.slice(0, 5).forEach(({ id, u }) => {
      const name = u.meta?.first_name || "Учитель";
      const price = u.teacher?.price ? `${u.teacher.price}грн` : "";
      buttons.push([Markup.button.callback(`⭐ ${name} — ${price}`, `S_VIEW_${id}`)]);
    });
  }

  if (regular.length) {
    buttons.push([Markup.button.callback("Обычные", "S_IGNORE")]);
    regular.slice(0, 10).forEach(({ id, u }) => {
      const name = u.meta?.first_name || "Учитель";
      const price = u.teacher?.price ? `${u.teacher.price}грн` : "";
      buttons.push([Markup.button.callback(`${name} — ${price}`, `S_VIEW_${id}`)]);
    });
  }

  if (!top.length && !regular.length) {
    await ctx.editMessageText(`По предмету “${subjLabel(subject)}” пока нет активных анкет.`, backMenuKeyboard());
    return;
  }

  buttons.push([Markup.button.callback("⬅️ В меню", "BACK_MENU")]);

  await ctx.editMessageText(
    `Результаты по предмету: ${subjLabel(subject)}\n\nВыбери учителя:`,
    Markup.inlineKeyboard(buttons)
  );
});

bot.action("S_IGNORE", async (ctx) => ctx.answerCbQuery());

bot.action(/S_VIEW_(\d+)/, async (ctx) => {
  const s = getSession(ctx.from.id);
  if (s.mode !== "student") return;

  const teacherId = ctx.match[1];
  const teacher = db.users[teacherId];

  await ctx.answerCbQuery();
  if (!teacher) return ctx.editMessageText("Учитель не найден.", backMenuKeyboard());

  const name = teacher.meta?.first_name || "Учитель";
  const price = teacher.teacher?.price ? `${teacher.teacher.price} грн / 60 мин` : "—";
  const bio = teacher.teacher?.bio ? teacher.teacher.bio : "—";
  const subject = subjLabel(teacher.teacher?.subject);

  const subjKey = teacher.teacher?.subject;
  const isTop = subjKey ? isPromoActive(teacher, subjKey) : false;
  const topUntil = isTop ? teacher.promos?.[subjKey]?.expiresAt : null;
  const topLine = isTop && topUntil ? `⭐ ТОП активен до ${fmtDate(topUntil)}\n` : (isTop ? "⭐ ТОП\n" : "");

  const text =
    `${topLine}` +
    `👤 ${name}\n` +
    `Предмет: ${subject}\n` +
    `Цена: ${price}\n\n` +
    `Описание:\n${bio}`;

  await ctx.editMessageText(
    text,
    Markup.inlineKeyboard([
      [Markup.button.callback("Отправить заявку", `S_REQ_${teacherId}`)],
      [Markup.button.callback("⬅️ Назад к списку", `S_SUBJECT_${s.lastStudentSubject || teacher.teacher.subject}`)],
      [Markup.button.callback("⬅️ В меню", "BACK_MENU")],
    ])
  );
});

// ====== Заявки (упрощённо, без кнопок) — оставим как есть ======
bot.action(/S_REQ_(\d+)/, async (ctx) => {
  const s = getSession(ctx.from.id);
  if (s.mode !== "student") return;

  const teacherId = ctx.match[1];
  const teacher = db.users[teacherId];

  await ctx.answerCbQuery();
  if (!teacher) return ctx.reply("Учитель не найден.");

  if (!canSendRequest(ctx.from.id)) {
    await ctx.reply("Слишком много заявок за час. Подожди немного и попробуй снова.");
    persist();
    return;
  }

  // просто уведомим
  try {
    await bot.telegram.sendMessage(teacherId, `📩 Новая заявка от ученика.\nПредмет: ${subjLabel(s.lastStudentSubject || teacher.teacher.subject)}`);
  } catch {}

  await ctx.editMessageText("Заявка отправлена ✅", backMenuKeyboard());
});

// ====== Текстовые шаги анкеты учителя ======
bot.on("text", async (ctx) => {
  const userId = ctx.from.id;
  const user = getUser(userId);
  const s = getSession(userId);
  const text = (ctx.message.text || "").trim();

  if (s.step === "T_WAIT_PRICE") {
    const num = parseInt(text.replace(/[^\d]/g, ""), 10);

    if (!Number.isFinite(num)) return ctx.reply("Не понял цену. Напиши число (например 400).");
    if (num < PRICE_MIN || num > PRICE_MAX) return ctx.reply(`Цена должна быть ${PRICE_MIN}–${PRICE_MAX} грн. Напиши заново.`);

    user.teacher.price = num;
    persist();

    s.step = "T_WAIT_BIO";
    await ctx.reply(`Цена сохранена ✅ ${num} грн / 60 мин\n\nТеперь напиши коротко о себе (1–3 предложения).`);
    return;
  }

  if (s.step === "T_WAIT_BIO") {
    if (text.length < BIO_MIN) return ctx.reply(`Слишком коротко. Нужно от ${BIO_MIN} символов.`);
    if (text.length > BIO_MAX) return ctx.reply(`Слишком длинно. До ${BIO_MAX} символов.`);

    user.teacher.bio = text;
    persist();

    s.step = null;
    await ctx.reply("Описание сохранено ✅\n\nТеперь нажми “Активна/Пауза”, чтобы включиться в поиске.", mainMenu("teacher"));
    return;
  }
});

bot.launch();
console.log("Bot is running...");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
