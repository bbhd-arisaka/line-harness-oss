import { Hono, type Context } from 'hono';
import {
  getForms,
  getFormsWithStats,
  getFormById,
  createForm,
  updateForm,
  deleteForm,
  duplicateForm,
  getFormFolders,
  createFormFolder,
  updateFormFolder,
  deleteFormFolder,
  getFormSubmissions,
  createFormSubmission,
  countFormSubmissions,
  getLatestSubmissionForFriend,
  getFriendById,
  getLineAccountById,
  jstNow,
  resolveDefaultLineAccount,
  stopAllFriendScenarios,
  updateFriendRegistrationFields,
  changedMetadataKeys,
  recordFriendInfoChanged,
  removeTagFromFriend,
  enrollFriendInReminder,
} from '@line-crm/db';
import type { FormLstepOptions } from '@line-crm/db';
import { checkDateAgainstRule, parseYmd, type DateRule } from '../lib/date-rules.js';
import { enrollFriendInScenario } from '@line-crm/db';
import { attachTagAndFireSideEffects } from '../services/friend-tag-attach.js';
import { verifyCallerLineUserId } from '../services/liff-auth.js';
import { findCallerFriend } from '../services/caller-friend.js';
import { exportSubmissionToGoogleSheet } from '../services/google-sheets-export.js';
import { pushViaHarnessProxy } from '../services/line-proxy-send.js';
import { dispatchLineProxyLocally } from '../services/local-line-proxy.js';
import type {
  Form as DbForm,
  FormFolder as DbFormFolder,
  FormSubmission as DbFormSubmission,
  FormUsedByAccount,
  Friend as DbFriend,
  FriendRegistrationTarget,
} from '@line-crm/db';
import type { Env } from '../index.js';

/** 選択肢ごとの選択人数を数える(キーは「項目名\u0000選択肢」)。定員数の判定用。 */
function countOptionSelections(
  submissions: Array<{ data: string }>,
  fields: Array<{ name: string; optionCapacity?: Record<string, number> }>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const sub of submissions) {
    let data: Record<string, unknown>;
    try { data = JSON.parse(sub.data) as Record<string, unknown>; } catch { continue; }
    for (const f of fields) {
      const v = data[f.name];
      const chosen = (Array.isArray(v) ? v : [v]).map((x) => String(x ?? ''));
      for (const opt of chosen) {
        if (f.optionCapacity && opt in f.optionCapacity) {
          const key = `${f.name}\u0000${opt}`;
          counts[key] = (counts[key] ?? 0) + 1;
        }
      }
    }
  }
  return counts;
}

/** forms.lstep_options(JSON文字列)を安全に読む。壊れていたら空オブジェクト。 */
function parseFormLstepOptions(raw: string | null | undefined): FormLstepOptions {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as FormLstepOptions) : {};
  } catch {
    return {};
  }
}
import { awardActivityMileage } from '../services/activity-mileage.js';

const forms = new Hono<Env>();

function optionalExecutionCtx(c: Context<Env>): ExecutionContext | undefined {
  try {
    return c.executionCtx;
  } catch {
    // Hono unit tests do not provide a Workers ExecutionContext.
    return undefined;
  }
}

async function resolveFriendAccessToken(
  db: D1Database,
  friend: DbFriend,
  defaultAccessToken: string,
): Promise<string> {
  const accountId = friend.line_account_id ?? null;
  if (!accountId) return defaultAccessToken;
  const account = await getLineAccountById(db, accountId);
  return account?.channel_access_token ?? defaultAccessToken;
}

/**
 * フォームの公開 URL（LIFF URL）を組み立てる。
 *
 * ホスト直下（`https://<host>/?page=form&id=...`）では **liff.init が完了せず
 * 永遠に読み込み中になる** — クライアントは `liffId` をクエリから読む設計で、
 * その値は `line_accounts` にしか無いため。正しくは liff.line.me 経由で開く。
 *
 * これをレスポンスに含めていなかったせいで、AI エージェントが自力で URL を
 * 組み立てて動かない画面を作る事故が起きた（2026-08-25 の実戦報告）。
 * `liffId` 未設定（LIFF 未構成）のテナントでは null を返す。
 */
function formPublicUrl(liffId: string | null | undefined, formId: string): string | null {
  if (!liffId) return null;
  return `https://liff.line.me/${liffId}?page=form&id=${formId}`;
}

function serializeForm(
  row: DbForm,
  extra?: { lastSubmittedAt?: string | null; usedByAccounts?: FormUsedByAccount[]; liffId?: string | null },
) {
  return {
    id: row.id,
    /** 公開 URL（LIFF）。LIFF 未設定なら null。ホスト直下の URL では動かない。 */
    formUrl: formPublicUrl(extra?.liffId, row.id),
    name: row.name,
    description: row.description,
    folderId: row.folder_id,
    fields: JSON.parse(row.fields || '[]') as unknown[],
    onSubmitTagId: row.on_submit_tag_id,
    onSubmitScenarioId: row.on_submit_scenario_id,
    onSubmitMessageType: row.on_submit_message_type,
    onSubmitMessageContent: row.on_submit_message_content,
    onSubmitWebhookUrl: row.on_submit_webhook_url,
    onSubmitWebhookHeaders: row.on_submit_webhook_headers,
    onSubmitWebhookFailMessage: row.on_submit_webhook_fail_message,
    saveToMetadata: Boolean(row.save_to_metadata),
    isActive: Boolean(row.is_active),
    submitCount: row.submit_count,
    ogTitle: row.og_title,
    ogDescription: row.og_description,
    ogImageUrl: row.og_image_url,
    expiresAt: row.expires_at,
    capacityLimit: row.capacity_limit,
    answerLimitPerFriend: row.answer_limit_per_friend,
    restorePreviousAnswer: Boolean(row.restore_previous_answer),
    thanksUrl: row.thanks_url,
    primaryColor: row.primary_color,
    onSubmitStopScenarios: Boolean(row.on_submit_stop_scenarios),
    customDesignEnabled: Boolean(row.custom_design_enabled),
    backgroundColor: row.background_color,
    formBackgroundColor: row.form_background_color,
    headerImageUrl: row.header_image_url,
    backgroundImageUrl: row.background_image_url,
    hideHeaderIcon: Boolean(row.hide_header_icon),
    customCssEnabled: Boolean(row.custom_css_enabled),
    customCss: row.custom_css,
    googleSheetsEnabled: Boolean(row.google_sheets_enabled),
    googleSheetUrl: row.google_sheet_url,
    googleSheetName: row.google_sheet_name,
    themeMainColor: row.theme_main_color,
    themeSubColor: row.theme_sub_color,
    themeErrorColor: row.theme_error_color,
    themeTextColor: row.theme_text_color,
    themeFont: row.theme_font,
    lstepOptions: parseFormLstepOptions(row.lstep_options),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSubmittedAt: extra?.lastSubmittedAt ?? null,
    usedByAccounts: extra?.usedByAccounts ?? [],
  };
}

function publicWebhookConfig(row: DbForm): {
  hasSubmitWebhook: boolean;
  webhookOrigin: string | null;
  webhookGateId: string | null;
} {
  if (!row.on_submit_webhook_url) {
    return { hasSubmitWebhook: false, webhookOrigin: null, webhookGateId: null };
  }

  try {
    const url = new URL(row.on_submit_webhook_url);
    const gateMatch = url.pathname.match(/\/engagement-gates\/([^/]+)\/verify\/?$/);
    return {
      hasSubmitWebhook: true,
      // The LIFF client needs the service origin for its public replier/verify
      // UX. Never expose the stored path, query string, or secret headers.
      webhookOrigin: url.origin,
      webhookGateId: gateMatch ? decodeURIComponent(gateMatch[1]) : null,
    };
  } catch {
    return { hasSubmitWebhook: true, webhookOrigin: null, webhookGateId: null };
  }
}

function serializePublicForm(
  row: DbForm,
  consultationWebinarSlug: string | null = null,
  status?: { isExpired: boolean; isFull: boolean; isNotStarted?: boolean; fullOptions?: Record<string, string[]> },
  previousAnswer: Record<string, unknown> | null = null,
) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    fields: JSON.parse(row.fields || '[]') as unknown[],
    isActive: Boolean(row.is_active),
    onSubmitMessageContent: row.on_submit_message_content,
    onSubmitWebhookFailMessage: row.on_submit_webhook_fail_message,
    primaryColor: row.primary_color,
    thanksUrl: row.thanks_url,
    lstepOptions: parseFormLstepOptions(row.lstep_options),
    isNotStarted: status?.isNotStarted ?? false,
    // 定員に達した選択肢(項目名 → 選択肢の配列)。公開フォームで選べなくする。
    fullOptions: status?.fullOptions ?? {},
    isExpired: status?.isExpired ?? false,
    isFull: status?.isFull ?? false,
    // Lステップの「回答復元」相当。restore_previous_answer が OFF、
    // または前回の回答が無ければ null のまま(LIFF 側は初期値のみ使う)。
    previousAnswer,
    // Lステップの「カラー/デザイン設定」タブ相当。トグルが OFF のままなら
    // 公開フォームへは一切出さない(Lステップも未使用時はデフォルト配色)。
    ...(row.custom_design_enabled
      ? {
          backgroundColor: row.background_color,
          formBackgroundColor: row.form_background_color,
          headerImageUrl: row.header_image_url,
          backgroundImageUrl: row.background_image_url,
          hideHeaderIcon: Boolean(row.hide_header_icon),
          customCss: row.custom_css_enabled ? row.custom_css : null,
          themeMainColor: row.theme_main_color,
          themeSubColor: row.theme_sub_color,
          themeErrorColor: row.theme_error_color,
          themeTextColor: row.theme_text_color,
          themeFont: row.theme_font,
        }
      : {}),
    // When this form belongs to an active webinar consultation funnel, the
    // LIFF form can switch directly to the same slot picker used by the live
    // CTA. The slug is public routing information; menu/staff IDs remain
    // server-side authorities and are never accepted from the browser.
    consultationWebinarSlug,
    ...publicWebhookConfig(row),
  };
}

/** 回答期限・先着数の判定。Lステップの「回答期限」「先着数制限」に相当。 */
async function computeFormAvailability(
  db: D1Database,
  row: DbForm,
): Promise<{ isExpired: boolean; isFull: boolean; isNotStarted: boolean; fullOptions: Record<string, string[]> }> {
  const isExpired = Boolean(row.expires_at) && row.expires_at! <= jstNow();
  const startsAt = parseFormLstepOptions(row.lstep_options).startsAt;
  const isNotStarted = Boolean(startsAt) && startsAt! > jstNow();
  let isFull = false;
  if (row.capacity_limit != null) {
    const count = await countFormSubmissions(db, row.id);
    isFull = count >= row.capacity_limit;
  }
  const fullOptions: Record<string, string[]> = {};
  try {
    const capped = (JSON.parse(row.fields || '[]') as Array<{ name: string; optionCapacity?: Record<string, number> }>)
      .filter((f) => f.optionCapacity && Object.keys(f.optionCapacity).length > 0);
    if (capped.length > 0) {
      const subs = await getFormSubmissions(db, row.id);
      const counts = countOptionSelections(subs, capped);
      for (const f of capped) {
        for (const [opt, limit] of Object.entries(f.optionCapacity ?? {})) {
          if ((counts[`${f.name}\u0000${opt}`] ?? 0) >= limit) (fullOptions[f.name] ??= []).push(opt);
        }
      }
    }
  } catch { /* 定員判定に失敗しても、フォーム自体の表示は止めない */ }
  return { isExpired, isFull, isNotStarted, fullOptions };
}

async function consultationWebinarSlugForForm(
  db: D1Database,
  formId: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT w.slug
         FROM webinar_ctas wc
         INNER JOIN webinars w
           ON w.id = wc.webinar_id AND w.status = 'active'
         INNER JOIN webinar_followup_configs cfg
           ON cfg.webinar_id = w.id
          AND cfg.is_active = 1
          AND cfg.booking_menu_id IS NOT NULL
        WHERE wc.form_id = ?
        ORDER BY datetime(COALESCE(cfg.stage_enabled_at, cfg.enabled_at)) DESC,
                 datetime(w.updated_at) DESC
        LIMIT 1`,
    )
    .bind(formId)
    .first<{ slug: string }>();
  return row?.slug ?? null;
}

function serializeSubmission(row: DbFormSubmission & { friend_name?: string | null }) {
  return {
    id: row.id,
    formId: row.form_id,
    friendId: row.friend_id,
    friendName: row.friend_name || null,
    data: JSON.parse(row.data || '{}') as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

// GET /api/forms/integrations/google-sheets — サービスアカウントの設定状況(共有先メールアドレス表示用)
forms.get('/api/forms/integrations/google-sheets', async (c) => {
  return c.json({
    success: true,
    data: {
      configured: Boolean(c.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && c.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
      serviceAccountEmail: c.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null,
    },
  });
});

function serializeFormFolder(row: DbFormFolder) {
  return {
    id: row.id,
    name: row.name,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── フォルダ(Lステップの回答フォーム一覧画面のフォルダ分け相当) ──────────────

forms.get('/api/forms/folders', async (c) => {
  try {
    const items = await getFormFolders(c.env.DB);
    return c.json({ success: true, data: items.map(serializeFormFolder) });
  } catch (err) {
    console.error('GET /api/forms/folders error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

forms.post('/api/forms/folders', async (c) => {
  try {
    const body = await c.req.json<{ name: string; displayOrder?: number }>();
    if (!body.name) {
      return c.json({ success: false, error: 'name is required' }, 400);
    }
    const folder = await createFormFolder(c.env.DB, { name: body.name, displayOrder: body.displayOrder });
    return c.json({ success: true, data: serializeFormFolder(folder) }, 201);
  } catch (err) {
    console.error('POST /api/forms/folders error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

forms.put('/api/forms/folders/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{ name?: string; displayOrder?: number }>();
    const updated = await updateFormFolder(c.env.DB, id, body);
    if (!updated) {
      return c.json({ success: false, error: 'Folder not found' }, 404);
    }
    return c.json({ success: true, data: serializeFormFolder(updated) });
  } catch (err) {
    console.error('PUT /api/forms/folders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

forms.delete('/api/forms/folders/:id', async (c) => {
  try {
    await deleteFormFolder(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/forms/folders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/forms — list all forms (with submission stats + delivering accounts)
forms.get('/api/forms', async (c) => {
  try {
    const items = await getFormsWithStats(c.env.DB);
    const liffId = (await resolveDefaultLineAccount(c.env.DB))?.liff_id ?? null;
    return c.json({
      success: true,
      data: items.map((row) =>
        serializeForm(row, {
          lastSubmittedAt: row.last_submitted_at,
          usedByAccounts: row.used_by_accounts,
          liffId,
        }),
      ),
    });
  } catch (err) {
    console.error('GET /api/forms error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/forms/:id — get form
forms.get('/api/forms/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const form = await getFormById(c.env.DB, id);
    if (!form) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    let previousAnswer: Record<string, unknown> | null = null;
    if (!c.get('staff') && form.restore_previous_answer) {
      const lineUserId = await verifyCallerLineUserId(c.req.header('Authorization'), c.env);
      const friend = lineUserId ? await findCallerFriend(c.env.DB, lineUserId, c.req.header('X-Liff-Id')) : null;
      if (friend) {
        const previous = await getLatestSubmissionForFriend(c.env.DB, id, friend.id);
        if (previous) {
          try {
            previousAnswer = JSON.parse(previous.data) as Record<string, unknown>;
          } catch {
            previousAnswer = null;
          }
        }
      }
    }

    const data = c.get('staff')
      ? serializeForm(form, { liffId: (await resolveDefaultLineAccount(c.env.DB))?.liff_id ?? null })
      : serializePublicForm(
          form,
          await consultationWebinarSlugForForm(c.env.DB, id),
          await computeFormAvailability(c.env.DB, form),
          previousAnswer,
        );
    return c.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/forms/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/forms — create form
forms.post('/api/forms', async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      description?: string | null;
      folderId?: string | null;
      fields?: unknown[];
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
    }>();

    if (!body.name) {
      return c.json({ success: false, error: 'name is required' }, 400);
    }

    const form = await createForm(c.env.DB, {
      name: body.name,
      description: body.description ?? null,
      folderId: body.folderId ?? null,
      fields: JSON.stringify(body.fields ?? []),
      onSubmitTagId: body.onSubmitTagId ?? null,
      onSubmitScenarioId: body.onSubmitScenarioId ?? null,
      onSubmitMessageType: body.onSubmitMessageType ?? null,
      onSubmitMessageContent: body.onSubmitMessageContent ?? null,
      onSubmitWebhookUrl: body.onSubmitWebhookUrl ?? null,
      onSubmitWebhookHeaders: body.onSubmitWebhookHeaders ?? null,
      onSubmitWebhookFailMessage: body.onSubmitWebhookFailMessage ?? null,
      saveToMetadata: body.saveToMetadata,
      ogTitle: body.ogTitle ?? null,
      ogDescription: body.ogDescription ?? null,
      ogImageUrl: body.ogImageUrl ?? null,
      expiresAt: body.expiresAt ?? null,
      capacityLimit: body.capacityLimit ?? null,
      answerLimitPerFriend: body.answerLimitPerFriend,
      restorePreviousAnswer: body.restorePreviousAnswer,
      thanksUrl: body.thanksUrl ?? null,
      primaryColor: body.primaryColor ?? null,
      onSubmitStopScenarios: body.onSubmitStopScenarios,
      customDesignEnabled: body.customDesignEnabled,
      backgroundColor: body.backgroundColor ?? null,
      formBackgroundColor: body.formBackgroundColor ?? null,
      headerImageUrl: body.headerImageUrl ?? null,
      backgroundImageUrl: body.backgroundImageUrl ?? null,
      hideHeaderIcon: body.hideHeaderIcon,
      customCssEnabled: body.customCssEnabled,
      customCss: body.customCss ?? null,
      googleSheetsEnabled: body.googleSheetsEnabled,
      googleSheetUrl: body.googleSheetUrl ?? null,
      googleSheetName: body.googleSheetName ?? null,
      themeMainColor: body.themeMainColor ?? null,
      themeSubColor: body.themeSubColor ?? null,
      themeErrorColor: body.themeErrorColor ?? null,
      themeTextColor: body.themeTextColor ?? null,
      themeFont: body.themeFont ?? null,
      lstepOptions: body.lstepOptions ?? null,
    });

    const liffId = (await resolveDefaultLineAccount(c.env.DB))?.liff_id ?? null;
    return c.json({ success: true, data: serializeForm(form, { liffId }) }, 201);
  } catch (err) {
    console.error('POST /api/forms error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/forms/:id/duplicate — フォームを複製(Lステップの「コピー」相当)
forms.post('/api/forms/:id/duplicate', async (c) => {
  try {
    const copy = await duplicateForm(c.env.DB, c.req.param('id'));
    if (!copy) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    const liffId = (await resolveDefaultLineAccount(c.env.DB))?.liff_id ?? null;
    return c.json({ success: true, data: serializeForm(copy, { liffId }) }, 201);
  } catch (err) {
    console.error('POST /api/forms/:id/duplicate error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/forms/:id — update form
forms.put('/api/forms/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{
      name?: string;
      description?: string | null;
      folderId?: string | null;
      fields?: unknown[];
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
    }>();

    // Only include fields that were explicitly sent (avoid undefined → null conversion)
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.folderId !== undefined) updates.folderId = body.folderId;
    if (body.fields !== undefined) updates.fields = JSON.stringify(body.fields);
    if (body.onSubmitTagId !== undefined) updates.onSubmitTagId = body.onSubmitTagId;
    if (body.onSubmitScenarioId !== undefined) updates.onSubmitScenarioId = body.onSubmitScenarioId;
    if (body.onSubmitMessageType !== undefined) updates.onSubmitMessageType = body.onSubmitMessageType;
    if (body.onSubmitMessageContent !== undefined) updates.onSubmitMessageContent = body.onSubmitMessageContent;
    if (body.onSubmitWebhookUrl !== undefined) updates.onSubmitWebhookUrl = body.onSubmitWebhookUrl;
    if (body.onSubmitWebhookHeaders !== undefined) updates.onSubmitWebhookHeaders = body.onSubmitWebhookHeaders;
    if (body.onSubmitWebhookFailMessage !== undefined) updates.onSubmitWebhookFailMessage = body.onSubmitWebhookFailMessage;
    if (body.saveToMetadata !== undefined) updates.saveToMetadata = body.saveToMetadata;
    if (body.isActive !== undefined) updates.isActive = body.isActive;
    if (body.ogTitle !== undefined) updates.ogTitle = body.ogTitle;
    if (body.ogDescription !== undefined) updates.ogDescription = body.ogDescription;
    if (body.ogImageUrl !== undefined) updates.ogImageUrl = body.ogImageUrl;
    if (body.expiresAt !== undefined) updates.expiresAt = body.expiresAt;
    if (body.capacityLimit !== undefined) updates.capacityLimit = body.capacityLimit;
    if (body.answerLimitPerFriend !== undefined) updates.answerLimitPerFriend = body.answerLimitPerFriend;
    if (body.restorePreviousAnswer !== undefined) updates.restorePreviousAnswer = body.restorePreviousAnswer;
    if (body.thanksUrl !== undefined) updates.thanksUrl = body.thanksUrl;
    if (body.primaryColor !== undefined) updates.primaryColor = body.primaryColor;
    if (body.onSubmitStopScenarios !== undefined) updates.onSubmitStopScenarios = body.onSubmitStopScenarios;
    if (body.customDesignEnabled !== undefined) updates.customDesignEnabled = body.customDesignEnabled;
    if (body.backgroundColor !== undefined) updates.backgroundColor = body.backgroundColor;
    if (body.formBackgroundColor !== undefined) updates.formBackgroundColor = body.formBackgroundColor;
    if (body.headerImageUrl !== undefined) updates.headerImageUrl = body.headerImageUrl;
    if (body.backgroundImageUrl !== undefined) updates.backgroundImageUrl = body.backgroundImageUrl;
    if (body.hideHeaderIcon !== undefined) updates.hideHeaderIcon = body.hideHeaderIcon;
    if (body.customCssEnabled !== undefined) updates.customCssEnabled = body.customCssEnabled;
    if (body.customCss !== undefined) updates.customCss = body.customCss;
    if (body.googleSheetsEnabled !== undefined) updates.googleSheetsEnabled = body.googleSheetsEnabled;
    if (body.googleSheetUrl !== undefined) updates.googleSheetUrl = body.googleSheetUrl;
    if (body.googleSheetName !== undefined) updates.googleSheetName = body.googleSheetName;
    if (body.themeMainColor !== undefined) updates.themeMainColor = body.themeMainColor;
    if (body.themeSubColor !== undefined) updates.themeSubColor = body.themeSubColor;
    if (body.themeErrorColor !== undefined) updates.themeErrorColor = body.themeErrorColor;
    if (body.themeTextColor !== undefined) updates.themeTextColor = body.themeTextColor;
    if (body.themeFont !== undefined) updates.themeFont = body.themeFont;
    if (body.lstepOptions !== undefined) updates.lstepOptions = body.lstepOptions;

    const updated = await updateForm(c.env.DB, id, updates as any);

    if (!updated) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }

    const liffId = (await resolveDefaultLineAccount(c.env.DB))?.liff_id ?? null;
    return c.json({ success: true, data: serializeForm(updated, { liffId }) });
  } catch (err) {
    console.error('PUT /api/forms/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/forms/:id
forms.delete('/api/forms/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const form = await getFormById(c.env.DB, id);
    if (!form) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    await deleteForm(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/forms/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/forms/:id/submissions — list submissions
forms.get('/api/forms/:id/submissions', async (c) => {
  try {
    const id = c.req.param('id');
    const form = await getFormById(c.env.DB, id);
    if (!form) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    const submissions = await getFormSubmissions(c.env.DB, id);
    return c.json({ success: true, data: submissions.map(serializeSubmission) });
  } catch (err) {
    console.error('GET /api/forms/:id/submissions error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/forms/:id/opened — record form open event (public, used by LIFF)
forms.post('/api/forms/:id/opened', async (c) => {
  try {
    const formId = c.req.param('id');
    // Open analytics may remain anonymous, but a caller can only attribute an
    // open to the LINE identity proven by its ID token. Body-supplied customer
    // IDs are intentionally ignored.
    const lineUserId = await verifyCallerLineUserId(c.req.header('Authorization'), c.env);
    const friend = lineUserId
      ? await findCallerFriend(c.env.DB, lineUserId, c.req.header('X-Liff-Id'))
      : null;

    const now = jstNow();
    await c.env.DB.prepare(
      'INSERT INTO form_opens (id, form_id, friend_id, friend_name, opened_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(
      crypto.randomUUID(),
      formId,
      friend?.id ?? null,
      friend?.display_name ?? null,
      now,
    ).run();

    return c.json({ success: true });
  } catch (err) {
    console.error('POST /api/forms/:id/opened error:', err);
    return c.json({ success: true }); // non-blocking, always succeed
  }
});

// POST /api/forms/:id/partial — save survey answers without x_username (public, used by LIFF page 1)
forms.post('/api/forms/:id/partial', async (c) => {
  try {
    const body = await c.req.json<{ data?: Record<string, unknown> }>();
    const lineUserId = await verifyCallerLineUserId(c.req.header('Authorization'), c.env);
    if (!lineUserId) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    const friend = await findCallerFriend(c.env.DB, lineUserId, c.req.header('X-Liff-Id'));

    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    // Save survey data to friend metadata (merge with existing)
    const existingMeta = friend.metadata ? JSON.parse(friend.metadata) : {};
    const merged = { ...existingMeta, ...body.data };
    await c.env.DB.prepare(
      'UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?',
    ).bind(JSON.stringify(merged), jstNow(), friend.id).run();

    return c.json({ success: true });
  } catch (err) {
    console.error('POST /api/forms/:id/partial error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/forms/:id/submit — submit form (public, used by LIFF)
forms.post('/api/forms/:id/submit', async (c) => {
  try {
    const formId = c.req.param('id');
    const form = await getFormById(c.env.DB, formId);
    if (!form) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    if (!form.is_active) {
      return c.json({ success: false, error: 'This form is no longer accepting responses' }, 400);
    }
    if (form.expires_at && form.expires_at <= jstNow()) {
      return c.json({ success: false, error: 'この回答フォームは回答期限を過ぎています' }, 400);
    }
    const startsAt = parseFormLstepOptions(form.lstep_options).startsAt;
    if (startsAt && startsAt > jstNow()) {
      return c.json({ success: false, error: 'この回答フォームはまだ回答を受け付けていません' }, 400);
    }
    if (form.capacity_limit != null) {
      const count = await countFormSubmissions(c.env.DB, formId);
      if (count >= form.capacity_limit) {
        return c.json({ success: false, error: 'この回答フォームは先着数に達しました' }, 400);
      }
    }

    const body = await c.req.json<{
      data?: Record<string, unknown>;
      trackedLinkId?: string;
    }>();

    const submissionData = body.data ?? {};

    const lineUserId = await verifyCallerLineUserId(c.req.header('Authorization'), c.env);
    if (!lineUserId) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    const friend = await findCallerFriend(c.env.DB, lineUserId, c.req.header('X-Liff-Id'));
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }
    const friendId = friend.id;

    if (form.answer_limit_per_friend === 'once') {
      const previous = await getLatestSubmissionForFriend(c.env.DB, formId, friendId);
      if (previous) {
        return c.json({ success: false, error: 'このフォームは1人1回のみ回答できます' }, 400);
      }
    }

    // Validate required fields
    const fields = JSON.parse(form.fields || '[]') as Array<{
      name: string;
      label: string;
      type: string;
      required?: boolean;
      // Lステップ新形式の「回答の登録先(複数可)」相当。本名/システム表示名/個別メモ/
      // 友だち情報(カスタム項目)のいずれか複数へ、この項目の回答をそのまま書き込む。
      registrationTargets?: FriendRegistrationTarget[];
      // ラジオ/チェックボックスの「選択時の動作」相当。
      optionTags?: Record<string, string[]>;
      friendFieldKey?: string;
      optionFriendFieldValues?: Record<string, string>;
      // 選択肢ごとの「アクション」(タグ追加/削除・シナリオ開始)
      optionActions?: Record<string, { addTagIds?: string[]; removeTagIds?: string[]; scenarioId?: string }>;
      // 選択肢ごとの定員数(先着)
      optionCapacity?: Record<string, number>;
      // 日付ブロックの入力制限・リマインダ連携
      dateRule?: DateRule;
      reminderId?: string;
      reminderTime?: string;
    }>;

    for (const field of fields) {
      if (field.required) {
        const val = submissionData[field.name];
        if (val === undefined || val === null || val === '') {
          return c.json(
            { success: false, error: `${field.label} は必須項目です` },
            400,
          );
        }
      }
    }

    // 日付ブロックの入力制限(開始日・終了日・曜日・祝日)と、ファイルブロックの値の検証。
    {
      const today = parseYmd(jstNow().slice(0, 10)) ?? new Date();
      for (const field of fields) {
        const val = submissionData[field.name];
        if (val === undefined || val === null || val === '') continue;
        if (field.type === 'date') {
          const err = checkDateAgainstRule(String(val), field.dateRule, today);
          if (err) return c.json({ success: false, error: `${field.label}: ${err}` }, 400);
        }
        if (field.type === 'file') {
          // 添付ファイルは、このフォームの upload API で保存したものだけを受け付ける
          if (typeof val !== 'string' || !val.includes(`/api/form-uploads/${formId}/`)) {
            return c.json({ success: false, error: `${field.label}: 添付ファイルが正しくありません` }, 400);
          }
        }
      }
    }

    // 選択肢ごとの定員数(先着)。満員の選択肢を選んだ回答は受け付けない。
    {
      const capped = fields.filter((f) => f.optionCapacity && Object.keys(f.optionCapacity).length > 0);
      if (capped.length > 0) {
        const existing = await getFormSubmissions(c.env.DB, formId);
        const counts = countOptionSelections(existing, capped);
        for (const field of capped) {
          const chosen = submissionData[field.name];
          const selected = (Array.isArray(chosen) ? chosen : [chosen]).map((v) => String(v ?? ''));
          for (const opt of selected) {
            const limit = field.optionCapacity?.[opt];
            if (limit != null && (counts[`${field.name}\u0000${opt}`] ?? 0) >= limit) {
              return c.json({ success: false, error: `「${opt}」は定員に達したため選択できません` }, 400);
            }
          }
        }
      }
    }

    // Browser-side verification is UX only. The server always performs the
    // authoritative webhook check; client-supplied skip flags are discarded.
    delete submissionData._webhookVerified;
    delete submissionData._skipWebhook;
    let webhookData: Record<string, unknown> | null = null;
    if (form.on_submit_webhook_url) {
      const webhookResult = await callFormWebhook(form, submissionData);
      webhookData = webhookResult.data as Record<string, unknown> | null;
      if (!webhookResult.passed) {
        // Webhook rejected — send fail message and stop
        if (form.on_submit_webhook_fail_message) {
          if (friend.line_user_id) {
            try {
              const accessToken = await resolveFriendAccessToken(
                c.env.DB,
                friend,
                c.env.LINE_CHANNEL_ACCESS_TOKEN,
              );
              await pushViaHarnessProxy(
                new URL(c.req.url).origin,
                accessToken,
                friend.line_user_id,
                [{ type: 'text', text: form.on_submit_webhook_fail_message }],
                crypto.randomUUID(),
                (request) => dispatchLineProxyLocally(request, c.env, optionalExecutionCtx(c)),
              );
            } catch (e) {
              console.error('Failed to send webhook fail message:', e);
            }
          }
        }
        // Still save the submission for records
        const submission = await createFormSubmission(c.env.DB, {
          formId,
          friendId,
          data: JSON.stringify({ ...submissionData, _webhookResult: webhookResult.data }),
        });
        return c.json({ success: true, data: { ...serializeSubmission(submission), webhookPassed: false, webhookData: webhookResult.data } }, 201);
      }
    }

    // Save submission against the authenticated caller only.
    const submission = await createFormSubmission(c.env.DB, {
      formId,
      friendId,
      data: JSON.stringify(submissionData),
    });

    await awardActivityMileage(c.env.DB, {
      eventType: 'form_submitted',
      source: 'form',
      sourceEventId: submission.id,
      friendId,
      subjectKey: formId,
      metadata: { formId, formName: form.name },
      occurredAt: submission.created_at,
    });

    // Side effects (best-effort, don't fail the request)
    {
      const db = c.env.DB;
      const now = jstNow();

      // Resolve reward template per-campaign.
      //
      // Priority:
      //   1. body.trackedLinkId (= ?ref= from /r/:ref → LIFF → form). This lets
      //      X Harness campaign settings drive the reward, even for friends who
      //      were originally added via a different campaign.
      //   2. Fallback to friends.first_tracked_link_id (first-touch attribution)
      //      so existing tracked links without ref pass-through still work.
      //
      // This OVERRIDES form.on_submit_message_*.
      //
      // Note: anti-replay (preventing the same friend from claiming the same
      // reward twice via URL tampering) is intentionally NOT enforced. The
      // product is opt-in oriented and the engagement gate handles real
      // anti-fraud upstream.
      let rewardTemplate: import('@line-crm/db').MessageTemplate | null = null;
      {
        const { getFriendById, getTrackedLinkById, getMessageTemplateById } = await import('@line-crm/db');
        const { resolveRewardTemplate } = await import('../services/reward-resolver.js');
        rewardTemplate = await resolveRewardTemplate(
          db,
          {
            friendId,
            requestedTrackedLinkId: body.trackedLinkId ?? null,
          },
          { getFriendById, getTrackedLinkById, getMessageTemplateById },
        );
      }

      const sideEffects: Promise<unknown>[] = [];

      // Save response data to friend's metadata
      if (form.save_to_metadata) {
        sideEffects.push(
          (async () => {
            const friend = await getFriendById(db, friendId!);
            if (!friend) return;
            const existing = JSON.parse(friend.metadata || '{}') as Record<string, unknown>;
            const merged = { ...existing, ...submissionData };
            await db
              .prepare(`UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?`)
              .bind(JSON.stringify(merged), now, friendId)
              .run();
            // トークの出来事のログ: 友だち情報欄として定義のある項目だけ(フォームの質問名は出さない)
            await recordFriendInfoChanged(db, {
              friendId: friendId!,
              lineAccountId: friend.line_account_id ?? null,
              keys: changedMetadataKeys(existing, submissionData),
              actor: 'フォーム',
              onlyDefined: true,
            });
          })(),
        );
      }

      // Lステップ新形式の「回答の登録先(複数可)」「選択時の動作」相当。
      // 本名/システム表示名/個別メモ/友だち情報(カスタム項目)への書き込みと、
      // ラジオ・チェックボックスの選択肢ごとのタグ追加・友だち情報への値書き込みを行う。
      {
        const metadataPatch: Record<string, unknown> = {};
        let realNamePatch: string | undefined;
        let displayNamePatch: string | undefined;
        let memoPatch: string | undefined;
        const tagIdsToAttach = new Set<string>();
        const tagIdsToDetach = new Set<string>();
        const scenarioIdsToStart = new Set<string>();

        for (const field of fields) {
          const value = submissionData[field.name];
          if (value === undefined) continue;

          if (Array.isArray(field.registrationTargets)) {
            const textValue = Array.isArray(value) ? value.join(', ') : String(value ?? '');
            for (const target of field.registrationTargets) {
              if (target.type === 'real_name') realNamePatch = textValue;
              else if (target.type === 'display_name') displayNamePatch = textValue;
              else if (target.type === 'memo') memoPatch = textValue;
              else if (target.type === 'friend_field' && target.fieldKey) metadataPatch[target.fieldKey] = value;
            }
          }

          if (field.type === 'radio' || field.type === 'checkbox' || field.type === 'select') {
            const selected = Array.isArray(value) ? value : [value];
            const friendValues: string[] = [];
            for (const opt of selected) {
              const optStr = String(opt);
              // 「その他(自由入力)」は、選択肢名「その他」の設定を使う
              const optKey = optStr.startsWith('その他(') ? 'その他' : optStr;
              const tagIds = field.optionTags?.[optKey];
              if (tagIds) for (const id of tagIds) tagIdsToAttach.add(id);
              const action = field.optionActions?.[optKey];
              if (action) {
                for (const id of action.addTagIds ?? []) tagIdsToAttach.add(id);
                for (const id of action.removeTagIds ?? []) tagIdsToDetach.add(id);
                if (action.scenarioId) scenarioIdsToStart.add(action.scenarioId);
              }
              if (field.friendFieldKey) {
                // 「登録する値」が空なら、選択肢の文言をそのまま友だち情報へ入れる
                const custom = field.optionFriendFieldValues?.[optKey];
                friendValues.push(custom !== undefined && custom !== '' ? custom : optStr);
              }
            }
            if (field.friendFieldKey && friendValues.length > 0) {
              metadataPatch[field.friendFieldKey] = field.type === 'checkbox' ? friendValues.join(', ') : friendValues[0];
            }
          }
        }

        if (
          realNamePatch !== undefined ||
          displayNamePatch !== undefined ||
          memoPatch !== undefined ||
          Object.keys(metadataPatch).length > 0
        ) {
          sideEffects.push(
            updateFriendRegistrationFields(db, friendId, {
              ...(realNamePatch !== undefined ? { realName: realNamePatch } : {}),
              ...(displayNamePatch !== undefined ? { systemDisplayName: displayNamePatch } : {}),
              ...(memoPatch !== undefined ? { memo: memoPatch } : {}),
              ...(Object.keys(metadataPatch).length > 0 ? { metadataPatch } : {}),
            }, { actor: 'フォーム' }),
          );
        }
        for (const tagId of tagIdsToAttach) {
          sideEffects.push(
            attachTagAndFireSideEffects(db, friendId, tagId, {
              defaultAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
              workerUrl: c.env.WORKER_URL,
            }, { actor: 'フォーム' }),
          );
        }
        for (const tagId of tagIdsToDetach) {
          if (!tagIdsToAttach.has(tagId)) sideEffects.push(removeTagFromFriend(db, friendId, tagId, { actor: 'フォーム' }));
        }
        for (const scenarioId of scenarioIdsToStart) {
          sideEffects.push(enrollFriendInScenario(db, friendId, scenarioId));
        }
        // 日付ブロックの「リマインダを設定」: 回答者が入力した日付(+時刻)を基準に、リマインダ配信へ登録する
        for (const field of fields) {
          const v = submissionData[field.name];
          if (field.type !== 'date' || !field.reminderId || typeof v !== 'string' || !parseYmd(v)) continue;
          const time = /^\d{2}:\d{2}$/.test(field.reminderTime ?? '') ? field.reminderTime! : '12:00';
          sideEffects.push(
            enrollFriendInReminder(db, { friendId, reminderId: field.reminderId, targetDate: `${v}T${time}:00.000+09:00` }),
          );
        }
      }

      // Add tag — guarded attach so a tag_added-triggered scenario fires on
      // first-time submit (and never re-fires on duplicate submits).
      if (form.on_submit_tag_id) {
        sideEffects.push(attachTagAndFireSideEffects(db, friendId, form.on_submit_tag_id, {
          defaultAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
          workerUrl: c.env.WORKER_URL,
        }, { actor: 'フォーム' }));
      }

      // Enroll in scenario
      if (form.on_submit_scenario_id) {
        sideEffects.push(enrollFriendInScenario(db, friendId, form.on_submit_scenario_id));
      }

      // Lステップの「シナリオを停止」相当。進行中の全シナリオを終了させる。
      if (form.on_submit_stop_scenarios) {
        sideEffects.push(stopAllFriendScenarios(db, friendId));
      }

      // Lステップの「Googleスプレッドシート連携 β版」相当。失敗しても回答自体は保存済み(allSettledでログのみ)。
      if (form.google_sheets_enabled && form.google_sheet_url) {
        sideEffects.push(
          exportSubmissionToGoogleSheet(c.env, form, submissionData, {
            friendName: friend.display_name,
            submittedAt: submission.created_at,
          }),
        );
      }

      // If webhook returned a join_url (e.g. Meet Harness), send a Flex button to the user
      if (webhookData?.join_url) {
        sideEffects.push(
          (async () => {
            const friend = await getFriendById(db, friendId!);
            if (!friend?.line_user_id) return;
            const accessToken = await resolveFriendAccessToken(
              db,
              friend,
              c.env.LINE_CHANNEL_ACCESS_TOKEN,
            );
            const joinUrl = String(webhookData!.join_url);
            const meetFlex = {
              type: 'bubble',
              header: {
                type: 'box', layout: 'vertical',
                contents: [
                  { type: 'text', text: 'ヒアリングの準備ができました', size: 'md', weight: 'bold', color: '#1e293b' },
                ],
                paddingAll: '20px', backgroundColor: '#f0f9ff',
              },
              body: {
                type: 'box', layout: 'vertical',
                contents: [
                  { type: 'text', text: 'アンケートありがとうございます。続けて短いヒアリングにご協力ください。', size: 'sm', color: '#475569', wrap: true },
                ],
                paddingAll: '20px',
              },
              footer: {
                type: 'box', layout: 'vertical',
                contents: [
                  {
                    type: 'button', style: 'primary', color: '#4CAF50',
                    action: { type: 'uri', label: 'ヒアリングを始める', uri: joinUrl },
                  },
                ],
                paddingAll: '16px',
              },
            };
            await pushViaHarnessProxy(
              new URL(c.req.url).origin,
              accessToken,
              friend.line_user_id,
              [{ type: 'flex', altText: 'ヒアリングの準備ができました', contents: meetFlex }],
              crypto.randomUUID(),
              (request) => dispatchLineProxyLocally(request, c.env, optionalExecutionCtx(c)),
            );
          })(),
        );
      }

      // Send confirmation message with submitted data back to user
      sideEffects.push(
        (async () => {
          console.log('Form reply: starting for friendId', friendId);
          const friend = await getFriendById(db, friendId!);
          if (!friend?.line_user_id) { console.log('Form reply: no line_user_id'); return; }
          console.log('Form reply: sending to', friend.line_user_id);
          const accessToken = await resolveFriendAccessToken(
            db,
            friend,
            c.env.LINE_CHANNEL_ACCESS_TOKEN,
          );
          const { buildMessage, expandVariables } = await import('../services/step-delivery.js');
          const apiOrigin = new URL(c.req.url).origin;
          const { resolveMetadata } = await import('../services/step-delivery.js');
          const resolvedMeta = await resolveMetadata(c.env.DB, { user_id: (friend as unknown as Record<string, string | null>).user_id, metadata: (friend as unknown as Record<string, string | null>).metadata });
          const friendData = {
            id: friend.id,
            display_name: friend.display_name,
            user_id: (friend as unknown as Record<string, string | null>).user_id,
            ref_code: (friend as unknown as Record<string, string | null>).ref_code,
            metadata: resolvedMeta,
          };

          // 回答後メッセージの種類(フォームごとに設定)。未設定のフォームは「送らない」。
          // 以前は未設定でも、宣伝文入りの「診断結果」カードを自動で送っていた(お客様向けには不適切)。
          const answerMessage = parseFormLstepOptions(form.lstep_options).answerMessage;
          const answerMode: 'none' | 'summary' | 'custom' =
            answerMessage?.mode ?? (form.on_submit_message_type && form.on_submit_message_content ? 'custom' : 'none');

          // Build the answer-summary Flex card showing their answers
          const entries = Object.entries(submissionData as Record<string, unknown>);
          const answerRows = entries.map(([key, value]) => {
            const field = form.fields ? (JSON.parse(form.fields) as Array<{ name: string; label: string }>).find((f: { name: string }) => f.name === key) : null;
            const label = field?.label || key;
            const val = Array.isArray(value) ? value.join(', ') : (value !== null && value !== undefined && value !== '') ? String(value) : '-';
            return {
              type: 'box' as const, layout: 'vertical' as const, margin: 'md' as const,
              contents: [
                { type: 'text' as const, text: label, size: 'xxs' as const, color: '#64748b' },
                { type: 'text' as const, text: val, size: 'sm' as const, color: '#1e293b', weight: 'bold' as const, wrap: true },
              ],
            };
          });

          const resultFlex = {
            type: 'bubble', size: 'giga',
            header: {
              type: 'box', layout: 'vertical',
              contents: [
                { type: 'text', text: answerMessage?.title?.trim() || 'ご回答内容', size: 'lg', weight: 'bold', color: '#1e293b' },
                { type: 'text', text: `${friend.display_name || ''}さんの回答`, size: 'xs', color: '#64748b', margin: 'sm' },
              ],
              paddingAll: '20px', backgroundColor: '#f0fdf4',
            },
            body: {
              type: 'box', layout: 'vertical',
              contents: [
                ...answerRows,
              ],
              paddingAll: '20px',
            },
          };

          const messages: ReturnType<typeof buildMessage>[] = [];

          const { buildRewardMessage } = await import('../services/reward-message.js');
          const rewardFromTrackedLink = buildRewardMessage(rewardTemplate, friend.display_name);

          if (rewardFromTrackedLink) {
            // Tracked-link reward template overrides everything (per-campaign reward)
            messages.push(rewardFromTrackedLink as ReturnType<typeof buildMessage>);
          } else if (answerMode === 'custom' && form.on_submit_message_type && form.on_submit_message_content) {
            // 自分で書いた回答後メッセージ
            const expanded = expandVariables(form.on_submit_message_content, friendData, apiOrigin, form.on_submit_message_type);
            // 1:1 push → /t リンクに f=<friendId> を焼き込み (LIFF 識別ホップ回避)
            const { appendFriendToTrackedLinks } = await import('../services/auto-track.js');
            const decorated = await appendFriendToTrackedLinks(db, expanded, apiOrigin, friend.id);
            messages.push(buildMessage(form.on_submit_message_type, decorated));
          } else if (answerMode === 'summary') {
            messages.push(buildMessage('flex', JSON.stringify(resultFlex)));
          }

          // 「送らない」設定(既定)のときは、何も送信しない
          if (messages.length === 0) return;

          // プロキシが LINE 送信と messages_log 記録を一体で行う。
          await pushViaHarnessProxy(
            new URL(c.req.url).origin,
            accessToken,
            friend.line_user_id,
            messages,
            crypto.randomUUID(),
            (request) => dispatchLineProxyLocally(request, c.env, optionalExecutionCtx(c)),
          );
        })(),
      );

      if (sideEffects.length > 0) {
        const results = await Promise.allSettled(sideEffects);
        for (const r of results) {
          if (r.status === 'rejected') console.error('Form side-effect failed:', r.reason);
        }
      }
    }

    return c.json({ success: true, data: serializeSubmission(submission) }, 201);
  } catch (err) {
    console.error('POST /api/forms/:id/submit error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

async function callFormWebhook(
  form: DbForm,
  submissionData: Record<string, unknown>,
): Promise<{ passed: boolean; data: unknown }> {
  if (!form.on_submit_webhook_url) return { passed: true, data: null };

  try {
    // Replace {field_name} placeholders in URL with submitted values
    let url = form.on_submit_webhook_url;
    for (const [key, value] of Object.entries(submissionData)) {
      url = url.replace(`{${key}}`, encodeURIComponent(String(value ?? '')));
    }

    // Parse headers
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (form.on_submit_webhook_headers) {
      try {
        const parsed = JSON.parse(form.on_submit_webhook_headers) as Record<string, string>;
        Object.assign(headers, parsed);
      } catch { /* ignore invalid headers */ }
    }

    // Determine method: GET if URL has {placeholders} replaced, POST otherwise
    const isGet = form.on_submit_webhook_url.includes('{');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      method: isGet ? 'GET' : 'POST',
      headers,
      signal: controller.signal,
      ...(isGet ? {} : { body: JSON.stringify(submissionData) }),
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { passed: false, data: { error: `HTTP ${res.status}` } };
    }

    const data = await res.json() as Record<string, unknown>;

    // Check for eligibility — support both { eligible: bool } and { success: bool, data: { eligible: bool } }
    const eligible = data.eligible ?? (data.data as Record<string, unknown> | undefined)?.eligible ?? data.success;
    return { passed: Boolean(eligible), data };
  } catch (err) {
    console.error('Form webhook error:', err);
    return { passed: false, data: { error: String(err) } };
  }
}

export { forms };
