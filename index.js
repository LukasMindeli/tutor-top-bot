require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) =>
  ctx.reply(
    "Выбирай роль:",
    Markup.inlineKeyboard([
      [Markup.button.callback("Я учитель", "ROLE_TEACHER")],
      [Markup.button.callback("Я ученик", "ROLE_STUDENT")],
    ])
  )
);

bot.action("ROLE_TEACHER", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText("Роль: Учитель ✅");
});

bot.action("ROLE_STUDENT", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText("Роль: Ученик ✅");
});

bot.launch();
console.log("Bot is running...");