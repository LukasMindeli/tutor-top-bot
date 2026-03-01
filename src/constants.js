const PROMO_PACKS = [
  { days: 7,  priceUah: 150, priceStars: 120 },
  { days: 30, priceUah: 400, priceStars: 300 },
  { days: 90, priceUah: 800, priceStars: 800 },
];

const LIMITS = {
  PRICE_MIN: 50,
  PRICE_MAX: 5000,
  BIO_MIN: 10,
  BIO_MAX: 600,
  REQ_LIMIT_PER_HOUR: 10,
};

// ЛІД (оплата за учня)
const LEAD_PRICE_UAH = 100;
const LEAD_POINTS_REWARD = 10; // +10 балів після підтвердження
// +1 учень — окремо в paid_students_count (в store.markLeadPaid)

module.exports = { PROMO_PACKS, LIMITS, LEAD_PRICE_UAH, LEAD_POINTS_REWARD };
