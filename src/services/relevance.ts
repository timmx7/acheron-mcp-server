// FTS5 rank scoring and result deduplication

import type Database from 'better-sqlite3';
import type { ContextRow } from '../types.js';
import { sanitizeFtsQuery } from '../utils/security.js';

export interface FtsSearchParams {
  query: string;
  project?: string;
  source_surface?: string;
  type?: string;
  limit: number;
  offset: number;
}

export interface FtsSearchResult {
  rows: ContextRow[];
  total: number;
}

export function searchWithFts(db: Database.Database, params: FtsSearchParams): FtsSearchResult {
  const sanitizedQuery = sanitizeFtsQuery(params.query);
  const conditions: string[] = [];
  const values: (string | number)[] = [];

  // FTS5 MATCH — always parameterized
  conditions.push('contexts_fts MATCH ?');
  values.push(sanitizedQuery);

  // Additional filters on the joined main table
  if (params.project !== undefined) {
    conditions.push('c.project = ?');
    values.push(params.project);
  }
  if (params.source_surface !== undefined) {
    conditions.push('c.source_surface = ?');
    values.push(params.source_surface);
  }
  if (params.type !== undefined) {
    conditions.push('c.type = ?');
    values.push(params.type);
  }

  const whereClause = conditions.join(' AND ');

  // Count total matches
  const countSql = `SELECT COUNT(*) as total FROM contexts_fts
    JOIN contexts c ON c.rowid = contexts_fts.rowid
    WHERE ${whereClause}`;
  const countRow = db.prepare(countSql).get(...values) as { total: number };

  // Fetch ranked results with BM25
  const selectSql = `SELECT c.* FROM contexts_fts
    JOIN contexts c ON c.rowid = contexts_fts.rowid
    WHERE ${whereClause}
    ORDER BY rank
    LIMIT ? OFFSET ?`;
  const rows = db.prepare(selectSql).all(...values, params.limit, params.offset) as ContextRow[];

  return { rows, total: countRow.total };
}
