import { tool } from 'ai';
import { z } from 'zod';

export const readFileTool = tool({
  description:
    'Read a file from the workspace. Returns file contents as a string.',
  inputSchema: z.object({
    path: z
      .string()
      .describe('Relative path from workspace root, e.g. "src/App.tsx"'),
  }),
});

export const listFilesTool = tool({
  description: 'List all files in the project workspace.',
  inputSchema: z.object({}),
});

const FileActionSchema = z.object({
  type: z.literal('file'),
  mode: z.enum(['file', 'diff']),
  filePath: z.string().describe('Relative path from project root'),
  content: z.string().optional().describe('File content (for mode=file)'),
  search: z.string().optional().describe('Text to search for (for mode=diff)'),
  replace: z.string().optional().describe('Replacement text (for mode=diff)'),
});

const ShellActionSchema = z.object({
  type: z.literal('shell'),
  command: z.string().describe('Shell command to run (npm only)'),
});

const ColumnSchema = z.object({
  name: z.string(),
  sqlType: z.string(),
  nullable: z.boolean(),
  defaultValue: z.string().optional(),
  primaryKey: z.boolean().default(false),
  unique: z.boolean().default(false),
  references: z.string().optional(),
});

const TemplateActionSchema = z.object({
  type: z.literal('template'),
  template: z.literal('crud'),
  tableName: z.string(),
  columns: z.array(ColumnSchema).min(1),
});

export const applyArtifactTool = tool({
  description:
    'Apply code changes to the project. Create, modify, or delete files; run shell commands; or generate CRUD templates from a schema. Prefer using multiple mode=file actions over mode=diff for reliability.',
  inputSchema: z.object({
    id: z.string().describe('Unique identifier for this change (e.g. "add-bookmark-model")'),
    title: z.string().describe('Human-readable summary of the change'),
    actions: z
      .array(
        z.discriminatedUnion('type', [
          FileActionSchema,
          ShellActionSchema,
          TemplateActionSchema,
        ])
      )
      .min(1)
      .max(30)
      .describe('List of actions to apply. Max 30 actions per call.'),
  }),
});

export const runShellTool = tool({
  description:
    'Run a shell command in the workspace. Only allowed: npm install, npm run build, npm run dev.',
  inputSchema: z.object({
    command: z.string().describe('Shell command to execute'),
  }),
});

export const getErrorsTool = tool({
  description:
    'Get current compilation and build errors from the project. Use this to check if changes introduced errors and fix them.',
  inputSchema: z.object({}),
});

const ScreenshotModeSchema = z
  .enum(['browser'])
  .optional()
  .default('browser')
  .describe(
    '"browser" (default) — connect to Vite Dev Server via headless Chrome to preview the running app.',
  );

const ViewportSchema = z.object({
  width: z.number().min(320).max(7680).describe('Viewport width in pixels'),
  height: z.number().min(240).max(4320).describe('Viewport height in pixels'),
  label: z.string().optional().describe('Optional label e.g. "mobile", "tablet", "desktop"'),
});

export const takeScreenshotTool = tool({
  description:
    'Take a screenshot of the running app for visual verification.\n' +
    'Use this when you have made UI/UX changes (components, layout, styling, CSS) ' +
    'and want to verify they look correct.\n' +
    '\n' +
    'Features:\n' +
    '  • Responsive: pass viewports=[...] to screenshot at multiple viewport sizes.\n' +
    '  • Diff: set compareWithPrevious=true to pixel-diff against last screenshot.\n' +
    '\n' +
    'Returns 3 layers + optional extras:\n' +
    '  Layer 1 — screenshot image (base64 JPEG) — multimodal models visually inspect\n' +
    '  Layer 2 — structured DOM metadata (elements, positions, text, errors)\n' +
    '  Layer 3 — human-readable text summary with console error detection\n' +
    '  extra: diff — pixel-diff overlay & change regions (when compareWithPrevious=true)\n' +
    '  extra: responsive[] — per-viewport results (when viewports provided)',
  inputSchema: z.object({
    target: z
      .string()
      .optional()
      .default('http://localhost:5174')
      .describe(
        'URL for the running app (Vite Dev Server).\n' +
        'Default: http://localhost:5174'
      ),
    mode: ScreenshotModeSchema,
    fullPage: z
      .boolean()
      .optional()
      .default(true)
      .describe('Capture full page scroll (true) or just the visible viewport (false). Browser mode only.'),
    width: z
      .number()
      .optional()
      .default(1280)
      .describe('Viewport width in pixels. Ignored if viewports is set.'),
    height: z
      .number()
      .optional()
      .default(720)
      .describe('Viewport height in pixels. Ignored if viewports is set.'),
    viewports: z
      .array(ViewportSchema)
      .min(1)
      .max(10)
      .optional()
      .describe(
        'Responsive test: take screenshots at multiple viewport sizes in one call. ' +
        'Each viewport gets its own 3-layer result. ' +
        'Example: [{width:375, height:812, label:"mobile"}, {width:1280, height:720, label:"desktop"}]'
      ),
    compareWithPrevious: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Compare this screenshot with the previous one using pixel-level diff. ' +
        'Returns diff overlay image + change regions + change percentage. ' +
        'Use this after making changes to verify exactly what changed visually.'
      ),
    waitAfterLoad: z
      .number()
      .optional()
      .default(1500)
      .describe('Milliseconds to wait after page load for async rendering. Default: 1500ms.'),
  }),
});

export const tools = {
  read_file: readFileTool,
  list_files: listFilesTool,
  apply_artifact: applyArtifactTool,
  run_shell: runShellTool,
  get_errors: getErrorsTool,
  take_screenshot: takeScreenshotTool,
} as const;
