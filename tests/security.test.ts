import { describe, it, expect } from 'vitest';
import {
  sanitizeFtsQuery,
  sanitizeString,
  containsNullBytes,
  containsControlChars,
  validateIsoDate,
} from '../src/utils/security.js';

describe('sanitizeString', () => {
  it('trims whitespace', () => {
    expect(sanitizeString('  hello  ')).toBe('hello');
  });

  it('strips null bytes', () => {
    expect(sanitizeString('hello\0world')).toBe('helloworld');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(sanitizeString('   ')).toBe('');
  });
});

describe('containsNullBytes', () => {
  it('detects null bytes', () => {
    expect(containsNullBytes('hello\0')).toBe(true);
  });

  it('returns false for clean strings', () => {
    expect(containsNullBytes('hello world')).toBe(false);
  });
});

describe('containsControlChars', () => {
  it('detects control characters', () => {
    expect(containsControlChars('hello\x01world')).toBe(true);
    expect(containsControlChars('hello\x7fworld')).toBe(true);
  });

  it('allows normal whitespace (newlines, tabs)', () => {
    // \n is \x0a, \t is \x09 — the regex excludes \x09 and \x0a and \x0d
    expect(containsControlChars('hello\nworld')).toBe(false);
  });

  it('returns false for clean strings', () => {
    expect(containsControlChars('hello world')).toBe(false);
  });
});

describe('sanitizeFtsQuery', () => {
  it('passes through simple queries', () => {
    expect(sanitizeFtsQuery('react hooks')).toBe('react hooks');
  });

  it('passes through quoted phrases', () => {
    expect(sanitizeFtsQuery('"react hooks"')).toBe('"react hooks"');
  });

  it('removes unbalanced quotes', () => {
    expect(sanitizeFtsQuery('"react hooks')).toBe('react hooks');
  });

  it('strips control characters', () => {
    expect(sanitizeFtsQuery('hello\x00world')).toBe('helloworld');
  });

  it('returns empty-match for empty query', () => {
    expect(sanitizeFtsQuery('')).toBe('""');
    expect(sanitizeFtsQuery('   ')).toBe('""');
  });

  it('handles FTS5 operators in queries', () => {
    const result = sanitizeFtsQuery('react AND hooks');
    expect(result).toBe('react AND hooks');
  });

  it('handles SQL injection attempts in FTS query', () => {
    const result = sanitizeFtsQuery("'; DROP TABLE contexts; --");
    expect(result).toContain('DROP TABLE');
    // The key point: this is passed as a MATCH parameter, never executed as SQL
  });
});

describe('validateIsoDate', () => {
  it('accepts valid ISO 8601 dates', () => {
    expect(validateIsoDate('2024-01-01T00:00:00Z')).toBe(true);
    expect(validateIsoDate('2024-06-15T14:30:00.000Z')).toBe(true);
    expect(validateIsoDate('2024-01-01T00:00:00+02:00')).toBe(true);
  });

  it('rejects invalid dates', () => {
    expect(validateIsoDate('not-a-date')).toBe(false);
    expect(validateIsoDate('2024-13-01T00:00:00Z')).toBe(false);
    expect(validateIsoDate('2024/01/01')).toBe(false);
    expect(validateIsoDate('')).toBe(false);
  });
});

describe('SQL injection patterns', () => {
  it('null bytes cannot bypass sanitization', () => {
    expect(containsNullBytes("content\0'; DROP TABLE--")).toBe(true);
  });

  it('long inputs are handled without crash', () => {
    const longString = 'a'.repeat(100_000);
    expect(() => sanitizeString(longString)).not.toThrow();
    expect(sanitizeString(longString)).toHaveLength(100_000);
  });

  it('unicode is preserved through sanitization', () => {
    expect(sanitizeString('日本語テスト')).toBe('日本語テスト');
    expect(sanitizeFtsQuery('日本語テスト')).toBe('日本語テスト');
  });
});
