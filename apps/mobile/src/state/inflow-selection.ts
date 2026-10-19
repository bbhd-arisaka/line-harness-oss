// 友だち追加のQR・URL画面で、いま選んでいる流入経路(null=基本)。登録・編集の画面から戻ったとき、作った流入経路を選んだ状態にする。
let selected: string | null = null;

export function getSelectedInflow(): string | null {
  return selected;
}

export function setSelectedInflow(id: string | null): void {
  selected = id;
}
