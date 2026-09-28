import { describe, it, expect } from 'vitest';
import { isAuthorized } from '../../src/bot/auth.js';

describe('isAuthorized', () => {
  it('allows the configured id', () => {
    expect(isAuthorized(42, 42)).toBe(true);
  });
  it('rejects any other id', () => {
    expect(isAuthorized(1, 42)).toBe(false);
  });
  it('rejects undefined (no from field)', () => {
    expect(isAuthorized(undefined, 42)).toBe(false);
  });
});
