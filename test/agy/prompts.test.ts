import { describe, it, expect } from 'vitest';
import { buildMessagePrompt, buildClarificationPrompt, CLARIFY_PREFIX } from '../../src/agy/prompts.js';

describe('buildMessagePrompt', () => {
  it('includes the user message and both fact/question branches', () => {
    const prompt = buildMessagePrompt('Пете нравится зелёный чай');
    expect(prompt).toContain('Пете нравится зелёный чай');
    expect(prompt).toContain('write_fact');
    expect(prompt).toContain('search_entities');
  });

  it('instructs not to dump the whole vault', () => {
    const prompt = buildMessagePrompt('какой чай у Пети');
    expect(prompt.toLowerCase()).toContain('не читай весь vault');
  });

  it('references the CLARIFY convention', () => {
    const prompt = buildMessagePrompt('кто он?');
    expect(prompt).toContain(CLARIFY_PREFIX);
  });
});

describe('buildClarificationPrompt', () => {
  it('includes the original message, the question and the answer', () => {
    const prompt = buildClarificationPrompt('Петя сделал сальто', 'Какой именно Петя?', 'Петя Иванов');
    expect(prompt).toContain('Петя сделал сальто');
    expect(prompt).toContain('Какой именно Петя?');
    expect(prompt).toContain('Петя Иванов');
  });
});
