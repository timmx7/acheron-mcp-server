import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { searchContexts } from '../services/context-manager.js';
import { formatContextListMarkdown, formatContextListJson } from '../utils/format.js';
import { handleDatabaseError, createToolSuccess } from '../utils/errors.js';

export function registerSearchTool(server: McpServer): void {
  server.registerTool(
    'bridge_search_context',
    {
      title: 'Search Saved Knowledge',
      description:
        'Search through everything that has been saved across conversations. Use when the user asks "what did I decide about...", "what do we know about...", "did I save anything about...", "find my notes on...", "what was that thing about...", or any question that might be answered by previously saved context. Also use proactively when the user asks a question that saved context might answer — check before saying "I don\'t have that information". Searches across all surfaces (Chat, Code, Cowork) and all projects.',
      inputSchema: {
        query: z.string().min(1).max(500)
          .describe("Keywords to search for. Use natural terms like 'authentication' or 'deploy process'. Supports quoted phrases like '\"react hooks\"' and operators AND/OR/NOT."),
        project: z.string().max(200).optional()
          .describe('Narrow search to a specific project. Omit to search across all projects.'),
        source_surface: z.enum(['chat', 'code', 'cowork']).optional()
          .describe('Narrow search to contexts saved from a specific surface. Omit to search all surfaces.'),
        type: z.enum(['decision', 'preference', 'insight', 'file_ref', 'workflow', 'note']).optional()
          .describe('Narrow search to a specific type. Use "decision" when user asks "what did I/we decide about...", "preference" for "what are my preferences for...", etc.'),
        limit: z.number().int().min(1).max(50).default(10)
          .describe('Maximum number of results to return (1-50, default 10)'),
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
    async ({ query, project, source_surface, type, limit, offset, response_format }) => {
      try {
        const result = searchContexts(
          { query, project, source_surface, type },
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
