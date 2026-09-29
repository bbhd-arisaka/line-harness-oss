'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { fetchApi } from '@/lib/api'
import { countryFlag } from '@/lib/country-flag'
import Header from '@/components/layout/header'
import { displayFormName, sortFormsByLatestAnswer } from './form-list'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Checkbox } from '@cloudflare/kumo/components/checkbox'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Input, InputArea } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Select } from '@cloudflare/kumo/components/select'
import { Table } from '@cloudflare/kumo/components/table'

type FieldType =
  | 'text' | 'email' | 'tel' | 'number' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'date'
  | 'prefecture' | 'file' | 'heading' | 'subheading' | 'paragraph'

const FIELD_TYPE_OPTIONS: Array<{ value: FieldType; label: string }> = [
  { value: 'heading', label: '見出し(中見出し)' },
  { value: 'subheading', label: '小見出し' },
  { value: 'paragraph', label: '説明文(同意書等の長文)' },
  { value: 'text', label: '1行テキスト' },
  { value: 'textarea', label: '複数行テキスト' },
  { value: 'email', label: 'メールアドレス' },
  { value: 'tel', label: '電話番号' },
  { value: 'number', label: '数値' },
  { value: 'date', label: '日付' },
  { value: 'prefecture', label: '都道府県' },
  { value: 'select', label: 'プルダウン選択' },
  { value: 'radio', label: '単一選択(ラジオ)' },
  { value: 'checkbox', label: '複数選択(チェックボックス)' },
  { value: 'file', label: 'ファイル添付' },
]

/** 選択肢を持つ項目タイプ。この3つだけ「選択肢」入力欄を出す。 */
const OPTION_TYPES: FieldType[] = ['select', 'radio', 'checkbox']

/** 見出し類。回答データを持たないので必須指定・ラベル欄の扱いを変える。 */
const DISPLAY_ONLY_TYPES: FieldType[] = ['heading', 'subheading', 'paragraph']

/** ラベル欄を複数行(InputArea)にする項目タイプ。同意書等の長文向け。 */
const MULTILINE_LABEL_TYPES: FieldType[] = ['paragraph']

let fieldRowSeq = 0
interface FieldDraft {
  rowId: number
  name: string
  label: string
  type: FieldType
  required: boolean
  optionsText: string // カンマ区切り。select/radio/checkbox のときだけ使う
}

/** ラベルから項目キー(name)を機械的に作る。英数字以外は捨て、空なら連番。 */
function slugifyFieldName(label: string, index: number): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9ぁ-んァ-ヶー一-龯]+/gi, '_')
    .replace(/^_+|_+$/g, '')
  return slug || `field_${index + 1}`
}

interface UsedByAccount {
  id: string
  name: string
  country: string | null
  displayOrder: number
  count: number
}

interface FormField {
  name: string
  label: string
  type?: FieldType
  required?: boolean
  options?: string[]
}

interface Form {
  id: string
  name: string
  description: string | null
  fields: FormField[]
  saveToMetadata?: boolean
  isActive: boolean
  submitCount?: number
  createdAt: string
  lastSubmittedAt: string | null
  usedByAccounts: UsedByAccount[]
  expiresAt?: string | null
  capacityLimit?: number | null
  answerLimitPerFriend?: 'unlimited' | 'once'
  restorePreviousAnswer?: boolean
  thanksUrl?: string | null
  primaryColor?: string | null
  onSubmitStopScenarios?: boolean
  customDesignEnabled?: boolean
  backgroundColor?: string | null
  formBackgroundColor?: string | null
  headerImageUrl?: string | null
  backgroundImageUrl?: string | null
  hideHeaderIcon?: boolean
  customCssEnabled?: boolean
  customCss?: string | null
  googleSheetsEnabled?: boolean
  googleSheetUrl?: string | null
  googleSheetName?: string | null
}

type FormDetail = Form

interface Submission {
  id: string
  formId: string
  friendId: string | null
  friendName?: string | null
  data: Record<string, unknown>
  createdAt: string
}

const PAGE_SIZE = 20
type FormFilter = 'all' | 'answered' | 'unanswered'

function formatRelative(iso: string | null): string {
  if (!iso) return '未回答'
  const d = new Date(iso)
  const now = Date.now()
  const diffMin = Math.floor((now - d.getTime()) / 60000)
  if (diffMin < 1) return 'たった今'
  if (diffMin < 60) return `${diffMin}分前`
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}時間前`
  if (diffMin < 60 * 24 * 7) return `${Math.floor(diffMin / (60 * 24))}日前`
  return d.toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' })
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (Array.isArray(v)) return v.length === 0 ? '—' : v.join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export default function FormSubmissionsPage() {
  const [forms, setForms] = useState<Form[]>([])
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [fieldLabels, setFieldLabels] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [subLoading, setSubLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [detailSubmission, setDetailSubmission] = useState<Submission | null>(null)
  const [query, setQuery] = useState('')
  const [formFilter, setFormFilter] = useState<FormFilter>('all')

  // 作成・編集ダイアログ。editingFormId=null なら新規作成。
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingFormId, setEditingFormId] = useState<string | null>(null)
  const [editingUsedByAccounts, setEditingUsedByAccounts] = useState<UsedByAccount[]>([])
  const [draftName, setDraftName] = useState('')
  const [draftDescription, setDraftDescription] = useState('')
  const [draftSaveToMetadata, setDraftSaveToMetadata] = useState(false)
  const [draftFields, setDraftFields] = useState<FieldDraft[]>([])
  const [savingForm, setSavingForm] = useState(false)
  const [formError, setFormError] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  // Lステップ互換の詳細設定
  const [draftExpiresAt, setDraftExpiresAt] = useState('') // datetime-local文字列、空なら期限なし
  const [draftCapacityLimit, setDraftCapacityLimit] = useState('') // 空文字なら上限なし
  const [draftAnswerLimitPerFriend, setDraftAnswerLimitPerFriend] = useState<'unlimited' | 'once'>('unlimited')
  const [draftRestorePreviousAnswer, setDraftRestorePreviousAnswer] = useState(false)
  const [draftThanksUrl, setDraftThanksUrl] = useState('')
  const [draftPrimaryColor, setDraftPrimaryColor] = useState('')
  const [draftStopScenarios, setDraftStopScenarios] = useState(false)
  // Lステップ「カラー/デザイン設定」タブ相当
  const [draftCustomDesignEnabled, setDraftCustomDesignEnabled] = useState(false)
  const [draftBackgroundColor, setDraftBackgroundColor] = useState('')
  const [draftFormBackgroundColor, setDraftFormBackgroundColor] = useState('')
  const [draftHeaderImageUrl, setDraftHeaderImageUrl] = useState('')
  const [draftBackgroundImageUrl, setDraftBackgroundImageUrl] = useState('')
  const [draftHideHeaderIcon, setDraftHideHeaderIcon] = useState(false)
  const [draftCustomCssEnabled, setDraftCustomCssEnabled] = useState(false)
  const [draftCustomCss, setDraftCustomCss] = useState('')
  // Lステップ「Googleスプレッドシート連携 β版」相当
  const [draftGoogleSheetsEnabled, setDraftGoogleSheetsEnabled] = useState(false)
  const [draftGoogleSheetUrl, setDraftGoogleSheetUrl] = useState('')
  const [draftGoogleSheetName, setDraftGoogleSheetName] = useState('')
  const [sheetsServiceAccountEmail, setSheetsServiceAccountEmail] = useState<string | null>(null)

  useEffect(() => {
    fetchApi<{ success: boolean; data: { configured: boolean; serviceAccountEmail: string | null } }>(
      '/api/forms/integrations/google-sheets',
    ).then((res) => { if (res.success) setSheetsServiceAccountEmail(res.data.serviceAccountEmail) }).catch(() => { /* silent */ })
  }, [])

  const loadForms = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; data: Form[] }>('/api/forms')
      if (res.success) setForms(res.data)
    } catch { /* silent */ }
    setLoading(false)
  }, [])

  useEffect(() => { loadForms() }, [loadForms])

  const loadSubmissions = useCallback(async (formId: string) => {
    setSubLoading(true)
    setPage(1)
    setDetailSubmission(null)
    try {
      const formRes = await fetchApi<{ success: boolean; data: FormDetail | { fields: string | FormDetail['fields'] } }>(`/api/forms/${formId}`)
      const subRes = await fetchApi<{ success: boolean; data: Submission[] }>(`/api/forms/${formId}/submissions`)

      // Race-guard: only apply if user hasn't switched away
      setSelectedFormId((current) => {
        if (current !== formId) return current
        if (formRes.success) {
          const rawFields = (formRes.data as { fields: unknown }).fields
          const fields = typeof rawFields === 'string'
            ? (JSON.parse(rawFields) as Array<{ name: string; label: string }>)
            : (rawFields as Array<{ name: string; label: string }>)
          const labels: Record<string, string> = {}
          for (const f of fields ?? []) labels[f.name] = f.label
          setFieldLabels(labels)
        }
        if (subRes.success) {
          setSubmissions(
            subRes.data.map((s) => ({
              ...s,
              data: typeof s.data === 'string' ? JSON.parse(s.data) : s.data,
              friendName: s.friendName ?? null,
            })),
          )
        }
        return current
      })
    } catch { /* silent */ }
    setSelectedFormId((current) => {
      if (current === formId) setSubLoading(false)
      return current
    })
  }, [])

  const handleSelectForm = (formId: string) => {
    setSelectedFormId(formId)
    loadSubmissions(formId)
  }

const openCreateForm = () => {
    setEditingFormId(null)
    setEditingUsedByAccounts([])
    setDraftName('')
    setDraftDescription('')
    setDraftSaveToMetadata(false)
    setDraftFields([])
    setDraftExpiresAt('')
    setDraftCapacityLimit('')
    setDraftAnswerLimitPerFriend('unlimited')
    setDraftRestorePreviousAnswer(false)
    setDraftThanksUrl('')
    setDraftPrimaryColor('')
    setDraftStopScenarios(false)
    setDraftCustomDesignEnabled(false)
    setDraftBackgroundColor('')
    setDraftFormBackgroundColor('')
    setDraftHeaderImageUrl('')
    setDraftBackgroundImageUrl('')
    setDraftHideHeaderIcon(false)
    setDraftCustomCssEnabled(false)
    setDraftCustomCss('')
    setDraftGoogleSheetsEnabled(false)
    setDraftGoogleSheetUrl('')
    setDraftGoogleSheetName('')
    setShowAdvanced(false)
    setFormError('')
    setEditorOpen(true)
  }

  const openEditForm = (form: Form) => {
    setEditingFormId(form.id)
    setEditingUsedByAccounts(form.usedByAccounts)
    setDraftName(displayFormName(form.name))
    setDraftDescription(form.description ?? '')
    setDraftSaveToMetadata(Boolean(form.saveToMetadata))
    setDraftFields(
      form.fields.map((f) => ({
        rowId: fieldRowSeq++,
        name: f.name,
        label: f.label,
        type: (f.type as FieldType) ?? 'text',
        required: Boolean(f.required),
        optionsText: (f.options ?? []).join(', '),
      })),
    )
    // ISO文字列(YYYY-MM-DDTHH:MM:SS...) → datetime-local入力用(YYYY-MM-DDTHH:MM)
    setDraftExpiresAt(form.expiresAt ? form.expiresAt.slice(0, 16) : '')
    setDraftCapacityLimit(form.capacityLimit != null ? String(form.capacityLimit) : '')
    setDraftAnswerLimitPerFriend(form.answerLimitPerFriend ?? 'unlimited')
    setDraftRestorePreviousAnswer(Boolean(form.restorePreviousAnswer))
    setDraftThanksUrl(form.thanksUrl ?? '')
    setDraftPrimaryColor(form.primaryColor ?? '')
    setDraftStopScenarios(Boolean(form.onSubmitStopScenarios))
    setDraftCustomDesignEnabled(Boolean(form.customDesignEnabled))
    setDraftBackgroundColor(form.backgroundColor ?? '')
    setDraftFormBackgroundColor(form.formBackgroundColor ?? '')
    setDraftHeaderImageUrl(form.headerImageUrl ?? '')
    setDraftBackgroundImageUrl(form.backgroundImageUrl ?? '')
    setDraftHideHeaderIcon(Boolean(form.hideHeaderIcon))
    setDraftCustomCssEnabled(Boolean(form.customCssEnabled))
    setDraftCustomCss(form.customCss ?? '')
    setDraftGoogleSheetsEnabled(Boolean(form.googleSheetsEnabled))
    setDraftGoogleSheetUrl(form.googleSheetUrl ?? '')
    setDraftGoogleSheetName(form.googleSheetName ?? '')
    setShowAdvanced(false)
    setFormError('')
    setEditorOpen(true)
  }

  const addDraftField = () => {
    setDraftFields((rows) => [
      ...rows,
      { rowId: fieldRowSeq++, name: '', label: '', type: 'text', required: false, optionsText: '' },
    ])
  }

  const saveForm = async () => {
    const name = draftName.trim()
    if (!name || savingForm) return
    if (draftFields.some((f) => !f.label.trim())) {
      setFormError('すべての項目にラベルを入力してください。')
      return
    }
    setSavingForm(true)
    setFormError('')
    try {
      const fields = draftFields.map((f, i) => ({
        name: f.name.trim() || slugifyFieldName(f.label, i),
        label: f.label.trim(),
        type: f.type,
        required: f.required,
        ...(OPTION_TYPES.includes(f.type)
          ? { options: f.optionsText.split(',').map((o) => o.trim()).filter(Boolean) }
          : {}),
      }))
      const payload = {
        name: displayFormName(name),
        description: draftDescription.trim() || null,
        saveToMetadata: draftSaveToMetadata,
        fields,
        // datetime-local(YYYY-MM-DDTHH:MM) → サーバーの秒精度ISO文字列に揃える
        expiresAt: draftExpiresAt ? `${draftExpiresAt}:00` : null,
        capacityLimit: draftCapacityLimit.trim() ? Number(draftCapacityLimit) : null,
        answerLimitPerFriend: draftAnswerLimitPerFriend,
        restorePreviousAnswer: draftRestorePreviousAnswer,
        thanksUrl: draftThanksUrl.trim() || null,
        primaryColor: draftPrimaryColor.trim() || null,
        onSubmitStopScenarios: draftStopScenarios,
        customDesignEnabled: draftCustomDesignEnabled,
        backgroundColor: draftBackgroundColor.trim() || null,
        formBackgroundColor: draftFormBackgroundColor.trim() || null,
        headerImageUrl: draftHeaderImageUrl.trim() || null,
        backgroundImageUrl: draftBackgroundImageUrl.trim() || null,
        hideHeaderIcon: draftHideHeaderIcon,
        customCssEnabled: draftCustomCssEnabled,
        customCss: draftCustomCss.trim() || null,
        googleSheetsEnabled: draftGoogleSheetsEnabled,
        googleSheetUrl: draftGoogleSheetUrl.trim() || null,
        googleSheetName: draftGoogleSheetName.trim() || null,
      }
      const res = editingFormId
        ? await fetchApi<{ success: boolean; data: Form }>(`/api/forms/${editingFormId}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          })
        : await fetchApi<{ success: boolean; data: Form }>('/api/forms', {
            method: 'POST',
            body: JSON.stringify(payload),
          })
      if (!res.success) throw new Error('save_failed')
      setEditorOpen(false)
      await loadForms()
    } catch {
      setFormError('保存できませんでした。もう一度お試しください。')
    } finally {
      setSavingForm(false)
    }
  }

  const sortedForms = useMemo(() => sortFormsByLatestAnswer(forms), [forms])
  const answeredCount = useMemo(
    () => forms.filter((form) => form.lastSubmittedAt !== null).length,
    [forms],
  )
  const filteredForms = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('ja-JP')
    return sortedForms.filter((form) => {
      if (formFilter === 'answered' && !form.lastSubmittedAt) return false
      if (formFilter === 'unanswered' && form.lastSubmittedAt) return false
      if (!normalizedQuery) return true
      return (
        displayFormName(form.name).toLocaleLowerCase('ja-JP').includes(normalizedQuery)
        || form.usedByAccounts.some((account) => account.name.toLocaleLowerCase('ja-JP').includes(normalizedQuery))
      )
    })
  }, [formFilter, query, sortedForms])
  const duplicateNameCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const form of forms) {
      const name = displayFormName(form.name).toLocaleLowerCase('ja-JP')
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return counts
  }, [forms])

  const selectedForm = useMemo(
    () => forms.find((f) => f.id === selectedFormId) ?? null,
    [forms, selectedFormId],
  )

  const totalPages = Math.max(1, Math.ceil(submissions.length / PAGE_SIZE))
  const paged = submissions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const fieldKeys = useMemo(
    () =>
      submissions.length > 0
        ? [...new Set(submissions.flatMap((s) => Object.keys(s.data)))]
        : [],
    [submissions],
  )

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <Header title="フォーム回答" description="送信されたフォームを件数・配信アカウント・回答内容まで一覧で確認" />
        <Button type="button" variant="primary" size="sm" onClick={openCreateForm} className="flex-none">
          + フォームを新規作成
        </Button>
      </div>

      {/* Form cards */}
      <section className="mb-6">
        {!loading && forms.length > 0 && (
          <div className="mb-4 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                {([
                  ['all', `すべて ${forms.length}`],
                  ['answered', `回答あり ${answeredCount}`],
                  ['unanswered', `未回答 ${forms.length - answeredCount}`],
                ] as Array<[FormFilter, string]>).map(([value, label]) => (
                  <Button
                    key={value}
                    type="button"
                    onClick={() => setFormFilter(value)}
                    size="xs"
                    variant={formFilter === value ? 'primary' : 'secondary'}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden text-[11px] text-gray-400 md:inline">最新回答順</span>
                <Input
                  aria-label="フォーム名・アカウントで検索"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="フォーム名・アカウントで検索"
                  className="w-full sm:w-64"
                />
              </div>
            </div>
            {query && (
              <p className="text-xs text-gray-400">{filteredForms.length}件見つかりました</p>
            )}
          </div>
        )}
        {loading ? (
          <Loader />
        ) : forms.length === 0 ? (
          <Empty
            title="フォームがまだありません"
            description="フォームが作成されると回答を確認できます。"
            contents={<Button type="button" variant="primary" onClick={openCreateForm}>+ フォームを新規作成</Button>}
          />
        ) : (
          filteredForms.length === 0 ? (
            <Empty title="条件に合うフォームがありません" description="検索条件を変更してください。" />
          ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredForms.map((form) => {
              const isSelected = selectedFormId === form.id
              const totalCount = form.usedByAccounts.reduce((sum, a) => sum + a.count, 0)
              const displayCount = form.submitCount ?? totalCount
              const normalizedName = displayFormName(form.name)
              const isDuplicate = (duplicateNameCounts.get(normalizedName.toLocaleLowerCase('ja-JP')) ?? 0) > 1
              return (
                <article
                  key={form.id}
                  className="group relative"
                >
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => handleSelectForm(form.id)}
                    aria-pressed={isSelected}
                    className={`h-auto w-full cursor-pointer justify-start p-4 text-left ${
                      isSelected
                        ? 'ring-2 ring-kumo-brand bg-kumo-control'
                        : ''
                    }`}
                  >
                  <div className="mb-2 flex items-start gap-2 pr-7">
                    <h3 className={`text-sm font-semibold leading-snug ${isSelected ? 'text-kumo-brand' : 'text-gray-900'}`}>
                      {normalizedName}
                    </h3>
                  </div>

                  <div className="flex items-baseline gap-1 mb-3">
                    <span className="text-2xl font-bold text-gray-900 tabular-nums">{displayCount}</span>
                    <span className="text-xs text-gray-400">件の回答</span>
                  </div>

                  {form.usedByAccounts.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {form.usedByAccounts.map((acc) => {
                        const flag = countryFlag(acc.country)
                        return (
                          <span
                            key={acc.id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-50 border border-gray-100 text-[11px] text-gray-700"
                            title={`${acc.name}: ${acc.count}件`}
                          >
                            {flag && <span>{flag}</span>}
                            <span className="font-medium">{acc.name}</span>
                            <span className="text-gray-400 tabular-nums">{acc.count}</span>
                          </span>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="text-[11px] text-gray-300">回答元アカウントなし</div>
                  )}

                  <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-2 text-[11px] text-gray-400">
                    <span>{form.lastSubmittedAt ? `最終回答 ${formatRelative(form.lastSubmittedAt)}` : '回答はまだありません'}</span>
                    {!form.isActive && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-500">停止中</span>
                    )}
                    {isDuplicate && (
                      <span className="ml-auto" title={`フォームID: ${form.id}`}>
                        同名あり・{form.fields.length}項目・作成 {new Date(form.createdAt).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' })}
                      </span>
                    )}
                  </div>
                  </Button>

                  <Button
                    type="button"
                    size="xs"
                    shape="square"
                    variant="ghost"
                    onClick={() => openEditForm(form)}
                    className="absolute right-3 top-3 opacity-60 group-hover:opacity-100"
                    aria-label={`${normalizedName}を編集`}
                    title="フォームを編集"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931ZM19.5 7.125 16.875 4.5M18 13.5V19.125A1.875 1.875 0 0 1 16.125 21H4.875A1.875 1.875 0 0 1 3 19.125V7.875A1.875 1.875 0 0 1 4.875 6H10.5" />
                    </svg>
                  </Button>
                </article>
              )
            })}
          </div>
          )
        )}
      </section>

      {/* Submissions table */}
      {selectedForm && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-base font-semibold text-gray-900">{displayFormName(selectedForm.name)}</h2>
              <span className="text-xs text-gray-400">
                {subLoading ? '読み込み中...' : `${submissions.length}件`}
              </span>
            </div>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => {
                setSelectedFormId(null)
                setSubmissions([])
                setDetailSubmission(null)
              }}
            >
              閉じる ✕
            </Button>
          </div>

          {subLoading ? (
            <LayerCard className="p-8"><Loader className="mx-auto" /></LayerCard>
          ) : submissions.length === 0 ? (
            <Empty title="回答がありません" description="回答が送信されるとここに表示されます。" />
          ) : (
            <>
              <LayerCard className="overflow-x-auto p-0">
                <Table className="min-w-[700px]">
                  <Table.Header>
                    <Table.Row>
                      <Table.Head>名前</Table.Head>
                      <Table.Head>日時</Table.Head>
                      {fieldKeys.slice(0, 4).map((key) => (
                        <Table.Head key={key}>
                          {fieldLabels[key] || key}
                        </Table.Head>
                      ))}
                      {fieldKeys.length > 4 && (
                        <Table.Head>…</Table.Head>
                      )}
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {paged.map((sub) => (
                      <Table.Row
                        key={sub.id}
                        onClick={() => setDetailSubmission(sub)}
                        className="hover:bg-gray-50 cursor-pointer"
                      >
                        <Table.Cell className="font-medium text-kumo-strong whitespace-nowrap">
                          {sub.friendId ? (
                            <Link
                              href={`/chats?friend=${encodeURIComponent(sub.friendId)}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-kumo-link hover:underline"
                            >
                              {sub.friendName || '不明'}
                            </Link>
                          ) : (
                            <span>{sub.friendName || '不明'}</span>
                          )}
                        </Table.Cell>
                        <Table.Cell className="text-xs text-kumo-subtle whitespace-nowrap">
                          {new Date(sub.createdAt).toLocaleString('ja-JP', {
                            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                          })}
                        </Table.Cell>
                        {fieldKeys.slice(0, 4).map((key) => (
                          <Table.Cell key={key} className="max-w-[200px] truncate text-kumo-default">
                            {formatValue(sub.data[key])}
                          </Table.Cell>
                        ))}
                        {fieldKeys.length > 4 && (
                          <Table.Cell className="text-xs text-kumo-subtle whitespace-nowrap">他 {fieldKeys.length - 4} 項目</Table.Cell>
                        )}
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              </LayerCard>

              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-xs text-gray-400">
                    {(page - 1) * PAGE_SIZE + 1}〜{Math.min(page * PAGE_SIZE, submissions.length)} 件 / 全{submissions.length}件
                  </p>
                  <div className="flex gap-2">
                    <Button type="button" size="xs" variant="secondary"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      前へ
                    </Button>
                    <span className="px-3 py-1.5 text-sm text-gray-500">{page} / {totalPages}</span>
                    <Button type="button" size="xs" variant="secondary"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                    >
                      次へ
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* Detail panel */}
      {detailSubmission && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setDetailSubmission(null)}
            aria-hidden
          />
          <aside className="relative h-full w-full max-w-md bg-white shadow-xl overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">回答詳細</h3>
              <Button
                type="button"
                size="xs"
                shape="square"
                variant="ghost"
                onClick={() => setDetailSubmission(null)}
                aria-label="閉じる"
              >
                ×
              </Button>
            </div>

            <div className="p-5 space-y-5">
              <div>
                <div className="text-[11px] text-gray-400 uppercase tracking-wide mb-1">回答者</div>
                {detailSubmission.friendId ? (
                  <Link
                    href={`/chats?friend=${encodeURIComponent(detailSubmission.friendId)}`}
                    className="inline-flex items-center gap-2 text-sm text-kumo-link hover:underline"
                  >
                    <span className="font-medium">{detailSubmission.friendName || '不明'}</span>
                    <span className="text-[11px] text-gray-400">→ チャットを開く</span>
                  </Link>
                ) : (
                  <span className="text-sm text-gray-700">{detailSubmission.friendName || '不明'}</span>
                )}
              </div>

              <div>
                <div className="text-[11px] text-gray-400 uppercase tracking-wide mb-1">送信日時</div>
                <div className="text-sm text-gray-700">{formatDateTime(detailSubmission.createdAt)}</div>
              </div>

              <div>
                <div className="text-[11px] text-gray-400 uppercase tracking-wide mb-2">回答内容</div>
                <dl className="space-y-3">
                  {fieldKeys.length === 0 ? (
                    <div className="text-sm text-gray-400">項目なし</div>
                  ) : (
                    fieldKeys.map((key) => (
                      <div key={key} className="grid grid-cols-1 gap-1">
                        <dt className="text-[11px] text-gray-500">{fieldLabels[key] || key}</dt>
                        <dd className="text-sm text-gray-900 break-words whitespace-pre-wrap">
                          {formatValue(detailSubmission.data[key])}
                        </dd>
                      </div>
                    ))
                  )}
                </dl>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* フォーム作成・編集ダイアログ */}
      <Dialog.Root open={editorOpen} onOpenChange={(open) => { if (!open && !savingForm) setEditorOpen(false) }}>
          <Dialog className="w-full max-w-lg p-5 max-h-[85vh] overflow-y-auto">
            <Dialog.Title>{editingFormId ? 'フォームを編集' : 'フォームを新規作成'}</Dialog.Title>
            <p className="mt-1 text-xs text-gray-400">推奨：サービス名｜目的（対象・導線）</p>
            {editingUsedByAccounts.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-gray-500">
                {editingUsedByAccounts.map((account) => (
                  <span key={account.id} className="rounded bg-gray-100 px-2 py-1">{account.name}</span>
                ))}
              </div>
            )}

            <Input
              label="フォーム名"
              autoFocus
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              className="mt-4"
            />
            <InputArea
              label="説明(任意・回答者には表示されません)"
              value={draftDescription}
              onChange={(event) => setDraftDescription(event.target.value)}
              className="mt-3"
              rows={2}
            />
            <Checkbox
              className="mt-3"
              label="回答内容を友だち情報(本名など)として保存する"
              checked={draftSaveToMetadata}
              onCheckedChange={setDraftSaveToMetadata}
            />

            <div className="mt-5">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-gray-700">質問項目</h4>
                <Button type="button" size="xs" variant="secondary" onClick={addDraftField}>+ 項目を追加</Button>
              </div>

              {draftFields.length === 0 ? (
                <p className="text-xs text-gray-400">まだ項目がありません。「項目を追加」で本名・電話番号などを追加してください。</p>
              ) : (
                <div className="space-y-3">
                  {draftFields.map((field, i) => (
                    <div key={field.rowId} className="rounded-lg border border-gray-200 p-3">
                      <div className="flex items-start gap-2">
                        <Input
                          className="min-w-0 flex-1"
                          aria-label="質問ラベル"
                          placeholder="質問ラベル (例: 本名)"
                          value={field.label}
                          onValueChange={(v) => setDraftFields((rows) => rows.map((r, ri) => (ri === i ? { ...r, label: v } : r)))}
                        />
                        <Select
                          aria-label="回答形式"
                          value={field.type}
                          onValueChange={(v) => setDraftFields((rows) => rows.map((r, ri) => (ri === i ? { ...r, type: v as FieldType } : r)))}
                          items={FIELD_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                        />
                        <button
                          type="button"
                          aria-label="この項目を削除"
                          className="mt-2 flex-none text-gray-400 hover:text-red-600"
                          onClick={() => setDraftFields((rows) => rows.filter((_, ri) => ri !== i))}
                        >
                          ×
                        </button>
                      </div>
                      {OPTION_TYPES.includes(field.type) && (
                        <Input
                          className="mt-2"
                          aria-label="選択肢(カンマ区切り)"
                          placeholder="選択肢をカンマ区切りで (例: 20代, 30代, 40代以上)"
                          value={field.optionsText}
                          onValueChange={(v) => setDraftFields((rows) => rows.map((r, ri) => (ri === i ? { ...r, optionsText: v } : r)))}
                        />
                      )}
                      {MULTILINE_LABEL_TYPES.includes(field.type) && (
                        <InputArea
                          className="mt-2 text-xs"
                          aria-label="説明文の本文"
                          rows={5}
                          placeholder="同意書・プライバシーポリシーなどの本文"
                          value={field.label}
                          onValueChange={(v) => setDraftFields((rows) => rows.map((r, ri) => (ri === i ? { ...r, label: v } : r)))}
                        />
                      )}
                      {!DISPLAY_ONLY_TYPES.includes(field.type) && (
                        <Checkbox
                          className="mt-2"
                          label="必須項目にする"
                          checked={field.required}
                          onCheckedChange={(checked) => setDraftFields((rows) => rows.map((r, ri) => (ri === i ? { ...r, required: checked } : r)))}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-5">
              <button
                type="button"
                className="text-xs font-semibold text-gray-600 underline decoration-gray-300 underline-offset-2"
                onClick={() => setShowAdvanced((v) => !v)}
              >
                {showAdvanced ? '▾ 詳細設定を閉じる' : '▸ 詳細設定(回答期限・人数制限・デザイン等)'}
              </button>

              {showAdvanced && (
                <div className="mt-3 space-y-3 rounded-lg border border-gray-200 p-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs text-gray-500">回答期限(任意)</label>
                      <input
                        type="datetime-local"
                        value={draftExpiresAt}
                        onChange={(e) => setDraftExpiresAt(e.target.value)}
                        className="h-9 w-full rounded-lg border border-gray-300 px-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-gray-500">先着人数の上限(任意)</label>
                      <Input
                        type="number"
                        placeholder="空欄なら上限なし"
                        value={draftCapacityLimit}
                        onValueChange={setDraftCapacityLimit}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs text-gray-500">1人が回答できる回数</label>
                    <Select
                      value={draftAnswerLimitPerFriend}
                      onValueChange={(v) => setDraftAnswerLimitPerFriend(v as 'unlimited' | 'once')}
                      items={[
                        { value: 'unlimited', label: '何度でも可能' },
                        { value: 'once', label: '1度のみ' },
                      ]}
                    />
                  </div>

                  <Checkbox
                    label="2回目以降の回答時に前回の回答を復元する"
                    checked={draftRestorePreviousAnswer}
                    onCheckedChange={setDraftRestorePreviousAnswer}
                  />

                  <Input
                    label="サンクスページURL(任意・未設定なら標準の完了画面を表示)"
                    placeholder="https://example.com/thanks"
                    value={draftThanksUrl}
                    onValueChange={setDraftThanksUrl}
                  />

                  <Checkbox
                    label="回答後アクション: 進行中のシナリオを停止する"
                    checked={draftStopScenarios}
                    onCheckedChange={setDraftStopScenarios}
                  />

                  <div className="border-t border-gray-200 pt-3">
                    <Checkbox
                      label="カスタムデザインを使用"
                      checked={draftCustomDesignEnabled}
                      onCheckedChange={setDraftCustomDesignEnabled}
                    />

                    {draftCustomDesignEnabled && (
                      <div className="mt-3 space-y-3 pl-1">
                        <div>
                          <label className="mb-1 block text-xs text-gray-500">ボタンカラー(16進、例 #d97786)</label>
                          <div className="flex items-center gap-2">
                            <Input
                              placeholder="#06C755"
                              value={draftPrimaryColor}
                              onValueChange={setDraftPrimaryColor}
                              className="flex-1"
                            />
                            {draftPrimaryColor && (
                              <span className="h-8 w-8 flex-none rounded border border-gray-300" style={{ backgroundColor: draftPrimaryColor }} />
                            )}
                          </div>
                        </div>

                        <div>
                          <label className="mb-1 block text-xs text-gray-500">背景カラー(※スマートフォンでは表示されません)</label>
                          <div className="flex items-center gap-2">
                            <Input
                              placeholder="#f5f5f5"
                              value={draftBackgroundColor}
                              onValueChange={setDraftBackgroundColor}
                              className="flex-1"
                            />
                            {draftBackgroundColor && (
                              <span className="h-8 w-8 flex-none rounded border border-gray-300" style={{ backgroundColor: draftBackgroundColor }} />
                            )}
                          </div>
                        </div>

                        <div>
                          <label className="mb-1 block text-xs text-gray-500">フォーム背景カラー</label>
                          <div className="flex items-center gap-2">
                            <Input
                              placeholder="#ffffff"
                              value={draftFormBackgroundColor}
                              onValueChange={setDraftFormBackgroundColor}
                              className="flex-1"
                            />
                            {draftFormBackgroundColor && (
                              <span className="h-8 w-8 flex-none rounded border border-gray-300" style={{ backgroundColor: draftFormBackgroundColor }} />
                            )}
                          </div>
                        </div>

                        <Input
                          label="ヘッダー画像URL"
                          placeholder="https://example.com/header.jpg"
                          value={draftHeaderImageUrl}
                          onValueChange={setDraftHeaderImageUrl}
                        />

                        <Input
                          label="背景画像URL"
                          placeholder="https://example.com/background.jpg"
                          value={draftBackgroundImageUrl}
                          onValueChange={setDraftBackgroundImageUrl}
                        />

                        <Checkbox
                          label="ヘッダーアイコンを非表示にする"
                          checked={draftHideHeaderIcon}
                          onCheckedChange={setDraftHideHeaderIcon}
                        />

                        <div>
                          <Checkbox
                            label="カスタムCSSを使用"
                            checked={draftCustomCssEnabled}
                            onCheckedChange={setDraftCustomCssEnabled}
                          />
                          {draftCustomCssEnabled && (
                            <>
                              <p className="mt-1 text-[11px] text-amber-600">
                                ※カスタムCSS使用時はフォームが使用できなくなる可能性があります。保存後は必ずプレビューで確認してください。
                              </p>
                              <InputArea
                                className="mt-2 font-mono text-xs"
                                rows={4}
                                placeholder=".form-body { ... }"
                                value={draftCustomCss}
                                onChange={(e) => setDraftCustomCss(e.target.value)}
                              />
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-gray-200 pt-3">
                    <Checkbox
                      label="Googleスプレッドシート連携(β版)"
                      checked={draftGoogleSheetsEnabled}
                      onCheckedChange={setDraftGoogleSheetsEnabled}
                    />
                    {draftGoogleSheetsEnabled && (
                      <div className="mt-3 space-y-3 pl-1">
                        {sheetsServiceAccountEmail && (
                          <p className="text-[11px] text-gray-500">
                            スプレッドシートを次のメールアドレスへ「編集者」として共有してください:{' '}
                            <span className="font-mono text-gray-700">{sheetsServiceAccountEmail}</span>
                          </p>
                        )}
                        <Input
                          label="スプレッドシートURL"
                          placeholder="https://docs.google.com/spreadsheets/d/..."
                          value={draftGoogleSheetUrl}
                          onValueChange={setDraftGoogleSheetUrl}
                        />
                        <Input
                          label="シート名(タブ名)"
                          placeholder="シート1"
                          value={draftGoogleSheetName}
                          onValueChange={setDraftGoogleSheetName}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {formError && <Banner className="mt-3" size="sm" variant="error" title="保存できませんでした" description={formError} />}

            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditorOpen(false)} disabled={savingForm}>
                キャンセル
              </Button>
              <Button
                type="button"
                variant="primary"
                loading={savingForm}
                onClick={() => void saveForm()}
                disabled={!draftName.trim() || savingForm}
              >
                保存
              </Button>
            </div>
          </Dialog>
      </Dialog.Root>
    </div>
  )
}
