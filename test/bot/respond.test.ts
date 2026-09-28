import { describe, it, expect } from 'vitest';
import { interpretAgyResponse } from '../../src/bot/respond.js';

describe('interpretAgyResponse', () => {
  it('treats a CLARIFY-prefixed response as a clarification request', () => {
    const action = interpretAgyResponse('CLARIFY: Какой именно Петя?');
    expect(action).toEqual({ kind: 'clarify', text: 'Какой именно Петя?' });
  });

  it('treats any other response as a final reply', () => {
    const action = interpretAgyResponse('Записал: Пете нравится зелёный чай.');
    expect(action).toEqual({ kind: 'reply', text: 'Записал: Пете нравится зелёный чай.' });
  });
});
