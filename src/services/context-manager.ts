// Core CRUD business logic for context entries

import fs from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/client.js';
import { DB_PATH } from '../constants.js';
import type {
  ContextEntry,
  ContextRow,
  ContextFilter,
  PaginationParams,
  PaginatedResult,
  BridgeStatus,
  ContextType,
  Surface,
} from '../types.js';
import { sanitizeString, containsNullBytes, containsControlChars, validateIsoDate } from '../utils/security.js';
import { searchWithFts } from './relevance.js';

function rowToEntry(row: ContextRow): ContextEntry {
  return {
    id: row.id,
    content: row.content,
    type: row.type as ContextType,
    source_surface: row.source_surface as Surface,
    project: row.project,
    tags: JSON.parse(row.tags) as string[],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface SaveContextInput {
  content: string;
  type: ContextType;
  source_surface: Surface;
  project?: string;
  tags: string[];
}

export function saveContext(input: SaveContextInput): ContextEntry {
  const db = getDatabase();

  // Sanitize inputs
  const content = sanitizeString(input.content);
  if (!content) {
    throw new Error('Content cannot be empty after sanitization');
  }
  if (containsNullBytes(input.content)) {
    throw new Error('Content contains null bytes');
  }

  const project = input.project ? sanitizeString(input.project) : null;
  if (project !== null && containsControlChars(project)) {
    throw new Error('Project name contains control characters');
  }

  const tags = input.tags.map((tag) => {
    if (containsNullBytes(tag)) {
      throw new Error('Tag contains null bytes');
    }
    const sanitized = sanitizeString(tag);
    if (!sanitized) {
      throw new Error('Tag cannot be empty after sanitization');
    }
    return sanitized;
  });

  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO contexts (id, content, type, source_surface, project, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, content, input.type, input.source_surface, project, JSON.stringify(tags), now, now);

  return {
    id,
    content,
    type: input.type,
    source_surface: input.source_surface,
    project,
    tags,
    created_at: now,
    updated_at: now,
  };
}

export function getContext(id: string): ContextEntry | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM contexts WHERE id = ?').get(id) as ContextRow | undefined;
  return row ? rowToEntry(row) : null;
}

export interface SearchContextsInput {
  query: string;
  project?: string;
  source_surface?: Surface;
  type?: ContextType;
}

export function searchContexts(
  input: SearchContextsInput,
  pagination: PaginationParams
): PaginatedResult<ContextEntry> {
  const db = getDatabase();

  const result = searchWithFts(db, {
    query: input.query,
    project: input.project,
    source_surface: input.source_surface,
    type: input.type,
    limit: pagination.limit,
    offset: pagination.offset,
  });

  const items = result.rows.map(rowToEntry);
  const hasMore = pagination.offset + items.length < result.total;

  return {
    total: result.total,
    count: items.length,
    offset: pagination.offset,
    items,
    has_more: hasMore,
    ...(hasMore ? { next_offset: pagination.offset + pagination.limit } : {}),
  };
}

export function listContexts(
  filter: ContextFilter,
  pagination: PaginationParams
): PaginatedResult<ContextEntry> {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filter.project !== undefined) {
    conditions.push('project = ?');
    params.push(filter.project);
  }
  if (filter.source_surface !== undefined) {
    conditions.push('source_surface = ?');
    params.push(filter.source_surface);
  }
  if (filter.type !== undefined) {
    conditions.push('type = ?');
    params.push(filter.type);
  }
  if (filter.since !== undefined) {
    if (!validateIsoDate(filter.since)) {
      throw new Error('Invalid ISO 8601 date format for "since" parameter');
    }
    conditions.push('created_at > ?');
    params.push(filter.since);
  }

  let tagSubquery = '';
  if (filter.tags && filter.tags.length > 0) {
    // Entries must contain ALL specified tags
    const placeholders = filter.tags.map(() => '?').join(', ');
    tagSubquery = `id IN (
      SELECT c2.id FROM contexts c2, json_each(c2.tags) AS t
      WHERE t.value IN (${placeholders})
      GROUP BY c2.id
      HAVING COUNT(DISTINCT t.value) = ?
    )`;
    conditions.push(tagSubquery);
    params.push(...filter.tags, filter.tags.length);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Count total matches
  const countSql = `SELECT COUNT(*) as total FROM contexts ${whereClause}`;
  const countRow = db.prepare(countSql).get(...params) as { total: number };

  // Fetch page
  const selectSql = `SELECT * FROM contexts ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  const rows = db.prepare(selectSql).all(...params, pagination.limit, pagination.offset) as ContextRow[];

  const items = rows.map(rowToEntry);
  const hasMore = pagination.offset + items.length < countRow.total;

  return {
    total: countRow.total,
    count: items.length,
    offset: pagination.offset,
    items,
    has_more: hasMore,
    ...(hasMore ? { next_offset: pagination.offset + pagination.limit } : {}),
  };
}

export function deleteContext(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM contexts WHERE id = ?').run(id);
  return result.changes > 0;
}

export function getStatus(): BridgeStatus {
  const db = getDatabase();

  const totalRow = db.prepare('SELECT COUNT(*) as total FROM contexts').get() as { total: number };

  const surfaceRows = db.prepare(
    'SELECT source_surface, COUNT(*) as count FROM contexts GROUP BY source_surface'
  ).all() as Array<{ source_surface: string; count: number }>;

  const typeRows = db.prepare(
    'SELECT type, COUNT(*) as count FROM contexts GROUP BY type'
  ).all() as Array<{ type: string; count: number }>;

  const dateRow = db.prepare(
    'SELECT MIN(created_at) as oldest, MAX(created_at) as newest FROM contexts'
  ).get() as { oldest: string | null; newest: string | null };

  // Database file size
  let dbSizeBytes = 0;
  try {
    const stats = fs.statSync(DB_PATH);
    dbSizeBytes = stats.size;
  } catch {
    // DB file may not exist yet
  }

  const bySurface: Record<Surface, number> = { chat: 0, code: 0, cowork: 0 };
  for (const row of surfaceRows) {
    bySurface[row.source_surface as Surface] = row.count;
  }

  const byType: Record<ContextType, number> = {
    decision: 0, preference: 0, insight: 0,
    file_ref: 0, workflow: 0, note: 0,
  };
  for (const row of typeRows) {
    byType[row.type as ContextType] = row.count;
  }

  return {
    total_contexts: totalRow.total,
    by_surface: bySurface,
    by_type: byType,
    db_size_bytes: dbSizeBytes,
    oldest_entry: dateRow.oldest,
    newest_entry: dateRow.newest,
  };
}
