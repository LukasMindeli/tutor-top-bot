async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const { bot } = require("./app");

let launching = false;

async function launchWithRetry() {
  if (launching) return;
  launching = true;

  while (true) {
    try {
      // на всякий случай удалим webhook и дропнем старые апдейты
      try { await bot.telegram.deleteWebhook({ drop_pending_updates: true }); } catch {}

      await bot.launch();
      console.log("Bot launched (polling).");
      break; // успешно запустились
    } catch (err) {
      const code = err?.response?.error_code;
      const desc = err?.response?.description || err?.message || String(err);
      console.error("LAUNCH_ERROR", code, desc);

      // 409: конфликт getUpdates — ждём и пробуем снова, НЕ падаем
      if (code === 409 || String(desc).includes("Conflict")) {
        await sleep(5000);
        continue;
      }

      // другое — пусть падает (это реально баг)
      throw err;
    }
  }

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

launchWithRetry();
