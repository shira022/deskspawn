import { describe, it, expect } from "vitest";
import { findListeningPids, nextFallbackPort } from "../src/port-utils";

// netstat -ano 相当のサンプル出力（Windows 形式: Proto LocalAddress ForeignAddress State PID）
const NETSTAT_SAMPLE = [
  "  Proto  Local Address          Foreign Address        State           PID",
  "  TCP    0.0.0.0:3009           0.0.0.0:0              LISTENING       1234",
  "  TCP    127.0.0.1:5174         0.0.0.0:0              LISTENING       5678",
  "  TCP    [::1]:5175             [::]:0                 LISTENING       9012",
  "  TCP    0.0.0.0:51740          0.0.0.0:0              LISTENING       9999", // 5174 と前方一致するが別ポート
  "  TCP    0.0.0.0:8080           0.0.0.0:0              TIME_WAIT       1111", // LISTENING 以外は対象外
  "  TCP    0.0.0.0:3009           0.0.0.0:0              LISTENING       4444", // 同一ポートに複数 PID
].join("\n");

describe("findListeningPids", () => {
  it("単一ポートで LISTENING 中の PID を全て返す（出現順・重複なし）", () => {
    expect(findListeningPids(NETSTAT_SAMPLE, [3009])).toEqual([1234, 4444]);
  });

  it("ポート帯（複数ポート）をまとめて探索できる", () => {
    expect(findListeningPids(NETSTAT_SAMPLE, [5174, 5175])).toEqual([5678, 9012]);
  });

  it("前方一致ポート（51740）は 5174 として誤検出しない", () => {
    expect(findListeningPids(NETSTAT_SAMPLE, [5174])).toEqual([5678]);
  });

  it("LISTENING 以外の状態（TIME_WAIT 等）は対象外", () => {
    expect(findListeningPids(NETSTAT_SAMPLE, [8080])).toEqual([]);
  });

  it("該当ポートが無ければ空配列", () => {
    expect(findListeningPids(NETSTAT_SAMPLE, [99999])).toEqual([]);
    expect(findListeningPids("", [3009])).toEqual([]);
  });

  it("PID 列が欠けている行は無視する", () => {
    const broken = "  TCP    0.0.0.0:3009           0.0.0.0:0              LISTENING\n";
    expect(findListeningPids(broken, [3009])).toEqual([]);
  });
});

describe("nextFallbackPort", () => {
  it("上限以内なら次のポートを採用する", () => {
    expect(nextFallbackPort(3009, 3009, 9)).toBe(3010);
    expect(nextFallbackPort(3015, 3009, 9)).toBe(3016);
  });

  it("上限ちょうどは採用（境界値）", () => {
    expect(nextFallbackPort(3017, 3009, 9)).toBe(3018);
  });

  it("上限を超えたら null（フォールバック断念）", () => {
    expect(nextFallbackPort(3018, 3009, 9)).toBeNull();
    expect(nextFallbackPort(3019, 3009, 9)).toBeNull();
  });

  it("起点ポートが DESIRED 以外でも判定は desiredPort 基準で行う", () => {
    expect(nextFallbackPort(5174, 5174, 5)).toBe(5175);
    expect(nextFallbackPort(5179, 5174, 5)).toBeNull();
  });
});
