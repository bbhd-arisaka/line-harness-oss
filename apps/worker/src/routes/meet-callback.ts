import { Hono } from 'hono';
import type { Env } from '../index.js';
import { getFriendByLineUserIdForAccount } from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';

const app = new Hono<Env>();

// Meet Harness calls this when a hearing session completes
app.post('/api/meet-callback', async (c) => {
  const body = await c.req.json<{
    session_id: string;
    scenario_id: string;
    line_user_id: string;
    status: string;
    context?: Record<string, unknown>;
    transcripts: Array<{
      question_text?: string;
      transcript: string;
    }>;
    requirements_doc?: string;
    completed_at: string;
  }>();

  if (!body.line_user_id) {
    return c.json({ success: false, error: 'line_user_id required' }, 400);
  }

  // 同じ人が複数アカウントの友だちでも取り違えないよう、アカウントを特定する。
  // 外部から届くのはユーザーIDだけなので、該当が複数アカウントにまたがる場合は
  // line_account_id の指定を必須にし、曖昧なまま送信しない。
  const candidates = await c.env.DB
    .prepare('SELECT id, line_account_id FROM friends WHERE line_user_id = ?')
    .bind(body.line_user_id)
    .all<{ id: string; line_account_id: string | null }>();
  const requestedAccountId = (body as { line_account_id?: string }).line_account_id ?? null;
  if (!requestedAccountId && (candidates.results ?? []).length > 1) {
    return c.json({ success: false, error: 'line_account_id required: user belongs to multiple accounts' }, 409);
  }
  const friend = await getFriendByLineUserIdForAccount(
    c.env.DB,
    body.line_user_id,
    requestedAccountId ?? (candidates.results?.[0]?.line_account_id ?? null),
  );
  if (!friend) {
    return c.json({ success: false, error: 'friend not found' }, 404);
  }

  // Resolve LINE access token (multi-account support)
  let accessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
  if ((friend as unknown as Record<string, unknown>).line_account_id) {
    const { getLineAccountById } = await import('@line-crm/db');
    const account = await getLineAccountById(c.env.DB, (friend as unknown as Record<string, unknown>).line_account_id as string);
    if (account) accessToken = account.channel_access_token;
  }
  const lineClient = new LineClient(accessToken);

  // Build Flex message with requirements doc
  const transcriptRows = body.transcripts.map((t) => ({
    type: 'box' as const, layout: 'vertical' as const, margin: 'md' as const,
    contents: [
      { type: 'text' as const, text: t.question_text || 'Q', size: 'xxs' as const, color: '#64748b' },
      { type: 'text' as const, text: t.transcript, size: 'sm' as const, color: '#1e293b', wrap: true },
    ],
  }));

  const resultFlex = {
    type: 'bubble', size: 'giga',
    header: {
      type: 'box', layout: 'vertical',
      contents: [
        { type: 'text', text: 'ヒアリング完了', size: 'lg', weight: 'bold', color: '#1e293b' },
        { type: 'text', text: `${friend.display_name || ''}さん`, size: 'xs', color: '#64748b', margin: 'sm' },
      ],
      paddingAll: '20px', backgroundColor: '#f0f9ff',
    },
    body: {
      type: 'box', layout: 'vertical',
      contents: [
        ...transcriptRows,
        { type: 'separator', margin: 'lg' },
        ...(body.requirements_doc ? [
          { type: 'text' as const, text: '要件定義書', size: 'sm' as const, weight: 'bold' as const, color: '#1e293b', margin: 'lg' as const },
          { type: 'text' as const, text: body.requirements_doc.slice(0, 1000), size: 'xs' as const, color: '#334155', wrap: true, margin: 'sm' as const },
        ] : []),
      ],
      paddingAll: '20px',
    },
  };

  try {
    await lineClient.pushMessage(friend.line_user_id, [
      { type: 'flex', altText: 'ヒアリング結果', contents: resultFlex },
    ]);
  } catch (e) {
    console.error('Failed to send meet callback message:', e);
  }

  // Save to friend metadata
  try {
    const existing = JSON.parse(friend.metadata || '{}') as Record<string, unknown>;
    const updated = {
      ...existing,
      meet_hearing: {
        session_id: body.session_id,
        status: body.status,
        context: body.context,
        transcripts: body.transcripts,
        requirements_doc: body.requirements_doc,
        completed_at: body.completed_at,
      },
    };
    await c.env.DB.prepare('UPDATE friends SET metadata = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .bind(JSON.stringify(updated), friend.id)
      .run();
  } catch (e) {
    console.error('Failed to save meet hearing to metadata:', e);
  }

  return c.json({ success: true });
});

export { app as meetCallback };
