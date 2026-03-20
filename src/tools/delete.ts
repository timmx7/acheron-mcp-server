import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deleteContext } from '../services/context-manager.js';
import { createToolError, handleDatabaseError, createToolSuccess } from '../utils/errors.js';

export function registerDeleteTool(server: McpServer): void {
  server.registerTool(
    'bridge_delete_context',
    {
      title: 'Forget / Delete Context',
      description: 'Permanently delete a saved context. Use when the user says "forget this", "delete that", "remove that note", "I don\'t need that anymore", or "that\'s outdated, remove it". Requires the context ID — use search or list first to find it.',
      inputSchema: {
        id: z.string().uuid('Must be a valid UUID v4')
          .describe('The UUID of the context to delete. Find it first using search or list.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id }) => {
      try {
        const deleted = deleteContext(id);
        if (!deleted) {
          return createToolError(
            `Context not found: ${id}`,
            'Use bridge_list_contexts to see available contexts.'
          );
        }
        return createToolSuccess(`Context ${id} has been deleted.`);
      } catch (error: unknown) {
        return handleDatabaseError(error);
      }
    }
  );
}
