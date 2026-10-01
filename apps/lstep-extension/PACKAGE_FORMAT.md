# Lステップ引き継ぎ: 収集パッケージの形(拡張機能 → beyond line 画面)

拡張機能(`apps/lstep-extension/`)が Lステップから集めて拡張機能内に保存するデータと、
beyond line の画面(`apps/web/src/lib/lstep-migrate/`)がそれを読んで引き継ぎデータに変換する処理の、約束事。
どちらも、この形に従う。形を変えるときは、この文書を先に直す。

過去に大門浜松町店で成功したスクリプトの移植元は
`C:\Users\ありぼう\OneDrive\Desktop\beyond beauty holding株式会社\事業管理\beyond line\引き継ぎツール\`
(match2.cjs / build-dataset.cjs / forms-map.cjs / forms-build.cjs / messages-build.cjs / browser-snippets.md / README.md)。
手順の背景は同フォルダの `..\引き継ぎ手順書.md`。

## LstepPackage(1アカウント = 1パッケージ)

```ts
interface LstepPackage {
  version: 1;
  collectedAt: string;            // ISO
  lstepHost: string;              // 'manager.linestep.net'
  accountName: string;            // Lステップの画面右上のアカウント名 例: 'エクラブロウ 大門浜松町店'
  /** 友だちリスト(有効な友だちだけ。ブロック済みは出ない)。キー=Lステップの友だちID */
  list: Record<string, { name: string; pic: string | null; row: string }>;
  /** GET /api/member/data/<id>?ui_type=1 の応答そのまま。キー=友だちID */
  members: Record<string, LstepMember>;
  /** CSVエクスポートを Shift-JIS から文字列にして、CSVとして行×列に分けたもの(先頭行・見出し行も含む、加工しない) */
  csvRows: string[][];
  /** 友だち情報欄の定義: フォルダごとに、表の各行の innerText(空白を1つにまとめたもの) */
  fieldDefs: Array<{ folder: string; gid: string | null; rows: string[] }>;
  /** タグの定義(同上) */
  tagDefs: Array<{ folder: string; gid: string | null; rows: string[] }>;
  /** 回答フォーム。csvRows は /lvf/export/<id> を Shift-JIS で文字列にして分けたもの(先頭が見出し行) */
  forms: Array<{ lid: string; name: string; folder: string | null; csvRows: string[][] }>;
  /** トーク履歴: GET /api/member/messages/<id>?ui_type=1(&all_table=1&ptime=…) の応答を、ページ順に並べた配列。キー=友だちID */
  messages: Record<string, unknown[]>;
  /** 収集中の注意点(失敗したID、取れなかった項目など) */
  warnings: string[];
}
interface LstepMember {
  created_at: string; memo: string | null;
  tags: Array<{ name: string }>;
  uid: string | null;             // 常に null(LINEのユーザーIDは出ない)
  vars: Array<{ id: number; name: string; value: unknown; group: number; type: number; encoded_choice_label?: string }>;
}
```

CSV(csvRows): 0行目はタイトル行、1行目が見出し(`ID, 表示名, LINE登録名, 本名, システム表示名, ステータスメッセージ, 個別メモ, 友だち追加日時, 対応マーク, 表示状態, ユーザーブロック, …`)、2行目以降がデータ。
フォームCSV: 0行目が見出し。列0=回答ID, 列1=回答日時, 列2=回答者ID(=友だちID), 列3=回答者名, 列4以降が質問。

## 画面側の出力(既存の取り込みAPIが受け取る形)

`apps/worker/src/services/lstep-import.ts` の `validate*` が受け取る形(dataset: `source:'lstep', accountId, folders, fields, tags, friends[], forms:{configs,submissions}, messages[]`)。
既存のスクリプトが作っていたものと同じ。
