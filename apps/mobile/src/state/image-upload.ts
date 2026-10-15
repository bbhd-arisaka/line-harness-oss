import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { api } from './services';

/**
 * 写真アプリから1枚選び、配信に使える大きさに小さくして(JPEG・横1440px・1MB未満)、アップロードする。
 * LINE の画像メッセージは、プレビュー画像が1MB以下・JPEG/PNG・https が条件。
 * 戻り値: アップロードした画像のURL。選ぶのをやめたときは null。失敗したときは例外(日本語の理由つき)。
 */
export async function pickAndUploadImage(): Promise<string | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false, quality: 1 });
  if (picked.canceled || !picked.assets?.[0]) return null;
  const asset = picked.assets[0];

  // 大きい写真は縮める。1MBを超えたら、画質を下げて、もう一度
  const targetWidth = asset.width && asset.width > 1440 ? 1440 : undefined;
  let base64: string | null = null;
  for (const compress of [0.75, 0.55, 0.4]) {
    const out = await manipulateAsync(asset.uri, targetWidth ? [{ resize: { width: targetWidth } }] : [], {
      compress,
      format: SaveFormat.JPEG,
      base64: true,
    });
    base64 = out.base64 ?? null;
    // base64 の文字数 × 3/4 ≒ 実際の大きさ。900KB 未満なら採用
    if (base64 && (base64.length * 3) / 4 < 900 * 1024) break;
  }
  if (!base64) throw new Error('画像を読み込めませんでした');
  if ((base64.length * 3) / 4 >= 1024 * 1024) throw new Error('画像が大きすぎます。別の写真を選んでください');

  const up = await api.uploadImage(base64, 'image/jpeg', `broadcast-${Date.now()}.jpg`);
  if (!up.url?.startsWith('https://')) throw new Error('画像のアップロード先が正しくありません');
  return up.url;
}
