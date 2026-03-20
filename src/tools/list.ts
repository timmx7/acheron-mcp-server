import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listContexts } from '../services/context-manager.js';
import { formatContextListMarkdown, formatContextListJson } from '../utils/format.js';
import { handleDatabaseError, createToolSuccess } from '../utils/errors.js';

export function registerListTool(server: McpServer): void {
  server.registerTool(
    'bridge_list_contexts',
    {
      title: 'Browse Saved Contexts',
      description:
        'Browse and filter all saved contexts. Use when the user asks "what have I saved?", "show me my decisions", "what do I have for this project?", "list my preferences", "what did we do recently?", "show everything tagged with...", or "what happened in Cowork?". Unlike search (keyword-based), this tool browses by category — filter by project, surface, type, tags, or date. Returns newest entries first.',
      inputSchema: {
        project: z.string().max(200).optional()
          .describe('Show only contexts for this project. Use when user asks "what do we have for [project]?" or "show me everything on [project]".'),
        source_surface: z.enum(['chat', 'code', 'cowork']).optional()
          .describe('Show only contexts from a specific surface. Use when user asks "what did I save in Chat?" or "what happened in Cowork?".'),
        type: z.enum(['decision', 'preference', 'insight', 'file_ref', 'workflow', 'note']).optional()
          .describe('Show only a specific type. "decision" for "show my decisions", "preference" for "what are my preferences", "workflow" for "what processes do we have", etc.'),
        tags: z.array(z.string()).optional()
          .describe('Show contexts with ALL of these tags. Use when user asks "show everything tagged with auth" or "find frontend + react entries".'),
        since: z.string().optional()
          .describe('Only show contexts saved after this date (ISO 8601). Use when user asks "what did I save this week?" or "anything new since Monday?".'),
        limit: z.number().int().min(1).max(50).default(20)
          .describe('Maximum number of results to return (1-50, default 20)'),
        offset: z.number().int().min(0).default(0)
          .describe('Number of results to skip for pagination'),
        response_format: z.enum(['json', 'markdown']).default('markdown')
          .describe('Response format: json or markdown'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ project, source_surface, type, tags, since, limit, offset, response_format }) => {
      try {
        const result = listContexts(
          { project, source_surface, type, tags, since },
          { limit, offset }
        );
        const text = response_format === 'json'
          ? formatContextListJson(result)
          : formatContextListMarkdown(result);
        return createToolSuccess(text);
      } catch (error: unknown) {
        return handleDatabaseError(error);
      }
    }
  );
}
