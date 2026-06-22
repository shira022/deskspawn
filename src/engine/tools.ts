/**
 * @deskspawn/browser-engine — Tool definitions for the AI agent
 *
 * Defines the tools available to AI agents. Browser-compatible versions:
 * - No shell execution (not possible in browser)
 * - get_errors uses esbuild-based syntax checking
 * - Screenshot uses html2canvas instead of Puppeteer
 */

import { tool } from 'ai';
import { z } from 'zod';

export const readFileTool = tool({
  description:
    'Read a file from the project workspace. Returns file contents as a string.',
  inputSchema: z.object({
    path: z
      .string()
      .describe('Relative path from project root, e.g. "src/App.tsx"'),
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
    'Apply code changes to the project. Create or modify files, or generate CRUD templates from a schema. Prefer using multiple mode=file actions over mode=diff for reliability.',
  inputSchema: z.object({
    id: z.string().describe('Unique identifier for this change'),
    title: z.string().describe('Human-readable summary of the change'),
    actions: z
      .array(
        z.discriminatedUnion('type', [
          FileActionSchema,
          TemplateActionSchema,
        ])
      )
      .min(1)
      .max(30)
      .describe('List of actions to apply. Max 30 actions per call.'),
  }),
});

export const getErrorsTool = tool({
  description:
    'Check for errors in the project. Runs tsc --noEmit for TypeScript type errors, scans for missing packages, checks for unresolved local imports (files that are imported via relative/@/ paths but do not exist), detects missing `import React` in files that use React.createElement (a common silent runtime error), checks for empty #root (blank page detection), AND detects Vite dev server errors (CSS parsing, plugin errors, module resolution failures, etc.) from the preview server output.',
  inputSchema: z.object({}),
});

const ScreenshotModeSchema = z
  .enum(['browser'])
  .optional()
  .default('browser')
  .describe('"browser" — uses html2canvas in the browser to capture the preview.');

const ViewportSchema = z.object({
  width: z.number().min(320).max(7680).describe('Viewport width in pixels'),
  height: z.number().min(240).max(4320).describe('Viewport height in pixels'),
  label: z.string().optional().describe('Optional label e.g. "mobile", "tablet", "desktop"'),
});

export const takeScreenshotTool = tool({
  description:
    'Take a screenshot of the running app for visual verification. Uses html2canvas to capture the preview iframe. Use this when you have made UI/UX changes and want to verify they look correct.',
  inputSchema: z.object({
    target: z
      .string()
      .optional()
      .describe('URL or selector for screenshot target. Default: preview iframe.'),
    mode: ScreenshotModeSchema,
    fullPage: z
      .boolean()
      .optional()
      .default(true)
      .describe('Capture full page or just the visible viewport.'),
    width: z
      .number()
      .optional()
      .default(1280)
      .describe('Viewport width in pixels.'),
    height: z
      .number()
      .optional()
      .default(720)
      .describe('Viewport height in pixels.'),
    viewports: z
      .array(ViewportSchema)
      .min(1)
      .max(10)
      .optional()
      .describe('Take screenshots at multiple viewport sizes.'),
    compareWithPrevious: z
      .boolean()
      .optional()
      .default(false)
      .describe('Compare with previous screenshot using pixel-level diff.'),
    waitAfterLoad: z
      .number()
      .optional()
      .default(1500)
      .describe('Milliseconds to wait after page load.'),
  }),
});

export const tools = {
  read_file: readFileTool,
  list_files: listFilesTool,
  apply_artifact: applyArtifactTool,
  get_errors: getErrorsTool,
  take_screenshot: takeScreenshotTool,
} as const;
