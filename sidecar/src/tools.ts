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

export const applyArtifactTool = tool({
  description:
    'Apply code changes to the project. Use this to create, modify, or delete files. The json parameter must be a valid Artifact JSON string following the schema.',
  inputSchema: z.object({
    json: z
      .string()
      .describe(
        'A JSON string containing the Artifact with actions to apply. See schema for details.'
      ),
  }),
});

export const runShellTool = tool({
  description:
    'Run a shell command in the workspace. Only allowed: npm install/run, cargo check/build, sqlx migrate run/revert.',
  inputSchema: z.object({
    command: z.string().describe('Shell command to execute'),
  }),
});

export const getErrorsTool = tool({
  description:
    'Get current compilation and build errors from the project. Use this to check if changes introduced errors and fix them.',
  inputSchema: z.object({}),
});

export const tools = {
  read_file: readFileTool,
  list_files: listFilesTool,
  apply_artifact: applyArtifactTool,
  run_shell: runShellTool,
  get_errors: getErrorsTool,
} as const;
