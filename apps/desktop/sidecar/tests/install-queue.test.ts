import { describe, it, expect } from "vitest";
import { createSerialQueue } from "../src/install-queue";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("createSerialQueue", () => {
  it("runs tasks sequentially, never in parallel", async () => {
    const enqueue = createSerialQueue();
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];

    const task = (name: string, ms: number) => () =>
      (async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        order.push(`${name}:start`);
        await sleep(ms);
        order.push(`${name}:end`);
        active--;
      })();

    // 3 タスクを同時に enqueue（並行実行されないこと）
    await Promise.all([
      enqueue(task("A", 30)),
      enqueue(task("B", 10)),
      enqueue(task("C", 5)),
    ]);

    expect(maxActive).toBe(1); // 同時実行は常に 1 つ
    expect(order).toEqual([
      "A:start",
      "A:end",
      "B:start",
      "B:end",
      "C:start",
      "C:end",
    ]);
  });

  it("keeps the queue usable after a task failure", async () => {
    const enqueue = createSerialQueue();
    const calls: string[] = [];

    const first = enqueue(async () => {
      calls.push("fail");
      throw new Error("boom");
    });
    await expect(first).rejects.toThrow("boom");

    // 失敗後も後続タスクは実行できる
    const second = enqueue(async () => {
      calls.push("ok");
      return 42;
    });
    await expect(second).resolves.toBe(42);
    expect(calls).toEqual(["fail", "ok"]);
  });

  it("returns the task result to each caller", async () => {
    const enqueue = createSerialQueue();
    const [a, b] = await Promise.all([
      enqueue(async () => "first"),
      enqueue(async () => "second"),
    ]);
    expect(a).toBe("first");
    expect(b).toBe("second");
  });
});
