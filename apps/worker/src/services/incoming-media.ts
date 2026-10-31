// お客様から届いた動画・音声・ファイルを、LINE から取り出して R2 に保存する。
// 危険なファイルを入れないため、保存するのは「種類が決まっているもの」だけ。名前(拡張子)・LINEが伝える種類・中身の先頭(マジックナンバー)の3つが合ったものだけを保存する。
// 実行ファイル・スクリプト・HTML・圧縮ファイル・マクロつきの古いOffice形式などは保存せず、「保存していません」とだけ記録する。

const LINE_CONTENT_API_BASE = 'https://api-data.line.me/v2/bot/message';

/** 1ファイルの上限(バイト) */
export const INCOMING_MEDIA_MAX_BYTES = 50 * 1024 * 1024;

export type IncomingMediaKind = 'video' | 'audio' | 'file';

export interface StoredIncomingMedia {
  url: string;
  fileName: string;
  size: number;
  contentType: string;
  /** 動画・音声の長さ(ミリ秒)。LINEが伝えたとき */
  duration?: number;
}

export interface BlockedIncomingMedia {
  fileName: string;
  blocked: true;
  reason: string;
}

export interface FetchMediaOptions {
  r2: R2Bucket;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  workerUrl: string;
  channelAccessToken: string;
  accountId: string;
  messageId: string;
  kind: IncomingMediaKind;
  fileName?: string;
  duration?: number;
}

interface Allowed {
  ext: string;
  contentType: string;
  check: (head: Uint8Array) => boolean;
}

const startsWith = (head: Uint8Array, bytes: number[], offset = 0) => bytes.every((b, i) => head[offset + i] === b);
const ascii = (head: Uint8Array, text: string, offset = 0) => startsWith(head, [...text].map((c) => c.charCodeAt(0)), offset);
const isZip = (h: Uint8Array) => startsWith(h, [0x50, 0x4b, 0x03, 0x04]);
const isText = (h: Uint8Array) => !h.subarray(0, 4096).includes(0) && !ascii(h, 'MZ') && !startsWith(h, [0x7f, 0x45, 0x4c, 0x46]) && !ascii(h, '#!');
const isIsoMedia = (h: Uint8Array) => ascii(h, 'ftyp', 4) || ascii(h, 'moov', 4) || ascii(h, 'mdat', 4) || ascii(h, 'wide', 4);

/** ファイル(拡張子で決める)。古い doc/xls/ppt は、マクロを含められるので入れない */
const FILE_TYPES: Record<string, Allowed> = {
  pdf: { ext: 'pdf', contentType: 'application/pdf', check: (h) => ascii(h, '%PDF') },
  docx: { ext: 'docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', check: isZip },
  xlsx: { ext: 'xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', check: isZip },
  pptx: { ext: 'pptx', contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', check: isZip },
  txt: { ext: 'txt', contentType: 'text/plain; charset=utf-8', check: isText },
  csv: { ext: 'csv', contentType: 'text/csv; charset=utf-8', check: isText },
  jpg: { ext: 'jpg', contentType: 'image/jpeg', check: (h) => startsWith(h, [0xff, 0xd8, 0xff]) },
  jpeg: { ext: 'jpg', contentType: 'image/jpeg', check: (h) => startsWith(h, [0xff, 0xd8, 0xff]) },
  png: { ext: 'png', contentType: 'image/png', check: (h) => startsWith(h, [0x89, 0x50, 0x4e, 0x47]) },
  gif: { ext: 'gif', contentType: 'image/gif', check: (h) => ascii(h, 'GIF8') },
  webp: { ext: 'webp', contentType: 'image/webp', check: (h) => ascii(h, 'RIFF') && ascii(h, 'WEBP', 8) },
};

/** 動画・音声(LINEが伝える種類で決める) */
const VIDEO_TYPES: Record<string, Allowed> = {
  'video/mp4': { ext: 'mp4', contentType: 'video/mp4', check: isIsoMedia },
  'video/quicktime': { ext: 'mov', contentType: 'video/quicktime', check: isIsoMedia },
};
const AUDIO_TYPES: Record<string, Allowed> = {
  'audio/mp4': { ext: 'm4a', contentType: 'audio/mp4', check: isIsoMedia },
  'audio/x-m4a': { ext: 'm4a', contentType: 'audio/mp4', check: isIsoMedia },
  'audio/m4a': { ext: 'm4a', contentType: 'audio/mp4', check: isIsoMedia },
  'audio/aac': { ext: 'aac', contentType: 'audio/aac', check: (h) => h[0] === 0xff && (h[1] & 0xf0) === 0xf0 },
  'audio/mpeg': { ext: 'mp3', contentType: 'audio/mpeg', check: (h) => ascii(h, 'ID3') || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0) },
};

function extensionOf(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i < 0 ? '' : fileName.slice(i + 1).toLowerCase();
}

const blocked = (fileName: string, reason: string): BlockedIncomingMedia => ({ fileName, blocked: true, reason });

/** ファイル名から、画面に出せる安全な表示名にする(制御文字・パス区切りを除く・長さ制限) */
export function cleanFileName(name: string | undefined): string {
  return (name ?? '').replace(/[\u0000-\u001f\u007f/\\]/g, '').trim().slice(0, 120);
}

export async function fetchAndStoreIncomingMedia(opts: FetchMediaOptions): Promise<StoredIncomingMedia | BlockedIncomingMedia | null> {
  const fetcher = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const fileName = cleanFileName(opts.fileName);

  // ファイルは、名前の拡張子で保存してよい種類かを先に決める(取りに行く前に、危ないものは断る)
  let fixed: Allowed | null = null;
  if (opts.kind === 'file') {
    fixed = FILE_TYPES[extensionOf(fileName)] ?? null;
    if (!fixed) return blocked(fileName, '安全のため、この種類のファイルは保存していません');
  }

  // 動画・音声は、LINE側の変換が終わるまで少し待つことがある
  let res: Response | null = null;
  const attempts = opts.kind === 'file' ? 1 : 4;
  for (let i = 0; i < attempts; i++) {
    try {
      res = await fetcher(`${LINE_CONTENT_API_BASE}/${opts.messageId}/content`, { headers: { Authorization: `Bearer ${opts.channelAccessToken}` } });
    } catch (err) {
      console.error('incoming-media: fetch failed', { err, messageId: opts.messageId, accountId: opts.accountId });
      return null;
    }
    if (res.ok && res.status !== 202) break;
    if (i < attempts - 1 && [202, 404, 409, 425, 503].includes(res.status)) {
      await sleep(1500);
      continue;
    }
    console.error('incoming-media: non-200', { status: res.status, messageId: opts.messageId, accountId: opts.accountId });
    return null;
  }
  if (!res || !res.ok || res.status === 202) return null;

  const declared = Number(res.headers.get('Content-Length') ?? '0');
  if (declared > INCOMING_MEDIA_MAX_BYTES) return blocked(fileName, '大きすぎるため保存していません(50MBまで)');

  const lineType = (res.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (!fixed) fixed = (opts.kind === 'video' ? VIDEO_TYPES : AUDIO_TYPES)[lineType] ?? null;
  if (!fixed) return blocked(fileName, '安全のため、この種類のファイルは保存していません');

  let data: ArrayBuffer;
  try {
    data = await res.arrayBuffer();
  } catch (err) {
    console.error('incoming-media: arrayBuffer failed', { err, messageId: opts.messageId, accountId: opts.accountId });
    return null;
  }
  if (data.byteLength === 0) return null;
  if (data.byteLength > INCOMING_MEDIA_MAX_BYTES) return blocked(fileName, '大きすぎるため保存していません(50MBまで)');
  if (!fixed.check(new Uint8Array(data, 0, Math.min(data.byteLength, 4096)))) {
    return blocked(fileName, '拡張子と中身が合わないため保存していません');
  }

  const safeAccountId = opts.accountId.replace(/[^a-zA-Z0-9-]/g, '_');
  const safeMessageId = opts.messageId.replace(/[^a-zA-Z0-9-]/g, '_');
  const key = `incoming-${safeAccountId}-${safeMessageId}.${fixed.ext}`;
  try {
    await opts.r2.put(key, data, { httpMetadata: { contentType: fixed.contentType }, customMetadata: { originalFilename: fileName } });
  } catch (err) {
    console.error('incoming-media: R2 put failed', { err, messageId: opts.messageId, accountId: opts.accountId });
    return null;
  }

  const base = opts.workerUrl.replace(/\/$/, '');
  return {
    url: `${base}/images/${key}`,
    fileName,
    size: data.byteLength,
    contentType: fixed.contentType,
    ...(typeof opts.duration === 'number' ? { duration: opts.duration } : {}),
  };
}
