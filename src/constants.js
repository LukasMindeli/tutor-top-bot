const PROMO_PACKS = [
  { days: 7,  priceUah: 199,  priceStars: 120 },
  { days: 30, priceUah: 499,  priceStars: 300 },
  { days: 90, priceUah: 1199, priceStars: 800 },
];

const LIMITS = {
  PRICE_MIN: 50,
  PRICE_MAX: 5000,
  BIO_MIN: 10,
  BIO_MAX: 600,
  REQ_LIMIT_PER_HOUR: 10,
};

/**
 * Лід (оплата за учня) — учитель платить за бажанням.
 */
const LEAD_PRICE_UAH = 100;     // 100 грн
const LEAD_PRICE_STARS = 60;    // 60 ⭐ (можеш змінити)
const LEAD_POINTS_REWARD = 5;   // +5 балів за оплату ліда

module.exports = { PROMO_PACKS, LIMITS, LEAD_PRICE_UAH, LEAD_PRICE_STARS, LEAD_POINTS_REWARD };
