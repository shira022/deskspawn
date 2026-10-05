/**
 * 直列実行キュー。
 *
 * bun install はグローバルキャッシュ（Windows: %USERPROFILE%\.bun）を共有するため、
 * 複数の install を並行実行するとロック競合で失敗することがある
 * （実績 2026-08-12: アプリを連続作成すると「npm install exited with code 1」）。
 * このキューで install を直列化し、同時実行を防ぐ。
 *
 * 失敗したタスクはキュー自体を壊さない（後続タスクは通常どおり実行される）。
 */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();

  return function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = tail.then(fn, fn);
    // 後続をブロックしないよう、失敗はここで吸収して tail を正常系に保つ
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
