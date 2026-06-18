import type { CheckpointInfo, ChatMessage } from "@/types";
import { getProjectId } from "@/engine/tool-executors";

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
 * Restore project files to a given checkpoint and clean up future checkpoints
 * using browser-native checkpoint storage (IndexedDB).
 * Throws if the restore fails.
 */
export async function restoreCheckpoint(checkpointId: string): Promise<void> {
  const pid = getProjectId();
  if (!pid) throw new Error("No project selected.");

  // Use the browser-native checkpoint restore from tool-executors
  const { restoreCheckpoint: engineRestore, deleteCheckpointsAfter } = await import("@/engine/tool-executors");
  await engineRestore(pid, checkpointId);
  await deleteCheckpointsAfter(pid, checkpointId);
}
