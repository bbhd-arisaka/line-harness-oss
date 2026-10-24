import { describe, expect, it } from 'vitest';
import { bubbleWidthOf, fontSizeOf, gradientColorAt, parseAspectRatio, parseFlexMessages, parseGradient, parseLength, px, rgbaOf } from './flex-style';

describe('Flex の値の読み取り', () => {
  it('余白は、キーワード・px・% のどれでも読める', () => {
    expect(parseLength('xl')).toEqual({ px: 16 });
    expect(parseLength('5px')).toEqual({ px: 5 });
    expect(parseLength('100%')).toEqual({ pct: 100 });
    expect(parseLength('none')).toEqual({ px: 0 });
    expect(parseLength('たくさん')).toBeNull();
    expect(px('50%')).toBeNull();
  });
  it('文字の大きさ・バブルの幅は、LINE の既定値。指定がなければ md・mega', () => {
    expect(fontSizeOf('xl')).toBe(22);
    expect(fontSizeOf(undefined)).toBe(16);
    expect(fontSizeOf('12px')).toBe(12);
    expect(bubbleWidthOf('kilo')).toBe(260);
    expect(bubbleWidthOf(undefined)).toBe(300);
  });
  it('縦横比 "1024:678" を割り算にする', () => {
    expect(parseAspectRatio('1:1')).toBe(1);
    expect(parseAspectRatio('1024:678')).toBeCloseTo(1.5103, 3);
    expect(parseAspectRatio('x')).toBeNull();
  });
  it('#RRGGBBAA を読む(アルファは0〜1)', () => {
    expect(rgbaOf('#00000080')[3]).toBeCloseTo(0.502, 2);
    expect(rgbaOf('#ff0000')).toEqual([255, 0, 0, 1]);
    expect(rgbaOf('赤', [1, 2, 3, 1])).toEqual([1, 2, 3, 1]);
  });
  it('グラデーション: 開始色から終了色へ。途中の色は混ぜる', () => {
    const g = parseGradient({ type: 'linearGradient', angle: '0deg', startColor: '#00000080', endColor: '#00000000' })!;
    expect(g.angle).toBe(0);
    expect(gradientColorAt(g, 0)[3]).toBeCloseTo(0.502, 2);
    expect(gradientColorAt(g, 1)[3]).toBe(0);
    expect(gradientColorAt(g, 0.5)[3]).toBeCloseTo(0.251, 2);
    expect(parseGradient({ type: 'solid' })).toBeNull();
  });
});

describe('parseFlexMessages(記録された本文から、届いたメッセージの並びを取り出す)', () => {
  const bubble = { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [] } };
  it('バブル・カルーセルそのものは、カード1件', () => {
    expect(parseFlexMessages(JSON.stringify(bubble))).toEqual([{ kind: 'flex', flex: bubble }]);
    const car = { type: 'carousel', contents: [bubble, bubble] };
    expect(parseFlexMessages(JSON.stringify(car))[0].flex).toEqual(car);
  });
  it('LINE に送った形 {type:flex, contents} は、中身のカード', () => {
    const items = parseFlexMessages(JSON.stringify({ type: 'flex', altText: '選んでください', contents: bubble }));
    expect(items).toEqual([{ kind: 'flex', flex: bubble, altText: '選んでください' }]);
  });
  it('lineMessages(複数を1件で記録したもの)は、順番にテキスト・画像・カードに分ける', () => {
    const items = parseFlexMessages(
      JSON.stringify({ lineMessages: [{ type: 'text', text: 'こんにちは' }, { type: 'image', originalContentUrl: 'https://x/a.jpg', previewImageUrl: 'https://x/p.jpg' }, { type: 'flex', altText: 'a', contents: bubble }] }),
    );
    expect(items.map((i) => i.kind)).toEqual(['text', 'image', 'flex']);
    expect(items[0].text).toBe('こんにちは');
    expect(items[1].imageUrl).toBe('https://x/a.jpg');
  });
  it('JSONでない・未知の形は、空か「その他」', () => {
    expect(parseFlexMessages('これはJSONではない')).toEqual([]);
    expect(parseFlexMessages(JSON.stringify({ type: 'imagemap' }))).toEqual([{ kind: 'other', text: '[imagemap]' }]);
  });
});
