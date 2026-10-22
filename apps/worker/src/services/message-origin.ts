/**
 * 送ったメッセージが「スタッフの手動送信」か「システムからの配信(一斉配信・シナリオ・自動応答・リマインダなど)」か。
 * トークの吹き出しの色分けに使う。受信(incoming)には付けない。
 *
 * 手動 = source が 'manual'、または古い記録で source・配信・シナリオのどれも無いもの。
 * それ以外の送信は、すべてシステムからの配信。
 */
export type MessageOrigin = 'manual' | 'system';

export function messageOrigin(row: Record<string, unknown>): MessageOrigin | null {
  if (row.direction !== 'outgoing') return null;
  if (row.broadcast_id || row.scenario_step_id) return 'system';
  const source = typeof row.source === 'string' ? row.source : '';
  return source === '' || source === 'manual' ? 'manual' : 'system';
}
