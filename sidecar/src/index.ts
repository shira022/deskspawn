import { createInterface } from 'readline';
import { handleChat } from './agent.js';
import type {
  InboundMessage,
  OutboundMessage,
} from './types.js';

/**
 * Write a JSON message to stdout followed by a newline.
 * This is the sole output channel to the Rust parent process.
 */
function send(msg: OutboundMessage): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

/**
 * Main entry point for the DeskSpawn AI sidecar.
 *
 * Protocol: JSON Lines over stdin/stdout
 * - Reads one JSON object per line from stdin
 * - Writes one JSON object per line to stdout
 * - Signals readiness by sending a `ready` message on startup
 *
 * Supported message types:
 *   - `chat`  → run the AI agent loop, forwarding tool calls to Rust
 *   - `ping`  → respond with `pong`
 */
async function main(): Promise<void> {
  // Signal to the parent process that the sidecar is ready
  send({ type: 'ready' });

  const rl = createInterface({ input: process.stdin, terminal: false });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let msg: InboundMessage;
    try {
      msg = JSON.parse(trimmed);
    } catch (e) {
      send({
        type: 'error',
        id: 'unknown',
        error: `Failed to parse incoming message: ${String(e)}`,
      });
      continue;
    }

    try {
      switch (msg.type) {
        case 'chat': {
          // Fire-and-forget – the agent will send responses via the callback
          handleChat(msg, send).catch((err) => {
            send({
              type: 'error',
              id: msg.id,
              error: `Unhandled agent error: ${String(err)}`,
            });
          });
          break;
        }

        case 'ping': {
          send({ type: 'pong', id: msg.id });
          break;
        }

        default: {
          send({
            type: 'error',
            id: 'unknown',
            error: `Unknown message type: "${(msg as { type: string }).type}"`,
          });
          break;
        }
      }
    } catch (e) {
      send({
        type: 'error',
        id: (msg as { id?: string }).id ?? 'unknown',
        error: `Handler error: ${String(e)}`,
      });
    }
  }
}

// ─── Process Lifecycle ─────────────────────────────────────────────────────────

process.on('SIGTERM', () => {
  process.exit(0);
});

process.on('SIGINT', () => {
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  // Attempt to report, then exit
  send({
    type: 'error',
    id: 'unknown',
    error: `Uncaught exception: ${String(err)}`,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  send({
    type: 'error',
    id: 'unknown',
    error: `Unhandled rejection: ${String(reason)}`,
  });
  process.exit(1);
});

main().catch((err) => {
  console.error('Fatal error in sidecar main():', err);
  process.exit(1);
});
