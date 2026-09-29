/** 友だち情報欄の種別(Lステップの「種別」に合わせた名称・説明)。 */
export type FriendFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'datetime'
  | 'image'
  | 'pdf'
  | 'select'
  | 'radio'
  | 'checkbox'

/** 登録画面で選べる種別(Lステップと同じ7種、この並び順)。 */
export const REGISTRABLE_FIELD_TYPES: Array<{
  value: FriendFieldType
  label: string
  description: string
}> = [
  { value: 'text', label: '標準', description: '友だちの名前やメールアドレスなど、短いテキスト情報を登録できます。' },
  { value: 'textarea', label: '長文', description: '志望動機やプロフィール文など、長いテキスト情報を登録できます。' },
  { value: 'image', label: '画像', description: '友だちから送信された画像を登録できます。' },
  { value: 'pdf', label: 'PDF', description: '履歴書や同意書など、PDFファイルを登録できます。' },
  { value: 'date', label: '年月日', description: '誕生日・最終来店日など、友だちごとに異なる日付を登録できます。' },
  { value: 'datetime', label: '日時', description: '来店日時など、時刻も含めた情報を登録できます。' },
  { value: 'select', label: '選択肢', description: '担当者や選考段階など、選択肢を作成して友だちに割り振れます。' },
]

/** 一覧の「種別」列の表示名。旧種別(数値・ラジオ・チェックボックス)も近い名称で表示する。 */
export const FIELD_TYPE_LABEL: Record<FriendFieldType, string> = {
  text: '標準',
  textarea: '長文',
  number: '標準',
  date: '年月日',
  datetime: '日時',
  image: '画像',
  pdf: 'PDF',
  select: '選択肢',
  radio: '選択肢',
  checkbox: '選択肢',
}

export const OPTION_FIELD_TYPES: FriendFieldType[] = ['select', 'radio', 'checkbox']

/** 選択肢のカラーパレット(「設定」で選べる色)。 */
export const OPTION_COLORS = [
  '#e5451f', '#f28c28', '#f2c700', '#7cc52e', '#069e04', '#1ab7a5',
  '#2b9bd8', '#2f62d0', '#7a4fd6', '#d24fa8', '#8a8a8e', '#414143',
]
