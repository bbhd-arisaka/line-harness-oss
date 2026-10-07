/**
 * 友だち追加時設定(Lステップの「友だち追加時設定」)。公式アカウントごとに2区分:
 *   new       新規友だち(システム導入後に、はじめてフォローした人)
 *   returning すでに名簿にいる人が、またフォローしたとき(システム導入前からの友だち・ブロックを解除した友だち)
 * それぞれ「登録するシナリオ」と「その他のアクション」を持つ。
 */

export type FriendAddKind = 'new' | 'returning';

export type FriendAddAction =
  | { type: 'add_tag'; params: { tagId: string } }
  | { type: 'remove_tag'; params: { tagId: string } }
  /** テンプレートを送る(templates の id) */
  | { type: 'send_message'; params: { template_id: string } }
  /** リッチメニュー(beyond line で作ったメニュー)に切り替える */
  | { type: 'switch_rich_menu_group'; params: { groupId: string } }
  | { type: 'remove_rich_menu'; params: Record<string, never> };

export interface FriendAddSetting {
  lineAccountId: string;
  kind: FriendAddKind;
  scenarioId: string | null;
  actions: FriendAddAction[];
  updatedAt: string | null;
}

export class FriendAddSettingError extends Error {}

const MAX_ACTIONS = 30;

export function parseFriendAddActions(raw: unknown): FriendAddAction[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new FriendAddSettingError('アクションの形が正しくありません');
  if (raw.length > MAX_ACTIONS) throw new FriendAddSettingError(`アクションは${MAX_ACTIONS}個までです`);
  const out: FriendAddAction[] = [];
  const str = (v: unknown, label: string): string => {
    if (typeof v !== 'string' || !v.trim() || v.length > 100) throw new FriendAddSettingError(`${label}を選んでください`);
    return v.trim();
  };
  for (const item of raw as Array<{ type?: unknown; params?: Record<string, unknown> }>) {
    const p = item?.params ?? {};
    switch (item?.type) {
      case 'add_tag':
        out.push({ type: 'add_tag', params: { tagId: str(p.tagId, 'タグ') } });
        break;
      case 'remove_tag':
        out.push({ type: 'remove_tag', params: { tagId: str(p.tagId, 'タグ') } });
        break;
      case 'send_message':
        out.push({ type: 'send_message', params: { template_id: str(p.template_id, 'テンプレート') } });
        break;
      case 'switch_rich_menu_group':
        out.push({ type: 'switch_rich_menu_group', params: { groupId: str(p.groupId, 'リッチメニュー') } });
        break;
      case 'remove_rich_menu':
        out.push({ type: 'remove_rich_menu', params: {} });
        break;
      default:
        throw new FriendAddSettingError('未対応のアクションが含まれています');
    }
  }
  return out;
}

interface Row {
  line_account_id: string;
  kind: FriendAddKind;
  scenario_id: string | null;
  actions: string;
  updated_at: string;
}

function toSetting(r: Row): FriendAddSetting {
  let actions: FriendAddAction[] = [];
  try {
    actions = JSON.parse(r.actions) as FriendAddAction[];
  } catch {
    actions = [];
  }
  return { lineAccountId: r.line_account_id, kind: r.kind, scenarioId: r.scenario_id, actions, updatedAt: r.updated_at };
}

/** 2区分とも返す(まだ保存されていない区分は、空の設定) */
export async function getFriendAddSettings(db: D1Database, lineAccountId: string): Promise<Record<FriendAddKind, FriendAddSetting>> {
  const rows = await db
    .prepare('SELECT line_account_id, kind, scenario_id, actions, updated_at FROM friend_add_settings WHERE line_account_id = ?')
    .bind(lineAccountId)
    .all<Row>();
  const empty = (kind: FriendAddKind): FriendAddSetting => ({ lineAccountId, kind, scenarioId: null, actions: [], updatedAt: null });
  const result: Record<FriendAddKind, FriendAddSetting> = { new: empty('new'), returning: empty('returning') };
  for (const r of rows.results ?? []) result[r.kind] = toSetting(r);
  return result;
}

export async function saveFriendAddSetting(
  db: D1Database,
  lineAccountId: string,
  kind: FriendAddKind,
  input: { scenarioId?: unknown; actions?: unknown },
): Promise<FriendAddSetting> {
  const actions = parseFriendAddActions(input.actions);
  const scenarioId = typeof input.scenarioId === 'string' && input.scenarioId.trim() ? input.scenarioId.trim() : null;
  if (scenarioId) {
    const sc = await db.prepare('SELECT id, line_account_id FROM scenarios WHERE id = ?').bind(scenarioId).first<{ id: string; line_account_id: string | null }>();
    if (!sc || (sc.line_account_id && sc.line_account_id !== lineAccountId)) throw new FriendAddSettingError('このアカウントで使えるシナリオを選んでください');
  }
  await db
    .prepare(
      `INSERT INTO friend_add_settings (id, line_account_id, kind, scenario_id, actions)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (line_account_id, kind) DO UPDATE SET scenario_id = excluded.scenario_id, actions = excluded.actions,
         updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')`,
    )
    .bind(crypto.randomUUID(), lineAccountId, kind, scenarioId, JSON.stringify(actions))
    .run();
  return (await getFriendAddSettings(db, lineAccountId))[kind];
}
