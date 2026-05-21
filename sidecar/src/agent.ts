import { generateText, stepCountIs, type LanguageModel, type ToolSet } from 'ai';
import { getModel } from './providers.js';
import { tools } from './tools.js';
import { buildSystemPrompt } from './system-prompt.js';
import type {
  ChatRequest,
  ChatMessage,
  ToolCallResponse,
  TextResponse,
  ErrorResponse,
} from './types.js';

/**
 * Normalise an IPC-protocol message into the shape the AI SDK expects.
 *
 * IPC uses `tool_calls` (plural, snake_case) on assistant messages and
 * `tool_call_id` on tool-result messages. The AI SDK uses `toolCalls`
 * and `toolCallId` respectively.
 */
function toCoreMessage(msg: ChatMessage): Record<string, unknown> {
  switch (msg.role) {
    case 'system':
      return { role: 'system', content: msg.content };
    case 'user':
      return { role: 'user', content: msg.content };
    case 'tool':
      return {
        role: 'tool',
        content: [{ type: 'tool-result' as const, toolCallId: msg.tool_call_id ?? '', result: msg.content }],
      };
    case 'assistant': {
      const toolCalls = (msg.tool_calls ?? []).map((tc) => ({
        type: 'tool-call' as const,
        toolCallId: tc.id ?? '',
        toolName: tc.function.name,
        args: JSON.parse(tc.function.arguments),
      }));
      return {
        role: 'assistant',
        content: msg.content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    }
    default:
      return { role: 'user', content: msg.content };
  }
}

/**
 * Handle an incoming chat request.
 *
 * 1. Resolve the language model from the config.
 * 2. Build the full message list (system prompt + conversation history).
 * 3. Call the AI SDK's `generateText` with the tools.
 * 4. Forward tool calls to Rust via the `send` callback in `onStepFinish`.
 * 5. Emit the final text response (or error).
 */
export async function handleChat(
  request: ChatRequest,
  send: (
    response: TextResponse | ToolCallResponse | ErrorResponse
  ) => void
): Promise<void> {
  let model: LanguageModel;

  try {
    model = getModel(request.config);
  } catch (err) {
    send({
      type: 'error',
      id: request.id,
      error: `Failed to initialise model: ${String(err)}`,
    });
    return;
  }

  const systemPrompt = buildSystemPrompt();
  const conversationMessages = request.messages.map(toCoreMessage);

  // Prepend the system prompt as a system message at the front
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...conversationMessages,
  ];

  try {
    const result = await generateText({
      model,
      messages: messages as Parameters<typeof generateText>[0]['messages'],
      tools: tools as unknown as ToolSet,
      stopWhen: stepCountIs(request.maxSteps ?? 20),
      temperature: request.config.temperature ?? 0.2,
      maxOutputTokens: request.config.maxTokens ?? 4096,
      onStepFinish: (event) => {
        if (event.toolCalls && event.toolCalls.length > 0) {
          for (const call of event.toolCalls) {
            send({
              type: 'tool_call',
              id: request.id,
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              args: call.args as Record<string, unknown>,
            });
          }
        }
      },
    });

    send({
      type: 'text',
      id: request.id,
      text: result.text,
      usage: {
        inputTokens: result.usage?.promptTokens ?? 0,
        outputTokens: result.usage?.completionTokens ?? 0,
      },
    });
  } catch (error) {
    send({
      type: 'error',
      id: request.id,
      error: `Generation failed: ${String(error)}`,
    });
  }
}
