import * as Notifications from 'expo-notifications';
import { notificationIdsForChat } from '../lib/notifications';

/**
 * 返信したトークの通知を、iPhone の通知センターから消す(そのトークの分だけ。ほかのトークの通知は残す)。
 * 消せなくても、返信そのものには影響しない。
 */
export async function dismissChatNotifications(chatId: string): Promise<void> {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    for (const id of notificationIdsForChat(presented, chatId)) {
      await Notifications.dismissNotificationAsync(id);
    }
  } catch {
    // 通知の許可がない・取得できないときは、何もしない
  }
}
