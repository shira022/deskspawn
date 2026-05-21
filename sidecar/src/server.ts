/**
 * HTTP server for the DeskSpawn sidecar.
 * Provides a REST API for the frontend to call for AI-powered code generation.
 * For dev/demo mode, tools are executed directly (not via Rust IPC).
 */
import express from 'express';
import cors from 'cors';
import { generateText, stepCountIs } from 'ai';
import { getModel } from './providers.js';
import { tools } from './tools.js';
import { buildSystemPrompt } from './system-prompt.js';
import * as executors from './tool-executors.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
const WORKSPACE_DIR = executors.getWorkspaceDir();

// ── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', workspace: WORKSPACE_DIR });
});

// ── Chat endpoint ────────────────────────────────────────────────────────────

app.post('/chat', async (req, res) => {
  const { messages, config } = req.body;
  
  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: 'messages array required' });
    return;
  }

  try {
    const model = getModel({
      provider: config?.provider || 'ollama',
      model: config?.model || 'qwen3.5:4b',
      apiKey: config?.apiKey || '',
      customEndpoint: config?.customEndpoint,
      temperature: config?.temperature ?? 0.2,
      maxTokens: config?.maxTokens,
    });

    const systemPrompt = buildSystemPrompt();
    
    // Build message history
    const aiMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...messages.map((m: any) => ({
        role: m.role as 'user' | 'assistant' | 'tool',
        content: m.content,
        ...(m.tool_calls ? { toolCalls: m.tool_calls } : {}),
        ...(m.tool_call_id ? { toolCallId: m.tool_call_id } : {}),
      })),
    ];

    // Create tools with execute functions that call executors directly
    const toolsWithExec = {
      read_file: {
        ...tools.read_file,
        execute: async ({ path: filePath }: { path: string }) => {
          const content = await executors.readFile(filePath);
          console.log(`[exec] read_file(${filePath}) => ${content.length} chars`);
          return content;
        },
      },
      list_files: {
        ...tools.list_files,
        execute: async () => {
          return await executors.listFiles();
        },
      },
      apply_artifact: {
        ...tools.apply_artifact,
        execute: async ({ json }: { json: string }) => {
          console.log(`[exec] apply_artifact jsonLen=${json?.length || 0}`);
          return await executors.applyArtifact(json);
        },
      },
      run_shell: {
        ...tools.run_shell,
        execute: async ({ command }: { command: string }) => {
          console.log(`[exec] run_shell: ${command}`);
          try {
            const { execSync } = require('child_process');
            const result = execSync(command, {
              cwd: WORKSPACE_DIR,
              encoding: 'utf-8',
              timeout: 120_000,
              stdio: 'pipe',
            });
            return { success: true, stdout: result, stderr: '', exitCode: 0 };
          } catch (e: any) {
            return {
              success: false,
              stdout: e.stdout || '',
              stderr: e.stderr || e.message || '',
              exitCode: e.status || 1,
            };
          }
        },
      },
      get_errors: {
        ...tools.get_errors,
        execute: async () => {
          return await executors.getErrors();
        },
      },
    };

    // Set up SSE for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendSSE = (data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await generateText({
        model,
        messages: aiMessages as any,
        tools: toolsWithExec as any,
        stopWhen: stepCountIs(config?.maxSteps || 10),
        temperature: config?.temperature ?? 0.2,
        maxOutputTokens: config?.maxTokens ?? 4096,
        onStepFinish: (event: any) => {
          console.log(`[step] toolCalls=${event.toolCalls?.length || 0} textLen=${event.text?.length || 0}`);
          if (event.toolCalls && event.toolCalls.length > 0) {
            for (const call of event.toolCalls) {
              console.log(`[tool] full call keys=${JSON.stringify(Object.keys(call))}`);
              console.log(`[tool] ${call.toolName} args=${JSON.stringify(call.args)} input=${JSON.stringify(call.input)}`);
              sendSSE({
                type: 'tool_call',
                toolName: call.toolName,
                args: call.input || call.args || {},
              });
            }
          }
        },
      });

      sendSSE({
        type: 'text',
        text: result.text,
        usage: {
          inputTokens: result.usage?.promptTokens ?? 0,
          outputTokens: result.usage?.completionTokens ?? 0,
        },
        steps: result.steps?.length,
      });
      console.log(`[done] textLen=${result.text?.length || 0} steps=${result.steps?.length} finishReason=${(result as any).finishReason}`);
    } catch (error: any) {
      sendSSE({
        type: 'error',
        error: `Generation failed: ${error?.message || error}`,
      });
    }

    sendSSE({ type: 'done' });
    res.end();
  } catch (error: any) {
    res.status(500).json({ error: `Server error: ${error?.message || error}` });
  }
});

// ── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`DeskSpawn sidecar HTTP server on port ${PORT}`);
  console.log(`Workspace: ${WORKSPACE_DIR}`);
});
