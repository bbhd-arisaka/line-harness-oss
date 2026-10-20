import { parseRawMessages } from '@line-crm/shared';
import type { Message } from '@line-crm/line-sdk';

/**
 * テンプレートの「そのまま送る LINE メッセージ」(スタンプ・位置情報・画像リンク・質問など。packages/shared/src/templates.ts)を取り出す。
 * 既存の保存先は 'text' / 'image' / 'flex' しか入れられないので、'flex' の箱に {"lineMessages":[…]} の目印を付けて入れてある。
 * 目印が無ければ null(従来どおりの Flex として扱う)。
 */
export function rawMessagesOf(messageType: string, messageContent: string): Message[] | null {
  const raw = parseRawMessages(messageType, messageContent);
  return raw ? (raw as unknown as Message[]) : null;
}
