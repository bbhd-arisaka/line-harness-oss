// 回答フォーム編集画面(Lステップ準拠)で使う型と、API とのデータ変換。

export type FieldType =
  | 'text' | 'email' | 'tel' | 'number' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'date'
  | 'prefecture' | 'file' | 'heading' | 'subheading' | 'paragraph' | 'image' | 'button'

/** 「+ブロックを追加」メニュー(Lステップと同じ並び・名称)。空文字の label は区切り線。 */
export const BLOCK_MENU: Array<{ type: FieldType | 'divider'; label: string }> = [
  { type: 'image', label: '画像' },
  { type: 'heading', label: '見出し' },
  { type: 'paragraph', label: 'テキスト' },
  { type: 'button', label: 'ボタン' },
  { type: 'divider', label: '' },
  { type: 'text', label: '単一行入力' },
  { type: 'textarea', label: '複数行入力' },
  { type: 'radio', label: 'ラジオ ボタン' },
  { type: 'checkbox', label: 'チェック ボックス' },
  { type: 'select', label: 'プルダウン' },
  { type: 'file', label: 'ファイル' },
  { type: 'date', label: '日付' },
  { type: 'prefecture', label: '都道府県' },
]

/** カード左に出す種別名(改行入り)。 */
export const BLOCK_TYPE_LABEL: Record<FieldType, string> = {
  text: '単一行\n入力', email: '単一行\n入力', tel: '単一行\n入力', number: '単一行\n入力',
  textarea: '複数行\n入力', radio: 'ラジオ\nボタン', checkbox: 'チェック\nボックス', select: 'プルダウン',
  file: 'ファイル', date: '日付', prefecture: '都道府県',
  heading: '見出し', subheading: '小見出し', paragraph: 'テキスト', image: '画像', button: 'ボタン',
}

/** 「タイプ」プルダウン(単一行入力のサブ種別)。 */
export const TEXT_SUBTYPES: Array<{ value: FieldType; label: string }> = [
  { value: 'text', label: '単一行' },
  { value: 'email', label: 'メールアドレス' },
  { value: 'tel', label: '電話番号' },
  { value: 'number', label: '数値' },
]

export const OPTION_TYPES: FieldType[] = ['select', 'radio', 'checkbox']
export const DISPLAY_ONLY_TYPES: FieldType[] = ['heading', 'subheading', 'paragraph', 'image', 'button']
/** 「回答の登録先(複数可)」を設定できる項目タイプ(単一値の入力系)。 */
export const REGISTRATION_TARGET_TYPES: FieldType[] = ['text', 'email', 'tel', 'number', 'textarea', 'date', 'prefecture', 'select']
/** 選択時の動作(タグ追加・友だち情報への値書き込み)を選択肢ごとに設定できるタイプ。 */
export const CHOICE_ACTION_TYPES: FieldType[] = ['radio', 'checkbox']
/** 「説明文/初期値/プレースホルダ/入力制限」を持てる入力タイプ。 */
export const TEXT_INPUT_TYPES: FieldType[] = ['text', 'email', 'tel', 'number', 'textarea']

export type RegistrationTarget =
  | { type: 'real_name' }
  | { type: 'display_name' }
  | { type: 'memo' }
  | { type: 'friend_field'; fieldKey: string }

export function targetKey(t: RegistrationTarget): string {
  return t.type === 'friend_field' ? `friend_field:${t.fieldKey}` : t.type
}

let rowSeq = 0
export const nextRowId = () => rowSeq++

export interface BlockDraft {
  rowId: number
  /** 0 = 共通ヘッダ、1以降 = セクション番号 */
  section: number
  name: string
  type: FieldType
  label: string
  required: boolean
  hidden: boolean
  description: string
  defaultValue: string
  placeholder: string
  maxLength: string
  /** 説明文/初期値/プレースホルダ/入力制限のどれを画面で開いているか(値が入っていれば読み込み時に開く) */
  open: { description: boolean; defaultValue: boolean; placeholder: boolean; maxLength: boolean }
  options: string[]
  registrationTargets: RegistrationTarget[]
  friendFieldKey: string
  optionTagIds: Record<string, string[]>
  optionFriendFieldValues: Record<string, string>
  imageUrl: string
  buttonUrl: string
}

export function newBlock(type: FieldType, section: number): BlockDraft {
  return {
    rowId: nextRowId(),
    section,
    name: '',
    type,
    label: '',
    required: false,
    hidden: false,
    description: '',
    defaultValue: '',
    placeholder: '',
    maxLength: '',
    open: { description: false, defaultValue: false, placeholder: false, maxLength: false },
    options: OPTION_TYPES.includes(type) ? ['', ''] : [],
    registrationTargets: [],
    friendFieldKey: '',
    optionTagIds: {},
    optionFriendFieldValues: {},
    imageUrl: '',
    buttonUrl: '',
  }
}

export function duplicateBlock(b: BlockDraft): BlockDraft {
  return {
    ...b,
    rowId: nextRowId(),
    name: '',
    open: { ...b.open },
    options: [...b.options],
    registrationTargets: b.registrationTargets.map((t) => ({ ...t })),
    optionTagIds: JSON.parse(JSON.stringify(b.optionTagIds)),
    optionFriendFieldValues: { ...b.optionFriendFieldValues },
  }
}

/** API から返る 1 項目(保存済みの fields JSON の要素)。 */
export interface ApiField {
  name: string
  label: string
  type?: FieldType
  required?: boolean
  options?: string[]
  registrationTargets?: RegistrationTarget[]
  friendFieldKey?: string
  optionTags?: Record<string, string[]>
  optionFriendFieldValues?: Record<string, string>
  imageUrl?: string
  buttonLabel?: string
  buttonUrl?: string
  section?: number
  description?: string
  defaultValue?: string
  placeholder?: string
  maxLength?: number
  hidden?: boolean
}

export function blockFromApi(f: ApiField): BlockDraft {
  return {
    rowId: nextRowId(),
    section: typeof f.section === 'number' ? f.section : 1,
    name: f.name,
    type: (f.type as FieldType) ?? 'text',
    label: f.label,
    required: Boolean(f.required),
    hidden: Boolean(f.hidden),
    description: f.description ?? '',
    defaultValue: f.defaultValue ?? '',
    placeholder: f.placeholder ?? '',
    maxLength: f.maxLength ? String(f.maxLength) : '',
    open: {
      description: Boolean(f.description),
      defaultValue: Boolean(f.defaultValue),
      placeholder: Boolean(f.placeholder),
      maxLength: Boolean(f.maxLength),
    },
    options: f.options ?? [],
    registrationTargets: f.registrationTargets ?? [],
    friendFieldKey: f.friendFieldKey ?? '',
    optionTagIds: f.optionTags ?? {},
    optionFriendFieldValues: f.optionFriendFieldValues ?? {},
    imageUrl: f.imageUrl ?? '',
    buttonUrl: f.buttonUrl ?? '',
  }
}

function slugify(label: string, index: number): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9ぁ-んァ-ヶー一-龯]+/gi, '_')
    .replace(/^_+|_+$/g, '')
  return slug || `field_${index + 1}`
}

/** 保存用の fields 配列。共通ヘッダ → セクション順に並べ、既存の name(回答データのキー)は維持する。 */
export function blocksToApi(blocks: BlockDraft[]): ApiField[] {
  const ordered = [...blocks].sort((a, b) => a.section - b.section)
  const used = new Set<string>()
  return ordered.map((b, i) => {
    let name = b.name.trim() || slugify(b.label, i)
    while (used.has(name)) name = `${name}_${i + 1}`
    used.add(name)
    const f: ApiField = { name, label: b.label.trim(), type: b.type, required: b.required, section: b.section }
    if (b.hidden) f.hidden = true
    if (OPTION_TYPES.includes(b.type)) f.options = b.options.map((o) => o.trim()).filter(Boolean)
    if (REGISTRATION_TARGET_TYPES.includes(b.type) && b.registrationTargets.length > 0) f.registrationTargets = b.registrationTargets
    if (CHOICE_ACTION_TYPES.includes(b.type)) {
      if (b.friendFieldKey) f.friendFieldKey = b.friendFieldKey
      if (Object.keys(b.optionTagIds).length > 0) f.optionTags = b.optionTagIds
      if (Object.keys(b.optionFriendFieldValues).length > 0) f.optionFriendFieldValues = b.optionFriendFieldValues
    }
    if (b.type === 'image') f.imageUrl = b.imageUrl.trim() || undefined
    if (b.type === 'button') { f.buttonLabel = b.label.trim(); f.buttonUrl = b.buttonUrl.trim() || undefined }
    if (!DISPLAY_ONLY_TYPES.includes(b.type)) {
      if (b.open.description && b.description.trim()) f.description = b.description.trim()
      if (b.open.defaultValue && b.defaultValue) f.defaultValue = b.defaultValue
      if (b.open.placeholder && b.placeholder.trim()) f.placeholder = b.placeholder.trim()
      if (b.open.maxLength && Number(b.maxLength) > 0) f.maxLength = Number(b.maxLength)
    }
    return f
  })
}

/** 「オプション設定」「デザイン設定」のうち、フォーム本体の専用カラムを持たない項目。 */
export interface LstepOptions {
  pageTitle?: string
  submitLabel?: string
  nextLabel?: string
  buttonStyle?: 'default' | 'rounded' | 'square'
  buttonColor?: string
  sectionHeaderStyle?: 'page-number' | 'progress' | 'none'
  confirmDialog?: boolean
  startsAt?: string | null
  backgroundImageOpacity?: number
  thanksText?: string
}

export interface FormDraft {
  name: string
  folderId: string
  blocks: BlockDraft[]
  sectionCount: number
  // オプション設定
  googleSheetsEnabled: boolean
  googleSheetUrl: string
  googleSheetName: string
  onSubmitTagId: string
  onSubmitScenarioId: string
  onSubmitStopScenarios: boolean
  thanksUrl: string
  restorePreviousAnswer: boolean
  expiresAt: string
  capacityLimit: string
  answerLimitPerFriend: 'unlimited' | 'once'
  lstep: LstepOptions
  // デザイン設定
  themeMainColor: string
  themeSubColor: string
  primaryColor: string
  themeErrorColor: string
  themeTextColor: string
  backgroundColor: string
  formBackgroundColor: string
  backgroundImageUrl: string
  headerImageUrl: string
  themeFont: string
  customCssEnabled: boolean
  customCss: string
}

export function emptyDraft(folderId: string): FormDraft {
  return {
    name: '名称未設定',
    folderId,
    blocks: [],
    sectionCount: 1,
    googleSheetsEnabled: false,
    googleSheetUrl: '',
    googleSheetName: '',
    onSubmitTagId: '',
    onSubmitScenarioId: '',
    onSubmitStopScenarios: false,
    thanksUrl: '',
    restorePreviousAnswer: false,
    expiresAt: '',
    capacityLimit: '',
    answerLimitPerFriend: 'unlimited',
    lstep: {},
    themeMainColor: '',
    themeSubColor: '',
    primaryColor: '',
    themeErrorColor: '',
    themeTextColor: '',
    backgroundColor: '',
    formBackgroundColor: '',
    backgroundImageUrl: '',
    headerImageUrl: '',
    themeFont: '',
    customCssEnabled: false,
    customCss: '',
  }
}

/** API のフォーム1件 → 編集用ドラフト。 */
export function draftFromApi(form: Record<string, unknown>): FormDraft {
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const rawFields = form.fields
  const fields = (typeof rawFields === 'string' ? JSON.parse(rawFields) : rawFields) as ApiField[] | undefined
  const blocks = (fields ?? []).map(blockFromApi)
  const sectionCount = Math.max(1, ...blocks.map((b) => b.section))
  const lstep = ((form.lstepOptions as LstepOptions | null) ?? {}) as LstepOptions
  const expires = str(form.expiresAt)
  return {
    ...emptyDraft(str(form.folderId)),
    name: str(form.name),
    blocks,
    sectionCount,
    googleSheetsEnabled: Boolean(form.googleSheetsEnabled),
    googleSheetUrl: str(form.googleSheetUrl),
    googleSheetName: str(form.googleSheetName),
    onSubmitTagId: str(form.onSubmitTagId),
    onSubmitScenarioId: str(form.onSubmitScenarioId),
    onSubmitStopScenarios: Boolean(form.onSubmitStopScenarios),
    thanksUrl: str(form.thanksUrl),
    restorePreviousAnswer: Boolean(form.restorePreviousAnswer),
    expiresAt: expires ? expires.slice(0, 16) : '',
    capacityLimit: form.capacityLimit != null ? String(form.capacityLimit) : '',
    answerLimitPerFriend: form.answerLimitPerFriend === 'once' ? 'once' : 'unlimited',
    lstep,
    themeMainColor: str(form.themeMainColor),
    themeSubColor: str(form.themeSubColor),
    primaryColor: str(form.primaryColor),
    themeErrorColor: str(form.themeErrorColor),
    themeTextColor: str(form.themeTextColor),
    backgroundColor: str(form.backgroundColor),
    formBackgroundColor: str(form.formBackgroundColor),
    backgroundImageUrl: str(form.backgroundImageUrl),
    headerImageUrl: str(form.headerImageUrl),
    themeFont: str(form.themeFont),
    customCssEnabled: Boolean(form.customCssEnabled),
    customCss: str(form.customCss),
  }
}

export function draftToPayload(d: FormDraft) {
  const designUsed = Boolean(
    d.themeMainColor || d.themeSubColor || d.primaryColor || d.themeErrorColor || d.themeTextColor ||
    d.backgroundColor || d.formBackgroundColor || d.backgroundImageUrl || d.headerImageUrl || d.themeFont || d.customCssEnabled,
  )
  const nz = (v: string) => v.trim() || null
  return {
    name: d.name.trim(),
    folderId: d.folderId || null,
    fields: blocksToApi(d.blocks),
    onSubmitTagId: d.onSubmitTagId || null,
    onSubmitScenarioId: d.onSubmitScenarioId || null,
    onSubmitStopScenarios: d.onSubmitStopScenarios,
    thanksUrl: nz(d.thanksUrl),
    restorePreviousAnswer: d.restorePreviousAnswer,
    expiresAt: d.expiresAt ? `${d.expiresAt}:00` : null,
    capacityLimit: d.capacityLimit.trim() ? Number(d.capacityLimit) : null,
    answerLimitPerFriend: d.answerLimitPerFriend,
    googleSheetsEnabled: d.googleSheetsEnabled,
    googleSheetUrl: nz(d.googleSheetUrl),
    googleSheetName: nz(d.googleSheetName),
    customDesignEnabled: designUsed,
    themeMainColor: nz(d.themeMainColor),
    themeSubColor: nz(d.themeSubColor),
    primaryColor: nz(d.primaryColor),
    themeErrorColor: nz(d.themeErrorColor),
    themeTextColor: nz(d.themeTextColor),
    backgroundColor: nz(d.backgroundColor),
    formBackgroundColor: nz(d.formBackgroundColor),
    backgroundImageUrl: nz(d.backgroundImageUrl),
    headerImageUrl: nz(d.headerImageUrl),
    themeFont: nz(d.themeFont),
    customCssEnabled: d.customCssEnabled,
    customCss: nz(d.customCss),
    lstepOptions: d.lstep,
  }
}
