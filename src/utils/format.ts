// Markdown and JSON response formatters

import type { ContextEntry, PaginatedResult, BridgeStatus } from '../types.js';

export function formatContextMarkdown(entry: ContextEntry): string {
  const lines = [
    `## Context: ${entry.id}`,
    '',
    `- **Type**: ${entry.type}`,
    `- **Surface**: ${entry.source_surface}`,
    `- **Project**: ${entry.project ?? '(none)'}`,
    `- **Tags**: ${entry.tags.length > 0 ? entry.tags.join(', ') : '(none)'}`,
    `- **Created**: ${entry.created_at}`,
    `- **Updated**: ${entry.updated_at}`,
    '',
    '### Content',
    '',
    entry.content,
  ];
  return lines.join('\n');
}

export function formatContextListMarkdown(result: PaginatedResult<ContextEntry>): string {
  if (result.items.length === 0) {
    return 'No contexts found matching your criteria.';
  }

  const lines = [
    `**Found ${result.total} context(s)** — showing ${result.offset + 1}–${result.offset + result.count}`,
    '',
  ];

  for (const entry of result.items) {
    const tags = entry.tags.length > 0 ? ` [${entry.tags.join(', ')}]` : '';
    const project = entry.project ? ` (${entry.project})` : '';
    lines.push(`### ${entry.type}${project}${tags}`);
    lines.push(`> ID: \`${entry.id}\` | ${entry.source_surface} | ${entry.created_at}`);
    lines.push('');
    // Truncate long content in list view
    const preview = entry.content.length > 200
      ? entry.content.substring(0, 200) + '...'
      : entry.content;
    lines.push(preview);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  if (result.has_more) {
    lines.push(`*More results available. Use \`offset: ${result.next_offset}\` to see the next page.*`);
  }

  return lines.join('\n');
}

export function formatStatusMarkdown(status: BridgeStatus): string {
  const lines = [
    '# Acheron Bridge Status',
    '',
    `**Total contexts**: ${status.total_contexts}`,
    `**Database size**: ${formatBytes(status.db_size_bytes)}`,
    `**Date range**: ${status.oldest_entry ?? 'N/A'} → ${status.newest_entry ?? 'N/A'}`,
    '',
    '## By Surface',
    '',
    `| Surface | Count |`,
    `|---------|-------|`,
    `| Chat    | ${status.by_surface.chat} |`,
    `| Code    | ${status.by_surface.code} |`,
    `| Cowork  | ${status.by_surface.cowork} |`,
    '',
    '## By Type',
    '',
    `| Type | Count |`,
    `|------|-------|`,
  ];

  for (const [typeName, count] of Object.entries(status.by_type)) {
    lines.push(`| ${typeName} | ${count} |`);
  }

  return lines.join('\n');
}

export function formatContextJson(entry: ContextEntry): string {
  return JSON.stringify(entry, null, 2);
}

export function formatContextListJson(result: PaginatedResult<ContextEntry>): string {
  return JSON.stringify(result, null, 2);
}

export function formatStatusJson(status: BridgeStatus): string {
  return JSON.stringify(status, null, 2);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
