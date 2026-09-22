/**
 * summarizePipelineResult — 生成完了サマリの判定テスト。
 *
 * 検証フェーズの散文に "no errors found" / 「エラーはありません」のような
 * 否定文が含まれてもエラー扱いしないこと、stepLogs のツールエラーを
 * 検証失敗（警告）と区別して情報表示すること、および「検証の後に修正が
 * 入った」古い判定を最終状態として断定しないことを検証する。
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
      { simpleMode: true, language: "ja", stepErrorCount: 0 },
    );
    expect(text).toContain("一部の問題が検出されました");
    expect(text).toContain("エラーが検出されました");
    expect(text).not.toContain("正常に生成されました");
  });

  it("B: 検証失敗は無いが stepLogs にエラーがある場合は情報表示し、警告を出さない", () => {
    const text = summarizePipelineResult(
      makeOutputs({ verifier: "Verification passed", visual_qa: "✅ PASS" }),
      { simpleMode: true, language: "ja", stepErrorCount: 3 },
    );
    expect(text).toContain("3 件のツールエラー");
    expect(text).not.toContain("一部の問題が検出されました");
    expect(text).not.toContain("エラーが検出されました");
  });

  it("C: 検証失敗も stepLogs エラーも無ければ正常表示", () => {
    const text = summarizePipelineResult(
      makeOutputs({ verifier: "All good", visual_qa: "✅ PASS" }),
      { simpleMode: true, language: "ja", stepErrorCount: 0 },
    );
    expect(text).toContain("正常に生成されました");
    expect(text).not.toContain("エラーが検出されました");
  });

  it("D: 'no errors found' のような否定文はエラー扱いしない", () => {
    const text = summarizePipelineResult(
      makeOutputs({ verifier: "No errors found", visual_qa: "No errors found" }),
      { simpleMode: true, language: "ja", stepErrorCount: 0 },
    );
    expect(text).toContain("正常に生成されました");
    expect(text).not.toContain("エラーが検出されました");
    expect(text).not.toContain("一部の問題が検出されました");
  });

  it("D: 「エラーはありません」もエラー扱いしない", () => {
    const text = summarizePipelineResult(
      makeOutputs({ verifier: "検証完了: エラーはありません", visual_qa: "問題なし" }),
      { simpleMode: true, language: "ja", stepErrorCount: 0 },
    );
    expect(text).toContain("正常に生成されました");
    expect(text).not.toContain("エラーが検出されました");
  });

  it("否定されていないエラー散文は検証失敗として警告する", () => {
    const text = summarizePipelineResult(
      makeOutputs({ verifier: "3 errors found in src/App.tsx" }),
      { simpleMode: true, language: "ja", stepErrorCount: 0 },
    );
    expect(text).toContain("一部の問題が検出されました");
  });

  it("英語でも A/B/C が正しく切り替わる", () => {
    const a = summarizePipelineResult(
      makeOutputs({ visual_qa: "❌ FAIL" }),
      { simpleMode: true, language: "en", stepErrorCount: 0 },
    );
    expect(a).toContain("Some issues were detected");

    const b = summarizePipelineResult(
      makeOutputs({ verifier: "Verification passed", visual_qa: "✅ PASS" }),
      { simpleMode: true, language: "en", stepErrorCount: 2 },
    );
    expect(b).toContain("2 tool error");
    expect(b).not.toContain("Errors were detected");

    const c = summarizePipelineResult(makeOutputs(), { simpleMode: true, language: "en", stepErrorCount: 0 });
    expect(c).toContain("Generated successfully");
  });

  it("F1: エラー語を含まないフェーズ失敗でも phaseFailed=true なら警告する", () => {
    const outputs = makeOutputs({
      verifier: "⚠️ verifier フェーズで問題が発生しました: 応答がタイムアウトしました",
    });

    const warned = summarizePipelineResult(outputs, {
      simpleMode: true,
      language: "ja",
      stepErrorCount: 0,
      phaseFailed: true,
    });
    expect(warned).toContain("一部の問題が検出されました");
    expect(warned).toContain("エラーが検出されました");
    expect(warned).not.toContain("正常に生成されました");

    // 構造的シグナルが無ければ現行のテキスト判定のみ（エラー語なし → 正常）
    const normal = summarizePipelineResult(outputs, {
      simpleMode: true,
      language: "ja",
      stepErrorCount: 0,
      phaseFailed: false,
    });
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
        const out = summarizePipelineResult(makeOutputs({ verifier: text }), {
          simpleMode: true, language: "ja", stepErrorCount: 0,
        });
        expect(out).toContain("正常に生成されました");
        expect(out).not.toContain("一部の問題が検出されました");
      });
    }

    for (const text of warned) {
      it(`抑制しない（警告）: ${text}`, () => {
        const out = summarizePipelineResult(makeOutputs({ verifier: text }), {
          simpleMode: true, language: "ja", stepErrorCount: 0,
        });
        expect(out).toContain("一部の問題が検出されました");
      });
    }
  });
});

describe("R2: get_errors() の語境界", () => {
  it("verifier の成功定型文「get_errors() returns empty」は警告しない", () => {
    const text = summarizePipelineResult(
      makeOutputs({ verifier: "✅ All errors resolved (get_errors() returns empty)." }),
      { simpleMode: true, language: "ja", stepErrorCount: 0 },
    );
    expect(text).toContain("正常に生成されました");
    expect(text).not.toContain("一部の問題が検出されました");
  });

  it("実エラー「3 errors found in src/App.tsx」は警告する", () => {
    const text = summarizePipelineResult(
      makeOutputs({ verifier: "3 errors found in src/App.tsx" }),
      { simpleMode: true, language: "ja", stepErrorCount: 0 },
    );
    expect(text).toContain("一部の問題が検出されました");
  });
});

describe("R3: critical は visual_qa のみ", () => {
  it("verifier の「No critical issues」は警告しない", () => {
    const text = summarizePipelineResult(
      makeOutputs({ verifier: "No critical issues found", visual_qa: "✅ PASS" }),
      { simpleMode: true, language: "ja", stepErrorCount: 0 },
    );
    expect(text).toContain("正常に生成されました");
    expect(text).not.toContain("一部の問題が検出されました");
  });

  it("visual_qa の critical は失敗扱い", () => {
    const text = summarizePipelineResult(
      makeOutputs({ verifier: "All good", visual_qa: "❌ Critical errors on page" }),
      { simpleMode: true, language: "ja", stepErrorCount: 0 },
    );
    expect(text).toContain("一部の問題が検出されました");
  });
});

describe("R4: 後置否定と否定窓の精度", () => {
  const suppressedAfter = ["Errors: 0", "errors: none", "エラー 0件"];
  for (const text of suppressedAfter) {
    it(`後置否定で抑制: ${text}`, () => {
      const out = summarizePipelineResult(makeOutputs({ verifier: text }), {
        simpleMode: true, language: "ja", stepErrorCount: 0,
      });
      expect(out).toContain("正常に生成されました");
      expect(out).not.toContain("一部の問題が検出されました");
    });
  }

  it("節をまたいだ否定では本物のエラーを抑制しない", () => {
    const out = summarizePipelineResult(
      makeOutputs({ verifier: "No files changed. 3 errors found" }),
      { simpleMode: true, language: "ja", stepErrorCount: 0 },
    );
    expect(out).toContain("一部の問題が検出されました");
  });
});

describe("R5: technical mode (simpleMode=false)", () => {
  it("verifier にエラー語・visual_qa は PASS → ⚠️ 警告付きパス", () => {
    const out = summarizePipelineResult(
      makeOutputs({ verifier: "3 errors found in src/App.tsx", visual_qa: "✅ PASS" }),
      { simpleMode: false, language: "ja", stepErrorCount: 0 },
    );
    expect(out).toContain("⚠️ **警告付きパス**");
    expect(out).not.toContain("❌ **失敗**");
    expect(out).not.toContain("✅ **パス**");
  });

  it("visual_qa が ❌ のときは ❌ 失敗", () => {
    const out = summarizePipelineResult(
      makeOutputs({ verifier: "All good", visual_qa: "❌ FAIL: blank page" }),
      { simpleMode: false, language: "ja", stepErrorCount: 0 },
    );
    expect(out).toContain("❌ **失敗**");
    expect(out).not.toContain("⚠️ **警告付きパス**");
  });

  it("英語でも verifier エラー + visual  PASS は Passed with warnings", () => {
    const out = summarizePipelineResult(
      makeOutputs({ verifier: "3 errors found", visual_qa: "✅ PASS" }),
      { simpleMode: false, language: "en", stepErrorCount: 0 },
    );
    expect(out).toContain("⚠️ **Passed with warnings**");
    expect(out).not.toContain("❌ **Failed**");
  });
});

describe("R7: stepLogs エラーは自動修正を断定しない", () => {
  it("日本語: 「自動修正」と断定しない", () => {
    const out = summarizePipelineResult(
      makeOutputs({ verifier: "Verification passed", visual_qa: "✅ PASS" }),
      { simpleMode: true, language: "ja", stepErrorCount: 3 },
    );
    expect(out).toContain("ツールエラー");
    expect(out).not.toContain("自動修正");
  });

  it("英語: 'auto-corrected' と断定しない", () => {
    const out = summarizePipelineResult(
      makeOutputs({ verifier: "Verification passed", visual_qa: "✅ PASS" }),
      { simpleMode: true, language: "en", stepErrorCount: 3 },
    );
    expect(out).toContain("tool error");
    expect(out).not.toContain("auto-corrected");
  });
});

describe("R8: プレビューの位置を断定しない", () => {
  it("日本語: 最終行が「チャット下」等の位置断定を含まない", () => {
    const out = summarizePipelineResult(
      makeOutputs({ verifier: "All good", visual_qa: "✅ PASS" }),
      { simpleMode: true, language: "ja", stepErrorCount: 0 },
    );
    expect(out).toContain("アプリはプレビューパネルで確認できます。");
    expect(out).not.toContain("チャット下");
    expect(out).not.toContain("パネルで下");
  });

  it("英語: 最終行が 'below' 等の位置断定を含まない", () => {
    const out = summarizePipelineResult(
      makeOutputs({ verifier: "All good", visual_qa: "✅ PASS" }),
      { simpleMode: true, language: "en", stepErrorCount: 0 },
    );
    expect(out).toContain("You can preview the app in the preview panel.");
    expect(out).not.toContain("preview panel below");
  });
});

describe("R9: 検証後に修正が入った場合（qaVerdict='stale'）", () => {
  it("日本語: 断定せず、確認を促す（修正が必要とは言わない）", () => {
    const out = summarizePipelineResult(
      makeOutputs({ verifier: "3 errors found", visual_qa: "❌ FAIL: blank page" }),
      { simpleMode: true, language: "ja", stepErrorCount: 0, qaVerdict: "stale" },
    );
    expect(out).toContain("検証で問題が指摘され、修正を適用しました。最終状態はまだ確認されていません。");
    expect(out).toContain("プレビューで最終状態をご確認ください。");
    expect(out).not.toContain("修正が必要な場合があります");
    expect(out).not.toContain("一部の問題が検出されました");
  });

  it("英語: does not assert corrections are needed", () => {
    const out = summarizePipelineResult(
      makeOutputs({ verifier: "3 errors found", visual_qa: "❌ FAIL: blank page" }),
      { simpleMode: true, language: "en", stepErrorCount: 0, qaVerdict: "stale" },
    );
    expect(out).toContain("Issues were reported during verification and fixes were applied. The final state has not been verified yet.");
    expect(out).toContain("Please review the final state in the preview.");
    expect(out).not.toContain("You may need to make corrections");
    expect(out).not.toContain("Some issues were detected");
  });

  it("qaVerdict='current' なら従来どおり断定する（A）", () => {
    const out = summarizePipelineResult(
      makeOutputs({ verifier: "3 errors found", visual_qa: "❌ FAIL: blank page" }),
      { simpleMode: true, language: "ja", stepErrorCount: 0, qaVerdict: "current" },
    );
    expect(out).toContain("一部の問題が検出されました");
    expect(out).toContain("修正が必要な場合があります");
  });
});

describe("R10: タイムアウト中断の明示", () => {
  it("日本語: 短いフェーズ名で時間切れ行を出す（生 id を出さない）", () => {
    const out = summarizePipelineResult(
      makeOutputs({ verifier: "⚠️ verifier フェーズで問題が発生しました: 応答がタイムアウトしました" }),
      {
        simpleMode: true,
        language: "ja",
        stepErrorCount: 0,
        phaseFailed: true,
        qaVerdict: "stale",
        interruptedBy: "timeout",
        failedPhases: ["verifier"],
        fileChangesApplied: true,
      },
    );
    expect(out).toContain("⏱️ **時間切れ**");
    expect(out).toContain("検証 フェーズが時間切れで終了しました");
    expect(out).toContain("適用済みの変更はそのまま残っています");
    expect(out).not.toContain("verifier フェーズ");
  });

  it("英語: shows a timeout line with the phase name", () => {
    const out = summarizePipelineResult(
      makeOutputs({ verifier: "⚠️ verifier failed: signal timed out" }),
      {
        simpleMode: true,
        language: "en",
        stepErrorCount: 0,
        phaseFailed: true,
        qaVerdict: "stale",
        interruptedBy: "timeout",
        failedPhases: ["verifier"],
        fileChangesApplied: true,
      },
    );
    expect(out).toContain("⏱️ **Timeout**");
    expect(out).toContain("The verification phase ended due to a timeout");
  });

  it("interruptedBy が 'error' のときは時間切れ行を出さない", () => {
    const out = summarizePipelineResult(
      makeOutputs({ verifier: "⚠️ verifier failed" }),
      {
        simpleMode: true,
        language: "ja",
        stepErrorCount: 0,
        phaseFailed: true,
        interruptedBy: "error",
        failedPhases: ["verifier"],
      },
    );
    expect(out).not.toContain("時間切れ");
  });
});

describe("R11: 検証が完了しなかった場合（qaVerdict='absent'）", () => {
  it("日本語: 断定せず、検証未完了とプレビュー確認を促す", () => {
    const out = summarizePipelineResult(
      makeOutputs({ verifier: "⚠️ verifier フェーズで問題が発生しました: 応答がタイムアウトしました" }),
      {
        simpleMode: true,
        language: "ja",
        stepErrorCount: 0,
        phaseFailed: true,
        qaVerdict: "absent",
        interruptedBy: "timeout",
        failedPhases: ["visual_qa"],
        fileChangesApplied: true,
      },
    );
    expect(out).toContain("検証が完了しませんでした（時間切れまたはエラー）。最終状態は確認できていません。");
    expect(out).toContain("プレビューで最終状態をご確認ください。");
    expect(out).not.toContain("修正が必要な場合があります");
    expect(out).not.toContain("一部の問題が検出されました");
  });

  it("英語: does not assert a verdict", () => {
    const out = summarizePipelineResult(
      makeOutputs({ verifier: "⚠️ verifier failed" }),
      {
        simpleMode: true,
        language: "en",
        stepErrorCount: 0,
        phaseFailed: true,
        qaVerdict: "absent",
        interruptedBy: "timeout",
        failedPhases: ["visual_qa"],
      },
    );
    expect(out).toContain("Verification did not complete (timeout or error). The final state has not been confirmed.");
    expect(out).toContain("Please review the final state in the preview.");
    expect(out).not.toContain("You may need to make corrections");
    expect(out).not.toContain("Some issues were detected");
  });
});

describe("R12: タイムアウト行は実際の変更の有無で文言を変える", () => {
  it("変更あり: 適用済みの変更が残っていると伝える", () => {
    const out = summarizePipelineResult(
      makeOutputs({ verifier: "Verify" }),
      {
        simpleMode: true, language: "ja", stepErrorCount: 0,
        interruptedBy: "timeout", failedPhases: ["coder"], fileChangesApplied: true,
      },
    );
    expect(out).toContain("実装 フェーズが時間切れで終了しました（適用済みの変更はそのまま残っています）。");
  });

  it("変更なし: 適用済みと断定しない", () => {
    const out = summarizePipelineResult(
      makeOutputs({ verifier: "Verify" }),
      {
        simpleMode: true, language: "ja", stepErrorCount: 0,
        interruptedBy: "timeout", failedPhases: ["planner"], fileChangesApplied: false,
      },
    );
    expect(out).toContain("計画 フェーズがタイムアウトしたため終了しました。");
    expect(out).not.toContain("適用済みの変更");
  });

  it("英語: with no changes it does not claim changes were applied", () => {
    const out = summarizePipelineResult(
      makeOutputs({ verifier: "Verify" }),
      {
        simpleMode: true, language: "en", stepErrorCount: 0,
        interruptedBy: "timeout", failedPhases: ["planner"], fileChangesApplied: false,
      },
    );
    expect(out).toContain("The planning phase ended because it timed out.");
    expect(out).not.toContain("applied changes have been kept");
  });
});

describe("R13: ユーザー中断（aborted）は時間切れに化けない", () => {
  it("日本語: aborted では時間切れ行を出さない", () => {
    const out = summarizePipelineResult(
      makeOutputs({ verifier: "Verify" }),
      { simpleMode: true, language: "ja", stepErrorCount: 0, interruptedBy: "aborted" },
    );
    expect(out).not.toContain("時間切れ");
  });

  it("英語: aborted emits no timeout line", () => {
    const out = summarizePipelineResult(
      makeOutputs({ verifier: "Verify" }),
      { simpleMode: true, language: "en", stepErrorCount: 0, interruptedBy: "aborted" },
    );
    expect(out).not.toContain("Timeout");
  });
});

describe("R14: technical mode も qaVerdict / 中断を反映する", () => {
  it("日本語: stale は ❌ 失敗 ではなく判定が修正前であることを示す", () => {
    const out = summarizePipelineResult(
      makeOutputs({ verifier: "All good", visual_qa: "❌ FAIL: blank page" }),
      { simpleMode: false, language: "ja", stepErrorCount: 0, qaVerdict: "stale" },
    );
    expect(out).toContain("❌ **判定は修正前のもの**");
    expect(out).not.toContain("❌ **失敗**");
  });

  it("日本語: absent は判定なしを示す", () => {
    const out = summarizePipelineResult(
      makeOutputs({ verifier: "Verify" }),
      { simpleMode: false, language: "ja", stepErrorCount: 0, qaVerdict: "absent" },
    );
    expect(out).toContain("⚠️ **判定なし**");
    expect(out).not.toContain("❌ **失敗**");
  });

  it("日本語: technical 側にも時間切れ行を出す", () => {
    const out = summarizePipelineResult(
      makeOutputs({ verifier: "Verify" }),
      {
        simpleMode: false, language: "ja", stepErrorCount: 0,
        interruptedBy: "timeout", failedPhases: ["verifier"], fileChangesApplied: false,
      },
    );
    expect(out).toContain("⏱️ **時間切れ**");
    expect(out).toContain("検証 フェーズがタイムアウトしたため終了しました。");
  });

  it("英語: reflects stale / absent", () => {
    const stale = summarizePipelineResult(
      makeOutputs({ verifier: "All good", visual_qa: "❌ FAIL" }),
      { simpleMode: false, language: "en", stepErrorCount: 0, qaVerdict: "stale" },
    );
    expect(stale).toContain("❌ **Verdict is from before fixes**");
    expect(stale).not.toContain("❌ **Failed**");

    const absent = summarizePipelineResult(
      makeOutputs({ verifier: "Verify" }),
      { simpleMode: false, language: "en", stepErrorCount: 0, qaVerdict: "absent" },
    );
    expect(absent).toContain("⚠️ **No verdict**");
    expect(absent).not.toContain("❌ **Failed**");
  });
});
