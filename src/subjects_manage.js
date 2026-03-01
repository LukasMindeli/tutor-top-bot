const { Markup } = require("telegraf");

function asList(x) {
  if (Array.isArray(x)) return x;
  if (!x) return [];
  if (typeof x === "object") return Object.values(x).filter(Boolean);
  return [];
}

function registerSubjectsManage(bot, deps) {
  const { store, ui, getSession, SUBJECT_LABELS, searchSubjects } = deps;

  function requireTeacher(ctx) {
    const s = getSession(ctx.from.id);
    return s.mode === "teacher";
  }

  bot.action("T_SUBJECTS_MENU", async (ctx) => {
    await ctx.answerCbQuery();
    if (!requireTeacher(ctx)) return;

    const list = await store.listTeacherSubjects(ctx.from.id);
    const s = getSession(ctx.from.id);
    s.subjList = list;

    const rows = [];
    if (list.length) {
      // кнопки удаления
      list.slice(0, 20).forEach((subj, i) => {
        rows.push([Markup.button.callback(`🗑 ${subj}`, `T_SUBJ_RM_${i}`)]);
      });
    }
    rows.push([Markup.button.callback("➕ Додати предмет", "T_SUBJ_ADD")]);
    rows.push([Markup.button.callback("⬅️ В меню", "BACK_MENU")]);

    await ctx.editMessageText(
      `📚 Мої предмети\n\n${list.length ? "Натисни на предмет, щоб прибрати його." : "Поки що немає предметів."}`,
      Markup.inlineKeyboard(rows)
    );
  });

  bot.action("T_SUBJ_ADD", async (ctx) => {
    await ctx.answerCbQuery();
    if (!requireTeacher(ctx)) return;

    const s = getSession(ctx.from.id);
    s.step = "T_SUBJ_QUERY";
    await ctx.editMessageText("Введи предмет текстом (наприклад: «Математика», «Програмування»):", ui.backMenuKeyboard());
  });

  bot.on("text", async (ctx, next) => {
    const s = getSession(ctx.from.id);
    if (s.step !== "T_SUBJ_QUERY") return next();

    const q = (ctx.message.text || "").trim();
    if (!q || q.startsWith("/")) return;

    let matches = [];
    try {
      const res = searchSubjects ? searchSubjects(q) : [];
      matches = asList(res);
    } catch (e) {
      matches = [];
    }

    if (!matches.length) {
      const all = asList(SUBJECT_LABELS);
      const qq = q.toLowerCase();
      matches = all.filter(x => String(x).toLowerCase().includes(qq)).slice(0, 10);
    } else {
      matches = matches.slice(0, 10);
    }

    s.subjMatches = matches;
    s.step = null;

    if (!matches.length) {
      await ctx.reply("Не знайшов такий предмет. Спробуй інакше.", ui.backMenuKeyboard());
      return;
    }

    const rows = matches.map((subj, i) => [Markup.button.callback(subj, `T_SUBJ_PICK_${i}`)]);
    rows.push([Markup.button.callback("⬅️ Назад", "T_SUBJECTS_MENU")]);

    await ctx.reply("Обери предмет зі списку:", Markup.inlineKeyboard(rows));
  });

  bot.action(/T_SUBJ_PICK_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!requireTeacher(ctx)) return;

    const s = getSession(ctx.from.id);
    const i = parseInt(ctx.match[1], 10);
    const subj = s.subjMatches?.[i];
    if (!subj) return ctx.reply("Помилка вибору. Спробуй ще раз.");

    await store.addTeacherSubject(ctx.from.id, subj);

    // после добавления возвращаем меню предметов
    await ctx.reply("✅ Додано предмет: " + subj);
    await ctx.reply("Відкриваю список предметів…");
    // имитация перехода
    await bot.telegram.sendMessage(ctx.chat.id, "📚", Markup.inlineKeyboard([[Markup.button.callback("Відкрити", "T_SUBJECTS_MENU")]]));
  });

  bot.action(/T_SUBJ_RM_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!requireTeacher(ctx)) return;

    const s = getSession(ctx.from.id);
    const i = parseInt(ctx.match[1], 10);
    const subj = s.subjList?.[i];
    if (!subj) return;

    await store.removeTeacherSubject(ctx.from.id, subj);

    // обновляем экран
    const list = await store.listTeacherSubjects(ctx.from.id);
    s.subjList = list;

    const rows = [];
    if (list.length) {
      list.slice(0, 20).forEach((subj2, j) => {
        rows.push([Markup.button.callback(`🗑 ${subj2}`, `T_SUBJ_RM_${j}`)]);
      });
    }
    rows.push([Markup.button.callback("➕ Додати предмет", "T_SUBJ_ADD")]);
    rows.push([Markup.button.callback("⬅️ В меню", "BACK_MENU")]);

    await ctx.editMessageText(
      `📚 Мої предмети\n\n${list.length ? "Натисни на предмет, щоб прибрати його." : "Поки що немає предметів."}`,
      Markup.inlineKeyboard(rows)
    );
  });
}

module.exports = { registerSubjectsManage };
