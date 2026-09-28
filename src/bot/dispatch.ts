import { PendingContextStore } from './pendingContext.js';
import { buildMessagePrompt, buildClarificationPrompt } from '../agy/prompts.js';

export function buildPromptForMessage(chatId: number, text: string, pending: PendingContextStore): string {
  const pendingEntry = pending.takeIfFresh(chatId);
  if (pendingEntry) {
    return buildClarificationPrompt(pendingEntry.originalMessage, pendingEntry.question, text);
  }
  return buildMessagePrompt(text);
}
