// 回答フォーム編集画面(Lステップ準拠)で使う型と、API とのデータ変換。

export type DateBound =
  | { mode: 'none' }
  | { mode: 'relative'; days: number }
  | { mode: 'fixed'; date: string }

export interface DateRule {
  start?: DateBound
  end?: DateBound
  weekdays?: number[]
  holiday?: 'ignore' | 'allow' | 'deny'
}

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
/** 「タイプ」プルダウンで相互に切り替えられる選択系ブロック */
export const CHOICE_TYPES: Array<{ value: FieldType; label: string }> = [
  { value: 'radio', label: 'ラジオボタン' },
  { value: 'checkbox', label: 'チェックボックス' },
  { value: 'select', label: 'プルダウン' },
]
export const DISPLAY_ONLY_TYPES: FieldType[] = ['heading', 'subheading', 'paragraph', 'image', 'button']
/** 「回答の登録先(複数可)」を設定できる項目タイプ(単一値の入力系)。 */
export const REGISTRATION_TARGET_TYPES: FieldType[] = ['text', 'email', 'tel', 'number', 'textarea', 'date', 'prefecture', 'select']
/** 選択時の動作(タグ追加・友だち情報への値書き込み)を選択肢ごとに設定できるタイプ。 */
export const CHOICE_ACTION_TYPES: FieldType[] = ['radio', 'checkbox', 'select']
/** 「友だち情報に登録」だけを持つ入力タイプ(本名・システム表示名・個別メモは出さない) */
export const FRIEND_FIELD_ONLY_TYPES: FieldType[] = ['date', 'prefecture', 'file']

/** 選択時の動作(Lステップの「タグ追加 / 友だち情報に登録 / アクション」) */
export type ChoiceMode = 'tag' | 'friend' | 'action'

export interface OptionAction {
  addTagIds: string[]
  removeTagIds: string[]
  scenarioId: string
}
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
  // 選択系ブロック
  choiceMode: ChoiceMode
  optionActions: Record<string, OptionAction>
  allowOther: boolean
  defaultOptions: string[]
  optionCapacity: Record<string, number>
  // 画像・ボタン・ファイル
  imageSize: 'small' | 'normal' | 'large'
  imageLinkUrl: string
  buttonStyle: 'default' | 'outline' | 'rounded'
  buttonColor: string
  fileKind: 'image' | 'pdf'
  // 日付ブロック
  dateFormat: 'calendar' | 'ymd'
  dateLimitOn: boolean
  dateRule: DateRule
  reminderOn: boolean
  reminderId: string
  reminderTime: string
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
    choiceMode: 'tag',
    optionActions: {},
    allowOther: false,
    defaultOptions: [],
    optionCapacity: {},
    imageSize: 'normal',
    imageLinkUrl: '',
    buttonStyle: 'default',
    buttonColor: '',
    fileKind: 'image',
    dateFormat: 'calendar',
    dateLimitOn: false,
    dateRule: {},
    reminderOn: false,
    reminderId: '',
    reminderTime: '12:00',
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
    optionActions: JSON.parse(JSON.stringify(b.optionActions)),
    defaultOptions: [...b.defaultOptions],
    optionCapacity: { ...b.optionCapacity },
    dateRule: JSON.parse(JSON.stringify(b.dateRule)),
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
  optionActions?: Record<string, OptionAction>
  allowOther?: boolean
  defaultOptions?: string[]
  optionCapacity?: Record<string, number>
  imageSize?: 'small' | 'normal' | 'large'
  imageLinkUrl?: string
  buttonStyle?: 'default' | 'outline' | 'rounded'
  buttonColor?: string
  fileKind?: 'image' | 'pdf'
  dateFormat?: 'calendar' | 'ymd'
  dateRule?: DateRule
  reminderId?: string
  reminderTime?: string
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
    choiceMode: f.friendFieldKey ? 'friend' : f.optionActions && Object.keys(f.optionActions).length > 0 ? 'action' : 'tag',
    optionActions: f.optionActions ?? {},
    allowOther: Boolean(f.allowOther),
    defaultOptions: f.defaultOptions ?? [],
    optionCapacity: f.optionCapacity ?? {},
    imageSize: f.imageSize ?? 'normal',
    imageLinkUrl: f.imageLinkUrl ?? '',
    buttonStyle: f.buttonStyle ?? 'default',
    buttonColor: f.buttonColor ?? '',
    fileKind: f.fileKind ?? 'image',
    dateFormat: f.dateFormat ?? 'calendar',
    dateLimitOn: Boolean(f.dateRule),
    dateRule: f.dateRule ?? {},
    reminderOn: Boolean(f.reminderId),
    reminderId: f.reminderId ?? '',
    reminderTime: f.reminderTime ?? '12:00',
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
    if ((REGISTRATION_TARGET_TYPES.includes(b.type) || b.type === 'file') && b.registrationTargets.length > 0) f.registrationTargets = b.registrationTargets
    if (CHOICE_ACTION_TYPES.includes(b.type)) {
      // 選択時の動作は、いま選んでいるモードの内容だけを保存する(切り替えて残った古い設定は捨てる)
      const names = new Set(b.options.map((o) => o.trim()).filter(Boolean))
      if (b.allowOther) names.add('その他')
      const only = <T,>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).filter(([k]) => names.has(k)))
      if (b.choiceMode === 'friend' && b.friendFieldKey) {
        f.friendFieldKey = b.friendFieldKey
        const vals = Object.fromEntries(Object.entries(only(b.optionFriendFieldValues)).filter(([, v]) => v !== ''))
        if (Object.keys(vals).length > 0) f.optionFriendFieldValues = vals
      }
      if (b.choiceMode === 'tag') {
        const tags = only(b.optionTagIds)
        if (Object.keys(tags).length > 0) f.optionTags = tags
      }
      if (b.choiceMode === 'action') {
        const acts = Object.fromEntries(
          Object.entries(only(b.optionActions)).filter(([, a]) => a.addTagIds.length || a.removeTagIds.length || a.scenarioId),
        )
        if (Object.keys(acts).length > 0) f.optionActions = acts
      }
      if (b.allowOther) f.allowOther = true
      const defs = b.defaultOptions.filter((o) => names.has(o))
      if (defs.length > 0) f.defaultOptions = defs
      const caps = only(b.optionCapacity)
      if (Object.keys(caps).length > 0) f.optionCapacity = caps
    }
    if (b.type === 'image') {
      f.imageUrl = b.imageUrl.trim() || undefined
      if (b.imageSize !== 'normal') f.imageSize = b.imageSize
      if (b.imageLinkUrl.trim()) f.imageLinkUrl = b.imageLinkUrl.trim()
    }
    if (b.type === 'button') {
      f.buttonLabel = b.label.trim()
      f.buttonUrl = b.buttonUrl.trim() || undefined
      if (b.buttonStyle !== 'default') f.buttonStyle = b.buttonStyle
      if (b.buttonColor) f.buttonColor = b.buttonColor
    }
    if (b.type === 'file' && b.fileKind !== 'image') f.fileKind = b.fileKind
    if (b.type === 'date') {
      if (b.dateFormat !== 'calendar') f.dateFormat = b.dateFormat
      if (b.dateLimitOn) {
        const r = b.dateRule
        const bound = (x?: DateBound) => (x && x.mode !== 'none' ? x : undefined)
        f.dateRule = {
          ...(bound(r.start) ? { start: bound(r.start) } : {}),
          ...(bound(r.end) ? { end: bound(r.end) } : {}),
          ...(r.weekdays && r.weekdays.length > 0 ? { weekdays: r.weekdays } : {}),
          ...(r.holiday && r.holiday !== 'ignore' ? { holiday: r.holiday } : {}),
        }
      }
      if (b.reminderOn && b.reminderId) { f.reminderId = b.reminderId; f.reminderTime = b.reminderTime }
    }
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
  answerMessage?: { mode: 'none' | 'summary' | 'custom'; title?: string }
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
  onSubmitMessageType: string
  onSubmitMessageContent: string
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
    onSubmitMessageType: '',
    onSubmitMessageContent: '',
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
    onSubmitMessageType: str(form.onSubmitMessageType),
    onSubmitMessageContent: str(form.onSubmitMessageContent),
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
    // 回答後メッセージ: 「自分の文章」のときだけ文章を保存する(Flex等の既存設定は、種類ごとそのまま維持)
    ...(d.lstep.answerMessage?.mode === 'custom' && d.onSubmitMessageType !== 'flex'
      ? { onSubmitMessageType: 'text' as const, onSubmitMessageContent: nz(d.onSubmitMessageContent) }
      : {}),
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

/**
 * 公開フォーム(LIFF)が受け取る「フォーム定義」を、編集中のドラフトから作る(別タブのプレビュー用)。
 * 保存前の内容でも、本番と同じ描画処理で確認できる。
 */
export function draftToPreviewFormDef(d: FormDraft) {
  const nz = (v: string) => (v.trim() ? v.trim() : null)
  return {
    id: 'preview',
    name: d.name,
    description: null,
    fields: blocksToApi(d.blocks),
    isActive: true,
    hasSubmitWebhook: false,
    webhookOrigin: null,
    webhookGateId: null,
    thanksUrl: null, // プレビューでは移動させない
    previousAnswer: null,
    fullOptions: {},
    lstepOptions: d.lstep,
    primaryColor: nz(d.primaryColor),
    backgroundColor: nz(d.backgroundColor),
    formBackgroundColor: nz(d.formBackgroundColor),
    headerImageUrl: nz(d.headerImageUrl),
    backgroundImageUrl: nz(d.backgroundImageUrl),
    hideHeaderIcon: true,
    customCss: d.customCssEnabled ? nz(d.customCss) : null,
    themeMainColor: nz(d.themeMainColor),
    themeSubColor: nz(d.themeSubColor),
    themeErrorColor: nz(d.themeErrorColor),
    themeTextColor: nz(d.themeTextColor),
    themeFont: nz(d.themeFont),
  }
}
