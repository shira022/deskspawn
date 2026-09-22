/**
 * summarizePipelineResult — 生成完了サマリの判定テスト。
 *
 * 検証フェーズの散文に "no errors found" / 「エラーはありません」のような
 * 否定文が含まれてもエラー扱いしないこと、および stepLogs のツールエラーを
 * 検証失敗（警告）と区別して情報表示することを検証する。
 */

import { describe, it, expect } from "vitest";
import { summarizePipelineResult } from "./useChatStream";

function makeOutputs(over: Record<string, string> = {}) {
  const outputs: Record<string, { label: string; text: string }> = {
    planner: { label: "Planning", text: "Build a todo app" },
    coder: { label: "Code", text: "Created src/App.tsx and src/main.tsx" },
  };
  for (const [phase, text] of Object.entries(over)) {
    outputs[phase] = { label: phase, text };
  }
  return outputs;
}

describe("summarizePipelineResult (simple mode)", () => {
  it("A: visual_qa の ❌ FAIL は警告を出す（消さない）", () => {
    const text = summarizePipelineResult(
      makeOutputs({ visual_qa: "❌ FAIL: blank page" }),
      true,
      "ja",
      0,
    );
    expect(text).toContain("一部の問題が検出されました");
    expect(text).toContain("エラーが検出されました");
    expect(text).not.toContain("正常に生成されました");
  });

  it("B: 検証失敗は無いが stepLogs にエラーがある場合は情報表示し、警告を出さない", () => {
    const text = summarizePipelineResult(
      makeOutputs({ verifier: "Verification passed", visual_qa: "✅ PASS" }),
      true,
      "ja",
      3,
    );
    expect(text).toContain("3 件のツールエラー");
    expect(text).not.toContain("一部の問題が検出されました");
    expect(text).not.toContain("エラーが検出されました");
  });

  it("C: 検証失敗も stepLogs エラーも無ければ正常表示", () => {
    const text = summarizePipelineResult(
      makeOutputs({ verifier: "All good", visual_qa: "✅ PASS" }),
      true,
      "ja",
      0,
    );
    expect(text).toContain("正常に生成されました");
    expect(text).not.toContain("エラーが検出されました");
  });

  it("D: 'no errors found' のような否定文はエラー扱いしない", () => {
    const text = summarizePipelineResult(
      makeOutputs({ verifier: "No errors found", visual_qa: "No errors found" }),
      true,
      "ja",
      0,
    );
    expect(text).toContain("正常に生成されました");
    expect(text).not.toContain("エラーが検出されました");
    expect(text).not.toContain("一部の問題が検出されました");
  });

  it("D: 「エラーはありません」もエラー扱いしない", () => {
    const text = summarizePipelineResult(
      makeOutputs({ verifier: "検証完了: エラーはありません", visual_qa: "問題なし" }),
      true,
      "ja",
      0,
    );
    expect(text).toContain("正常に生成されました");
    expect(text).not.toContain("エラーが検出されました");
  });

  it("否定されていないエラー散文は検証失敗として警告する", () => {
    const text = summarizePipelineResult(
      makeOutputs({ verifier: "3 errors found in src/App.tsx" }),
      true,
      "ja",
      0,
    );
    expect(text).toContain("一部の問題が検出されました");
  });

  it("英語でも A/B/C が正しく切り替わる", () => {
    const a = summarizePipelineResult(
      makeOutputs({ visual_qa: "❌ FAIL" }),
      true,
      "en",
      0,
    );
    expect(a).toContain("Some issues were detected");

    const b = summarizePipelineResult(
      makeOutputs({ verifier: "Verification passed", visual_qa: "✅ PASS" }),
      true,
      "en",
      2,
    );
    expect(b).toContain("2 tool error");
    expect(b).not.toContain("Errors were detected");

    const c = summarizePipelineResult(makeOutputs(), true, "en", 0);
    expect(c).toContain("Generated successfully");
  });

  it("F1: エラー語を含まないフェーズ失敗でも phaseFailed=true なら警告する", () => {
    const outputs = makeOutputs({
      verifier: "⚠️ verifier フェーズで問題が発生しました: 応答がタイムアウトしました",
    });

    const warned = summarizePipelineResult(outputs, true, "ja", 0, true);
    expect(warned).toContain("一部の問題が検出されました");
    expect(warned).toContain("エラーが検出されました");
    expect(warned).not.toContain("正常に生成されました");

    // 構造的シグナルが無ければ現行のテキスト判定のみ（エラー語なし → 正常）
    const normal = summarizePipelineResult(outputs, true, "ja", 0, false);
    expect(normal).toContain("正常に生成されました");
    expect(normal).not.toContain("エラーが検出されました");
  });

  describe("F3: 近接した否定・解消のみを抑制に使う", () => {
    const suppressed = [
      "No errors found",
      "検証完了: エラーはありません",
      "errors were resolved",
      "エラーは修正済み",
    ];
    const warned = [
      "PASS: 3 errors remain",
      "3 errors found in src/App.tsx",
      "Verification passed, but 1 failure remains",
    ];

    for (const text of suppressed) {
      it(`抑制する: ${text}`, () => {
        const out = summarizePipelineResult(makeOutputs({ verifier: text }), true, "ja", 0);
        expect(out).toContain("正常に生成されました");
        expect(out).not.toContain("一部の問題が検出されました");
      });
    }

    for (const text of warned) {
      it(`抑制しない（警告）: ${text}`, () => {
        const out = summarizePipelineResult(makeOutputs({ verifier: text }), true, "ja", 0);
        expect(out).toContain("一部の問題が検出されました");
      });
    }
  });
});
