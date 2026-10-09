// iPad など画面が広い端末で、画面の中身を「読みやすい幅」にそろえるための判断。
// iPhone(幅 700 未満)は、これまでどおり画面いっぱい。

/** これ以上の幅で、中身の幅を制限する(iPhone は最大でも約 430。iPad mini の縦が 744) */
export const WIDE_SCREEN_MIN = 700;
/** 中身の最大幅(トークの吹き出しや一覧が、横に伸びすぎない) */
export const CONTENT_MAX_WIDTH = 860;

/** 画面の幅から、中身の最大幅を返す(制限しないときは null) */
export function contentMaxWidth(windowWidth: number): number | null {
  return windowWidth >= WIDE_SCREEN_MIN ? CONTENT_MAX_WIDTH : null;
}
