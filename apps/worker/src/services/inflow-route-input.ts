import { FriendAddSettingError, parseFriendAddActions } from '@line-crm/db';

/**
 * 流入経路(Lステップの「流入経路分析」)の、作成・更新の入力の検査。画面に依存しない純粋な関数。
 * 問題があれば、画面にそのまま出せる日本語の理由を返す。
 */

export interface ParsedInflowRoute {
  name: string;
  folderId: string | null;
  qrText: string | null;
  validFrom: string | null;
  validTo: string | null;
  outOfPeriodMessage: string | null;
  /** アクション(JSON文字列) */
  actions: string;
  scenarioId: string | null;
  ignoreFriendAddSettings: boolean;
  actionMode: 'first' | 'always';
  adImportMode: 'first' | 'always';
  adParamMap: string | null;
  htmlHead: string | null;
  htmlBody: string | null;
  geoLat: number | null;
  geoLng: number | null;
  geoRadius: number | null;
}

export type ParseResult = { ok: true; value: ParsedInflowRoute } | { ok: false; error: string };

export const DEFAULT_OUT_OF_PERIOD_MESSAGE = '現在ご利用いただけません';
const DATETIME = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
const PARAM_NAME = /^[A-Za-z0-9_.\-]{1,64}$/;
export const MAX_NAME = 255;
export const MAX_QR_TEXT = 10;
export const MAX_HTML = 20000;
export const MAX_AD_PARAMS = 30;

const optStr = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function isRealDateTime(s: string): boolean {
  const ms = Date.parse(`${s}:00+09:00`);
  return !Number.isNaN(ms) && new Date(ms + 9 * 3600_000).toISOString().slice(0, 16) === s;
}

/** 日本時間の「YYYY-MM-DDTHH:mm」を、ミリ秒に */
export function periodMs(s: string): number {
  return Date.parse(`${s}:00+09:00`);
}

export function parseInflowRouteInput(body: unknown, opts: { isCreate: boolean }): ParseResult {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) return { ok: false, error: '流入経路名を入力してください' };
  if (name.length > MAX_NAME) return { ok: false, error: `流入経路名は${MAX_NAME}文字までです` };

  const qrText = optStr(b.qrText);
  if (qrText && Array.from(qrText).length > MAX_QR_TEXT) return { ok: false, error: `QRコード表示用テキストは${MAX_QR_TEXT}文字までです` };

  // 有効期間: 日付と時刻の両方。開始だけ・終了だけは可。同じ日時・終了が開始より前は不可
  const validFrom = optStr(b.validFrom);
  const validTo = optStr(b.validTo);
  for (const [label, v] of [['開始', validFrom], ['終了', validTo]] as const) {
    if (v && (!DATETIME.test(v) || !isRealDateTime(v))) return { ok: false, error: `有効期間(${label})は、日付と時刻の両方を入力してください` };
  }
  if (validFrom && validTo) {
    if (periodMs(validFrom) === periodMs(validTo)) return { ok: false, error: '有効期間の開始と終了を、同じ日時にはできません' };
    if (periodMs(validTo) < periodMs(validFrom)) return { ok: false, error: '有効期間の終了は、開始より後の日時にしてください' };
  }
  const outMsg = optStr(b.outOfPeriodMessage);
  if (outMsg && outMsg.length > 500) return { ok: false, error: '有効期間外メッセージは500文字までです' };

  let actions;
  try {
    actions = parseFriendAddActions(b.actions ?? []);
  } catch (e) {
    if (e instanceof FriendAddSettingError) return { ok: false, error: e.message };
    throw e;
  }
  const scenarioId = optStr(b.scenarioId);
  const hasActions = actions.length > 0 || !!scenarioId;
  // アクションが未設定のときは、自動的に「無視しない」
  const ignore = hasActions && b.ignoreFriendAddSettings === true;

  const actionMode = b.actionMode === 'always' ? 'always' : 'first';
  const adImportMode = b.adImportMode === 'first' ? 'first' : 'always';
  if (opts.isCreate) {
    if (b.actionMode !== undefined && b.actionMode !== 'always' && b.actionMode !== 'first') return { ok: false, error: 'アクションの実行は、「いつでも」か「初回の友だち追加時のみ」を選んでください' };
  }

  // 広告パラメータ → 友だち情報欄
  let adParamMap: string | null = null;
  if (b.adParamMap !== undefined && b.adParamMap !== null) {
    if (!Array.isArray(b.adParamMap)) return { ok: false, error: '広告パラメータの形が正しくありません' };
    if (b.adParamMap.length > MAX_AD_PARAMS) return { ok: false, error: `広告パラメータは${MAX_AD_PARAMS}個までです` };
    const rows: Array<{ param: string; fieldKey: string }> = [];
    const seen = new Set<string>();
    for (const raw of b.adParamMap as Array<{ param?: unknown; fieldKey?: unknown }>) {
      const param = typeof raw?.param === 'string' ? raw.param.trim() : '';
      const fieldKey = typeof raw?.fieldKey === 'string' ? raw.fieldKey.trim() : '';
      if (!param && !fieldKey) continue; // 空の行は、保存しない
      if (!param || !fieldKey) return { ok: false, error: '広告パラメータは、パラメータ名と友だち情報の両方を入力してください' };
      if (!PARAM_NAME.test(param)) return { ok: false, error: `パラメータ名「${param}」は、英数字・「_」「-」「.」で入力してください` };
      if (seen.has(param)) return { ok: false, error: `パラメータ名「${param}」が重複しています` };
      seen.add(param);
      rows.push({ param, fieldKey });
    }
    adParamMap = rows.length > 0 ? JSON.stringify(rows) : null;
  }

  const htmlHead = optStr(b.htmlHead);
  const htmlBody = optStr(b.htmlBody);
  if ((htmlHead && htmlHead.length > MAX_HTML) || (htmlBody && htmlBody.length > MAX_HTML)) return { ok: false, error: `HTMLタグは、それぞれ${MAX_HTML.toLocaleString('ja-JP')}文字までです` };

  // 位置情報: 緯度・経度・半径の3つがそろったときだけ
  const geo = [b.geoLat, b.geoLng, b.geoRadius].map((v) => (v === undefined || v === null || v === '' ? null : Number(v)));
  const anyGeo = geo.some((v) => v !== null);
  let geoLat: number | null = null;
  let geoLng: number | null = null;
  let geoRadius: number | null = null;
  if (anyGeo) {
    if (geo.some((v) => v === null || Number.isNaN(v))) return { ok: false, error: '位置情報は、緯度・経度・有効範囲(半径)をすべて入力してください' };
    [geoLat, geoLng, geoRadius] = geo as number[];
    if (geoLat! < -90 || geoLat! > 90) return { ok: false, error: '緯度は、-90〜90の範囲で入力してください' };
    if (geoLng! < -180 || geoLng! > 180) return { ok: false, error: '経度は、-180〜180の範囲で入力してください' };
    if (!Number.isInteger(geoRadius) || geoRadius! < 5 || geoRadius! > 1000) return { ok: false, error: '有効範囲(半径)は、5m〜1000mの整数で入力してください' };
  }

  return {
    ok: true,
    value: {
      name,
      folderId: optStr(b.folderId),
      qrText,
      validFrom,
      validTo,
      outOfPeriodMessage: outMsg,
      actions: JSON.stringify(actions),
      scenarioId,
      ignoreFriendAddSettings: ignore,
      actionMode,
      adImportMode,
      adParamMap,
      htmlHead,
      htmlBody,
      geoLat,
      geoLng,
      geoRadius,
    },
  };
}

/** いまが有効期間の中か。{ok:false} のとき、「まだ」か「すぎた」か */
export function checkPeriod(route: { valid_from: string | null; valid_to: string | null }, nowMs: number): { ok: true } | { ok: false; reason: 'before' | 'after' } {
  if (route.valid_from && nowMs < periodMs(route.valid_from)) return { ok: false, reason: 'before' };
  if (route.valid_to && nowMs >= periodMs(route.valid_to)) return { ok: false, reason: 'after' };
  return { ok: true };
}

/** 2点間の距離(m)。位置情報の有効範囲の判定に使う */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** 流入経路の ref コード(英数字6文字)を作る */
export function generateRefCode(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = random(6);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/** 検索ボックスに、流入経路のURLが貼られたときに、ref コードを取り出す(/r/<ref> か lp=<ref>) */
export function refCodeFromSearch(q: string): string | null {
  const s = q.trim();
  const m = s.match(/\/r\/([A-Za-z0-9_-]+)/) ?? s.match(/[?&]lp=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}
