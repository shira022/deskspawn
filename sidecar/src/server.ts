/**
 * HTTP server for the DeskSpawn sidecar.
 * Provides a REST API for the frontend to call for AI-powered code generation.
 * For dev/demo mode, tools are executed directly (not via Rust IPC).
 */
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { ChildProcess, spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { generateText, stepCountIs } from 'ai';
import { getModel } from './providers.js';
import { tools } from './tools.js';
import { buildSystemPrompt } from './system-prompt.js';
import * as executors from './tool-executors.js';
import { getModelsForProvider } from './models-fetcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const PROJECTS_DIR = path.join(PROJECT_ROOT, 'projects');
const PROJECTS_JSON = path.join(PROJECTS_DIR, 'projects.json');
const TEMPLATE_DIR = path.join(PROJECT_ROOT, 'templates', 'react-template');
const WORKSPACE_DEV_PORT = 5174;
let workspaceDevActualPort = WORKSPACE_DEV_PORT;

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

// ── Workspace dev server process management ─────────────────────────────────

let workspaceDevProcess: ChildProcess | null = null;
let workspaceDevReady = false;

// ── Project registry helpers ─────────────────────────────────────────────────

interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

function ensureProjectsDir() {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

function readProjectsJson(): ProjectMeta[] {
  ensureProjectsDir();
  try {
    if (fs.existsSync(PROJECTS_JSON)) {
      const raw = fs.readFileSync(PROJECTS_JSON, 'utf-8');
      return JSON.parse(raw) as ProjectMeta[];
    }
  } catch (e) {
    console.warn('[projects] Failed to read projects.json, starting fresh:', e);
  }
  return [];
}

function saveProjectsJson(projects: ProjectMeta[]) {
  ensureProjectsDir();
  fs.writeFileSync(PROJECTS_JSON, JSON.stringify(projects, null, 2), 'utf-8');
}

function createProjectDir(projectId: string, name: string): string {
  const projectDir = path.join(PROJECTS_DIR, projectId);
  fs.mkdirSync(projectDir, { recursive: true });

  // Copy template files
  if (fs.existsSync(TEMPLATE_DIR)) {
    copyDir(TEMPLATE_DIR, projectDir);
    console.log(`[projects] Copied template to ${projectDir}`);
  } else {
    // Minimal scaffold
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'src', 'main.tsx'), `
import React from 'react';
import ReactDOM from 'react-dom/client';

function App() {
  return <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-8">
    <div className="text-center space-y-4">
      <h1 className="text-2xl font-bold">${name}</h1>
      <p className="text-muted-foreground">新しいアプリが作成されました。</p>
      <p className="text-sm text-muted-foreground">AI チャットでアプリを構築してください。</p>
    </div>
  </div>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
`);
    fs.writeFileSync(path.join(projectDir, 'index.html'), `<!DOCTYPE html>
<html lang="ja">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${name}</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>`);
  }

  // Write package.json
  fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
    name: name.toLowerCase().replace(/\s+/g, '-'),
    private: true,
    version: '0.1.0',
    type: 'module',
    scripts: { dev: 'vite', build: 'tsc -b && vite build', preview: 'vite preview' },
    dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
    devDependencies: {
      '@tailwindcss/vite': '^4.3.0',
      '@types/react': '^18.3.12',
      '@types/react-dom': '^18.3.1',
      '@vitejs/plugin-react': '^4.3.4',
      tailwindcss: '^4.3.0',
      typescript: '~5.6.3',
      vite: '^6.0.0',
    },
  }, null, 2));

  // Write tsconfig.json
  fs.writeFileSync(path.join(projectDir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2020', module: 'ESNext', moduleResolution: 'bundler',
      jsx: 'react-jsx', strict: true, esModuleInterop: true,
      skipLibCheck: true, forceConsistentCasingInFileNames: true,
    },
    include: ['src'],
  }, null, 2));

  // Write vite config
  fs.writeFileSync(path.join(projectDir, 'vite.config.ts'), `
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: { port: ${WORKSPACE_DEV_PORT}, strictPort: false },
  css: { transformer: 'lightningcss' },
});
`);

  // Write project metadata
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({
    name, createdAt: now, updatedAt: now,
  }, null, 2));

  return projectDir;
}

function copyDir(src: string, dst: string) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      if (executors.IGNORED_DIRS.includes(entry.name)) continue;
      copyDir(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

// ── Workspace dev server management ──────────────────────────────────────────

function stopWorkspaceDevServer() {
  if (workspaceDevProcess) {
    console.log('[devserver] Stopping workspace dev server...');
    workspaceDevProcess.kill('SIGTERM');
    // Also kill any child processes
    try { process.kill(-workspaceDevProcess.pid!, 'SIGTERM'); } catch {}
    workspaceDevProcess = null;
    workspaceDevReady = false;
  }
}

function startWorkspaceDevServer(dir: string) {
  stopWorkspaceDevServer();

  console.log(`[devserver] Starting dev server in ${dir}...`);
  workspaceDevReady = false;

  const child = spawn('npm', ['run', 'dev'], {
    cwd: dir,
    stdio: 'pipe',
    detached: true,
    shell: true,
    env: { ...process.env, PORT: String(WORKSPACE_DEV_PORT) },
  });

  workspaceDevProcess = child;

  child.stdout?.on('data', (data: Buffer) => {
    const text = data.toString();
    console.log(`[devserver] ${text.trim()}`);
    // Parse actual port from Vite's "Local:" line, e.g. "➜  Local:   http://localhost:5174/"
    const portMatch = text.match(/Local:\s+https?:\/\/localhost:(\d+)/);
    if (portMatch) {
      const parsedPort = parseInt(portMatch[1], 10);
      if (!isNaN(parsedPort)) {
        workspaceDevActualPort = parsedPort;
        console.log(`[devserver] Detected actual port: ${parsedPort}`);
      }
      workspaceDevReady = true;
      console.log('[devserver] Workspace dev server is ready');
    }
  });

  child.stderr?.on('data', (data: Buffer) => {
    console.warn(`[devserver:err] ${data.toString().trim()}`);
  });

  child.on('exit', (code) => {
    console.log(`[devserver] Exited with code ${code}`);
    workspaceDevReady = false;
    if (workspaceDevProcess === child) {
      workspaceDevProcess = null;
    }
  });

  child.on('error', (err) => {
    console.error(`[devserver] Failed to start: ${err.message}`);
    workspaceDevReady = false;
    workspaceDevProcess = null;
  });
}

function installDeps(dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[projects] Installing dependencies in ${dir}...`);
    const child = spawn('npm', ['install'], {
      cwd: dir,
      stdio: 'pipe',
      shell: true,
    });
    let output = '';
    child.stdout?.on('data', (d: Buffer) => { output += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { output += d.toString(); });
    child.on('exit', (code) => {
      if (code === 0) {
        console.log('[projects] Dependencies installed');
        resolve();
      } else {
        reject(new Error(`npm install exited with code ${code}: ${output.slice(-200)}`));
      }
    });
    child.on('error', reject);
  });
}

// ── Project Management Endpoints ─────────────────────────────────────────────

// List all projects
app.get('/projects/list', (_req, res) => {
  try {
    const projects = readProjectsJson();
    res.json({ projects });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Create new project
app.post('/projects/new', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'Project name is required' });
      return;
    }

    const projectId = crypto.randomUUID();
    const now = new Date().toISOString();
    const projectMeta: ProjectMeta = {
      id: projectId,
      name: name.trim(),
      createdAt: now,
      updatedAt: now,
    };

    // Create project directory
    const projectDir = createProjectDir(projectId, projectMeta.name);

    // Register in registry
    const projects = readProjectsJson();
    projects.push(projectMeta);
    saveProjectsJson(projects);

    // Switch workspace to new project
    executors.setWorkspaceDir(projectDir);

    // Install deps and start dev server in background
    installDeps(projectDir)
      .then(() => startWorkspaceDevServer(projectDir))
      .catch((e) => console.error('[projects] Failed to setup:', e));

    res.json({ project: projectMeta, projects });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Switch to an existing project
app.post('/projects/switch', (req, res) => {
  try {
    const { projectId } = req.body;
    if (!projectId) {
      res.status(400).json({ error: 'projectId is required' });
      return;
    }

    const projects = readProjectsJson();
    const project = projects.find((p) => p.id === projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const projectDir = path.join(PROJECTS_DIR, projectId);
    if (!fs.existsSync(projectDir)) {
      res.status(404).json({ error: 'Project directory not found' });
      return;
    }

    // Update metadata
    project.updatedAt = new Date().toISOString();
    saveProjectsJson(projects);

    // Switch workspace
    executors.setWorkspaceDir(projectDir);

    // Restart dev server
    startWorkspaceDevServer(projectDir);

    res.json({ project, projects });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Get current project info
app.get('/projects/current', (_req, res) => {
  const workspaceDir = executors.getWorkspaceDir();
  const projectJsonPath = path.join(workspaceDir, 'project.json');
  let project: ProjectMeta | null = null;

  if (fs.existsSync(projectJsonPath)) {
    try {
      const raw = fs.readFileSync(projectJsonPath, 'utf-8');
      const meta = JSON.parse(raw);
      const projects = readProjectsJson();
      project = projects.find((p) => p.id === path.basename(workspaceDir)) || null;
      if (project && meta.name) project.name = meta.name;
    } catch {}
  }

  res.json({
    project,
    workspaceDir,
    devServerReady: workspaceDevReady,
  });
});

// Check if workspace dev server is ready
app.get('/projects/ready', (_req, res) => {
  res.json({
    ready: workspaceDevReady,
    workspaceDir: executors.getWorkspaceDir(),
    port: workspaceDevActualPort,
  });
});

// ── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', workspace: executors.getWorkspaceDir() });
});

// ── Model discovery endpoint ──────────────────────────────────────────────────

app.get('/api/models', async (req, res) => {
  try {
    const provider = (req.query.provider as string) || 'openai';
    const customEndpoint = req.query.customEndpoint as string | undefined;
    const apiKey = req.query.apiKey as string | undefined;

    const models = await getModelsForProvider(provider, customEndpoint, apiKey);
    res.json({ models });
  } catch (error: any) {
    res.status(500).json({ error: `Failed to fetch models: ${error?.message || error}` });
  }
});

// ── Chat endpoint ────────────────────────────────────────────────────────────

app.post('/chat', async (req, res) => {
  const { messages, config } = req.body;
  
  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: 'messages array required' });
    return;
  }

  try {
    // Capture workspace dir at request start to prevent race condition
    // if project is switched mid-generation.
    const workspaceDir = executors.getWorkspaceDir();

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

    // Set up SSE for streaming (declare early so tools can use it)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendSSE = (data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    let stepCount = 0;

    // Create tools with execute functions that emit results via SSE
    const toolsWithExec = {
      read_file: {
        ...tools.read_file,
        execute: async ({ path: filePath }: { path: string }) => {
          const content = await executors.readFile(filePath, workspaceDir);
          console.log(`[exec] read_file(${filePath}) => ${content.length} chars`);
          sendSSE({
            type: 'tool_result',
            toolName: 'read_file',
            result: `${content.length} chars read from ${filePath}`,
            detail: { file: filePath, size: content.length },
          });
          return content;
        },
      },
      list_files: {
        ...tools.list_files,
        execute: async () => {
          const files = await executors.listFiles(workspaceDir);
          sendSSE({
            type: 'tool_result',
            toolName: 'list_files',
            result: `${files.length} files found`,
          });
          return files;
        },
      },
      apply_artifact: {
        ...tools.apply_artifact,
        execute: async ({ json }: { json: string }) => {
          console.log(`[exec] apply_artifact jsonLen=${json?.length || 0}`);
          const result = await executors.applyArtifact(json, workspaceDir);
          sendSSE({
            type: 'tool_result',
            toolName: 'apply_artifact',
            result: result.success
              ? `${result.filesChanged.length} files changed: ${result.filesChanged.join(', ')}`
              : `Failed: ${(result.errors || []).join('; ')}`,
            detail: {
              filesChanged: result.filesChanged,
              errors: result.errors,
            },
          });
          return result;
        },
      },
      run_shell: {
        ...tools.run_shell,
        execute: async ({ command }: { command: string }) => {
          console.log(`[exec] run_shell: ${command}`);
          // Enforce command allowlist
          if (!executors.isCommandAllowed(command)) {
            const msg = `Command not allowed: ${command.split(/\s+/)[0]}`;
            sendSSE({ type: 'tool_result', toolName: 'run_shell', result: `❌ ${msg}` });
            return { success: false, stdout: '', stderr: msg, exitCode: 1 };
          }
          try {
            const result = execSync(command, {
              cwd: workspaceDir,
              encoding: 'utf-8',
              timeout: 120_000,
              stdio: 'pipe',
            });
            sendSSE({
              type: 'tool_result',
              toolName: 'run_shell',
              result: `✅ ${command}`,
            });
            return { success: true, stdout: result, stderr: '', exitCode: 0 };
          } catch (e: any) {
            sendSSE({
              type: 'tool_result',
              toolName: 'run_shell',
              result: `❌ ${command}: ${e.stderr || e.message || ''}`.substring(0, 200),
            });
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
          const errors = await executors.getErrors(workspaceDir);
          sendSSE({
            type: 'tool_result',
            toolName: 'get_errors',
            result: errors.length === 0 ? 'No errors found' : `${errors.length} errors found`,
          });
          return errors;
        },
      },
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
          stepCount++;
          console.log(`[step ${stepCount}] toolCalls=${event.toolCalls?.length || 0} textLen=${event.text?.length || 0}`);
          // Send step progress
          sendSSE({
            type: 'step_progress',
            step: stepCount,
            maxSteps: config?.maxSteps || 10,
          });
          if (event.toolCalls && event.toolCalls.length > 0) {
            for (const call of event.toolCalls) {
              sendSSE({
                type: 'tool_call',
                step: stepCount,
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

// Cleanup on exit
process.on('SIGTERM', () => { stopWorkspaceDevServer(); process.exit(0); });
process.on('SIGINT', () => { stopWorkspaceDevServer(); process.exit(0); });

app.listen(PORT, () => {
  console.log(`DeskSpawn sidecar HTTP server on port ${PORT}`);
  console.log(`Workspace: ${executors.getWorkspaceDir()}`);
});
