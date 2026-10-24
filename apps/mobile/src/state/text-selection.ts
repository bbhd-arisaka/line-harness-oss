/**
 * 範囲選択(メッセージの長押し)の「いま選んでいる1つ」を覚えておく置き場。
 * 選んでいる最中に、ほかの場所をタップ・スクロールしたら、選択をやめる(普通のLINEと同じ)ために使う。
 * 入力欄は、ほかの入力欄に移らない限り「フォーカスが外れた」とならないので、画面側から終了させる必要がある。
 */
interface Active {
  end: () => void;
  /** 選んでいる入力欄の view の番号(ここへのタップ=ハンドルの操作は、終了にしない) */
  tag: number | null;
  startedAt: number;
}

let active: Active | null = null;

/** 選び始めた。前に選んでいたものがあれば、先に終わらせる */
export function beginSelection(end: () => void, tag: number | null, now: number = Date.now()): void {
  if (active && active.end !== end) active.end();
  active = { end, tag, startedAt: now };
}

/** 自分の選択が終わった(自分が選択中のものだったときだけ、置き場を空にする) */
export function endSelectionOf(end: () => void): void {
  if (active?.end === end) active = null;
}

/** 選択の入力欄の番号が、あとから分かったとき */
export function setSelectionTag(end: () => void, tag: number | null): void {
  if (active?.end === end) active.tag = tag;
}

/**
 * 画面のどこかをタップ・スクロールし始めたときに呼ぶ。選択中なら終わらせる。
 * ただし、選んでいる入力欄そのもの(ハンドルをドラッグする操作)と、選び始めて間もない操作(長押しの指の離れ際)は、終わらせない。
 * 戻り値: 終わらせたか
 */
export function endActiveSelection(touchTarget?: number | null, now: number = Date.now()): boolean {
  if (!active) return false;
  if (touchTarget != null && active.tag != null && touchTarget === active.tag) return false;
  if (now - active.startedAt < 400) return false;
  const a = active;
  active = null;
  a.end();
  return true;
}
