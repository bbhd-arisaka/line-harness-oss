// 友だち追加の QR・URL まわりの、画面に依存しない部分。

/** サーバーから届いた QR(PNG の base64)を、画像として表示できる形にする */
export function qrDataUri(base64: string): string {
  return `data:image/png;base64,${base64}`;
}

/** 写真アプリに保存する画像のファイル名(アカウント名・ID から、ファイル名に使えない文字を除く) */
export function qrFileName(accountName: string, basicId: string): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|\s@]+/g, '').slice(0, 40);
  const name = safe(accountName) || 'line';
  const id = safe(basicId);
  return `友だち追加QR_${name}${id ? `_${id}` : ''}.png`;
}
