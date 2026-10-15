import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../../../src/theme/theme';
import { useUnread } from '../../../src/state/unread';
import { formatUnreadBadge } from '../../../src/lib/unread-badge';

export default function TabsLayout() {
  const c = useColors();
  // 「トーク」の数字 = 未対応のトーク数(トークが増えても、未対応を見落とさないため)
  const unread = useUnread();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.textMuted,
        tabBarStyle: { backgroundColor: c.card, borderTopColor: c.border },
        headerStyle: { backgroundColor: c.card },
        headerTitleStyle: { color: c.text },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: c.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'トーク',
          tabBarBadge: formatUnreadBadge(unread.count),
          tabBarBadgeStyle: { backgroundColor: c.danger, color: '#fff' },
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{
          title: '友だち',
          tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="broadcasts"
        options={{
          title: '配信',
          tabBarIcon: ({ color, size }) => <Ionicons name="megaphone" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '設定',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
