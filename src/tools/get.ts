import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getContext } from '../services/context-manager.js';
import { formatContextMarkdown, formatContextJson } from '../utils/format.js';
import { createToolError, handleDatabaseError, createToolSuccess } from '../utils/errors.js';

export function registerGetTool(server: McpServer): void {
  server.registerTool(
    'bridge_get_context',
    {
      title: 'Recall Saved Context',
      description: 'Retrieve the full details of a previously saved context by its ID. Use this after finding a context via search or list, when the user wants to see the complete content of a specific saved memory. Typically used as a follow-up: "show me that decision", "give me the full details on that one".',
      inputSchema: {
        id: z.string().uuid('Must be a valid UUID v4')
          .describe('The UUID of the context to retrieve. Get this from search or list results.'),
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
    async ({ id, response_format }) => {
      try {
        const entry = getContext(id);
        if (!entry) {
          return createToolError(
            `Context not found: ${id}`,
            'Use bridge_list_contexts or bridge_search_context to find available contexts.'
          );
        }
        const text = response_format === 'json'
          ? formatContextJson(entry)
          : formatContextMarkdown(entry);
        return createToolSuccess(text);
      } catch (error: unknown) {
        return handleDatabaseError(error);
      }
    }
  );
}
