import { CLARIFY_PREFIX } from '../agy/prompts.js';

export interface ResponseAction {
  kind: 'reply' | 'clarify';
  text: string;
}

export function interpretAgyResponse(response: string): ResponseAction {
  if (response.startsWith(CLARIFY_PREFIX)) {
    return { kind: 'clarify', text: response.slice(CLARIFY_PREFIX.length).trim() };
  }
  return { kind: 'reply', text: response };
}
