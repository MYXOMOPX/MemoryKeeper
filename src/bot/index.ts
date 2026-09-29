import { mkdirSync } from 'node:fs';
import { Bot } from 'grammy';
import type { Config } from '../config.js';
import { runHeadless } from '../agy/runHeadless.js';
import { isAuthorized } from './auth.js';
import { interpretAgyResponse } from './respond.js';
import { PendingContextStore } from './pendingContext.js';
import { buildPromptForMessage } from './dispatch.js';
import { getProposal, deleteProposal } from '../vault/schemaProposals.js';
import { applySchemaChange } from '../vault/applySchemaChange.js';

function log(chatId: number | string, message: string): void {
  console.log(`[${new Date().toISOString()}] [chat ${chatId}] ${message}`);
}

export function createBot(config: Config): Bot {
  // agy is a general coding-agent CLI, not a plain LLM call: run it from a
  // directory with real files (e.g. this project's own checkout) and it
  // indexes that as "the project" before doing anything else — which is
  // where the huge token counts and multi-minute latency were coming from.
  // Give it an empty, dedicated scratch directory instead.
  mkdirSync(config.agyCwd, { recursive: true });

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
    log(ctx.chat.id, `/confirm_schema ${id} — looking up proposal`);
    const proposal = await getProposal(config.vaultPath, id);
    if (!proposal) {
      log(ctx.chat.id, `/confirm_schema ${id} — not found`);
      await ctx.reply(`Предложение ${id} не найдено.`);
      return;
    }
    log(ctx.chat.id, `/confirm_schema ${id} — applying (${proposal.change.kind})`);
    const result = await applySchemaChange(config.vaultPath, proposal);
    await deleteProposal(config.vaultPath, id);
    log(ctx.chat.id, `/confirm_schema ${id} — applied, updated files: ${result.updatedFiles.join(', ') || '—'}`);
    await ctx.reply(`Применено. Обновлённые файлы: ${result.updatedFiles.join(', ') || '—'}`);
  });

  bot.command('cancel_schema', async (ctx) => {
    const id = ctx.match.trim();
    log(ctx.chat.id, `/cancel_schema ${id}`);
    await deleteProposal(config.vaultPath, id);
    await ctx.reply(`Предложение ${id} отменено.`);
  });

  bot.on('message:text', async (ctx) => {
    const chatId = ctx.chat.id;
    log(chatId, `message received: "${ctx.message.text}"`);
    const { prompt, effectiveOriginalMessage } = buildPromptForMessage(chatId, ctx.message.text, pending);
    log(chatId, `calling agy (bin=${config.agyBin}, timeout=${config.agyTimeout})...`);
    try {
      const result = await runHeadless(prompt, {
        agyBin: config.agyBin,
        timeout: config.agyTimeout,
        cwd: config.agyCwd,
      });
      log(
        chatId,
        `agy responded: status=${result.status}, duration=${(result.raw as { duration_seconds?: number }).duration_seconds ?? '?'}s`,
      );
      log(chatId, `agy raw result: ${JSON.stringify(result.raw)}`);
      const action = interpretAgyResponse(result.response);
      if (action.kind === 'clarify') {
        // Not ctx.message.text: on a 2nd+ clarification round that is only the
        // user's answer to the previous question, not the original message.
        log(chatId, `asking for clarification: "${action.text}"`);
        pending.set({ chatId, originalMessage: effectiveOriginalMessage, question: action.text });
      } else {
        log(chatId, `replying: "${action.text.slice(0, 200)}"`);
      }
      await ctx.reply(action.text.trim() || 'agy вернул пустой ответ — см. логи бота в консоли.');
    } catch (err) {
      console.error(`[${new Date().toISOString()}] [chat ${chatId}] runHeadless failed:`, err);
      await ctx.reply(`Ошибка: ${(err as Error).message}. Попробуйте ещё раз.`);
    }
  });

  return bot;
}
