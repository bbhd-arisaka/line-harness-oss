import { describe, expect, it } from 'vitest';
import { buildAnswerItems } from './form-answer-items.js';

const fields = JSON.stringify([
  { name: 'f_name', label: 'お名前', type: 'text' },
  { name: 'h1', label: '見出し', type: 'heading' },
  { name: 'f_menu', label: 'メニュー', type: 'checkbox' },
  { name: 'f_note', label: '', type: 'textarea' },
  { name: 'f_photo', label: '写真', type: 'file' },
]);

describe('buildAnswerItems(回答結果の一覧)', () => {
  it('フォームの項目の順に、項目名と値を並べる。見出しは出さない。未回答は「-」', () => {
    const items = buildAnswerItems(fields, JSON.stringify({ f_menu: ['カット', 'カラー'], f_name: '山田', f_note: '' }));
    expect(items).toEqual([
      { label: 'お名前', value: '山田' },
      { label: 'メニュー', value: 'カット, カラー' },
      { label: 'f_note', value: '-' },
      { label: '写真', value: '-' },
    ]);
  });
  it('アップロードされたファイルは、URL とファイルの印を付ける', () => {
    const url = 'https://x.example/api/form-uploads/F1/abc.png';
    const items = buildAnswerItems(fields, JSON.stringify({ f_photo: url }));
    expect(items.find((i) => i.label === '写真')).toEqual({ label: '写真', value: url, isFile: true });
  });
  it('定義に無い回答は後ろに足す。_ で始まる内部の項目は出さない', () => {
    const items = buildAnswerItems(fields, JSON.stringify({ f_name: 'a', extra: 1, _webhookVerified: true }));
    expect(items.map((i) => i.label)).toEqual(['お名前', 'メニュー', 'f_note', '写真', 'extra']);
    expect(items.at(-1)).toEqual({ label: 'extra', value: '1' });
  });
  it('壊れた JSON・空でも落ちない', () => {
    expect(buildAnswerItems('not json', 'not json')).toEqual([]);
    expect(buildAnswerItems(null, null)).toEqual([]);
    expect(buildAnswerItems('[]', JSON.stringify({ a: { x: 1 } }))).toEqual([{ label: 'a', value: '{"x":1}' }]);
  });
});
