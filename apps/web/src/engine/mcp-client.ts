/**
 * @deskspawn/browser-engine — MCP client (stub)
 *
 * MCP (Model Context Protocol) client for browser environment.
 * Currently a stub — will be implemented when MCP tools are needed
 * in the browser (e.g. grep.app search).
 */

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

let _initialized = false;
let _tools: Record<string, MCPTool> = {};

/**
 * Initialize MCP clients.
 * Currently a no-op until browser-compatible MCP transport is implemented.
 */
export async function initMCPClients(): Promise<void> {
  if (_initialized) return;
  // TODO: Implement browser-compatible MCP transport (WebSocket/SSE)
  _initialized = true;
}

/**
 * Get all registered MCP tools.
 */
export function getMCPTools(): Record<string, MCPTool> | null {
  return Object.keys(_tools).length > 0 ? _tools : null;
}

/**
 * Close all MCP clients.
 */
export async function closeMCPClients(): Promise<void> {
  _tools = {};
  _initialized = false;
}
