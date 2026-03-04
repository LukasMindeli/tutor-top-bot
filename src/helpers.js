// helpers.js — спільні утиліти (UA)
// Важливо: цей файл мають використовувати student.js / teacher.js / requests.js / promo.js / admin.js

function normalizeSubject(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ");
}

function safeText(s, max = 600) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? t.slice(0, max).trim() : t;
}

function safeInt(v, { min = null, max = null } = {}) {
  const n = Number.parseInt(String(v || "").replace(/[^\d-]/g, ""), 10);
  if (!Number.isFinite(n)) return null;
  if (min !== null && n < min) return null;
  if (max !== null && n > max) return null;
  return n;
}

function parseNumber(text) {
  const m = String(text || "").match(/-?\d+/);
  if (!m) return null;
  const n = Number.parseInt(m[0], 10);
  return Number.isFinite(n) ? n : null;
}

function truncate(s, max = 120) {
  const t = String(s || "");
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear());
  return `${dd}.${mm}.${yy}`;
}

function tgUserLink(username, telegramId) {
  const u = String(username || "").trim();
  if (u) return u.startsWith("@") ? `https://t.me/${u.slice(1)}` : `https://t.me/${u}`;
  if (telegramId) return `tg://user?id=${telegramId}`;
  return "";
}

/**
 * Детектор телефону у біо:
 * якщо в тексті загалом >= 9 цифр → вважаємо що це телефон/карта.
 * Обхід можливий: писати цифри словами, через пробіли/крапки, або картинкою.
 */
function looksLikePhone(text) {
  const digits = String(text || "").replace(/\D/g, "");
  return digits.length >= 9;
}

module.exports = {
  normalizeSubject,
  safeText,
  safeInt,
  parseNumber,
  truncate,
  fmtDate,
  tgUserLink,
  looksLikePhone,
};