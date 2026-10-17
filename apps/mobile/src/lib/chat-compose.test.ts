import { describe, expect, it } from 'vitest';
import { appendTemplateText, CHAT_MAX_LENGTH, imageContent, planCompose, templateNote } from './chat-compose';

describe('トークの入力欄', () => {
  it('画像メッセージの本文は、LINE が求める JSON(元の画像とプレビューが同じURL)', () => {
    expect(JSON.parse(imageContent('https://x.test/a.jpg'))).toEqual({ originalContentUrl: 'https://x.test/a.jpg', previewImageUrl: 'https://x.test/a.jpg' });
  });
  it('テンプレートの説明: タグは {{…}} の文字で見せない・画像と Flex は種類だけ', () => {
    expect(templateNote({ messageType: 'text', messageContent: '{{name}}さん\n{{real_name}}様 {{form_url:abc}}' })).toBe('[LINE名]さん [本名]様 [フォーム]');
    expect(templateNote({ messageType: 'image', messageContent: '{}' })).toBe('[画像]');
    expect(templateNote({ messageType: 'flex', messageContent: '{}' })).toBe('[Flex メッセージ]');
    expect(templateNote({ messageType: 'text', messageContent: 'あ'.repeat(100) })).toHaveLength(61);
  });
  it('テンプレートのテキストは、入力欄の後ろに足す(空なら、そのまま)', () => {
    expect(appendTemplateText('', 'こんにちは')).toBe('こんにちは');
    expect(appendTemplateText('  \n', 'こんにちは')).toBe('こんにちは');
    expect(appendTemplateText('ご予約ありがとうございます', 'お待ちしています')).toBe('ご予約ありがとうございます\nお待ちしています');
  });
  it('送るものを決める: 画像だけ・テキストだけ・両方(画像が先)', () => {
    expect(planCompose({ text: '  ', imageUrl: null, unsupportedTag: null })).toEqual({ ok: false, reason: '送る内容がありません' });
    expect(planCompose({ text: ' こんにちは ', imageUrl: null, unsupportedTag: null })).toEqual({ ok: true, image: null, text: 'こんにちは' });
    expect(planCompose({ text: '', imageUrl: 'https://x.test/a.jpg', unsupportedTag: null })).toEqual({ ok: true, image: 'https://x.test/a.jpg', text: null });
    expect(planCompose({ text: 'どうぞ', imageUrl: 'https://x.test/a.jpg', unsupportedTag: null })).toEqual({ ok: true, image: 'https://x.test/a.jpg', text: 'どうぞ' });
  });
  it('使えない差し込み・長すぎるテキストは、送らない', () => {
    expect(planCompose({ text: '{{foo}}', imageUrl: null, unsupportedTag: '{{foo}}' })).toEqual({ ok: false, reason: '使えない差し込みがあります: {{foo}}' });
    const long = planCompose({ text: 'あ'.repeat(CHAT_MAX_LENGTH + 1), imageUrl: null, unsupportedTag: null });
    expect(long.ok).toBe(false);
    expect(planCompose({ text: 'あ'.repeat(CHAT_MAX_LENGTH), imageUrl: null, unsupportedTag: null }).ok).toBe(true);
  });
});
