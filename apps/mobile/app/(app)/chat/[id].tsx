import { useLocalSearchParams } from 'expo-router';
import { ChatView } from '../../../src/components/chat-view';
import { withReadableWidth } from '../../../src/components/readable-width';

function ChatScreen() {
  // 検索から開いたときは、該当メッセージの位置へ移動し、検索語を黄色で目立たせる
  const { id, messageId, q } = useLocalSearchParams<{ id: string; messageId?: string; q?: string }>();
  return <ChatView id={id ?? ''} focusMessageId={messageId || undefined} highlight={q || undefined} />;
}

export default withReadableWidth(ChatScreen);
