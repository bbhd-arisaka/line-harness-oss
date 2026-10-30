import { describe, expect, it } from 'vitest';
import { buildInfoGroups, fieldText, initialInputText, inputKindOf, parseFieldInput, toggleChoice } from './friend-fields';
import type { FriendFieldDefinition, FriendFieldFolder } from './types';

const def = (o: Partial<FriendFieldDefinition> & Pick<FriendFieldDefinition, 'fieldKey' | 'label'>): FriendFieldDefinition => ({
  id: o.fieldKey,
  folderId: null,
  fieldType: 'text',
  options: [],
  displayOrder: 0,
  ...o,
});
const folders: FriendFieldFolder[] = [
  { id: 'f2', name: 'お客様情報', displayOrder: 2 },
  { id: 'f1', name: '施術', displayOrder: 1 },
  { id: 'f3', name: '空のフォルダ', displayOrder: 3 },
];

describe('buildInfoGroups(フォルダごと・全項目を上から順に)', () => {
  const defs = [
    def({ fieldKey: 'b', label: 'B', folderId: 'f2', displayOrder: 2 }),
    def({ fieldKey: 'a', label: 'A', folderId: 'f2', displayOrder: 1 }),
    def({ fieldKey: 'c', label: 'C', folderId: 'f1', displayOrder: 3, fieldType: 'image' }),
    def({ fieldKey: 'x', label: 'X', displayOrder: 0 }),
    def({ fieldKey: 'y', label: 'Y', folderId: 'gone', displayOrder: 4 }),
  ];
  it('フォルダの並び・項目の並びどおり。値が無い項目も出す。空のフォルダは出さない。フォルダ無しは最後の「未分類」', () => {
    const g = buildInfoGroups({ a: '山田', c: 'https://x/api/form-uploads/1.png' }, defs, folders);
    expect(g.map((x) => x.name)).toEqual(['施術', 'お客様情報', '未分類']);
    expect(g[1].items.map((i) => [i.key, i.value])).toEqual([
      ['a', '山田'],
      ['b', ''],
    ]);
    expect(g[0].items[0]).toMatchObject({ key: 'c', value: '(添付ファイルあり)', editable: true });
    expect(g[2].items.map((i) => i.key)).toEqual(['x', 'y']);
  });
  it('定義が無ければ空', () => {
    expect(buildInfoGroups({}, [], folders)).toEqual([]);
  });
});

describe('入力の変換', () => {
  it('種類', () => {
    expect(inputKindOf('radio')).toBe('select');
    expect(inputKindOf('image')).toBe('image');
    expect(inputKindOf('pdf')).toBeNull();
    expect(inputKindOf('datetime')).toBe('datetime');
  });
  it('表示用の文字', () => {
    expect(fieldText(['a', 'b'])).toBe('a, b');
    expect(fieldText(null)).toBe('');
    expect(initialInputText('datetime', '2026-10-20T15:30')).toBe('2026-10-20 15:30');
  });
  it('日付・日時・数字を検査して、保存する形にそろえる。空は消す', () => {
    expect(parseFieldInput('date', '2026/1/5')).toEqual({ ok: true, value: '2026-01-05' });
    expect(parseFieldInput('date', '2026-02-30').ok).toBe(false);
    expect(parseFieldInput('datetime', '2026-10-20 9:05')).toEqual({ ok: true, value: '2026-10-20T09:05' });
    expect(parseFieldInput('datetime', '2026-10-20 25:00').ok).toBe(false);
    expect(parseFieldInput('number', 'abc').ok).toBe(false);
    expect(parseFieldInput('text', '  ')).toEqual({ ok: true, value: null });
    expect(parseFieldInput('text', ' こんにちは ')).toEqual({ ok: true, value: 'こんにちは' });
  });
  it('複数選択の入れ外し', () => {
    expect(toggleChoice('', 'A')).toBe('A');
    expect(toggleChoice('A, B', 'A')).toBe('B');
    expect(toggleChoice('A', 'B')).toBe('A, B');
  });
});
