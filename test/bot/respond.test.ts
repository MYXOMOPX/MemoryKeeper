import { describe, it, expect } from 'vitest';
import { interpretLlmResponse } from '../../src/bot/respond.js';

describe('interpretLlmResponse', () => {
  it('treats a CLARIFY-prefixed response as a clarification request', () => {
    const action = interpretLlmResponse('CLARIFY: Какой именно Петя?');
    expect(action).toEqual({ kind: 'clarify', text: 'Какой именно Петя?' });
  });

  it('treats any other response as a final reply', () => {
    const action = interpretLlmResponse('Записал: Пете нравится зелёный чай.');
    expect(action).toEqual({ kind: 'reply', text: 'Записал: Пете нравится зелёный чай.' });
  });
});
