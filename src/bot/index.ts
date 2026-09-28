import { Bot } from 'grammy';
import type { Config } from '../config.js';
import { runHeadless } from '../agy/runHeadless.js';
import { isAuthorized } from './auth.js';
import { interpretAgyResponse } from './respond.js';
import { PendingContextStore } from './pendingContext.js';
import { buildPromptForMessage } from './dispatch.js';
import { getProposal, deleteProposal } from '../vault/schemaProposals.js';
import { applySchemaChange } from '../vault/applySchemaChange.js';

export function createBot(config: Config): Bot {
  const bot = new Bot(config.telegramBotToken);
  const pending = new PendingContextStore();

  bot.catch((err) => {
    console.error(`Unhandled bot error for update ${err.ctx.update.update_id}:`, err.error);
  });

  bot.use(async (ctx, next) => {
    if (!isAuthorized(ctx.from?.id, config.allowedTelegramId)) return;
    await next();
  });

  bot.command('confirm_schema', async (ctx) => {
    const id = ctx.match.trim();
    const proposal = await getProposal(config.vaultPath, id);
    if (!proposal) {
      await ctx.reply(`Предложение ${id} не найдено.`);
      return;
    }
    const result = await applySchemaChange(config.vaultPath, proposal);
    await deleteProposal(config.vaultPath, id);
    await ctx.reply(`Применено. Обновлённые файлы: ${result.updatedFiles.join(', ') || '—'}`);
  });

  bot.command('cancel_schema', async (ctx) => {
    const id = ctx.match.trim();
    await deleteProposal(config.vaultPath, id);
    await ctx.reply(`Предложение ${id} отменено.`);
  });

  bot.on('message:text', async (ctx) => {
    const chatId = ctx.chat.id;
    const prompt = buildPromptForMessage(chatId, ctx.message.text, pending);
    try {
      const result = await runHeadless(prompt, { agyBin: config.agyBin, timeout: config.agyTimeout });
      const action = interpretAgyResponse(result.response);
      if (action.kind === 'clarify') {
        pending.set({ chatId, originalMessage: ctx.message.text, question: action.text });
      }
      await ctx.reply(action.text);
    } catch (err) {
      await ctx.reply(`Ошибка: ${(err as Error).message}. Попробуйте ещё раз.`);
    }
  });

  return bot;
}
