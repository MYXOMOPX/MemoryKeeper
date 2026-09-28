import { describe, it, expect } from 'vitest';
import { PendingContextStore } from '../../src/bot/pendingContext.js';

describe('PendingContextStore', () => {
  it('returns null when nothing is pending for a chat', () => {
    const store = new PendingContextStore(() => 0);
    expect(store.takeIfFresh(1)).toBeNull();
  });

  it('returns and clears a pending entry within the 1-hour window', () => {
    let now = 0;
    const store = new PendingContextStore(() => now);
    store.set({ chatId: 1, originalMessage: 'Петя сделал сальто', question: 'Какой именно Петя?' });

    now = 30 * 60 * 1000; // 30 minutes later
    const entry = store.takeIfFresh(1);
    expect(entry?.question).toBe('Какой именно Петя?');
    expect(store.takeIfFresh(1)).toBeNull(); // consumed
  });

  it('discards an entry older than 1 hour', () => {
    let now = 0;
    const store = new PendingContextStore(() => now);
    store.set({ chatId: 1, originalMessage: 'X', question: 'Y?' });

    now = 61 * 60 * 1000; // 61 minutes later
    expect(store.takeIfFresh(1)).toBeNull();
  });

  it('keeps separate state per chat id', () => {
    const store = new PendingContextStore(() => 0);
    store.set({ chatId: 1, originalMessage: 'X', question: 'Y?' });
    expect(store.takeIfFresh(2)).toBeNull();
    expect(store.takeIfFresh(1)).not.toBeNull();
  });
});
