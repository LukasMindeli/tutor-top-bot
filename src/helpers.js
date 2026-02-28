const { SUBJECTS } = require("./constants");

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

function subjLabel(key) {
  return SUBJECTS.find((s) => s.key === key)?.label || key || "—";
}

function isPromoActive(user, subjectKey) {
  const p = user?.promos?.[subjectKey];
  if (!p?.expiresAt) return false;
  return new Date(p.expiresAt).getTime() > nowMs();
}

function ensureUser(db, userIdRaw) {
  const userId = String(userIdRaw);

  db.users[userId] ||= {
    meta: { first_name: "", username: "" },
    lastMode: null,
    teacher: { subject: null, price: null, bio: null, isActive: false },
    student: { reqLog: [] },
    promos: {},     // subjectKey -> { expiresAt, chargeId }
  };

  return db.users[userId];
}

function parseNumber(text) {
  const raw = String(text || "").trim();
  const num = parseInt(raw.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(num) ? num : null;
}

function makeReqId() {
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function canSendRequest(user, limitPerHour) {
  user.student ||= {};
  user.student.reqLog ||= [];

  const hourAgo = nowMs() - 60 * 60 * 1000;
  user.student.reqLog = user.student.reqLog.filter((t) => t > hourAgo);

  if (user.student.reqLog.length >= limitPerHour) return false;

  user.student.reqLog.push(nowMs());
  return true;
}

function teacherCardUA(user) {
  const t = user.teacher || {};
  const subject = subjLabel(t.subject);
  const price = t.price ? `${t.price} грн / 60 хв` : "—";
  const bio = t.bio ? t.bio : "—";
  const status = t.isActive ? "✅ Активна (у пошуку)" : "⏸ Пауза (прихована)";

  const promoLine =
    t.subject && isPromoActive(user, t.subject)
      ? `⭐ ТОП активний до ${fmtDate(user.promos[t.subject].expiresAt)}`
      : "⭐ ТОП: —";

  return (
    `🧑‍🏫 Моя анкета\n\n` +
    `Статус: ${status}\n` +
    `Предмет: ${subject}\n` +
    `Ціна: ${price}\n` +
    `${promoLine}\n\n` +
    `Опис:\n${bio}`
  );
}

function teacherCardForStudentUA(teacherUser) {
  const name = teacherUser.meta?.first_name || "Вчитель";
  const subjKey = teacherUser.teacher?.subject;
  const subject = subjLabel(subjKey);
  const price = teacherUser.teacher?.price ? `${teacherUser.teacher.price} грн / 60 хв` : "—";
  const bio = teacherUser.teacher?.bio ? teacherUser.teacher.bio : "—";

  const isTop = subjKey ? isPromoActive(teacherUser, subjKey) : false;
  const until = isTop ? teacherUser.promos?.[subjKey]?.expiresAt : null;
  const topLine = isTop && until ? `⭐ ТОП активний до ${fmtDate(until)}\n` : (isTop ? "⭐ ТОП\n" : "");

  return (
    `${topLine}` +
    `👤 ${name}\n` +
    `Предмет: ${subject}\n` +
    `Ціна: ${price}\n\n` +
    `Опис:\n${bio}`
  );
}

function tgUserLink(userId, username) {
  if (username) return `https://t.me/${username}`;
  return `tg://user?id=${userId}`;
}

module.exports = {
  nowMs,
  fmtDate,
  subjLabel,
  isPromoActive,
  ensureUser,
  parseNumber,
  makeReqId,
  canSendRequest,
  teacherCardUA,
  teacherCardForStudentUA,
  tgUserLink,
};
