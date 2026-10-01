/**
 * Lステップ → beyond line 引き継ぎの型。
 * LstepPackage は apps/lstep-extension/PACKAGE_FORMAT.md と同じ形(形を変えるときは文書を先に直す)。
 * Dataset* は apps/worker/src/services/lstep-import.ts の validate* が受け取る形(worker からは import せず、ここに最小限で重複定義する)。
 */

// ── 収集パッケージ(拡張機能 → 画面) ────────────────────────────────

export interface LstepMember {
  created_at: string
  memo: string | null
  tags: Array<{ name: string }>
  /** 常に null(LINEのユーザーIDは出ない) */
  uid: string | null
  vars: Array<{ id: number; name: string; value: unknown; group: number; type: number; encoded_choice_label?: string }>
}

export interface LstepDefRows { folder: string; gid: string | null; rows: string[] }

export interface LstepForm {
  lid: string
  name: string
  folder: string | null
  /** /lvf/export/<id> を文字列にして行×列に分けたもの(先頭が見出し行) */
  csvRows: string[][]
}

export interface LstepPackage {
  version: 1
  collectedAt: string
  lstepHost: string
  accountName: string
  /** 有効な友だちだけ(ブロック済みは出ない)。キー=Lステップの友だちID */
  list: Record<string, { name: string; pic: string | null; row: string }>
  members: Record<string, LstepMember>
  csvRows: string[][]
  fieldDefs: LstepDefRows[]
  tagDefs: LstepDefRows[]
  forms: LstepForm[]
  /** トーク履歴: 友だちID → APIの応答(ページ順) */
  messages: Record<string, unknown[]>
  warnings: string[]
}

// ── beyond line 側(画面が API から取ってきたもの) ──────────────────

export interface BeyondFriend {
  id: string
  displayName: string | null
  pictureUrl: string | null
  isFollowing: boolean
}

export interface BeyondFormField {
  name: string
  label?: string
  type: string
  options?: string[]
  [key: string]: unknown
}

export interface BeyondForm {
  id: string
  name: string
  /** JSON文字列、またはパース済みの配列 */
  fields: string | BeyondFormField[]
}

// ── 取り込みデータ(worker の取り込みAPIが受け取る形) ───────────────

export type DatasetFieldType = 'text' | 'textarea' | 'number' | 'date' | 'datetime' | 'select'

export interface DatasetFolder { name: string; order: number }
export interface DatasetField {
  key: string
  label: string
  type: DatasetFieldType
  folder: string | null
  order: number
  options: string[]
  defaultValue: string | null
  /** Lステップ側の種別表示(標準/長文/…)。取り込みAPIは無視する */
  lstepType?: string
}
export interface DatasetTag { name: string; folder?: string }
export interface DatasetFriend {
  beyondFriendId: string
  lstepId?: string
  how?: string
  realName: string | null
  systemDisplayName: string | null
  /** JST 例: 2025-09-30T14:40:17 */
  addedAt: string | null
  tags: string[]
  values: Record<string, string>
}

export interface FormFieldPatch {
  registrationTargets?: Array<{ type: 'real_name' | 'display_name' | 'memo' } | { type: 'friend_field'; fieldKey: string }>
  friendFieldKey?: string
  optionFriendFieldValues?: Record<string, string>
}
export interface FormAddField { name: string; label: string; type: 'text' | 'textarea'; hidden: true }
export interface FormConfig {
  formId: string
  formName?: string
  saveToMetadata?: boolean
  fields: Record<string, FormFieldPatch>
  addFields?: FormAddField[]
}
export interface DatasetSubmission {
  formId: string
  beyondFriendId: string | null
  /** JST 例: 2025-10-28T13:07:04.000+09:00 */
  createdAt: string
  data: Record<string, unknown> & { _lstep: { key: string; answerId?: string; respondentId?: string; respondentName?: string; otherAnswers?: string } }
}

export interface DatasetMessage {
  id: string
  beyondFriendId: string
  direction: 'incoming' | 'outgoing'
  messageType: 'text' | 'flex'
  content: string
  source: 'user' | 'broadcast' | 'manual' | 'scenario'
  createdAt: string
}

/** 取り込みファイル1つ分の外枠(友だち / フォーム / トーク の3種で共通) */
export interface DatasetEnvelope {
  version: 1
  source: 'lstep'
  accountId: string
  accountName: string
  builtAt: string
  folders: DatasetFolder[]
  fields: DatasetField[]
  tags: DatasetTag[]
  friends: DatasetFriend[]
  forms?: { configs: FormConfig[]; submissions: DatasetSubmission[] }
  messages?: DatasetMessage[]
}
