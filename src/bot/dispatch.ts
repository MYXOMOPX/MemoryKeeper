import { PendingContextStore } from './pendingContext.js';
import { buildMessagePrompt, buildClarificationPrompt } from '../agy/prompts.js';

export interface DispatchedPrompt {
  prompt: string;
  /**
   * What to store as `originalMessage` if agy answers this prompt with yet
   * another CLARIFY. For a brand-new message it is the incoming text itself.
   * For a clarification continuation it is the TRUE original message (never
   * the user's answer alone), with the question just answered and its answer
   * appended — so neither the original message nor earlier answers are lost
   * across several consecutive clarification rounds.
   */
  effectiveOriginalMessage: string;
}

export function buildPromptForMessage(chatId: number, text: string, pending: PendingContextStore): DispatchedPrompt {
  const pendingEntry = pending.takeIfFresh(chatId);
  if (pendingEntry) {
    return {
      prompt: buildClarificationPrompt(pendingEntry.originalMessage, pendingEntry.question, text),
      effectiveOriginalMessage: `${pendingEntry.originalMessage}\n(уточнение: на вопрос "${pendingEntry.question}" пользователь ответил "${text}")`,
    };
  }
  return { prompt: buildMessagePrompt(text), effectiveOriginalMessage: text };
}
