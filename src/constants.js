const SUBJECTS = [
  { key: "math", label: "Математика" },
  { key: "english", label: "Англійська" },
  { key: "ukrainian", label: "Українська мова" },
  { key: "physics", label: "Фізика" },
  { key: "piano", label: "Піаніно" },
];

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

module.exports = { SUBJECTS, PROMO_PACKS, LIMITS };
