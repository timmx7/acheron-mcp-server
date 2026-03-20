// Input sanitization, FTS5 query safety, path validation

const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

export function sanitizeString(raw: string): string {
  return raw.replace(/\0/g, '').trim();
}

export function containsNullBytes(value: string): boolean {
  return value.includes('\0');
}

export function containsControlChars(value: string): boolean {
  // Match control chars except \t (\x09), \n (\x0a), \r (\x0d)
  return /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
}

export function sanitizeFtsQuery(raw: string): string {
  // Strip null bytes and control characters
  let sanitized = raw.replace(/[\x00-\x1f\x7f]/g, '');

  // Extract balanced quoted phrases first, then handle the rest
  const phrases: string[] = [];
  sanitized = sanitized.replace(/"([^"]+)"/g, (_match, phrase: string) => {
    phrases.push(`"${phrase}"`);
    return '';
  });

  // Strip all FTS5 special characters from remaining text
  sanitized = sanitized.replace(/[^a-zA-Z0-9\s\u0080-\uffff]/g, ' ');
  sanitized = sanitized.trim();

  // Collect individual words and quoted phrases
  const words = sanitized.split(/\s+/).filter((w) => w.length > 0);

  // Recognize AND/OR/NOT as FTS5 operators when between terms
  const ftsOperators = new Set(['AND', 'OR', 'NOT']);
  const tokens: string[] = [];

  for (const word of words) {
    if (ftsOperators.has(word) && tokens.length > 0) {
      tokens.push(word);
    } else {
      tokens.push(word);
    }
  }

  const allParts = [...phrases, ...tokens];

  if (allParts.length === 0) {
    return '""';
  }

  return allParts.join(' ');
}

export function validateIsoDate(raw: string): boolean {
  if (!ISO_8601_REGEX.test(raw)) {
    return false;
  }
  const date = new Date(raw);
  return !isNaN(date.getTime());
}
