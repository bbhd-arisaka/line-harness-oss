import { describe, expect, it } from 'vitest';
import { appendTag, applyEdit, CHIP_PAD, displayOf, insertTag, segsToText, tagLabel, tagTone, toSegs } from './tag-editor';
import { formTag, NAME_TAG, REAL_NAME_TAG } from './broadcast';

const P = CHIP_PAD;
const names = new Map([['f1', '初回カウンセリング']]);

// 入力欄の中でも、タグは色付きのボックス(コードは見せない)。ボックスは文章の中に並んで入り、ひとかたまりで消える
describe('見せ方', () => {
  it('ボックスの名前: LINE名・本名・フォーム(名前が分かれば「フォーム：○○」)', () => {
    expect(tagLabel(NAME_TAG)).toBe('LINE名');
    expect(tagLabel(REAL_NAME_TAG)).toBe('本名');
    expect(tagLabel(formTag('f1'))).toBe('フォーム');
    expect(tagLabel(formTag('f1'), names)).toBe('フォーム：初回カウンセリング');
    expect(tagLabel('{{liff_id}}')).toBe('liff_id');
  });
  it('色の系統', () => {
    expect(tagTone(NAME_TAG)).toBe('name');
    expect(tagTone(REAL_NAME_TAG)).toBe('realName');
    expect(tagTone(formTag('x'))).toBe('form');
    expect(tagTone('{{liff_id}}')).toBe('other');
  });
  it('入力欄に出す文字には、{{ }} が出ない。ボックスの両側に空白が付く', () => {
    const segs = toSegs(`こんにちは${NAME_TAG}さん`);
    const shown = displayOf(segs);
    expect(shown).toBe(`こんにちは${P}LINE名${P}さん`);
    expect(shown).not.toContain('{');
  });
  it('本文⇄セグメントは、元に戻る(保存される形は変わらない)', () => {
    const text = `A${NAME_TAG}B${REAL_NAME_TAG}\n${formTag('f1')}😀{{foo}}`;
    expect(segsToText(toSegs(text))).toBe(text);
    expect(toSegs('')).toEqual([]);
  });
});

describe('打つ・消す(前の表示 → いまの表示)', () => {
  const base = toSegs(`こんにちは${NAME_TAG}さん`);
  const shown = displayOf(base);
  const edit = (next: string) => segsToText(applyEdit(base, shown, next));

  it('文字を打つと、その位置に入る(ボックスはそのまま)', () => {
    expect(edit(`こんにちはA${P}LINE名${P}さん`)).toBe(`こんにちはA${NAME_TAG}さん`);
    expect(edit(`こんにちは${P}LINE名${P}さんB`)).toBe(`こんにちは${NAME_TAG}さんB`);
    expect(edit(`あ${shown}`)).toBe(`あこんにちは${NAME_TAG}さん`);
  });
  it('普通の文字を消しても、ボックスは残る', () => {
    expect(edit(`こんちは${P}LINE名${P}さん`)).toBe(`こんちは${NAME_TAG}さん`);
    expect(edit(`こんにちは${P}LINE名${P}`)).toBe(`こんにちは${NAME_TAG}`);
  });
  it('ボックスは、一部でも消されたら、ボックスごと消える(後ろの空白・名前の途中・前の空白)', () => {
    expect(edit(`こんにちは${P}LINE名さん`)).toBe('こんにちはさん'); // 後ろの空白を消した(バックスペース1回)
    expect(edit(`こんにちは${P}LINEさん`)).toBe('こんにちはさん'); // 名前の途中を消した
    expect(edit(`こんにちはLINE名${P}さん`)).toBe('こんにちはさん'); // 前の空白を消した
    expect(edit('こんにちはさん')).toBe('こんにちはさん'); // 全部消した
  });
  it('ボックスをまたいで選択して消すと、間のボックスも消える', () => {
    const segs = toSegs(`a${NAME_TAG}b${REAL_NAME_TAG}c`);
    const before = displayOf(segs);
    expect(segsToText(applyEdit(segs, before, `ac`))).toBe('ac');
    expect(segsToText(applyEdit(segs, before, `a${P}LINE名${P}c`))).toBe(`a${NAME_TAG}c`);
  });
  it('ボックスの中に文字を打つと、ボックスの後ろに入る(ボックスは壊れない)', () => {
    expect(edit(`こんにちは${P}LINE名X${P}さん`)).toBe(`こんにちは${NAME_TAG}Xさん`);
    expect(edit(`こんにちは${P}LINE${'Y'}名${P}さん`)).toBe(`こんにちは${NAME_TAG}Yさん`);
  });
  it('選択して別の文字に置き換える・日本語の変換(かな→漢字)・絵文字', () => {
    expect(edit(`こんば${P}LINE名${P}さん`)).toBe(`こんば${NAME_TAG}さん`);
    expect(edit(`今日は${P}LINE名${P}さん`)).toBe(`今日は${NAME_TAG}さん`);
    expect(edit(`こんにちは${P}LINE名${P}さん😀`)).toBe(`こんにちは${NAME_TAG}さん😀`);
  });
  it('同じ文字が続く場所での入力も、位置がずれない', () => {
    const segs = toSegs(`aa${NAME_TAG}aa`);
    const before = displayOf(segs);
    expect(segsToText(applyEdit(segs, before, `aaa${P}LINE名${P}aa`))).toBe(`aaa${NAME_TAG}aa`);
    expect(segsToText(applyEdit(segs, before, `aa${P}LINE名${P}aaa`))).toBe(`aa${NAME_TAG}aaa`);
  });
  it('変化が無ければ、そのまま', () => {
    expect(applyEdit(base, shown, shown)).toBe(base);
  });
  it('フォームの名前が読み込まれて表示が変わっても、同じ見せ方で計算すれば壊れない', () => {
    const segs = toSegs(`${formTag('f1')}X`);
    const before = displayOf(segs, names);
    expect(before).toBe(`${P}フォーム：初回カウンセリング${P}X`);
    expect(segsToText(applyEdit(segs, before, `${before}Y`, names))).toBe(`${formTag('f1')}XY`);
  });
});

describe('ボタンでボックスを入れる', () => {
  it('カーソル位置に入り、カーソルはボックスの直後', () => {
    const segs = toSegs('こんにちは');
    const r = insertTag(segs, 2, 2, NAME_TAG);
    expect(segsToText(r.segs)).toBe(`こん${NAME_TAG}にちは`);
    expect(r.cursor).toBe(2 + `${P}LINE名${P}`.length);
  });
  it('選択範囲があれば置き換える。ボックスの途中なら、ボックスの後ろ', () => {
    expect(segsToText(insertTag(toSegs('abcdef'), 1, 4, REAL_NAME_TAG).segs)).toBe(`a${REAL_NAME_TAG}ef`);
    const segs = toSegs(`a${NAME_TAG}b`);
    const chipLen = `${P}LINE名${P}`.length;
    expect(segsToText(insertTag(segs, 1 + 2, 1 + 2, REAL_NAME_TAG).segs)).toBe(`a${NAME_TAG}${REAL_NAME_TAG}b`);
    expect(chipLen).toBeGreaterThan(2);
  });
  it('範囲外のカーソルでも壊れない。分からないときは最後に足す', () => {
    expect(segsToText(insertTag(toSegs('abc'), 99, 120, NAME_TAG).segs)).toBe(`abc${NAME_TAG}`);
    expect(segsToText(appendTag(toSegs('abc'), formTag('f1')).segs)).toBe(`abc${formTag('f1')}`);
    expect(segsToText(appendTag([], NAME_TAG).segs)).toBe(NAME_TAG);
  });
  it('ボックスが続いても入れられる', () => {
    const a = appendTag(toSegs(''), NAME_TAG);
    const b = insertTag(a.segs, a.cursor, a.cursor, REAL_NAME_TAG);
    expect(segsToText(b.segs)).toBe(`${NAME_TAG}${REAL_NAME_TAG}`);
  });
});
