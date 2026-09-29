import { jstNow } from './utils.js';
// =============================================================================
// Forms — Survey / questionnaire system (L社 回答フォーム equivalent)
// =============================================================================

export interface FormFolder {
  id: string;
  name: string;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface Form {
  id: string;
  name: string;
  description: string | null;
  folder_id: string | null;
  fields: string; // JSON string of FormField[]
  on_submit_tag_id: string | null;
  on_submit_scenario_id: string | null;
  on_submit_message_type: 'text' | 'flex' | null;
  on_submit_message_content: string | null; // supports template variables: {{name}}, {{auth_url:CHANNEL_ID}}, etc.
  on_submit_webhook_url: string | null;
  on_submit_webhook_headers: string | null;
  on_submit_webhook_fail_message: string | null;
  save_to_metadata: number;
  is_active: number;
  submit_count: number;
  og_title: string | null;
  og_description: string | null;
  og_image_url: string | null;
  expires_at: string | null;
  capacity_limit: number | null;
  answer_limit_per_friend: 'unlimited' | 'once';
  restore_previous_answer: number;
  thanks_url: string | null;
  primary_color: string | null;
  on_submit_stop_scenarios: number;
  custom_design_enabled: number;
  background_color: string | null;
  form_background_color: string | null;
  header_image_url: string | null;
  background_image_url: string | null;
  hide_header_icon: number;
  custom_css_enabled: number;
  custom_css: string | null;
  google_sheets_enabled: number;
  google_sheet_url: string | null;
  google_sheet_name: string | null;
  theme_main_color: string | null;
  theme_sub_color: string | null;
  theme_error_color: string | null;
  theme_text_color: string | null;
  theme_font: string | null;
  /** Lステップ準拠オプション(JSON文字列)。中身は FormLstepOptions */
  lstep_options: string | null;
  created_at: string;
  updated_at: string;
}

/** 回答フォームの「オプション設定」「デザイン設定」のうち、個別カラムを持たないもの。 */
export interface FormLstepOptions {
  pageTitle?: string;
  submitLabel?: string;
  nextLabel?: string;
  buttonStyle?: 'default' | 'rounded' | 'square';
  buttonColor?: string;
  sectionHeaderStyle?: 'page-number' | 'progress' | 'none';
  confirmDialog?: boolean;
  startsAt?: string | null;
  backgroundImageOpacity?: number;
  /**
   * 回答後にお客様へ自動で送るメッセージ。
   * - none    : 送らない(既定)
   * - summary : 回答内容のまとめ(「診断結果」風のカード)を送る
   * - custom  : 自分で書いた文章を送る(forms.on_submit_message_* を使用)
   */
  answerMessage?: { mode: 'none' | 'summary' | 'custom'; title?: string };
}

export function parseFormLstepOptions(raw: string | null | undefined): FormLstepOptions {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as FormLstepOptions) : {};
  } catch {
    return {};
  }
}

export interface FormSubmission {
  id: string;
  form_id: string;
  friend_id: string | null;
  data: string; // JSON string
  created_at: string;
}

export interface FriendFormSubmission extends FormSubmission {
  form_name: string;
  form_fields: string;
}

// ── Folders ──────────────────────────────────────────────────────────────────

export async function getFormFolders(db: D1Database): Promise<FormFolder[]> {
  const result = await db
    .prepare(`SELECT * FROM form_folders ORDER BY display_order ASC, created_at ASC`)
    .all<FormFolder>();
  return result.results;
}

export interface CreateFormFolderInput {
  name: string;
  displayOrder?: number;
}

export async function createFormFolder(
  db: D1Database,
  input: CreateFormFolderInput,
): Promise<FormFolder> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO form_folders (id, name, display_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, input.name, input.displayOrder ?? 0, now, now)
    .run();
  return (await db
    .prepare(`SELECT * FROM form_folders WHERE id = ?`)
    .bind(id)
    .first<FormFolder>())!;
}

export interface UpdateFormFolderInput {
  name?: string;
  displayOrder?: number;
}

export async function updateFormFolder(
  db: D1Database,
  id: string,
  input: UpdateFormFolderInput,
): Promise<FormFolder | null> {
  const existing = await db
    .prepare(`SELECT * FROM form_folders WHERE id = ?`)
    .bind(id)
    .first<FormFolder>();
  if (!existing) return null;

  const now = jstNow();
  await db
    .prepare(`UPDATE form_folders SET name = ?, display_order = ?, updated_at = ? WHERE id = ?`)
    .bind(input.name ?? existing.name, input.displayOrder ?? existing.display_order, now, id)
    .run();
  return db.prepare(`SELECT * FROM form_folders WHERE id = ?`).bind(id).first<FormFolder>();
}

export async function deleteFormFolder(db: D1Database, id: string): Promise<void> {
  // フォルダを削除しても中のフォームは消さない。未分類扱いに戻すだけ。
  await db.batch([
    db.prepare(`UPDATE forms SET folder_id = NULL WHERE folder_id = ?`).bind(id),
    db.prepare(`DELETE FROM form_folders WHERE id = ?`).bind(id),
  ]);
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function getForms(db: D1Database): Promise<Form[]> {
  const result = await db
    .prepare(`SELECT * FROM forms ORDER BY created_at DESC`)
    .all<Form>();
  return result.results;
}

export interface FormUsedByAccount {
  id: string;
  name: string;
  country: string | null;
  displayOrder: number;
  count: number;
}

export interface FormWithStats extends Form {
  last_submitted_at: string | null;
  used_by_accounts: FormUsedByAccount[];
}

export async function getFormsWithStats(db: D1Database): Promise<FormWithStats[]> {
  // Single query: forms + last submission + per-account submission counts.
  // json_group_array returns '[]' (not NULL) when subquery yields no rows.
  const result = await db
    .prepare(
      `SELECT
         f.*,
         (SELECT MAX(created_at) FROM form_submissions WHERE form_id = f.id) AS last_submitted_at,
         (SELECT json_group_array(
                   json_object(
                     'id', la.id,
                     'name', la.name,
                     'country', la.country,
                     'displayOrder', la.display_order,
                     'count', sub.cnt
                   )
                 )
            FROM (
              SELECT fr.line_account_id, COUNT(*) AS cnt
              FROM form_submissions fs
              JOIN friends fr ON fr.id = fs.friend_id
              WHERE fs.form_id = f.id AND fr.line_account_id IS NOT NULL
              GROUP BY fr.line_account_id
            ) sub
            JOIN line_accounts la ON la.id = sub.line_account_id) AS used_by_accounts_json
       FROM forms f
       ORDER BY
         CASE WHEN last_submitted_at IS NULL THEN 1 ELSE 0 END,
         last_submitted_at DESC,
         f.created_at DESC`,
    )
    .all<Form & { last_submitted_at: string | null; used_by_accounts_json: string | null }>();

  return result.results.map((row) => {
    const { used_by_accounts_json, ...rest } = row;
    let parsed: FormUsedByAccount[] = [];
    if (used_by_accounts_json) {
      try {
        const arr = JSON.parse(used_by_accounts_json) as FormUsedByAccount[];
        parsed = arr.sort((a, b) => a.displayOrder - b.displayOrder);
      } catch {
        parsed = [];
      }
    }
    return { ...rest, used_by_accounts: parsed };
  });
}

export async function getFormById(db: D1Database, id: string): Promise<Form | null> {
  return db
    .prepare(`SELECT * FROM forms WHERE id = ?`)
    .bind(id)
    .first<Form>();
}

export interface CreateFormInput {
  name: string;
  description?: string | null;
  folderId?: string | null;
  fields: string; // JSON string
  onSubmitTagId?: string | null;
  onSubmitScenarioId?: string | null;
  onSubmitMessageType?: 'text' | 'flex' | null;
  onSubmitMessageContent?: string | null;
  onSubmitWebhookUrl?: string | null;
  onSubmitWebhookHeaders?: string | null;
  onSubmitWebhookFailMessage?: string | null;
  saveToMetadata?: boolean;
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogImageUrl?: string | null;
  expiresAt?: string | null;
  capacityLimit?: number | null;
  answerLimitPerFriend?: 'unlimited' | 'once';
  restorePreviousAnswer?: boolean;
  thanksUrl?: string | null;
  primaryColor?: string | null;
  onSubmitStopScenarios?: boolean;
  customDesignEnabled?: boolean;
  backgroundColor?: string | null;
  formBackgroundColor?: string | null;
  headerImageUrl?: string | null;
  backgroundImageUrl?: string | null;
  hideHeaderIcon?: boolean;
  customCssEnabled?: boolean;
  customCss?: string | null;
  googleSheetsEnabled?: boolean;
  googleSheetUrl?: string | null;
  googleSheetName?: string | null;
  themeMainColor?: string | null;
  themeSubColor?: string | null;
  themeErrorColor?: string | null;
  themeTextColor?: string | null;
  themeFont?: string | null;
  lstepOptions?: FormLstepOptions | null;
}

export async function createForm(db: D1Database, input: CreateFormInput): Promise<Form> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO forms
         (id, name, description, folder_id, fields, on_submit_tag_id, on_submit_scenario_id,
          on_submit_message_type, on_submit_message_content,
          on_submit_webhook_url, on_submit_webhook_headers, on_submit_webhook_fail_message,
          save_to_metadata, is_active, submit_count,
          og_title, og_description, og_image_url,
          expires_at, capacity_limit, answer_limit_per_friend, restore_previous_answer,
          thanks_url, primary_color, on_submit_stop_scenarios,
          custom_design_enabled, background_color, form_background_color,
          header_image_url, background_image_url, hide_header_icon,
          custom_css_enabled, custom_css,
          google_sheets_enabled, google_sheet_url, google_sheet_name,
          theme_main_color, theme_sub_color, theme_error_color, theme_text_color, theme_font,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.name,
      input.description ?? null,
      input.folderId ?? null,
      input.fields,
      input.onSubmitTagId ?? null,
      input.onSubmitScenarioId ?? null,
      input.onSubmitMessageType ?? null,
      input.onSubmitMessageContent ?? null,
      input.onSubmitWebhookUrl ?? null,
      input.onSubmitWebhookHeaders ?? null,
      input.onSubmitWebhookFailMessage ?? null,
      input.saveToMetadata !== false ? 1 : 0,
      input.ogTitle ?? null,
      input.ogDescription ?? null,
      input.ogImageUrl ?? null,
      input.expiresAt ?? null,
      input.capacityLimit ?? null,
      input.answerLimitPerFriend ?? 'unlimited',
      input.restorePreviousAnswer ? 1 : 0,
      input.thanksUrl ?? null,
      input.primaryColor ?? null,
      input.onSubmitStopScenarios ? 1 : 0,
      input.customDesignEnabled ? 1 : 0,
      input.backgroundColor ?? null,
      input.formBackgroundColor ?? null,
      input.headerImageUrl ?? null,
      input.backgroundImageUrl ?? null,
      input.hideHeaderIcon ? 1 : 0,
      input.customCssEnabled ? 1 : 0,
      input.customCss ?? null,
      input.googleSheetsEnabled ? 1 : 0,
      input.googleSheetUrl ?? null,
      input.googleSheetName ?? null,
      input.themeMainColor ?? null,
      input.themeSubColor ?? null,
      input.themeErrorColor ?? null,
      input.themeTextColor ?? null,
      input.themeFont ?? null,
      now,
      now,
    )
    .run();

  if (input.lstepOptions) {
    await db
      .prepare(`UPDATE forms SET lstep_options = ? WHERE id = ?`)
      .bind(JSON.stringify(input.lstepOptions), id)
      .run();
  }

  return (await getFormById(db, id))!;
}

export interface UpdateFormInput {
  name?: string;
  description?: string | null;
  folderId?: string | null;
  fields?: string;
  onSubmitTagId?: string | null;
  onSubmitScenarioId?: string | null;
  onSubmitMessageType?: 'text' | 'flex' | null;
  onSubmitMessageContent?: string | null;
  onSubmitWebhookUrl?: string | null;
  onSubmitWebhookHeaders?: string | null;
  onSubmitWebhookFailMessage?: string | null;
  saveToMetadata?: boolean;
  isActive?: boolean;
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogImageUrl?: string | null;
  expiresAt?: string | null;
  capacityLimit?: number | null;
  answerLimitPerFriend?: 'unlimited' | 'once';
  restorePreviousAnswer?: boolean;
  thanksUrl?: string | null;
  primaryColor?: string | null;
  onSubmitStopScenarios?: boolean;
  customDesignEnabled?: boolean;
  backgroundColor?: string | null;
  formBackgroundColor?: string | null;
  headerImageUrl?: string | null;
  backgroundImageUrl?: string | null;
  hideHeaderIcon?: boolean;
  customCssEnabled?: boolean;
  customCss?: string | null;
  googleSheetsEnabled?: boolean;
  googleSheetUrl?: string | null;
  googleSheetName?: string | null;
  themeMainColor?: string | null;
  themeSubColor?: string | null;
  themeErrorColor?: string | null;
  themeTextColor?: string | null;
  themeFont?: string | null;
  lstepOptions?: FormLstepOptions | null;
}

export async function updateForm(
  db: D1Database,
  id: string,
  input: UpdateFormInput,
): Promise<Form | null> {
  const existing = await getFormById(db, id);
  if (!existing) return null;

  const now = jstNow();

  await db
    .prepare(
      `UPDATE forms
       SET name = ?,
           description = ?,
           folder_id = ?,
           fields = ?,
           on_submit_tag_id = ?,
           on_submit_scenario_id = ?,
           on_submit_message_type = ?,
           on_submit_message_content = ?,
           on_submit_webhook_url = ?,
           on_submit_webhook_headers = ?,
           on_submit_webhook_fail_message = ?,
           save_to_metadata = ?,
           is_active = ?,
           og_title = ?,
           og_description = ?,
           og_image_url = ?,
           expires_at = ?,
           capacity_limit = ?,
           answer_limit_per_friend = ?,
           restore_previous_answer = ?,
           thanks_url = ?,
           primary_color = ?,
           on_submit_stop_scenarios = ?,
           custom_design_enabled = ?,
           background_color = ?,
           form_background_color = ?,
           header_image_url = ?,
           background_image_url = ?,
           hide_header_icon = ?,
           custom_css_enabled = ?,
           custom_css = ?,
           google_sheets_enabled = ?,
           google_sheet_url = ?,
           google_sheet_name = ?,
           theme_main_color = ?,
           theme_sub_color = ?,
           theme_error_color = ?,
           theme_text_color = ?,
           theme_font = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.name ?? existing.name,
      'description' in input ? (input.description ?? null) : existing.description,
      'folderId' in input ? (input.folderId ?? null) : existing.folder_id,
      input.fields ?? existing.fields,
      'onSubmitTagId' in input ? (input.onSubmitTagId ?? null) : existing.on_submit_tag_id,
      'onSubmitScenarioId' in input
        ? (input.onSubmitScenarioId ?? null)
        : existing.on_submit_scenario_id,
      'onSubmitMessageType' in input
        ? (input.onSubmitMessageType ?? null)
        : existing.on_submit_message_type,
      'onSubmitMessageContent' in input
        ? (input.onSubmitMessageContent ?? null)
        : existing.on_submit_message_content,
      'onSubmitWebhookUrl' in input
        ? (input.onSubmitWebhookUrl ?? null)
        : existing.on_submit_webhook_url,
      'onSubmitWebhookHeaders' in input
        ? (input.onSubmitWebhookHeaders ?? null)
        : existing.on_submit_webhook_headers,
      'onSubmitWebhookFailMessage' in input
        ? (input.onSubmitWebhookFailMessage ?? null)
        : existing.on_submit_webhook_fail_message,
      'saveToMetadata' in input
        ? (input.saveToMetadata !== false ? 1 : 0)
        : existing.save_to_metadata,
      'isActive' in input ? (input.isActive ? 1 : 0) : existing.is_active,
      'ogTitle' in input ? (input.ogTitle ?? null) : existing.og_title,
      'ogDescription' in input ? (input.ogDescription ?? null) : existing.og_description,
      'ogImageUrl' in input ? (input.ogImageUrl ?? null) : existing.og_image_url,
      'expiresAt' in input ? (input.expiresAt ?? null) : existing.expires_at,
      'capacityLimit' in input ? (input.capacityLimit ?? null) : existing.capacity_limit,
      'answerLimitPerFriend' in input
        ? (input.answerLimitPerFriend ?? 'unlimited')
        : existing.answer_limit_per_friend,
      'restorePreviousAnswer' in input
        ? (input.restorePreviousAnswer ? 1 : 0)
        : existing.restore_previous_answer,
      'thanksUrl' in input ? (input.thanksUrl ?? null) : existing.thanks_url,
      'primaryColor' in input ? (input.primaryColor ?? null) : existing.primary_color,
      'onSubmitStopScenarios' in input
        ? (input.onSubmitStopScenarios ? 1 : 0)
        : existing.on_submit_stop_scenarios,
      'customDesignEnabled' in input
        ? (input.customDesignEnabled ? 1 : 0)
        : existing.custom_design_enabled,
      'backgroundColor' in input ? (input.backgroundColor ?? null) : existing.background_color,
      'formBackgroundColor' in input
        ? (input.formBackgroundColor ?? null)
        : existing.form_background_color,
      'headerImageUrl' in input ? (input.headerImageUrl ?? null) : existing.header_image_url,
      'backgroundImageUrl' in input
        ? (input.backgroundImageUrl ?? null)
        : existing.background_image_url,
      'hideHeaderIcon' in input ? (input.hideHeaderIcon ? 1 : 0) : existing.hide_header_icon,
      'customCssEnabled' in input
        ? (input.customCssEnabled ? 1 : 0)
        : existing.custom_css_enabled,
      'customCss' in input ? (input.customCss ?? null) : existing.custom_css,
      'googleSheetsEnabled' in input
        ? (input.googleSheetsEnabled ? 1 : 0)
        : existing.google_sheets_enabled,
      'googleSheetUrl' in input ? (input.googleSheetUrl ?? null) : existing.google_sheet_url,
      'googleSheetName' in input ? (input.googleSheetName ?? null) : existing.google_sheet_name,
      'themeMainColor' in input ? (input.themeMainColor ?? null) : existing.theme_main_color,
      'themeSubColor' in input ? (input.themeSubColor ?? null) : existing.theme_sub_color,
      'themeErrorColor' in input ? (input.themeErrorColor ?? null) : existing.theme_error_color,
      'themeTextColor' in input ? (input.themeTextColor ?? null) : existing.theme_text_color,
      'themeFont' in input ? (input.themeFont ?? null) : existing.theme_font,
      now,
      id,
    )
    .run();

  if ('lstepOptions' in input) {
    await db
      .prepare(`UPDATE forms SET lstep_options = ? WHERE id = ?`)
      .bind(input.lstepOptions ? JSON.stringify(input.lstepOptions) : null, id)
      .run();
  }

  return getFormById(db, id);
}

/**
 * フォームを複製する(Lステップの「コピー」相当)。createForm をそのまま
 * 経由することで、INSERT の列リストを二重管理してカラム数がずれる
 * (このファイルで繰り返し起きたバグ)のを避ける。
 */
export async function duplicateForm(db: D1Database, id: string): Promise<Form | null> {
  const existing = await getFormById(db, id);
  if (!existing) return null;
  return createForm(db, {
    name: `${existing.name}のコピー`,
    description: existing.description,
    folderId: existing.folder_id,
    fields: existing.fields,
    onSubmitTagId: existing.on_submit_tag_id,
    onSubmitScenarioId: existing.on_submit_scenario_id,
    onSubmitMessageType: existing.on_submit_message_type,
    onSubmitMessageContent: existing.on_submit_message_content,
    onSubmitWebhookUrl: existing.on_submit_webhook_url,
    onSubmitWebhookHeaders: existing.on_submit_webhook_headers,
    onSubmitWebhookFailMessage: existing.on_submit_webhook_fail_message,
    saveToMetadata: existing.save_to_metadata === 1,
    ogTitle: existing.og_title,
    ogDescription: existing.og_description,
    ogImageUrl: existing.og_image_url,
    expiresAt: existing.expires_at,
    capacityLimit: existing.capacity_limit,
    answerLimitPerFriend: existing.answer_limit_per_friend,
    restorePreviousAnswer: existing.restore_previous_answer === 1,
    thanksUrl: existing.thanks_url,
    primaryColor: existing.primary_color,
    onSubmitStopScenarios: existing.on_submit_stop_scenarios === 1,
    customDesignEnabled: existing.custom_design_enabled === 1,
    backgroundColor: existing.background_color,
    formBackgroundColor: existing.form_background_color,
    headerImageUrl: existing.header_image_url,
    backgroundImageUrl: existing.background_image_url,
    hideHeaderIcon: existing.hide_header_icon === 1,
    customCssEnabled: existing.custom_css_enabled === 1,
    customCss: existing.custom_css,
    googleSheetsEnabled: existing.google_sheets_enabled === 1,
    googleSheetUrl: existing.google_sheet_url,
    googleSheetName: existing.google_sheet_name,
    themeMainColor: existing.theme_main_color,
    themeSubColor: existing.theme_sub_color,
    themeErrorColor: existing.theme_error_color,
    themeTextColor: existing.theme_text_color,
    themeFont: existing.theme_font,
    lstepOptions: existing.lstep_options ? parseFormLstepOptions(existing.lstep_options) : null,
  });
}

export async function deleteForm(db: D1Database, id: string): Promise<void> {
  // フォームを参照しているウェビナー CTA カードも同時に削除する。宙吊りの
  // form_id が残ると、放置運用中のオートウェビナーでカードだけ出続けて
  // 全タップがエラーになる (D1 は FK 未強制)。
  await db.batch([
    db.prepare(`DELETE FROM webinar_ctas WHERE form_id = ?`).bind(id),
    db.prepare(`DELETE FROM forms WHERE id = ?`).bind(id),
  ]);
}

// ── Submissions ───────────────────────────────────────────────────────────────

export async function getFormSubmissions(
  db: D1Database,
  formId: string,
): Promise<FormSubmission[]> {
  const result = await db
    .prepare(
      `SELECT fs.*, f.display_name as friend_name FROM form_submissions fs
       LEFT JOIN friends f ON f.id = fs.friend_id
       WHERE fs.form_id = ? ORDER BY fs.created_at DESC`,
    )
    .bind(formId)
    .all<FormSubmission & { friend_name: string | null }>();
  return result.results;
}

/** 友だち詳細欄で使う、フォーム名・質問定義つきの最新回答履歴。 */
export async function getFormSubmissionsByFriend(
  db: D1Database,
  friendId: string,
  limit = 10,
): Promise<FriendFormSubmission[]> {
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 50));
  const result = await db
    .prepare(
      `SELECT fs.*, f.name AS form_name, f.fields AS form_fields
       FROM form_submissions fs
       JOIN forms f ON f.id = fs.form_id
       WHERE fs.friend_id = ?
       ORDER BY fs.created_at DESC
       LIMIT ?`,
    )
    .bind(friendId, safeLimit)
    .all<FriendFormSubmission>();
  return result.results;
}

export async function countFormSubmissions(db: D1Database, formId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS cnt FROM form_submissions WHERE form_id = ?`)
    .bind(formId)
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

/** 「1人が回答できる回数」「回答復元」の判定に使う、その友だちの直近の回答。 */
export async function getLatestSubmissionForFriend(
  db: D1Database,
  formId: string,
  friendId: string,
): Promise<FormSubmission | null> {
  return db
    .prepare(
      `SELECT * FROM form_submissions WHERE form_id = ? AND friend_id = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(formId, friendId)
    .first<FormSubmission>();
}

export interface CreateFormSubmissionInput {
  formId: string;
  friendId?: string | null;
  data: string; // JSON string
}

export async function createFormSubmission(
  db: D1Database,
  input: CreateFormSubmissionInput,
): Promise<FormSubmission> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO form_submissions (id, form_id, friend_id, data, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, input.formId, input.friendId ?? null, input.data, now)
    .run();

  // Increment submit_count
  await db
    .prepare(`UPDATE forms SET submit_count = submit_count + 1, updated_at = ? WHERE id = ?`)
    .bind(now, input.formId)
    .run();

  return (await db
    .prepare(`SELECT * FROM form_submissions WHERE id = ?`)
    .bind(id)
    .first<FormSubmission>())!;
}
