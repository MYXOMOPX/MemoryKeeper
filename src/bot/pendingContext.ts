export interface PendingClarification {
  chatId: number;
  originalMessage: string;
  question: string;
  createdAt: number;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

export class PendingContextStore {
  private pending = new Map<number, PendingClarification>();

  constructor(private now: () => number = Date.now) {}

  set(entry: Omit<PendingClarification, 'createdAt'>): void {
    this.pending.set(entry.chatId, { ...entry, createdAt: this.now() });
  }

  takeIfFresh(chatId: number): PendingClarification | null {
    const entry = this.pending.get(chatId);
    if (!entry) return null;
    this.pending.delete(chatId);
    if (this.now() - entry.createdAt > ONE_HOUR_MS) return null;
    return entry;
  }

  clear(chatId: number): void {
    this.pending.delete(chatId);
  }
}
