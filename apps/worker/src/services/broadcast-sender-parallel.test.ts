import { describe, expect, it, vi } from 'vitest';

const accounts = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));
vi.mock('@line-crm/db', () => ({ getLineAccountById: vi.fn(async () => accounts.value) }));

import { BroadcastSenderError, resolveBroadcastSender } from './broadcast-sender.js';
import { LineClient } from '@line-crm/line-sdk';

const db = { prepare: () => ({ bind: () => ({ run: async () => ({}) }), first: async () => null }) } as unknown as D1Database;
const broadcast = { id: 'b1', line_account_id: 'A', target_type: 'all' } as never;

describe('resolveBroadcastSender: Lステップと並行運用中のアカウントからは送らない', () => {
  it('並行運用中(lstep_forward_url あり)のアカウントでは、BroadcastSenderError で止める', async () => {
    accounts.value = { id: 'A', is_active: 1, channel_access_token: 'tok', lstep_forward_url: 'https://rcv.linestep.net/v3/call/1' };
    await expect(resolveBroadcastSender(db, broadcast, new LineClient('x'))).rejects.toThrow(BroadcastSenderError);
    await expect(resolveBroadcastSender(db, broadcast, new LineClient('x'))).rejects.toThrow(/並行運用中/);
  });
  it('並行運用でない有効なアカウントは、そのアカウントのクライアントを返す', async () => {
    accounts.value = { id: 'A', is_active: 1, channel_access_token: 'tok', lstep_forward_url: null };
    await expect(resolveBroadcastSender(db, broadcast, new LineClient('x'))).resolves.toBeInstanceOf(LineClient);
  });
});
