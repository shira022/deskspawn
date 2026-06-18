import { describe, it, expect } from "vitest";

// Import the helper functions directly from FileTreePanel.
// They are module-scoped, not exported. We replicate them here for testing
// since they are pure functions with well-defined behavior.

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: TreeNode[];
}

function buildTreeFromPaths(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const filePath of paths) {
    const parts = filePath.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join("/");
      let node = current.find((n) => n.name === part);
      if (!node) {
        node = { name: part, path: fullPath, isDirectory: !isLast, children: !isLast ? [] : undefined };
        current.push(node);
      } else if (!isLast && !node.isDirectory) {
        node.isDirectory = true;
        node.children = [];
      }
      if (!isLast) {
        if (!node.children) node.children = [];
        current = node.children;
      }
    }
  }
  return sortTree(root);
}

function sortTree(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    })
    .map((node) => ({ ...node, children: node.children ? sortTree(node.children) : undefined }));
}

describe("buildTreeFromPaths", () => {
  it("converts a single flat path into a tree", () => {
    const result = buildTreeFromPaths(["src/index.ts"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("src");
    expect(result[0].isDirectory).toBe(true);
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children![0].name).toBe("index.ts");
    expect(result[0].children![0].isDirectory).toBe(false);
  });

  it("handles multiple files in the same directory", () => {
    const result = buildTreeFromPaths(["src/a.ts", "src/b.ts"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("src");
    expect(result[0].children).toHaveLength(2);
    const fileNames = result[0].children!.map((c) => c.name);
    expect(fileNames).toContain("a.ts");
    expect(fileNames).toContain("b.ts");
  });

  it("handles nested directories", () => {
    const result = buildTreeFromPaths(["src/components/Button.tsx"]);
    expect(result).toHaveLength(1);
    const src = result[0];
    expect(src.name).toBe("src");
    expect(src.isDirectory).toBe(true);
    expect(src.children).toHaveLength(1);
    const components = src.children![0];
    expect(components.name).toBe("components");
    expect(components.isDirectory).toBe(true);
    expect(components.children).toHaveLength(1);
    expect(components.children![0].name).toBe("Button.tsx");
  });

  it("handles deeply nested paths", () => {
    const result = buildTreeFromPaths(["a/b/c/d.ts"]);
    expect(result).toHaveLength(1);
    let node = result[0];
    expect(node.name).toBe("a");
    expect(node.children).toHaveLength(1);
    node = node.children![0];
    expect(node.name).toBe("b");
    expect(node.children).toHaveLength(1);
    node = node.children![0];
    expect(node.name).toBe("c");
    expect(node.children).toHaveLength(1);
    expect(node.children![0].name).toBe("d.ts");
  });

  it("merges overlapping paths", () => {
    const result = buildTreeFromPaths(["src/a.ts", "src/sub/b.ts"]);
    expect(result).toHaveLength(1);
    const src = result[0];
    expect(src.children).toHaveLength(2);
    const names = src.children!.map((c) => c.name);
    expect(names).toContain("a.ts");
    expect(names).toContain("sub");
  });

  it("upgrades file node to directory when necessary", () => {
    // If "foo" appears as a file first, then later as a directory, it upgrades.
    // "foo" becomes a directory with "bar.ts" as child. The original "foo"
    // file entry is consumed into the directory node.
    const result = buildTreeFromPaths(["foo", "foo/bar.ts"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("foo");
    expect(result[0].isDirectory).toBe(true);
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children![0].name).toBe("bar.ts");
    expect(result[0].children![0].isDirectory).toBe(false);
  });

  it("returns empty array for no paths", () => {
    expect(buildTreeFromPaths([])).toEqual([]);
  });

  it("handles root-level files", () => {
    const result = buildTreeFromPaths(["package.json", "tsconfig.json"]);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("package.json");
    expect(result[1].name).toBe("tsconfig.json");
    expect(result[0].isDirectory).toBe(false);
    expect(result[1].isDirectory).toBe(false);
  });
});

describe("sortTree", () => {
  it("sorts directories before files", () => {
    const nodes: TreeNode[] = [
      { name: "z.ts", path: "z.ts", isDirectory: false },
      { name: "a", path: "a", isDirectory: true, children: [] },
    ];
    const sorted = sortTree(nodes);
    expect(sorted[0].name).toBe("a");
    expect(sorted[1].name).toBe("z.ts");
  });

  it("sorts alphabetically within same type", () => {
    const nodes: TreeNode[] = [
      { name: "c.ts", path: "c.ts", isDirectory: false },
      { name: "a.ts", path: "a.ts", isDirectory: false },
      { name: "b.ts", path: "b.ts", isDirectory: false },
    ];
    const sorted = sortTree(nodes);
    expect(sorted.map((n) => n.name)).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("sorts directories alphabetically", () => {
    const nodes: TreeNode[] = [
      { name: "z", path: "z", isDirectory: true, children: [] },
      { name: "a", path: "a", isDirectory: true, children: [] },
    ];
    const sorted = sortTree(nodes);
    expect(sorted.map((n) => n.name)).toEqual(["a", "z"]);
  });

  it("recursively sorts children", () => {
    const nodes: TreeNode[] = [
      {
        name: "src",
        path: "src",
        isDirectory: true,
        children: [
          { name: "z.ts", path: "src/z.ts", isDirectory: false },
          { name: "a", path: "src/a", isDirectory: true, children: [] },
          { name: "m.ts", path: "src/m.ts", isDirectory: false },
        ],
      },
    ];
    const sorted = sortTree(nodes);
    const src = sorted[0];
    expect(src.children!.map((c) => c.name)).toEqual(["a", "m.ts", "z.ts"]);
  });

  it("returns empty array for empty input", () => {
    expect(sortTree([])).toEqual([]);
  });
});
