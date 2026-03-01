const { Markup } = require("telegraf");

const RULES_TEXT =
`<b>Правила TutorUA</b>

1) TutorUA — платформа для звʼязку між учнем і вчителем. Умови та оплату уроків сторони узгоджують напряму.
2) Заборонено: шахрайство, спам, образи, 18+, незаконний контент.
3) Анкета має бути чесною: реальна ціна, предмет і короткий опис.
4) ТОП/бали впливають лише на порядок показу в пошуку та не гарантують кількість заявок.
5) Підтримка: натисни «Підтримка» і напиши проблему — ми відповімо в Telegram.`;

function registerRules(bot, deps) {
  const { ui, getSession } = deps;

  bot.action("RULES", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    await ctx.reply(RULES_TEXT, { parse_mode: "HTML", ...ui.mainMenu(s.mode || "student") });
  });
}

module.exports = { registerRules };
