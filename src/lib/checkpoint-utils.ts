import type { CheckpointInfo, ChatMessage } from "@/types";
import { sidecarBase } from "@/lib/constants";

/**
 * Given the current checkpoint index (as used by the preview slider),
 * return how many chat messages should be visible.
 *
 * Each checkpoint (other than "initial") corresponds to the assistant
 * message that recorded that checkpoint's ID.  The visible message
 * count is the index + 1 of that assistant message.
 *
 * For the special "initial" checkpoint we return 0 (empty chat).
 * If no matching message is found (edge case) we fall back to showing
 * all messages so the UI is never stuck with a wrongly-empty chat.
 */
export function getMessageCountForCheckpoint(
  checkpoints: CheckpointInfo[],
  messages: ChatMessage[],
  checkpointIndex: number,
): number {
  if (checkpointIndex < 0 || checkpoints.length === 0) {
    return messages.length;
  }

  const cp = checkpoints[checkpointIndex];
  if (!cp) return messages.length;

  // The synthetic "initial" checkpoint has no matching assistant message
  if (cp.id === "initial") {
    return 0;
  }

  // Walk backwards through messages to find the assistant message that
  // was attached to this checkpoint.  Each AI generation creates a
  // checkpoint and the assistant message stores that checkpoint's ID.
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant" && messages[i].checkpointId === cp.id) {
      return i + 1;
    }
  }

  // Fallback – shouldn't happen for real checkpoints, but keeps the UI safe
  return messages.length;
}

/**
 * Restore project files to a given checkpoint and clean up future checkpoints.
 * Throws if the restore fails.
 */
export async function restoreCheckpoint(checkpointId: string): Promise<void> {
  const restoreRes = await fetch(`${sidecarBase()}/projects/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checkpointId }),
  });
  if (!restoreRes.ok) {
    throw new Error(`Restore failed: ${await restoreRes.text()}`);
  }

  // Clean up checkpoints after the restored one (undo-style)
  const cleanupRes = await fetch(`${sidecarBase()}/projects/checkpoints/cleanup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keepCheckpointId: checkpointId }),
  });
  if (!cleanupRes.ok) {
    console.warn("[checkpoint] Cleanup returned non-OK:", await cleanupRes.text());
  }
}
