import type { LineClient, Message } from '@line-crm/line-sdk';
import { jstNow } from '@line-crm/db';
import type { FriendAddAction, Friend } from '@line-crm/db';
import { parseTemplatePostback } from '@line-crm/shared';
import type { CarouselData, ChoiceDef, FlexEditorData, QuestionData, ReplyDef, TapLimit } from '@line-crm/shared';
import { applyScenarioAndActions } from './friend-add-settings.js';
import { logOutgoingMessage } from './event-bus.js';
import { expandFormLinks } from './form-link.js';
import { buildMessages, expandVariables, messageToLogPayload, resolveMetadata } from './step-delivery.js';

export const TEMPLATE_POSTBACK_PREFIX = 'tpl:';
export const TAP_LIMIT_NOTICE = 'このメッセージはすでに選択済みです。';

export type TemplateReplySender = (replyToken: string, messages: Message[]) => Promise<void>;

interface TemplateRow {
  id: string;
  editor_type: string | null;
  editor_data: string | null;
}

interface Resolved {
  choice: ChoiceDef;
  tapLimit: TapLimit;
  limitReply: 'default' | 'none';
  limitActions: unknown[];
}

const parseJson = <T>(s: string | null): T | null => {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

/** テンプレートの中の「押された選択肢」を取り出す。見つからなければ null */
export function resolveTappedChoice(editorType: string | null, data: unknown, panel: number, index: number): Resolved | null {
  if (!data || typeof data !== 'object') return null;
  if (editorType === 'question') {
    const d = data as QuestionData;
    const choice = d.choices?.[index];
    if (!choice) return null;
    // 詳細設定ONのとき: 1つのみタップ可能=全体で1回、両方タップ可能=選択肢ごとに1回
    const tapLimit: TapLimit = d.detail ? ((d.answerMode ?? 'single') === 'single' ? 'carousel_once' : 'choice_once') : 'none';
    return { choice, tapLimit, limitReply: 'default', limitActions: [] };
  }
  if (editorType === 'carousel') {
    const d = data as CarouselData;
    const choice = d.panels?.[panel]?.choices?.[index];
    if (!choice) return null;
    return { choice, tapLimit: d.tapLimit ?? 'none', limitReply: d.limitReply ?? 'default', limitActions: d.limitActions ?? [] };
  }
  if (editorType === 'flex') {
    const d = data as FlexEditorData;
    const block = d.panels?.[panel]?.blocks?.[index];
    if (!block) return null;
    const action = block.type === 'button' || block.type === 'image' || block.type === 'video' ? block.action : undefined;
    if (!action || action.kind !== 'actions') return null;
    const choice: ChoiceDef = { label: '', behavior: { kind: 'actions', actions: action.actions } };
    return { choice, tapLimit: d.tapLimit ?? 'none', limitReply: 'default', limitActions: [] };
  }
  return null;
}

/** 回数制限に引っかかるか。引っかかるなら、すでに押された記録がある */
function limited(limit: TapLimit, rows: Array<{ panel: number; choice: number }>, panel: number, choice: number): boolean {
  if (limit === 'carousel_once') return rows.length > 0;
  if (limit === 'panel_once') return rows.some((r) => r.panel === panel);
  if (limit === 'choice_once') return rows.some((r) => r.panel === panel && r.choice === choice);
  return false;
}

/** 選択肢のタップで起きること(タグ・情報欄・シナリオ・アクション)を、友だち追加時設定のアクションの形にする */
export function choiceActions(choice: ChoiceDef): { scenarioId: string | null; stopScenarioId: string | null; actions: FriendAddAction[] } {
  const actions: FriendAddAction[] = [];
  if ((choice.addTagIds?.length ?? 0) > 0) actions.push({ type: 'tag', params: { op: 'add', tagIds: choice.addTagIds }, condition: null });
  if ((choice.removeTagIds?.length ?? 0) > 0) actions.push({ type: 'tag', params: { op: 'remove', tagIds: choice.removeTagIds }, condition: null });
  if (choice.fieldId) actions.push({ type: 'friend_field', params: { op: 'set', fieldKey: choice.fieldId, value: choice.fieldValue ?? '' }, condition: null });
  if (choice.behavior.kind === 'actions') actions.push(...((choice.behavior.actions ?? []) as FriendAddAction[]));
  const b = choice.behavior;
  return {
    scenarioId: b.kind === 'scenario' && (b.scenarioOp ?? 'move') === 'move' && b.value ? b.value : null,
    stopScenarioId: b.kind === 'scenario' && b.scenarioOp === 'stop' && b.value ? b.value : null,
    actions,
  };
}

/**
 * テンプレート(質問・カルーセル・フレックス)のボタンが押された。
 * タップ回数の制限 → 記録 → 返信 → タグ・友だち情報・シナリオ・アクション の順に処理する。
 * @returns このpostbackを処理したら true(自動応答には回さない)
 */
export async function handleTemplatePostback(
  db: D1Database,
  lineClient: LineClient,
  friend: Friend,
  data: string,
  replyToken: string,
  opts: { lineAccountId?: string | null; lineAccessToken?: string; workerUrl?: string; replyMessage?: TemplateReplySender } = {},
): Promise<boolean> {
  const parsed = data.startsWith(TEMPLATE_POSTBACK_PREFIX) ? parseTemplatePostback(data) : null;
  if (!parsed) return false;
  try {
    const tpl = await db.prepare('SELECT id, editor_type, editor_data FROM templates WHERE id = ?').bind(parsed.templateId).first<TemplateRow>();
    if (!tpl) return true;
    const resolved = resolveTappedChoice(tpl.editor_type, parseJson(tpl.editor_data), parsed.panel, parsed.choice);
    if (!resolved) return true;
    const { choice } = resolved;

    const taps = await db
      .prepare('SELECT panel, choice, count FROM template_taps WHERE template_id = ? AND friend_id = ?')
      .bind(tpl.id, friend.id)
      .all<{ panel: number; choice: number; count: number }>();
    const rows = taps.results ?? [];
    const metadata = await resolveMetadata(db, friend);

    const reply = async (r: ReplyDef | undefined): Promise<void> => {
      if (!r) return;
      let messages: Message[] = [];
      if (r.mode === 'text') {
        if (!(r.text ?? '').trim()) return;
        const content = expandVariables(r.text ?? '', { ...friend, metadata }, opts.workerUrl, 'text');
        messages = [{ type: 'text', text: await expandFormLinks(db, content, opts.lineAccountId ?? null) }];
      } else if (r.templateId) {
        const t = await db.prepare('SELECT message_type, message_content FROM templates WHERE id = ?').bind(r.templateId).first<{ message_type: string; message_content: string }>();
        if (!t) return;
        let content = expandVariables(t.message_content, { ...friend, metadata }, opts.workerUrl, t.message_type);
        content = await expandFormLinks(db, content, opts.lineAccountId ?? null);
        messages = buildMessages(t.message_type, content);
      }
      if (messages.length === 0) return;
      if (opts.replyMessage) await opts.replyMessage(replyToken, messages);
      else await lineClient.replyMessage(replyToken, messages);
      for (const m of messages) {
        const log = messageToLogPayload(m);
        await logOutgoingMessage(db, { friendId: friend.id, messageType: log.messageType, content: log.content, deliveryType: 'reply', source: 'auto_reply', lineAccountId: opts.lineAccountId ?? null });
      }
    };

    const target = { friendId: friend.id, lineAccountId: opts.lineAccountId ?? null, lineAccessToken: opts.lineAccessToken, workerUrl: opts.workerUrl };

    // 上限を超えたとき: お知らせの返信(任意)と、上限超過時のアクションだけ
    if (limited(resolved.tapLimit, rows, parsed.panel, parsed.choice)) {
      if (resolved.limitReply === 'default') await reply({ mode: 'text', text: TAP_LIMIT_NOTICE });
      if (resolved.limitActions.length > 0) await applyScenarioAndActions(db, { ...target, scenarioId: null, actions: resolved.limitActions as FriendAddAction[] });
      return true;
    }

    // 押した記録(回答率の集計にも使う)
    const now = jstNow();
    await db
      .prepare(
        `INSERT INTO template_taps (template_id, friend_id, panel, choice, count, first_at, last_at) VALUES (?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT (template_id, friend_id, panel, choice) DO UPDATE SET count = count + 1, last_at = excluded.last_at`,
      )
      .bind(tpl.id, friend.id, parsed.panel, parsed.choice, now, now)
      .run();

    const before = rows.find((r) => r.panel === parsed.panel && r.choice === parsed.choice)?.count ?? 0;
    // 2回目以降は「二度押しの返信」(未設定なら通常の返信)
    const replyDef = before > 0 && choice.repeatReply && ((choice.repeatReply.text ?? '').trim() || choice.repeatReply.templateId) ? choice.repeatReply : choice.reply;
    await reply(replyDef);

    const effects = choiceActions(choice);
    if (effects.stopScenarioId) {
      await db
        .prepare("UPDATE friend_scenarios SET status = 'completed', updated_at = ? WHERE friend_id = ? AND scenario_id = ? AND status IN ('active', 'paused')")
        .bind(now, friend.id, effects.stopScenarioId)
        .run();
    }
    if (effects.scenarioId || effects.actions.length > 0) {
      await applyScenarioAndActions(db, { ...target, scenarioId: effects.scenarioId, actions: effects.actions });
    }
    return true;
  } catch (err) {
    console.error('Failed to handle template postback', err);
    return true;
  }
}
