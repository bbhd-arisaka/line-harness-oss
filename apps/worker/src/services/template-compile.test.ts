import { describe, expect, it } from 'vitest';
import {
  compileTemplate,
  emptyEditorData,
  parseRawMessages,
  parseTemplatePostback,
  splitText,
  validateTemplate,
} from '@line-crm/shared';
import type { CarouselData, ImageData, QuestionData } from '@line-crm/shared';
import { buildMessages } from './step-delivery.js';
import { buildMessage as buildBroadcastMessage } from './broadcast.js';

const ctx = { templateId: 'tpl-1', workerUrl: 'https://worker.example' };

describe('テンプレートの変換(Lステップ互換の入力データ → LINEへ送る形)', () => {
  it('テキスト: 短ければ従来の text のまま(既存の送り方と同じ)', () => {
    const c = compileTemplate('text', { text: 'こんにちは' }, ctx);
    expect(c.messageType).toBe('text');
    expect(c.messageContent).toBe('こんにちは');
  });

  it('テキスト: 4,500文字を超えたら複数のメッセージに分割する(最大5通)', () => {
    const text = 'あ'.repeat(4500) + '\n' + 'い'.repeat(4500) + '\n' + 'う'.repeat(100);
    const c = compileTemplate('text', { text }, ctx);
    expect(c.messages).toHaveLength(3);
    expect(c.messageType).toBe('flex');
    expect(parseRawMessages(c.messageType, c.messageContent)).toHaveLength(3);
    expect(splitText('x'.repeat(9001))).toHaveLength(3);
  });

  it('スタンプ: 「そのまま送る」箱に入る(DBの message_type 制約は変えない)', () => {
    const c = compileTemplate('sticker', { packageId: '11537', stickerId: '52002734' }, ctx);
    expect(c.messageType).toBe('flex');
    expect(parseRawMessages(c.messageType, c.messageContent)).toEqual([{ type: 'sticker', packageId: '11537', stickerId: '52002734' }]);
  });

  it('画像: リンクなしは従来の image。リンクありは imagemap(領域は 1040 幅の座標)', () => {
    const plain = compileTemplate('image', { imageUrl: 'https://worker.example/images/a.png', layout: 'none', areas: [] } satisfies ImageData, ctx);
    expect(plain.messageType).toBe('image');
    expect(JSON.parse(plain.messageContent)).toEqual({ originalContentUrl: 'https://worker.example/images/a.png', previewImageUrl: 'https://worker.example/images/a.png' });

    const data: ImageData = {
      imageUrl: 'https://worker.example/images/a.png',
      width: 1000,
      height: 500,
      layout: 'link2',
      areas: [
        { kind: 'url', url: 'https://example.com', x: 0, y: 0, w: 0.5, h: 1 },
        { kind: 'message', text: '予約したい', x: 0.5, y: 0, w: 0.5, h: 1 },
      ],
    };
    const c = compileTemplate('image', data, ctx);
    const [msg] = parseRawMessages(c.messageType, c.messageContent)!;
    expect(msg).toMatchObject({ type: 'imagemap', baseUrl: 'https://worker.example/imagemap/a.png', baseSize: { width: 1040, height: 520 } });
    expect((msg.actions as Array<Record<string, unknown>>)[0]).toEqual({ type: 'uri', linkUri: 'https://example.com', area: { x: 0, y: 0, width: 520, height: 520 } });
    expect((msg.actions as Array<Record<string, unknown>>)[1]).toMatchObject({ type: 'message', text: '予約したい', area: { x: 520, y: 0, width: 520, height: 520 } });
  });

  it('質問: 前文があれば2通(前文のテキスト+確認テンプレート)。選択肢は URL / ユーザーメッセージ / postback', () => {
    const data: QuestionData = {
      lead: '本日はありがとうございます',
      question: 'ご来店はいかがでしたか？',
      choices: [
        { label: 'とても良い', behavior: { kind: 'url', value: 'https://example.com/review' } },
        { label: 'ふつう', behavior: { kind: 'none' }, userMessage: 'ふつうでした', reply: { mode: 'text', text: 'ありがとうございます' } },
      ],
      answerMode: 'both',
    };
    const c = compileTemplate('question', data, ctx);
    const msgs = parseRawMessages(c.messageType, c.messageContent)!;
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ type: 'text', text: '本日はありがとうございます' });
    const tpl = (msgs[1] as unknown as { template: { type: string; actions: Array<Record<string, unknown>> } }).template;
    expect(tpl.type).toBe('confirm');
    expect(tpl.actions[0]).toEqual({ type: 'uri', label: 'とても良い', uri: 'https://example.com/review' });
    // 返信を設定した選択肢は、Webhook が処理できる postback(押したときに友だちの発言として見せる文は displayText)
    expect(tpl.actions[1]).toEqual({ type: 'postback', label: 'ふつう', data: 'tpl:tpl-1:0:1', displayText: 'ふつうでした' });
    expect(parseTemplatePostback('tpl:tpl-1:0:1')).toEqual({ templateId: 'tpl-1', panel: 0, choice: 1 });
  });

  it('質問: 何も設定しない選択肢は、押すと選択肢の文字を友だちの発言として送る(message アクション)', () => {
    const data = emptyEditorData('question') as QuestionData;
    data.question = 'はい?';
    data.choices[0].label = 'はい';
    data.choices[1].label = 'いいえ';
    data.answerMode = 'both';
    const c = compileTemplate('question', data, ctx);
    const tpl = (parseRawMessages(c.messageType, c.messageContent)![0] as unknown as { template: { actions: Array<Record<string, unknown>> } }).template;
    expect(tpl.actions[0]).toEqual({ type: 'message', label: 'はい', text: 'はい' });
  });

  it('カルーセル: Flex のカルーセルになる(従来の flex のまま・パネルごとに最大4つの選択肢)', () => {
    const data: CarouselData = {
      panels: [
        { title: '1枚目', text: '本文', imageUrl: 'https://worker.example/images/x.png', choices: [{ label: '見る', behavior: { kind: 'url', value: 'https://example.com' } }] },
        { title: '2枚目', text: '本文2', choices: [{ label: 'A', behavior: { kind: 'none' } }, { label: 'B', behavior: { kind: 'tel', value: '03-1234-5678' } }] },
      ],
      tapLimit: 'none',
    };
    const c = compileTemplate('carousel', data, ctx);
    expect(c.messageType).toBe('flex');
    const contents = JSON.parse(c.messageContent);
    expect(contents.type).toBe('carousel');
    expect(contents.contents).toHaveLength(2);
    expect(contents.contents[0].hero.url).toBe('https://worker.example/images/x.png');
    expect(contents.contents[1].footer.contents[1].action).toEqual({ type: 'uri', label: 'B', uri: 'tel:0312345678' });
    // タップ回数制限ありなら、(URL以外の)選択肢は postback(回数を数えるため)
    const limited = compileTemplate('carousel', { ...data, tapLimit: 'panel_once' }, ctx);
    expect(JSON.parse(limited.messageContent).contents[0].footer.contents[0].action).toMatchObject({ type: 'uri' });
    expect(JSON.parse(limited.messageContent).contents[1].footer.contents[0].action).toEqual({ type: 'postback', label: 'A', data: 'tpl:tpl-1:1:0' });
  });

  it('位置情報・音声・動画・紹介', () => {
    const loc = compileTemplate('location', { title: '店舗', address: '東京都港区', latitude: 35.6, longitude: 139.7 }, ctx);
    expect(parseRawMessages(loc.messageType, loc.messageContent)![0]).toMatchObject({ type: 'location', title: '店舗', latitude: 35.6 });
    const audio = compileTemplate('audio', { url: 'https://worker.example/images/a.m4a', durationMs: 12345 }, ctx);
    expect(parseRawMessages(audio.messageType, audio.messageContent)![0]).toMatchObject({ type: 'audio', duration: 12345 });
    const video = compileTemplate('video', { url: 'https://worker.example/images/v.mp4', previewUrl: 'https://worker.example/images/p.png' }, ctx);
    expect(parseRawMessages(video.messageType, video.messageContent)![0]).toMatchObject({ type: 'video', previewImageUrl: 'https://worker.example/images/p.png' });
    const ref = compileTemplate('referral', { text: 'こちらもどうぞ', accountId: 'friendname' }, ctx);
    expect(ref.messageType).toBe('flex');
    expect(JSON.parse(ref.messageContent).footer.contents[0].action.uri).toBe('https://line.me/R/ti/p/%40friendname');
  });

  it('送信者(送信名・アイコン)があれば、各メッセージに付く', () => {
    const c = compileTemplate('text', { text: 'やあ' }, { ...ctx, sender: { name: '店長', iconUrl: 'https://worker.example/images/i.png' } });
    expect(c.messages[0]).toMatchObject({ type: 'text', text: 'やあ', sender: { name: '店長', iconUrl: 'https://worker.example/images/i.png' } });
  });

  it('保存前の検査: 空の本文・スタンプ未選択・質問文なし などは、理由を返す', () => {
    expect(validateTemplate('text', { text: '  ' })).toEqual(['本文を入力してください']);
    expect(validateTemplate('sticker', { packageId: '', stickerId: '' })).toEqual(['スタンプを選択してください']);
    const q = emptyEditorData('question') as QuestionData;
    expect(validateTemplate('question', q)).toContain('質問文を入力してください');
    const c = emptyEditorData('carousel') as CarouselData;
    expect(validateTemplate('carousel', c).join('')).toContain('パネル#1の本文を入力してください');
  });
});

describe('送る側: 「そのまま送る」箱を、LINEのメッセージとして取り出す', () => {
  it('buildMessages は 2通以上を全部返し、buildMessage は 1通目を返す(既存の送り方は変わらない)', () => {
    const c = compileTemplate(
      'question',
      { lead: '前文', question: '質問', choices: [{ label: 'A', behavior: { kind: 'none' } }, { label: 'B', behavior: { kind: 'none' } }], answerMode: 'both' } satisfies QuestionData,
      ctx,
    );
    expect(buildMessages(c.messageType, c.messageContent)).toHaveLength(2);
    expect(buildBroadcastMessage(c.messageType, c.messageContent)).toMatchObject({ type: 'text', text: '前文' });
    // 従来のテキスト・画像・Flex は1通のまま
    expect(buildMessages('text', 'hi')).toEqual([{ type: 'text', text: 'hi' }]);
    expect(buildMessages('flex', JSON.stringify({ type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'a' }] } }))).toHaveLength(1);
  });
});

describe('配信日の差し込み語', () => {
  // 2026-10-20(火) 12:00 日本時間
  const now = Date.parse('2026-10-20T03:00:00Z');
  it('配信日・◯日後・◯日までの日数(日本時間)', async () => {
    const { renderDateVariables } = await import('./date-variables.js');
    expect(renderDateVariables('今日は{{date.mdw}}です', now)).toBe('今日は10月20日(火)です');
    expect(renderDateVariables('{{date.ymd_s}}', now)).toBe('2026/10/20');
    expect(renderDateVariables('{{date_plus.3.mdw_s}}', now)).toBe('10/23(金)');
    expect(renderDateVariables('あと{{date_until.2026-10-31}}日', now)).toBe('あと11日');
    // 書式が分からないものは、そのまま残す(送る前に気づける)
    expect(renderDateVariables('{{date.zzz}}', now)).toBe('{{date.zzz}}');
  });
  it('日本時間の日付をまたぐ(UTCでは前日の15:00〜)', async () => {
    const { renderDateVariables } = await import('./date-variables.js');
    expect(renderDateVariables('{{date.md}}', Date.parse('2026-10-20T15:30:00Z'))).toBe('10月21日');
  });
});
