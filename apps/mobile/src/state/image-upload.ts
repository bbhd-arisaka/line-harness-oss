import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { getInfoAsync, uploadAsync, FileSystemUploadType, FileSystemSessionType } from 'expo-file-system/legacy';
import { api, authStore } from './services';
import { ApiError } from '../lib/api';
import { toJapaneseError } from '../lib/errors';
import { appVersionHeaders } from '../lib/app-update';
import Constants from 'expo-constants';

/** 失敗した段階が分かるように、段階ごとの日本語の理由にする(画面に出る文言から、どこで失敗したか分かる) */
function stepError(step: string, e: unknown): Error {
  const detail = e instanceof Error ? e.message : String(e);
  return new Error(`${step}(${detail.replace(/\s+/g, ' ').slice(0, 80)})`);
}

function errDetail(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 70);
}

/** ネイティブの送信で、画像ファイルを /api/images へ。サーバーの返事(JSON)から URL を取り出す */
async function uploadNative(uri: string): Promise<string> {
  const token = authStore.getToken();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'image/jpeg',
    ...appVersionHeaders(Constants.expoConfig?.version, Constants.nativeBuildVersion),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await uploadAsync(`${api.baseUrl}/api/images`, uri, {
    httpMethod: 'POST',
    uploadType: FileSystemUploadType.BINARY_CONTENT,
    sessionType: FileSystemSessionType.FOREGROUND,
    headers,
  }).catch((e: unknown) => {
    throw new ApiError(`通信できませんでした。電波の良い場所でもう一度お試しください(${errDetail(e)})`, 0);
  });
  let json: { success?: boolean; data?: { url?: string }; error?: string } | null = null;
  try {
    json = JSON.parse(res.body);
  } catch {
    json = null;
  }
  if (res.status === 401) {
    void authStore.handleUnauthorized();
  }
  if (res.status < 200 || res.status >= 300 || !json || json.success === false || !json.data?.url) {
    throw new ApiError(toJapaneseError(json?.error, res.status), res.status);
  }
  return json.data.url;
}

/**
 * 写真アプリから1枚選び、送る大きさに小さくして(JPEG・横1280px・700KB未満)、アップロードする。
 * LINE の画像メッセージは、プレビュー画像が1MB以下・JPEG/PNG・https が条件。
 * アップロードは、画像のバイナリをそのまま送る(base64 の JSON より小さく、通信が失敗しにくい)。通信の失敗は、1回だけやり直す。
 * 戻り値: アップロードした画像のURL。選ぶのをやめたときは null。失敗したときは例外(失敗した段階を含む日本語の理由)。
 */
export async function pickAndUploadImage(): Promise<string | null> {
  let asset: ImagePicker.ImagePickerAsset;
  try {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false, quality: 1 });
    if (picked.canceled || !picked.assets?.[0]) return null;
    asset = picked.assets[0];
  } catch (e) {
    throw stepError('写真を開けませんでした', e);
  }

  // 大きい写真は縮める。大きすぎたら、画質を下げて、もう一度
  const targetWidth = asset.width && asset.width > 1280 ? 1280 : undefined;
  let uri: string | null = null;
  let size = Infinity;
  try {
    for (const compress of [0.7, 0.5, 0.35]) {
      const out = await manipulateAsync(asset.uri, targetWidth ? [{ resize: { width: targetWidth } }] : [], { compress, format: SaveFormat.JPEG });
      uri = out.uri;
      const info = await getInfoAsync(out.uri);
      size = info.exists && typeof info.size === 'number' ? info.size : (await (await fetch(out.uri)).blob()).size;
      if (size < 700 * 1024) break;
    }
  } catch (e) {
    throw stepError('写真を小さくできませんでした', e);
  }
  if (!uri) throw new Error('写真を小さくできませんでした');
  if (size >= 1024 * 1024) throw new Error('画像が大きすぎます。別の写真を選んでください');

  // 端末のネイティブの送信で、ファイルをそのままアップロードする(RN の fetch + Blob は、iPhone で通信エラーになることがあるため)。
  // 送れなかったら、従来の fetch で1回だけやり直す
  let url: string | undefined;
  try {
    url = await uploadNative(uri);
  } catch (nativeErr) {
    if (nativeErr instanceof ApiError && nativeErr.status !== 0) throw nativeErr;
    let blob: Blob;
    try {
      blob = await (await fetch(uri)).blob();
    } catch (e) {
      throw stepError('写真を読み込めませんでした', e);
    }
    try {
      url = (await api.uploadImageBinary(blob, 'image/jpeg')).url;
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        throw new ApiError(`${e.message}(アップロード: ${errDetail(nativeErr)} / ${errDetail(e)})`.slice(0, 220), 0);
      }
      throw e;
    }
  }
  if (!url?.startsWith('https://')) throw new Error('画像のアップロード先が正しくありません');
  return url;
}
