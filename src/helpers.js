function pad2(n) {
  return String(n).padStart(2, "0");
}

// DD.MM.YYYY
function fmtDate(value) {
  if (!value) return "";
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
  } catch {
    return "";
  }
}

// достает число из текста
function parseNumber(text) {
  const digits = String(text ?? "").replace(/[^0-9]/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n)) return null;
  return n;
}

// обрезка текста
function truncate(text, max = 600) {
  const s = String(text ?? "");
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

// ссылка на юзера
function tgUserLink(id, username) {
  const u = (username || "").toString().trim().replace(/^@/, "");
  if (u) return `https://t.me/${u}`;
  return `tg://user?id=${id}`;
}

module.exports = { fmtDate, parseNumber, truncate, tgUserLink };