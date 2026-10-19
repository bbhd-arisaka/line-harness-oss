import type { LandingStyle } from '../lib/inflow';

// 流入経路の登録・編集の途中の「友だち追加ページのデザイン」。デザインの画面(別画面)で編集し、戻ったときに、登録・編集の画面が受け取る。
let draft: LandingStyle = {};

export function getLandingDraft(): LandingStyle {
  return draft;
}

export function setLandingDraft(style: LandingStyle): void {
  draft = style;
}
