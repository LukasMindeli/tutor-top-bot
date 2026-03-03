function tgUserLink(id, username) {
  const u = (username || "").toString().trim().replace(/^@/, "");
  if (u) return `https://t.me/${u}`;
  return `tg://user?id=${id}`;
}

function parseNumber(text) {
  const raw = String(text || "")
    .replace(/\s+/g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function truncate(text, max = 450) {
  const s = String(text || "");
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return d.toLocaleDateString("uk-UA", { year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

// Ловим телефони навіть з пробілами/дефісами/скобками
function containsPhoneNumber(text) {
  const s = String(text || "");
  const re = /(\+?\d[\d\s().-]{7,}\d)/g;
  const matches = s.match(re) || [];

  for (const m of matches) {
    const digits = m.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) continue;

    // UA: 0XXXXXXXXX (10)
    if (digits.length === 10 && digits.startsWith("0")) return true;
    // UA: 380XXXXXXXXX (12)
    if (digits.length === 12 && digits.startsWith("380")) return true;

    // загальний E.164 якщо реально був "+"
    if (m.trim().startsWith("+") && digits.length >= 11 && digits.length <= 15) return true;
  }
  return false;
}

// Ловимо контакти: телефон, email, @нік, посилання, соцмережі/месенджери
function containsContactInfo(text) {
  const s = String(text || "");
  const low = s.toLowerCase();

  // email
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(s)) return true;

  // @username (щоб не плутати з одиночними символами)
  if (/@[a-z0-9_]{4,32}/i.test(s)) return true;

  // urls / домени / месенджер-лінки
  if (/(https?:\/\/|t\.me\/|telegram\.me\/|wa\.me\/|bit\.ly\/|tinyurl\.com\/)/i.test(s)) return true;

  // ключові слова контактів
  if (/(телеграм|telegram|tg\b|вайбер|viber|whats?app|ватсап|інстаграм|instagram|facebook|фейсбук|discord|signal|email|e-mail|пошта|почта)/i.test(low)) return true;

  // телефон
  if (containsPhoneNumber(s)) return true;

  return false;
}

module.exports = { tgUserLink, parseNumber, truncate, fmtDate, containsPhoneNumber, containsContactInfo };
