/**
 * DeskSpawn — XML コメントマスク共通ヘルパ
 *
 * Package.appxmanifest 等の XML から要素を正規表現で読む際、XML コメントで
 * コメントアウトされた旧要素を実体と誤認しないようにするためのヘルパ。
 * コメント範囲を「同数の空白」に置換する（等長置換）ため、元文字列と同じ
 * インデックスが保たれ、マッチ位置をそのまま実体側の置換に使える。
 *
 * build-msix.mjs / check-versions.mjs / set-version.py（同等実装）で共有する。
 */

/**
 * XML コメントの各文字を同数の空白に置換し、元文字列と同じインデックスを保つ。
 *
 * 正規表現でマークアップ終端を扱うと `--!>` 等の取りこぼしで誤検知し得るため、
 * `indexOf` による走査でコメント範囲を求める。XML はコメントの入れ子を許さない
 * ので、最初に見つけた `<!--` から次の `-->` までを 1 コメントとして扱う。
 *
 * `<!--` が未終端（対応する `-->` が無い）、または対応する `<!--` の無い
 * `-->` が現れた場合は、コメント内の <Identity Version> を本物と誤認して
 * 書き換えるのを防ぐため throw する。
 * @param {string} xml
 * @returns {string}
 */
export function maskXmlComments(xml) {
  const parts = [];
  let cursor = 0;
  for (;;) {
    const start = xml.indexOf('<!--', cursor);
    const strayClose = xml.indexOf('-->', cursor);
    if (start === -1) {
      if (strayClose !== -1) {
        throw new Error(
          'maskXmlComments: XML コメントが未終端です (対応する <!-- の無い --> があります)。' +
            'マニフェストを確認してください',
        );
      }
      break;
    }
    if (strayClose !== -1 && strayClose < start) {
      throw new Error(
        'maskXmlComments: XML コメントが未終端です (対応する <!-- の無い --> があります)。' +
          'マニフェストを確認してください',
      );
    }
    const end = xml.indexOf('-->', start + 4);
    if (end === -1) {
      throw new Error(
        'maskXmlComments: XML コメントが未終端です (--> が見つかりません)。' +
          'マニフェストを確認してください',
      );
    }
    const closeEnd = end + 3;
    parts.push(xml.slice(cursor, start));
    parts.push(' '.repeat(closeEnd - start));
    cursor = closeEnd;
  }
  parts.push(xml.slice(cursor));
  return parts.join('');
}
