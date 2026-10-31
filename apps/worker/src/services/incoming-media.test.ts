import { describe, expect, it, vi } from 'vitest';
import { fetchAndStoreIncomingMedia, cleanFileName } from './incoming-media.js';
import { signIncomingMessageContent, verifyIncomingKey, signIncomingKey } from '../lib/incoming-media-url.js';

function r2() {
  const put = vi.fn(async () => undefined);
  return { bucket: { put } as unknown as R2Bucket, put };
}

function bytes(...head: number[]) {
  const a = new Uint8Array(64);
  a.set(head);
  return a;
}
const ftyp = () => {
  const a = new Uint8Array(64);
  a.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]);
  return a;
};

function lineFetch(body: Uint8Array, type: string, status = 200) {
  return vi.fn(async () => new Response(status === 200 ? body : null, { status, headers: { 'Content-Type': type, 'Content-Length': String(body.byteLength) } })) as unknown as typeof fetch;
}

const base = { workerUrl: 'https://w.test', channelAccessToken: 't', accountId: 'acc1', messageId: '1001', sleep: async () => undefined };

describe('お客様から届いたファイルの保存', () => {
  it('PDFは、中身がPDFなら保存する', async () => {
    const s = r2();
    const res = await fetchAndStoreIncomingMedia({ ...base, r2: s.bucket, kind: 'file', fileName: '見積.pdf', fetch: lineFetch(bytes(0x25, 0x50, 0x44, 0x46), 'application/octet-stream') });
    expect(res).toMatchObject({ url: 'https://w.test/images/incoming-acc1-1001.pdf', fileName: '見積.pdf', contentType: 'application/pdf' });
    expect(s.put).toHaveBeenCalledOnce();
  });

  it('実行ファイルや圧縮ファイルは、取りに行かずに断る', async () => {
    for (const name of ['a.exe', 'a.apk', 'a.zip', 'a.html', 'a.svg', 'a.js', 'a.docm', 'a.doc', 'a.xls', 'noext']) {
      const s = r2();
      const f = lineFetch(bytes(1), 'application/octet-stream');
      const res = await fetchAndStoreIncomingMedia({ ...base, r2: s.bucket, kind: 'file', fileName: name, fetch: f });
      expect(res).toMatchObject({ blocked: true, fileName: name });
      expect(f).not.toHaveBeenCalled();
      expect(s.put).not.toHaveBeenCalled();
    }
  });

  it('名前はPDFでも、中身が実行ファイル(MZ)なら保存しない', async () => {
    const s = r2();
    const res = await fetchAndStoreIncomingMedia({ ...base, r2: s.bucket, kind: 'file', fileName: 'invoice.pdf', fetch: lineFetch(bytes(0x4d, 0x5a), 'application/pdf') });
    expect(res).toMatchObject({ blocked: true });
    expect(s.put).not.toHaveBeenCalled();
  });

  it('txt は、中身にバイナリ(NUL)があれば保存しない', async () => {
    const s = r2();
    const res = await fetchAndStoreIncomingMedia({ ...base, r2: s.bucket, kind: 'file', fileName: 'a.txt', fetch: lineFetch(bytes(0x68, 0, 0x69), 'text/plain') });
    expect(res).toMatchObject({ blocked: true });
  });

  it('50MBを超えるものは保存しない', async () => {
    const s = r2();
    const big = new Response(new Uint8Array(8), { headers: { 'Content-Length': String(60 * 1024 * 1024) } });
    const res = await fetchAndStoreIncomingMedia({ ...base, r2: s.bucket, kind: 'file', fileName: 'a.pdf', fetch: vi.fn(async () => big) as unknown as typeof fetch });
    expect(res).toMatchObject({ blocked: true });
    expect(s.put).not.toHaveBeenCalled();
  });

  it('動画(mp4)・音声(m4a)は、種類と中身が合えば保存する。長さも残す', async () => {
    const s = r2();
    const v = await fetchAndStoreIncomingMedia({ ...base, r2: s.bucket, kind: 'video', duration: 5000, fetch: lineFetch(ftyp(), 'video/mp4') });
    expect(v).toMatchObject({ url: 'https://w.test/images/incoming-acc1-1001.mp4', contentType: 'video/mp4', duration: 5000 });
    const a = await fetchAndStoreIncomingMedia({ ...base, r2: s.bucket, kind: 'audio', fetch: lineFetch(ftyp(), 'audio/x-m4a') });
    expect(a).toMatchObject({ url: 'https://w.test/images/incoming-acc1-1001.m4a', contentType: 'audio/mp4' });
  });

  it('動画でも、知らない種類(例: HTML)なら保存しない', async () => {
    const s = r2();
    const res = await fetchAndStoreIncomingMedia({ ...base, r2: s.bucket, kind: 'video', fetch: lineFetch(bytes(0x3c), 'text/html') });
    expect(res).toMatchObject({ blocked: true });
  });

  it('LINE側の変換待ちは少し待って取り直す。取れなければ null(ラベルのまま)', async () => {
    const s = r2();
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(new Response(ftyp(), { headers: { 'Content-Type': 'video/mp4' } })) as unknown as typeof fetch;
    const ok = await fetchAndStoreIncomingMedia({ ...base, r2: s.bucket, kind: 'video', fetch: f });
    expect(ok).toMatchObject({ contentType: 'video/mp4' });
    const none = await fetchAndStoreIncomingMedia({ ...base, r2: s.bucket, kind: 'video', fetch: vi.fn(async () => new Response(null, { status: 500 })) as unknown as typeof fetch });
    expect(none).toBeNull();
  });

  it('ファイル名の制御文字・パス区切りは取り除く', () => {
    expect(cleanFileName('a/b\\c\u0000.pdf')).toBe('abc.pdf');
    expect(cleanFileName(undefined)).toBe('');
  });
});

describe('署名つきURL', () => {
  const secret = 'k';
  it('署名と期限が合えば開ける。期限切れ・改ざんは開けない', async () => {
    const exp = 2_000_000_000;
    const sig = await signIncomingKey(secret, 'incoming-a-1.jpg', exp);
    expect(await verifyIncomingKey(secret, 'incoming-a-1.jpg', String(exp), sig, 1_900_000_000)).toBe(true);
    expect(await verifyIncomingKey(secret, 'incoming-a-1.jpg', String(exp), sig, 2_000_000_001)).toBe(false);
    expect(await verifyIncomingKey(secret, 'incoming-a-2.jpg', String(exp), sig, 1_900_000_000)).toBe(false);
    expect(await verifyIncomingKey(secret, 'incoming-a-1.jpg', undefined, sig, 1)).toBe(false);
    expect(await verifyIncomingKey('', 'incoming-a-1.jpg', String(exp), sig, 1)).toBe(false);
  });

  it('お客様からの画像・ファイルのURLにだけ署名をつける', async () => {
    const content = JSON.stringify({ originalContentUrl: 'https://w.test/images/incoming-a-1.jpg', previewImageUrl: 'https://w.test/images/incoming-a-1.jpg' });
    const signed = JSON.parse((await signIncomingMessageContent(secret, { direction: 'incoming', messageType: 'image', content }, 1_000_000_000_000)) as string);
    expect(signed.originalContentUrl).toMatch(/^https:\/\/w\.test\/images\/incoming-a-1\.jpg\?exp=\d+&sig=[\w-]+$/);
    // こちらから送った画像・テキスト・保存先以外のURLは、そのまま
    expect(await signIncomingMessageContent(secret, { direction: 'outgoing', messageType: 'image', content }, 1)).toBe(content);
    expect(await signIncomingMessageContent(secret, { direction: 'incoming', messageType: 'text', content }, 1)).toBe(content);
    const other = JSON.stringify({ originalContentUrl: 'https://w.test/images/abc.jpg' });
    expect(await signIncomingMessageContent(secret, { direction: 'incoming', messageType: 'image', content: other }, 1)).toBe(other);
    expect(await signIncomingMessageContent(secret, { direction: 'incoming', messageType: 'image', content: '[画像]' }, 1)).toBe('[画像]');
  });
});
