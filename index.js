require("dotenv").config();
const fs = require("fs");
const { Telegraf, Markup } = require("telegraf");

const bot = new Telegraf(process.env.BOT_TOKEN);

// Для оплаты картой нужен provider token из BotFather (Payments).
const CARD_PROVIDER_TOKEN = process.env.CARD_PROVIDER_TOKEN || "";

// ====== Простая "БД" в файле (чтобы не терялось после перезапуска) ======
const DB_PATH = "./db.json";

function loadDB() {
  try {
    if (!fs.existsSync(DB_PATH)) return { users: {} };
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch {
    return { users: {} };
  }
}
function saveDB() {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}
const db = loadDB(); // { users: { [id]: { role, meta, teacher, promos } } }

// runtime-сессии (шаги анкеты/покупки)
const session = new Map(); // userId -> { step, pendingPromo, lastStudentSubject }

// ====== Константы ======
const SUBJECTS = [
  { key: "math", label: "Математика" },
  { key: "english", label: "Английский" },
  { key: "ukrainian", label: "Украинский язык" },
  { key: "physics", label: "Физика" },
  { key: "piano", label: "Пианино" },
];

const PROMO_PACKS = [
  { days: 7,  priceUah: 199,  priceStars: 120 },
  { days: 30, priceUah: 499,  priceStars: 300 },
  { days: 90, priceUah: 1199, priceStars: 800 },
];

// Ограничения (чтобы не было космос-цен)
const PRICE_MIN = 50;
const PRICE_MAX = 5000;
const BIO_MIN = 10;
const BIO_MAX = 600;

function subjLabel(key) {
  return SUBJECTS.find((s) => s.key === key)?.label || key || "—";
}
function nowMs() {
  return Date.now();
}
function isPromoActive(user, subjectKey) {
  const p = user?.promos?.[subjectKey];
  if (!p?.expiresAt) return false;
  return new Date(p.expiresAt).getTime() > nowMs();
}
function fmtDate(iso) {
  try { return new Date(iso).toLocaleString("uk-UA"); } catch { return iso; }
}
function truncate(s, n) {
  s = (s || "").trim();
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function getUser(userId) {
  db.users[userId] ||= {
    role: null,
    meta: { first_name: "", username: "" },
    teacher: {
      subject: null,
      price: null,
      bio: null,
      isActive: false,
    },
    promos: {}, // subjectKey -> { expiresAt, chargeId }
  };
  return db.users[userId];
}
function getSession(userId) {
  session.set(userId, session.get(userId) || {});
  return session.get(userId);
}

// сохраняем имя/юзернейм всегда, когда человек что-то делает
bot.use(async (ctx, next) => {
  if (ctx.from?.id) {
    const u = getUser(ctx.from.id);
    u.meta.first_name = ctx.from.first_name || u.meta.first_name;
    u.meta.username = ctx.from.username || u.meta.username;
    saveDB();
  }
  return next();
});

// ====== Клавиатуры ======
function mainMenu(role) {
  if (role === "teacher") {
    return Markup.inlineKeyboard([
      [Markup.button.callback("Заполнить/изменить анкету", "T_PROFILE")],
      [Markup.button.callback("Моя анкета", "T_SHOW_PROFILE")],
      [Markup.button.callback("Активна/Пауза", "T_TOGGLE_ACTIVE")],
      [Markup.button.callback("Продвижение (ТОП)", "T_PROMO")],
    ]);
  }
  if (role === "student") {
    return Markup.inlineKeyboard([
      [Markup.button.callback("Найти репетитора", "S_SEARCH")],
    ]);
  }
  return Markup.inlineKeyboard([
    [Markup.button.callback("Я учитель", "ROLE_TEACHER")],
    [Markup.button.callback("Я ученик", "ROLE_STUDENT")],
  ]);
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

  const promoLine = t.subject && isPromoActive(user, t.subject)
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

function makeChatUrl(u) {
  const username = u?.meta?.username;
  if (username) return `https://t.me/${username}`;
  // запасной вариант (не всегда работает на всех клиентах, но пусть будет)
  return `tg://user?id=${u?.meta?.id || ""}`;
}

// ====== /start ======
bot.start(async (ctx) => {
  const user = getUser(ctx.from.id);
  await ctx.reply("Главное меню:", mainMenu(user.role));
});

// ====== Роли ======
bot.action("ROLE_TEACHER", async (ctx) => {
  const user = getUser(ctx.from.id);
  user.role = "teacher";
  saveDB();

  await ctx.answerCbQuery();
  await ctx.editMessageText("Роль сохранена: Учитель ✅\n\nГлавное меню:", mainMenu("teacher"));
});

bot.action("ROLE_STUDENT", async (ctx) => {
  const user = getUser(ctx.from.id);
  user.role = "student";
  saveDB();

  await ctx.answerCbQuery();
  await ctx.editMessageText("Роль сохранена: Ученик ✅\n\nГлавное меню:", mainMenu("student"));
});

// ====== Учитель: анкета ======
bot.action("T_PROFILE", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    "Анкета учителя — выбери предмет:",
    subjectsKeyboard("T_SUBJECT", [[Markup.button.callback("⬅️ В меню", "BACK_MENU")]])
  );
});

bot.action(/T_SUBJECT_(.+)/, async (ctx) => {
  const subject = ctx.match[1];
  const user = getUser(ctx.from.id);
  const s = getSession(ctx.from.id);

  user.teacher.subject = subject;
  saveDB();

  s.step = "T_WAIT_PRICE";

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `Анкета: предмет — ${subjLabel(subject)} ✅\n\nВведи цену за 60 минут (число, грн). Допустимо ${PRICE_MIN}–${PRICE_MAX}.`,
    backMenuKeyboard()
  );
});

bot.action("T_SHOW_PROFILE", async (ctx) => {
  const user = getUser(ctx.from.id);
  await ctx.answerCbQuery();
  await ctx.editMessageText(teacherCard(user), backMenuKeyboard());
});

bot.action("T_TOGGLE_ACTIVE", async (ctx) => {
  const user = getUser(ctx.from.id);
  user.teacher.isActive = !user.teacher.isActive;
  saveDB();

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `Готово ✅\nТеперь анкета: ${user.teacher.isActive ? "✅ Активна" : "⏸ На паузе"}\n\nГлавное меню:`,
    mainMenu("teacher")
  );
});

// ====== Учитель: ТОП ======
bot.action("T_PROMO", async (ctx) => {
  const user = getUser(ctx.from.id);
  await ctx.answerCbQuery();

  if (!user.teacher.subject) {
    await ctx.editMessageText(
      "Чтобы купить ТОП, сначала выбери предмет в анкете.",
      Markup.inlineKeyboard([[Markup.button.callback("Заполнить анкету", "T_PROFILE")], [Markup.button.callback("⬅️ В меню", "BACK_MENU")]])
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
  const days = parseInt(ctx.match[1], 10);
  const pack = PROMO_PACKS.find((p) => p.days === days);
  const user = getUser(ctx.from.id);
  const s = getSession(ctx.from.id);

  await ctx.answerCbQuery();

  if (!pack || !user.teacher.subject) {
    await ctx.editMessageText("Ошибка выбора пакета. Открой Продвижение заново.", mainMenu(user.role));
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
  await ctx.answerCbQuery();

  if (!s.pendingPromo) {
    await ctx.reply("Сначала выбери срок ТОП.");
    return;
  }

  const p = s.pendingPromo;
  const payload = `promo|${ctx.from.id}|${p.subject}|${p.days}|stars|${Date.now()}`;

  await ctx.replyWithInvoice({
    title: "ТОП репетитора",
    description: `ТОП по предмету: ${subjLabel(p.subject)} на ${p.days} дней`,
    payload,
    provider_token: "", // Stars
    currency: "XTR",
    prices: [{ label: `ТОП ${p.days} дней`, amount: p.priceStars }],
  });
});

bot.action("PROMO_PAY_CARD", async (ctx) => {
  const s = getSession(ctx.from.id);
  await ctx.answerCbQuery();

  if (!CARD_PROVIDER_TOKEN) {
    await ctx.reply("Оплата картой не настроена. Позже добавим CARD_PROVIDER_TOKEN в .env.");
    return;
  }
  if (!s.pendingPromo) {
    await ctx.reply("Сначала выбери срок ТОП.");
    return;
  }

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

  if (parts[0] !== "promo") {
    await ctx.reply("Оплата получена ✅");
    return;
  }

  const userId = parts[1];
  const subject = parts[2];
  const days = parseInt(parts[3], 10);

  const user = getUser(userId);
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  user.promos[subject] = { expiresAt, chargeId: sp.telegram_payment_charge_id };
  saveDB();

  await ctx.reply(
    `Оплата прошла ✅\nТОП активен: ${subjLabel(subject)}\nДо: ${fmtDate(expiresAt)}`,
    mainMenu("teacher")
  );
});

// ====== Ученик: поиск + выдача + ТОП-блок ======
bot.action("S_SEARCH", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    "Выбери предмет:",
    subjectsKeyboard("S_SUBJECT", [[Markup.button.callback("⬅️ В меню", "BACK_MENU")]])
  );
});

function listTeachersBySubject(subjectKey) {
  const all = Object.entries(db.users).map(([id, u]) => ({ id, u }));
  const teachers = all
    .filter(({ u }) => u.role === "teacher")
    .filter(({ u }) => u.teacher?.isActive)
    .filter(({ u }) => u.teacher?.subject === subjectKey)
    .filter(({ u }) => u.teacher?.price && u.teacher?.bio); // чтобы были заполнены

  const top = teachers.filter(({ u }) => isPromoActive(u, subjectKey));
  const regular = teachers.filter(({ u }) => !isPromoActive(u, subjectKey));

  return { top, regular };
}

bot.action(/S_SUBJECT_(.+)/, async (ctx) => {
  const subject = ctx.match[1];
  const s = getSession(ctx.from.id);
  s.lastStudentSubject = subject;

  await ctx.answerCbQuery();

  const { top, regular } = listTeachersBySubject(subject);

  const buttons = [];

  // ТОП блок
  if (top.length) {
    buttons.push([Markup.button.callback("⭐ ТОП репетиторы", "S_IGNORE")]);
    top.slice(0, 5).forEach(({ id, u }, idx) => {
      const name = u.meta?.first_name || `Учитель #${idx + 1}`;
      const price = u.teacher?.price ? `${u.teacher.price}грн` : "";
      buttons.push([Markup.button.callback(`⭐ ${name} — ${price}`, `S_VIEW_${id}`)]);
    });
  }

  // Обычные
  if (regular.length) {
    buttons.push([Markup.button.callback("Обычные", "S_IGNORE")]);
    regular.slice(0, 10).forEach(({ id, u }, idx) => {
      const name = u.meta?.first_name || `Учитель #${idx + 1}`;
      const price = u.teacher?.price ? `${u.teacher.price}грн` : "";
      buttons.push([Markup.button.callback(`${name} — ${price}`, `S_VIEW_${id}`)]);
    });
  }

  if (!top.length && !regular.length) {
    await ctx.editMessageText(
      `По предмету “${subjLabel(subject)}” пока нет активных анкет.\n\n(Позже добавим: оставить заявку, чтобы учителя откликались)`,
      backMenuKeyboard()
    );
    return;
  }

  buttons.push([Markup.button.callback("⬅️ В меню", "BACK_MENU")]);

  await ctx.editMessageText(
    `Результаты по предмету: ${subjLabel(subject)}\n\nВыбери учителя:`,
    Markup.inlineKeyboard(buttons)
  );
});

// “пустая” кнопка (чтобы заголовки не ругались)
bot.action("S_IGNORE", async (ctx) => {
  await ctx.answerCbQuery();
});

bot.action(/S_VIEW_(\d+)/, async (ctx) => {
  const teacherId = ctx.match[1];
  const teacher = db.users[teacherId];

  await ctx.answerCbQuery();

  if (!teacher || teacher.role !== "teacher") {
    await ctx.editMessageText("Учитель не найден.", backMenuKeyboard());
    return;
  }

  const name = teacher.meta?.first_name || "Учитель";
  const price = teacher.teacher?.price ? `${teacher.teacher.price} грн / 60 мин` : "—";
  const bio = teacher.teacher?.bio ? teacher.teacher.bio : "—";
  const subject = subjLabel(teacher.teacher?.subject);

  const isTop = teacher.teacher?.subject ? isPromoActive(teacher, teacher.teacher.subject) : false;

  const text =
    `${isTop ? "⭐ ТОП\n" : ""}` +
    `👤 ${name}\n` +
    `Предмет: ${subject}\n` +
    `Цена: ${price}\n\n` +
    `Описание:\n${bio}`;

  await ctx.editMessageText(
    text,
    Markup.inlineKeyboard([
      [Markup.button.callback("Отправить заявку", `S_REQ_${teacherId}`)],
      [Markup.button.callback("⬅️ Назад к списку", `S_SUBJECT_${getSession(ctx.from.id).lastStudentSubject || teacher.teacher.subject}`)],
      [Markup.button.callback("⬅️ В меню", "BACK_MENU")],
    ])
  );
});

bot.action(/S_REQ_(\d+)/, async (ctx) => {
  const teacherId = ctx.match[1];
  const teacher = db.users[teacherId];
  const student = getUser(ctx.from.id);

  await ctx.answerCbQuery();

  if (!teacher || teacher.role !== "teacher") {
    await ctx.reply("Учитель не найден.");
    return;
  }

  const studentName = student.meta?.first_name || "Ученик";
  const subject = getSession(ctx.from.id).lastStudentSubject || teacher.teacher.subject;

  // сообщение учителю
  try {
    await bot.telegram.sendMessage(
      teacherId,
      `📩 Новая заявка\nОт: ${studentName}\nПредмет: ${subjLabel(subject)}\n\nОткрой чат со студентом и договорись:`,
      Markup.inlineKeyboard([
        [Markup.button.url("Открыть чат", student.meta?.username ? `https://t.me/${student.meta.username}` : `tg://user?id=${ctx.from.id}`)],
      ])
    );
  } catch (e) {
    // если учитель не писал боту — Telegram не даст отправить
  }

  await ctx.editMessageText(
    "Заявка отправлена ✅\n\nЕсли учитель разрешил сообщения боту — он получит уведомление.",
    backMenuKeyboard()
  );
});

// ====== Текстовые шаги анкеты (цена/описание) ======
bot.on("text", async (ctx) => {
  const userId = ctx.from.id;
  const user = getUser(userId);
  const s = getSession(userId);
  const text = (ctx.message.text || "").trim();

  // цена
  if (s.step === "T_WAIT_PRICE") {
    const num = parseInt(text.replace(/[^\d]/g, ""), 10);

    if (!Number.isFinite(num)) {
      await ctx.reply(`Не понял цену. Напиши число (например 400).`);
      return;
    }
    if (num < PRICE_MIN || num > PRICE_MAX) {
      await ctx.reply(`Цена должна быть в диапазоне ${PRICE_MIN}–${PRICE_MAX} грн. Напиши заново.`);
      return;
    }

    user.teacher.price = num;
    saveDB();

    s.step = "T_WAIT_BIO";
    await ctx.reply(`Цена сохранена ✅ ${num} грн / 60 мин\n\nТеперь напиши коротко о себе (1–3 предложения).`);
    return;
  }

  // био
  if (s.step === "T_WAIT_BIO") {
    if (text.length < BIO_MIN) {
      await ctx.reply(`Слишком коротко. Напиши хотя бы от ${BIO_MIN} символов.`);
      return;
    }
    if (text.length > BIO_MAX) {
      await ctx.reply(`Слишком длинно. Уложись до ${BIO_MAX} символов.`);
      return;
    }

    user.teacher.bio = text;
    saveDB();

    s.step = null;

    await ctx.reply(
      `Описание сохранено ✅\n\nТеперь включи анкету в поиске: нажми “Активна/Пауза”.`,
      mainMenu("teacher")
    );
    return;
  }
});

bot.action("BACK_MENU", async (ctx) => {
  const user = getUser(ctx.from.id);
  await ctx.answerCbQuery();
  await ctx.editMessageText("Главное меню:", mainMenu(user.role));
});

bot.launch();
console.log("Bot is running...");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
