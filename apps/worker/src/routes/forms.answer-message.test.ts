import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = vi.hoisted(() => ({
  getFormById: vi.fn(),
  getFriendByLineUserId: vi.fn(),
  getFriendById: vi.fn(),
  createFormSubmission: vi.fn(),
  verifyCallerLineUserId: vi.fn(),
  push: vi.fn(),
}));

vi.mock('@line-crm/db', () => ({
  getForms: vi.fn(),
  getFormsWithStats: vi.fn(),
  getFormById: mocks.getFormById,
  createForm: vi.fn(),
  updateForm: vi.fn(),
  deleteForm: vi.fn(),
  getFormSubmissions: vi.fn(async () => []),
  createFormSubmission: mocks.createFormSubmission,
  getFriendByLineUserId: mocks.getFriendByLineUserId,
  getFriendById: mocks.getFriendById,
  getLatestSubmissionForFriend: vi.fn(),
  countFormSubmissions: vi.fn(async () => 0),
  getTrackedLinkById: vi.fn(),
  getMessageTemplateById: vi.fn(),
  getLineAccountById: vi.fn(),
  resolveDefaultLineAccount: vi.fn(async () => null),
  stopAllFriendScenarios: vi.fn(),
  updateFriendRegistrationFields: vi.fn(),
  removeTagFromFriend: vi.fn(),
  enrollFriendInScenario: vi.fn(),
  enrollFriendInReminder: vi.fn(),
  applyMileageRulesForEvent: vi.fn(),
  jstNow: vi.fn(() => '2026-09-29T12:00:00.000+09:00'),
}));
vi.mock('../services/liff-auth.js', () => ({ verifyCallerLineUserId: mocks.verifyCallerLineUserId }));
vi.mock('../services/friend-tag-attach.js', () => ({ attachTagAndFireSideEffects: vi.fn() }));
vi.mock('../services/local-line-proxy.js', () => ({ dispatchLineProxyLocally: vi.fn() }));
vi.mock('../services/line-proxy-send.js', () => ({ pushViaHarnessProxy: mocks.push }));
vi.mock('../services/reward-resolver.js', () => ({ resolveRewardTemplate: vi.fn(async () => null) }));
vi.mock('../services/reward-message.js', () => ({ buildRewardMessage: vi.fn(() => null) }));
vi.mock('../services/auto-track.js', () => ({ appendFriendToTrackedLinks: vi.fn(async (_db: unknown, content: string) => content) }));
vi.mock('../services/step-delivery.js', () => ({
  buildMessage: (type: string, content: string) => ({ type, content }),
  expandVariables: (content: string) => content.replace(/\{\{name\}\}/g, '山田'),
  resolveMetadata: vi.fn(async () => ({})),
}));

import { forms } from './forms.js';

const FORM_ID = '11111111-1111-4111-8111-111111111111';

function form(extra: Record<string, unknown> = {}) {
  return {
    id: FORM_ID,
    name: 'カウンセリング',
    description: null,
    fields: JSON.stringify([{ name: 'q1', label: 'ご来店のきっかけ', type: 'text' }]),
    on_submit_tag_id: null,
    on_submit_scenario_id: null,
    on_submit_message_type: null,
    on_submit_message_content: null,
    on_submit_webhook_url: null,
    on_submit_webhook_headers: null,
    on_submit_webhook_fail_message: null,
    on_submit_stop_scenarios: 0,
    answer_limit_per_friend: 'unlimited',
    google_sheets_enabled: 0,
    save_to_metadata: 0,
    is_active: 1,
    submit_count: 0,
    og_title: null,
    og_description: null,
    og_image_url: null,
    lstep_options: null,
    created_at: '2026-01-01T00:00:00+09:00',
    updated_at: '2026-01-01T00:00:00+09:00',
    ...extra,
  };
}

function submit() {
  const bindings = {
    DB: { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ run: vi.fn(), first: vi.fn(async () => null) })) })) } as unknown as D1Database,
    LINE_CHANNEL_ACCESS_TOKEN: 't',
    LINE_LOGIN_CHANNEL_ID: 'c',
    WORKER_URL: 'https://api.example.test',
  } as Env['Bindings'];
  const app = new Hono<Env>();
  app.route('/', forms);
  return app.request(
    `/api/forms/${FORM_ID}/submit`,
    { method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { q1: 'Instagram' } }) },
    bindings,
    { waitUntil: (p: Promise<unknown>) => void p.catch(() => undefined), passThroughOnException: () => undefined } as unknown as ExecutionContext,
  );
}

beforeEach(() => {
  mocks.verifyCallerLineUserId.mockResolvedValue('line-1');
  mocks.getFriendByLineUserId.mockResolvedValue({ id: 'friend-1', line_user_id: 'U1', display_name: '山田', metadata: '{}', line_account_id: null });
  mocks.getFriendById.mockResolvedValue({ id: 'friend-1', line_user_id: 'U1', display_name: '山田', metadata: '{}', line_account_id: null });
  mocks.createFormSubmission.mockImplementation(async (_db, input) => ({
    id: 's1', form_id: input.formId, friend_id: input.friendId, data: input.data, created_at: '2026-09-29T12:00:00+09:00',
  }));
  mocks.push.mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

const sentMessages = () => (mocks.push.mock.calls[0]?.[3] ?? []) as Array<{ type: string; content: string }>;

describe('回答後メッセージ', () => {
  test('設定がなければ、お客様には何も自動送信しない(以前は宣伝文入りの「診断結果」を送っていた)', async () => {
    mocks.getFormById.mockResolvedValue(form());
    expect((await submit()).status).toBe(201);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  test('「回答内容のまとめ」を選ぶと、見出し付きのカードを送る(宣伝文は含まない)', async () => {
    mocks.getFormById.mockResolvedValue(form({ lstep_options: JSON.stringify({ answerMessage: { mode: 'summary', title: 'ご回答ありがとうございました' } }) }));
    expect((await submit()).status).toBe(201);
    const [msg] = sentMessages();
    expect(msg.type).toBe('flex');
    expect(msg.content).toContain('ご回答ありがとうございました');
    expect(msg.content).toContain('ご来店のきっかけ');
    expect(msg.content).toContain('Instagram');
    expect(msg.content).not.toContain('L Harness');
    expect(msg.content).not.toContain('他社サービス');
  });

  test('「自分で書いた文章」を選ぶと、その文章を送る({{name}}は名前に置き換わる)', async () => {
    mocks.getFormById.mockResolvedValue(
      form({
        on_submit_message_type: 'text',
        on_submit_message_content: '{{name}}さん、ご回答ありがとうございます',
        lstep_options: JSON.stringify({ answerMessage: { mode: 'custom' } }),
      }),
    );
    await submit();
    expect(sentMessages()).toEqual([{ type: 'text', content: '山田さん、ご回答ありがとうございます' }]);
  });

  test('以前から文章が設定されているフォームは、そのまま送り続ける(設定変更なしでも動作が変わらない)', async () => {
    mocks.getFormById.mockResolvedValue(form({ on_submit_message_type: 'text', on_submit_message_content: 'ありがとうございます' }));
    await submit();
    expect(sentMessages()).toEqual([{ type: 'text', content: 'ありがとうございます' }]);
  });

  test('「送らない」を選んだら、文章が残っていても送らない', async () => {
    mocks.getFormById.mockResolvedValue(
      form({
        on_submit_message_type: 'text',
        on_submit_message_content: '古い文章',
        lstep_options: JSON.stringify({ answerMessage: { mode: 'none' } }),
      }),
    );
    await submit();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
