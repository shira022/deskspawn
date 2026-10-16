/**
 * DeskSpawn — scripts/lib/xml-comments.mjs の単体テスト（node:test）
 *
 * 実行: pnpm test:scripts（node --test "scripts/**\/*.test.mjs"）
 *
 * maskXmlComments は「コメント範囲を同数の空白に置換して元と同じインデックスを
 * 保つ」ことが肝。等長性・複数コメント・未終端コメントの throw を検証する。
 * build-msix.test.mjs 側にも同等の間接テストがあるが、ヘルパ自体の契約を
 * 直接固定するためここに重複して置く。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { maskXmlComments } from './xml-comments.mjs';

/**
 * 未終端エラー（実装メッセージに「未終端」を含む Error）かを判定する述語。
 * 正規表現リテラルで `-->` を扱うと CodeQL の js/bad-tag-filter に抵触するため、
 * assert.throws には正規表現ではなくこの述語を渡して判定の厳しさを保つ。
 */
const isUnterminatedError = (e) =>
  e instanceof Error && e.message.includes('未終端');

test('maskXmlComments: コメント無しは入力をそのまま返す', () => {
  const xml = '<Package><Identity Version="0.5.0.0"/></Package>';
  assert.equal(maskXmlComments(xml), xml);
});

test('maskXmlComments: コメントを同数の空白に置換し長さ（インデックス）を保つ', () => {
  const xml = 'a<!-- comment -->b';
  const masked = maskXmlComments(xml);
  assert.equal(masked.length, xml.length, '等長であること');
  assert.equal(masked, 'a' + ' '.repeat('<!-- comment -->'.length) + 'b');
  assert.equal(masked.includes('<!--'), false, 'コメント開始が残らないこと');
  assert.equal(masked.includes('-->'), false, 'コメント終了が残らないこと');
  // コメント外の文字は位置・内容とも不変
  assert.equal(masked[0], 'a');
  assert.equal(masked[masked.length - 1], 'b');
});

test('maskXmlComments: コメントアウトされた <Identity> をマスクする', () => {
  const xml = '<!-- <Identity Version="9.9.9.9"/> --><Identity Version="0.5.0.0"/>';
  const masked = maskXmlComments(xml);
  assert.equal(masked.length, xml.length, '等長であること');
  assert.doesNotMatch(masked, /9\.9\.9\.9/);
  assert.match(masked, /Version="0\.5\.0\.0"/);
});

test('maskXmlComments: 複数コメントをすべてマスクする', () => {
  const xml = '<!-- one -->mid<!-- two -->end';
  const masked = maskXmlComments(xml);
  assert.equal(masked.length, xml.length, '等長であること');
  assert.equal(masked, ' '.repeat('<!-- one -->'.length) + 'mid' + ' '.repeat('<!-- two -->'.length) + 'end');
});

test('maskXmlComments: 未終端の <!-- は throw する', () => {
  assert.throws(() => maskXmlComments('<!-- broken'), isUnterminatedError);
  assert.throws(() => maskXmlComments('a<!-- b <Identity Version="9.9.9.9"/>'), isUnterminatedError);
});

test('maskXmlComments: 対応する <!-- の無い --> も throw する', () => {
  assert.throws(() => maskXmlComments('a-->b'), isUnterminatedError);
});

test('maskXmlComments: --> の後ろに <!-- が来る未終端（strayClose < start）も throw する', () => {
  // 先頭側に閉じタグだけが現れるケース。ガード（strayClose < start）を
  // 消すと後続の <!-- を正規のコメント開始として処理してしまい素通しになる。
  assert.throws(() => maskXmlComments('a-->b<!-- c -->'), isUnterminatedError);
  assert.throws(() => maskXmlComments('a-->b'), isUnterminatedError);
});

test('maskXmlComments: 閉じたコメントの後ろに余分な --> があっても throw する', () => {
  // <!-- x --> を処理した後、対応する <!-- の無い --> が残るケース。
  assert.throws(() => maskXmlComments('<!-- x --> then --> rest'), isUnterminatedError);
});

test('maskXmlComments: 正常なコメントは等長で return する（未終端 throw と対比）', () => {
  const xml = 'a<!-- c -->b';
  const masked = maskXmlComments(xml);
  assert.equal(masked.length, xml.length, '入力と出力の length が一致すること');
});
