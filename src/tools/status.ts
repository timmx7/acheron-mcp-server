import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getStatus } from '../services/context-manager.js';
import { formatStatusMarkdown, formatStatusJson } from '../utils/format.js';
import { handleDatabaseError, createToolSuccess } from '../utils/errors.js';

export function registerStatusTool(server: McpServer): void {
  server.registerTool(
    'bridge_status',
    {
      title: 'Memory Overview',
      description:
        'Show a summary of all saved knowledge: how many contexts are stored, broken down by surface (Chat/Code/Cowork) and type (decisions, preferences, insights, etc.), database size, and date range. Use when the user asks "how much have I saved?", "give me an overview", "what\'s in my memory?", or "how big is my context database?".',
      inputSchema: {
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
    async ({ response_format }) => {
      try {
        const status = getStatus();
        const text = response_format === 'json'
          ? formatStatusJson(status)
          : formatStatusMarkdown(status);
        return createToolSuccess(text);
      } catch (error: unknown) {
        return handleDatabaseError(error);
      }
    }
  );
}
