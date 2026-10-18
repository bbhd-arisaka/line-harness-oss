import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { api } from './services';
import { ApiError } from '../lib/api';

/** 失敗した段階が分かるように、段階ごとの日本語の理由にする(画面に出る文言から、どこで失敗したか分かる) */
function stepError(step: string, e: unknown): Error {
  const detail = e instanceof Error ? e.message : String(e);
  return new Error(`${step}(${detail.replace(/\s+/g, ' ').slice(0, 80)})`);
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
      const blob = await (await fetch(out.uri)).blob();
      size = blob.size;
      if (size < 700 * 1024) break;
    }
  } catch (e) {
    throw stepError('写真を小さくできませんでした', e);
  }
  if (!uri) throw new Error('写真を小さくできませんでした');
  if (size >= 1024 * 1024) throw new Error('画像が大きすぎます。別の写真を選んでください');

  let blob: Blob;
  try {
    blob = await (await fetch(uri)).blob();
  } catch (e) {
    throw stepError('写真を読み込めませんでした', e);
  }

  let url: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      url = (await api.uploadImageBinary(blob, 'image/jpeg')).url;
      break;
    } catch (e) {
      // 通信そのものの失敗(HTTP の応答が無い)は、1回だけやり直す。サーバーが理由を返したものは、やり直さない
      const network = e instanceof ApiError && e.status === 0;
      if (!network || attempt === 1) throw e;
    }
  }
  if (!url?.startsWith('https://')) throw new Error('画像のアップロード先が正しくありません');
  return url;
}
