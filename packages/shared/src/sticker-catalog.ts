/**
 * LINE公式アカウントから送れるスタンプ(Messaging API の「Sticker definitions」。2026-10-20 に取り込み)。
 * スタンプIDは、各パッケージの中で連番。パッケージID・先頭のID・個数だけ持つ。
 * 画像は LINE の配信サーバー(stickershop.line-scdn.net)から直接読む。
 */
export interface StickerPackage {
  packageId: string;
  title: string;
  firstId: number;
  count: number;
}

export const STICKER_PACKAGES: StickerPackage[] = [
  { packageId: '11537', title: '動くブラウン＆コニー＆サリー スペシャル', firstId: 52002734, count: 40 },
  { packageId: '11538', title: '動くチョコ＆LINEキャラ スペシャル', firstId: 51626494, count: 40 },
  { packageId: '11539', title: 'コニバースター812 スペシャル', firstId: 52114110, count: 40 },
  { packageId: '446', title: 'ムーン スペシャル', firstId: 1988, count: 40 },
  { packageId: '789', title: 'サリー スペシャル', firstId: 10855, count: 40 },
  { packageId: '1070', title: 'ムーン スペシャル 2', firstId: 17839, count: 40 },
  { packageId: '6136', title: '謝罪のプロ！LINEキャラクターズ', firstId: 10551376, count: 24 },
  { packageId: '6325', title: 'ちっちゃいブラコニ', firstId: 10979904, count: 24 },
  { packageId: '6359', title: 'ちっちゃいブラコニ 2', firstId: 11069848, count: 24 },
  { packageId: '6362', title: 'ちっちゃいブラコニ 3', firstId: 11087920, count: 24 },
  { packageId: '6370', title: 'ちっちゃいブラコニ 4', firstId: 11088016, count: 24 },
  { packageId: '6632', title: 'LINEキャラクターズ スペシャル', firstId: 11825374, count: 24 },
  { packageId: '8515', title: 'ゆる敬語★LINEキャラクターズ', firstId: 16581242, count: 24 },
  { packageId: '8522', title: 'LINEキャラクターズ 敬語', firstId: 16581290, count: 24 },
  { packageId: '8525', title: 'LINEキャラクターズ ゆる', firstId: 16581266, count: 24 },
];

export function stickerIdsOf(pkg: StickerPackage): string[] {
  return Array.from({ length: pkg.count }, (_, i) => String(pkg.firstId + i));
}

/** スタンプの画像URL(静止画) */
export function stickerImageUrl(stickerId: string): string {
  return `https://stickershop.line-scdn.net/stickershop/v1/sticker/${encodeURIComponent(stickerId)}/android/sticker.png`;
}
