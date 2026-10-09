// iPad など画面が広い端末での、画面の使い方の判断。
// - iPhone(幅 700 未満): 画面いっぱい
// - iPad の縦など(幅 700〜899): 中身を「読みやすい幅」にして中央に置く
// - iPad の横など(幅 900 以上): トークは「左に一覧・右にチャット」の2列。それ以外の画面は読みやすい幅で中央

/** これ以上の幅で、中身の幅を制限する(iPhone は最大でも約 430。iPad mini の縦が 744) */
export const WIDE_SCREEN_MIN = 700;
/** 中身の最大幅(トークの吹き出しや一覧が、横に伸びすぎない) */
export const CONTENT_MAX_WIDTH = 860;
/** これ以上の幅で、トークを2列にする(iPad の横は 1024 以上。13インチの縦が 1032) */
export const SPLIT_MIN = 900;
/** 2列表示の、左の一覧の幅 */
export const LIST_PANE_WIDTH = 380;

/** 画面の幅から、中身の最大幅を返す(制限しないときは null) */
export function contentMaxWidth(windowWidth: number): number | null {
  return windowWidth >= WIDE_SCREEN_MIN ? CONTENT_MAX_WIDTH : null;
}

/** トークを「左に一覧・右にチャット」の2列にするか */
export function isSplitLayout(windowWidth: number): boolean {
  return windowWidth >= SPLIT_MIN;
}
