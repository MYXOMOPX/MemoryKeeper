import { describe, it, expect } from 'vitest';
import { PendingContextStore } from '../../src/bot/pendingContext.js';
import { buildPromptForMessage } from '../../src/bot/dispatch.js';

describe('buildPromptForMessage', () => {
  it('builds a fresh message prompt when nothing is pending', () => {
    const pending = new PendingContextStore(() => 0);
    const prompt = buildPromptForMessage(1, 'Пете нравится чай', pending);
    expect(prompt).toContain('Пете нравится чай');
  });

  it('builds a clarification prompt when an unanswered question is pending and fresh', () => {
    const pending = new PendingContextStore(() => 0);
    pending.set({ chatId: 1, originalMessage: 'Петя сделал сальто', question: 'Какой именно Петя?' });
    const prompt = buildPromptForMessage(1, 'Петя Иванов', pending);
    expect(prompt).toContain('Петя сделал сальто');
    expect(prompt).toContain('Какой именно Петя?');
    expect(prompt).toContain('Петя Иванов');
  });
});
