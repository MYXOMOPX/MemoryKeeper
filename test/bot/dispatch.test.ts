import { describe, it, expect } from 'vitest';
import { PendingContextStore } from '../../src/bot/pendingContext.js';
import { buildPromptForMessage } from '../../src/bot/dispatch.js';

describe('buildPromptForMessage', () => {
  it('builds a fresh message prompt when nothing is pending', () => {
    const pending = new PendingContextStore(() => 0);
    const { prompt, effectiveOriginalMessage } = buildPromptForMessage(1, 'Пете нравится чай', pending);
    expect(prompt).toContain('Пете нравится чай');
    expect(effectiveOriginalMessage).toBe('Пете нравится чай');
  });

  it('builds a clarification prompt when an unanswered question is pending and fresh', () => {
    const pending = new PendingContextStore(() => 0);
    pending.set({ chatId: 1, originalMessage: 'Петя сделал сальто', question: 'Какой именно Петя?' });
    const { prompt, effectiveOriginalMessage } = buildPromptForMessage(1, 'Петя Иванов', pending);
    expect(prompt).toContain('Петя сделал сальто');
    expect(prompt).toContain('Какой именно Петя?');
    expect(prompt).toContain('Петя Иванов');
    expect(effectiveOriginalMessage.startsWith('Петя сделал сальто')).toBe(true);
  });

  it('keeps the true original message (and the first answer) across two consecutive clarification rounds', () => {
    const pending = new PendingContextStore(() => 0);

    // Round 0: brand-new message; agy answers CLARIFY → bot stores the pending entry
    // exactly as src/bot/index.ts does, using effectiveOriginalMessage.
    const first = buildPromptForMessage(1, 'Петя сделал сальто', pending);
    pending.set({ chatId: 1, originalMessage: first.effectiveOriginalMessage, question: 'Какой именно Петя?' });

    // Round 1: user answers; agy asks a SECOND clarifying question.
    const second = buildPromptForMessage(1, 'Иванов', pending);
    expect(second.prompt).toContain('Петя сделал сальто');
    pending.set({ chatId: 1, originalMessage: second.effectiveOriginalMessage, question: 'На каком событии?' });

    // Round 2: the pending entry being consumed must still carry the true original message.
    const third = buildPromptForMessage(1, 'На ДР у Кати', pending);
    expect(third.prompt).toContain('Петя сделал сальто');
    expect(third.prompt).toContain('Какой именно Петя?');
    expect(third.prompt).toContain('Иванов');
    expect(third.prompt).toContain('На каком событии?');
    expect(third.prompt).toContain('На ДР у Кати');
    expect(second.effectiveOriginalMessage).not.toBe('Иванов');
    expect(second.effectiveOriginalMessage.startsWith('Петя сделал сальто')).toBe(true);
  });
});
