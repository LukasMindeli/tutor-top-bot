const { replyBottom } = require("./respond");

const RULES_TEXT =
`<b>🟥 Правила TutorUA</b>

1) TutorUA — платформа для звʼязку між учнем і вчителем. Умови та оплату уроків сторони узгоджують напряму.
2) Заборонено: шахрайство, спам, образи, 18+, незаконний контент.
3) Анкети мають бути чесними: реальна ціна, предмет і короткий опис.
4) ТОП/бали впливають лише на порядок показу в пошуку.
5) Якщо є проблема — натисни «🆘 Підтримка» і напиши, що сталося.`;

function registerRules(bot, deps) {
  const { ui, getSession } = deps;

  bot.action("RULES", async (ctx) => {
    const s = getSession(ctx.from.id);
    await replyBottom(ctx, RULES_TEXT, { parse_mode: "HTML", ...ui.mainMenu(s.mode || "student") });
  });
}

module.exports = { registerRules };
