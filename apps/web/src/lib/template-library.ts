import type { EditorData, EditorType, TemplateKind } from '@line-crm/shared'

/** テンプレート(Lステップ同形)の、画面とAPIの型。変換・検査は @line-crm/shared(Worker と同じ関数) */

export interface TemplateFolderItem {
  id: string
  name: string
  count: number
}

export interface TemplateSummary {
  id: string
  name: string
  folderId: string | null
  displayOrder: number
  kind: TemplateKind
  typeLabel: string
  editorType: string | null
  legacy: boolean
  summary: string
  packCount?: number
  createdAt: string
  updatedAt: string
}

export interface TemplateDetail extends Omit<TemplateSummary, 'editorType'> {
  lineAccountId: string | null
  /** 旧来のフレックス(ビジュアルエディタで作っていないもの)は 'legacy_flex' */
  editorType: EditorType | 'legacy_flex' | 'pack'
  editorData: unknown
  messageType: string
  messageContent: string
  senderId: string | null
  allowSenderOverride: boolean
}

export interface TemplateInput {
  lineAccountId: string
  name: string
  folderId: string | null
  kind: TemplateKind
  editorType: EditorType | 'pack'
  editorData?: EditorData | null
  senderId?: string | null
  allowSenderOverride?: boolean
  draftId?: string | null
}

export interface TemplateSender {
  id: string
  name: string
  iconUrl: string | null
}

export interface TemplateDraft {
  id: string
  templateId: string | null
  kind: TemplateKind
  editorType: EditorType
  typeLabel: string
  name: string
  folderId: string | null
  editorData: EditorData
  senderId: string | null
  allowSenderOverride: boolean
  summary: string
  createdAt: string
  updatedAt: string
}

export interface PackItemView {
  id: string
  position: number
  templateId: string | null
  templateName: string | null
  templateMissing: boolean
  editorType: string | null
  typeLabel: string
  summary: string
  editorData: unknown
}

export interface PackDetail extends TemplateDetail {
  items: PackItemView[]
}
