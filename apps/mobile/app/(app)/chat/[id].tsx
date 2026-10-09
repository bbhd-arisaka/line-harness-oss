import { useLocalSearchParams } from 'expo-router';
import { ChatView } from '../../../src/components/chat-view';
import { withReadableWidth } from '../../../src/components/readable-width';

function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChatView id={id ?? ''} />;
}

export default withReadableWidth(ChatScreen);
