import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { writeFileAtomic } from "../src/atomic-write";

const createdDirs: string[] = [];

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-write-"));
  createdDirs.push(dir);
  return dir;
}

function listTmp(dir: string): string[] {
  return fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"));
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of createdDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("writeFileAtomic", () => {
  it("既存ファイルを上書き → 最終内容が完全一致、.tmp 残骸なし", () => {
    const dir = makeDir();
    const target = path.join(dir, "App.tsx");
    fs.writeFileSync(target, "stale partial content", "utf-8");

    writeFileAtomic(dir, "App.tsx", "export const App = () => null;\n");

    expect(fs.readFileSync(target, "utf-8")).toBe("export const App = () => null;\n");
    expect(listTmp(dir)).toEqual([]);
  });

  it("rename が EPERM で1回失敗 → リトライで成功", () => {
    const dir = makeDir();
    const target = path.join(dir, "main.ts");
    const realRename = fs.renameSync;
    const locked = Object.assign(new Error("file locked"), { code: "EPERM" });
    let calls = 0;
    vi.spyOn(fs, "renameSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      calls += 1;
      if (calls === 1) throw locked;
      return realRename(from, to);
    }) as typeof fs.renameSync);

    writeFileAtomic(dir, "main.ts", "export const main = 1;\n");

    expect(calls).toBe(2);
    expect(fs.readFileSync(target, "utf-8")).toBe("export const main = 1;\n");
    expect(listTmp(dir)).toEqual([]);
  });

  it("どうにも失敗 → tmp が削除され、元エラーが throw", () => {
    const dir = makeDir();
    const target = path.join(dir, "component.tsx");
    fs.writeFileSync(target, "before", "utf-8");
    const fatal = Object.assign(new Error("permanently locked"), { code: "EBUSY" });
    const spy = vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw fatal;
    });

    let thrown: unknown;
    try {
      writeFileAtomic(dir, "component.tsx", "after");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(fatal);
    expect(spy).toHaveBeenCalledTimes(4);
    expect(fs.readFileSync(target, "utf-8")).toBe("before");
    expect(listTmp(dir)).toEqual([]);
  });

  it("削除API(rmSync)が失敗しても → rename の元エラーが再 throw され、writeFileAtomic は握りつぶさない", () => {
    const dir = makeDir();
    const target = path.join(dir, "styles.css");
    fs.writeFileSync(target, "before", "utf-8");

    const fatal = Object.assign(new Error("read-only fs"), { code: "EROFS" });
    const removeFailed = new Error("unlink failed");
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw fatal;
    });
    const rmSpy = vi.spyOn(fs, "rmSync").mockImplementation(() => {
      throw removeFailed;
    });

    let thrown: unknown;
    try {
      writeFileAtomic(dir, "styles.css", "after");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(fatal);
    expect(thrown).not.toBe(removeFailed);
    expect(rmSpy).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(target, "utf-8")).toBe("before");
    expect(listTmp(dir)).toHaveLength(1);
  });

  it("100KB の content を書き込み→読戻し一致（torn write の回帰チェック）", () => {
    const dir = makeDir();
    const target = path.join(dir, "big.txt");
    const content = Array.from({ length: 100 * 1024 }, (_, i) =>
      String.fromCharCode(33 + (i % 90))
    ).join("");

    writeFileAtomic(dir, "big.txt", content);

    const readBack = fs.readFileSync(target, "utf-8");
    expect(readBack.length).toBe(content.length);
    expect(readBack).toBe(content);
    expect(listTmp(dir)).toEqual([]);
  });

  it("存在しないファイルにも新規作成できる", () => {
    const dir = makeDir();
    const target = path.join(dir, "nested", "new.ts");

    fs.mkdirSync(path.dirname(target), { recursive: true });
    writeFileAtomic(dir, "nested/new.ts", "export {};\n");

    expect(fs.readFileSync(target, "utf-8")).toBe("export {};\n");
    expect(listTmp(dir)).toEqual([]);
  });

  it("rel が root 外を指す（../evil.txt）→ throw され、ファイルが作られない", () => {
    const dir = makeDir();
    const evil = path.join(path.dirname(dir), "evil.txt");
    fs.rmSync(evil, { force: true });

    expect(() => writeFileAtomic(dir, "../evil.txt", "pwned")).toThrow(
      /Invalid file path/
    );

    expect(fs.existsSync(evil)).toBe(false);
    expect(listTmp(dir)).toEqual([]);
  });

  it("rel が root 外の絶対パス → throw され、ファイルが作られない", () => {
    const dir = makeDir();
    const outside = path.join(os.tmpdir(), `atomic-write-outside-${process.pid}.txt`);
    fs.rmSync(outside, { force: true });

    expect(() => writeFileAtomic(dir, outside, "pwned")).toThrow(/Invalid file path/);

    expect(fs.existsSync(outside)).toBe(false);
    expect(listTmp(dir)).toEqual([]);
  });
});
