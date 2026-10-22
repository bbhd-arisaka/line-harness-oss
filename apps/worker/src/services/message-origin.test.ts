import { describe, expect, it } from 'vitest';
import { messageOrigin } from './message-origin.js';

describe('messageOrigin(手動送信かシステム配信か)', () => {
  it('受信には付けない', () => {
    expect(messageOrigin({ direction: 'incoming', source: 'user' })).toBeNull();
  });
  it('スタッフの手動送信と、古い記録(出どころなし)は手動', () => {
    expect(messageOrigin({ direction: 'outgoing', source: 'manual' })).toBe('manual');
    expect(messageOrigin({ direction: 'outgoing', source: null })).toBe('manual');
  });
  it('一斉配信・シナリオ・自動応答・リマインダ・Lステップから取り込んだ配信は、システム', () => {
    for (const source of ['broadcast', 'scenario', 'reminder', 'booking', 'auto_reply']) {
      expect(messageOrigin({ direction: 'outgoing', source })).toBe('system');
    }
    expect(messageOrigin({ direction: 'outgoing', source: null, broadcast_id: 'b1' })).toBe('system');
    expect(messageOrigin({ direction: 'outgoing', source: 'manual', scenario_step_id: 's1' })).toBe('system');
  });
});
