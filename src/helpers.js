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

function truncate(text, max = 200) {
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

/**
 * Ловим телефони (UA + загальні E.164) навіть якщо розбито пробілами/дефісами/скобками.
 * Повертає true, якщо схоже на телефон.
 */
function containsPhoneNumber(text) {
  const s = String(text || "");

  // Беремо підрядки типу "+38 (097) 123-45-67" або "097 123 45 67"
  const re = /(\+?\d[\d\s().-]{7,}\d)/g;
  const matches = s.match(re) || [];

  for (const m of matches) {
    const digits = m.replace(/\D/g, ""); // тільки цифри
    if (digits.length < 10 || digits.length > 15) continue;

    // UA: 0XXXXXXXXX (10 цифр)
    if (digits.length === 10 && digits.startsWith("0")) return true;

    // UA: 380XXXXXXXXX (12 цифр)
    if (digits.length === 12 && digits.startsWith("380")) return true;

    // Загальний E.164: +XXXXXXXXXXX (11-15 цифр), якщо було "+"
    if (m.trim().startsWith("+") && digits.length >= 11 && digits.length <= 15) return true;
  }

  return false;
}

module.exports = { tgUserLink, parseNumber, truncate, fmtDate, containsPhoneNumber };
