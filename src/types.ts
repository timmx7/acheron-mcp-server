export type ContextType = 'decision' | 'preference' | 'insight' | 'file_ref' | 'workflow' | 'note';
export type Surface = 'chat' | 'code' | 'cowork';

export interface ContextEntry {
  id: string;
  content: string;
  type: ContextType;
  source_surface: Surface;
  project: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface ContextFilter {
  project?: string;
  source_surface?: Surface;
  type?: ContextType;
  tags?: string[];
  since?: string;
}

export interface PaginationParams {
  limit: number;
  offset: number;
}

export interface PaginatedResult<T> {
  total: number;
  count: number;
  offset: number;
  items: T[];
  has_more: boolean;
  next_offset?: number;
}

export interface BridgeStatus {
  total_contexts: number;
  by_surface: Record<Surface, number>;
  by_type: Record<ContextType, number>;
  db_size_bytes: number;
  oldest_entry: string | null;
  newest_entry: string | null;
}

// Row shape returned by better-sqlite3 before parsing tags from JSON
export interface ContextRow {
  id: string;
  content: string;
  type: string;
  source_surface: string;
  project: string | null;
  tags: string;
  created_at: string;
  updated_at: string;
}
