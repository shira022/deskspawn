/**
 * ポート探索・フォールバック判定の純関数群。
 *
 * プロセス kill やネットワーク I/O には一切触れない（テスト容易性のため
 * server.ts から分離）。netstat -ano 出力の解析と、EADDRINUSE 時のフォール
 * バック採用判定のみを担当する。
 */

/**
 * `netstat -ano` 出力から、指定ポート帯で LISTENING 中のソケットの PID を
 * 出現順で返す（重複は除去）。純関数: 外部コマンド・ファイルに触れない。
 *
 * 注意: `-p tcp` を付けると [::1] (IPv6) の LISTENING 行が出力されないため、
 * 呼び出し側はプレーンな `netstat -ano` の出力を渡すこと。
 * また `:5174` を探すとき `:51740` のような前方一致ポートは対象外にする
 * （ポート番号は行末のアドレス列から厳密に切り出す）。
 */
export function findListeningPids(netstatOutput: string, ports: number[]): number[] {
  const portSet = new Set(ports);
  const pids = new Set<number>();
  for (const line of netstatOutput.split(/\r?\n/)) {
    if (!/LISTENING/.test(line)) continue;
    const cols = line.trim().split(/\s+/);
    const localAddress = cols[1]; // Proto LocalAddress ForeignAddress State PID
    if (!localAddress) continue;
    const portMatch = localAddress.match(/:(\d+)$/);
    if (!portMatch || !portSet.has(parseInt(portMatch[1], 10))) continue;
    const pid = parseInt(cols[cols.length - 1], 10);
    if (!Number.isNaN(pid)) pids.add(pid);
  }
  return [...pids];
}

/**
 * EADDRINUSE 時のフォールバック採用判定。
 * 次の候補ポート（port + 1）が desiredPort + maxExtra 以内ならそれを返し、
 * 上限を超える場合は null（フォールバック断念・起動失敗）を返す。
 * 純関数: I/O なし。
 */
export function nextFallbackPort(port: number, desiredPort: number, maxExtra: number): number | null {
  const nextPort = port + 1;
  const maxPort = desiredPort + maxExtra;
  return nextPort <= maxPort ? nextPort : null;
}