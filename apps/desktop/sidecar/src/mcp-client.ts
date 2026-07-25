/**
 * MCP Client Manager
 *
 * Manages connections to external MCP (Model Context Protocol) servers.
 * Currently connects to grep.app for GitHub code search.
 *
 * MCP tools returned by getMCPTools() are AI SDK-compatible and can be
 * merged directly into the tool set passed to generateText/streamText.
 */

import { createMCPClient } from '@ai-sdk/mcp';

const GREP_APP_URL = 'https://mcp.grep.app';

let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | null = null;
let mcpTools: Record<string, any> | null = null;

/**
 * Initialize all MCP client connections.
 * Call once at server startup. Failures are non-fatal — tools are
 * simply unavailable if the remote server is unreachable.
 */
export async function initMCPClients(): Promise<void> {
  // ── grep.app (GitHub code search) ───────────────────────────────
  try {
    mcpClient = await createMCPClient({
      transport: { type: 'http', url: GREP_APP_URL },
    });
    const tools = await mcpClient.tools();
    mcpTools = tools as Record<string, any>;
    console.log(`[mcp] grep.app connected — tool: ${Object.keys(tools).join(', ')}`);
  } catch (e) {
    console.warn('[mcp] Failed to connect to grep.app (non-fatal):', e instanceof Error ? e.message : e);
  }
}

/**
 * Get all connected MCP tools, keyed by tool name.
 * Returns null if the client hasn't been initialised or failed.
 * Each tool is an AI SDK Tool-compatible object with execute().
 */
export function getMCPTools(): Record<string, any> | null {
  return mcpTools;
}

/**
 * Close all MCP client connections.
 * Call once at server shutdown.
 */
export async function closeMCPClients(): Promise<void> {
  if (mcpClient) {
    await mcpClient.close();
    mcpClient = null;
    mcpTools = null;
    console.log('[mcp] grep.app client closed');
  }
}
