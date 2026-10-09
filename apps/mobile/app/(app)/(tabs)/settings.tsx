import { Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useEffect, useState } from 'react';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { authStore, useAccounts, useAuth } from '../../../src/state/session';
import { Button, Card, confirmAsync, SectionTitle } from '../../../src/components/ui';
import { accountLabel } from '../../../src/lib/accounts';
import { usePushStatus } from '../../../src/state/push';
import { api } from '../../../src/state/services';
import { describeError } from '../../../src/lib/errors';
import type { PushSettings } from '../../../src/lib/types';
import { MIN_TAP, useColors } from '../../../src/theme/theme';
import { withReadableWidth } from '../../../src/components/readable-width';

const ROLE_LABEL: Record<string, string> = { owner: 'オーナー', admin: '管理者', staff: 'スタッフ' };

function Row({ label, value }: { label: string; value: string }) {
  const c = useColors();
  return (
    <View style={styles.infoRow}>
      <Text style={{ color: c.textMuted, fontSize: 13, width: 84 }}>{label}</Text>
      <Text selectable style={{ color: c.text, fontSize: 15, flex: 1 }}>
        {value}
      </Text>
    </View>
  );
}

function SettingsScreen() {
  const c = useColors();
  const auth = useAuth();
  const acc = useAccounts();
  const staff = auth.staff;
  const push = usePushStatus();
  const version = Constants.expoConfig?.version ?? '-';

  // 公式アカウントごとの通知(この端末だけの設定)
  const [muted, setMuted] = useState<string[] | null>(null);
  // 通知する内容(新着メッセージ・フォームの回答 など)。種類の一覧はサーバーが返す
  const [mutedKinds, setMutedKinds] = useState<string[] | null>(null);
  const [kinds, setKinds] = useState<PushSettings['kinds']>([]);
  const [mutedError, setMutedError] = useState<string | null>(null);
  useEffect(() => {
    if (push.state === 'unsupported') return;
    let cancelled = false;
    api
      .getPushSettings()
      .then((r) => {
        if (cancelled) return;
        setMuted(r.mutedAccountIds);
        setMutedKinds(r.mutedKinds ?? []);
        setKinds(r.kinds ?? []);
      })
      .catch((e) => {
        if (!cancelled) setMutedError(describeError(e, '通知の設定を読み込めませんでした'));
      });
    return () => {
      cancelled = true;
    };
  }, [push.state]);

  async function toggleAccount(accountId: string, enabled: boolean) {
    const before = muted ?? [];
    const next = enabled ? before.filter((x) => x !== accountId) : [...before, accountId];
    setMuted(next);
    setMutedError(null);
    try {
      const r = await api.setPushSettings({ mutedAccountIds: next });
      setMuted(r.mutedAccountIds);
    } catch (e) {
      setMuted(before);
      setMutedError(describeError(e, '通知の設定を保存できませんでした'));
    }
  }

  async function toggleKind(kind: string, enabled: boolean) {
    const before = mutedKinds ?? [];
    const next = enabled ? before.filter((x) => x !== kind) : [...before, kind];
    setMutedKinds(next);
    setMutedError(null);
    try {
      const r = await api.setPushSettings({ mutedKinds: next });
      setMutedKinds(r.mutedKinds);
    } catch (e) {
      setMutedKinds(before);
      setMutedError(describeError(e, '通知の設定を保存できませんでした'));
    }
  }

  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function requestDeletion() {
    const ok = await confirmAsync(
      'アカウントの削除を申請しますか?',
      '申請すると、すべての端末からログアウトされ、以後ログインできなくなります。ユーザー情報の削除は、会社の管理者が行います。',
      '削除を申請',
    );
    if (!ok) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.requestAccountDeletion();
      await authStore.logout();
      Alert.alert('削除を申請しました', 'ログアウトしました。ユーザー情報の削除は、会社の管理者が行います。');
    } catch (e) {
      setDeleteError(describeError(e, '申請できませんでした'));
    } finally {
      setDeleting(false);
    }
  }

  function openPage(path: string) {
    void Linking.openURL(`${api.baseUrl}${path}`);
  }

  async function logout() {
    const ok = await confirmAsync('ログアウトしますか?', 'このスマートフォンのログインを終了します。', 'ログアウト');
    if (ok) await authStore.logout();
  }

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.content}>
      <SectionTitle>ログイン中のユーザー</SectionTitle>
      <Card>
        <Row label="名前" value={staff?.name ?? '-'} />
        <Row label="メール" value={staff?.email ?? '-'} />
        <Row label="役割" value={staff ? (ROLE_LABEL[staff.role] ?? staff.role) : '-'} />
      </Card>

      <SectionTitle>公式アカウント</SectionTitle>
      <Pressable
        onPress={acc.startChoosing}
        accessibilityRole="button"
        accessibilityLabel="公式アカウントを切り替える"
        style={({ pressed }) => [styles.link, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.8 : 1 }]}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.textMuted, fontSize: 12 }}>いま見ているアカウント</Text>
          <Text style={{ color: c.text, fontSize: 16, fontWeight: '700', marginTop: 2 }} numberOfLines={1}>
            {acc.selected ? accountLabel(acc.selected) : '未選択'}
          </Text>
        </View>
        <Text style={{ color: c.primaryText, fontWeight: '700', marginRight: 4 }}>切り替え</Text>
        <Ionicons name="chevron-forward" size={18} color={c.primaryText} />
      </Pressable>

      {push.state !== 'unsupported' ? (
        <>
          <SectionTitle>通知</SectionTitle>
          <Card>
            <Row
              label="新着通知"
              value={push.state === 'granted' ? 'オン' : push.state === 'denied' ? 'オフ(iPhone の設定で拒否されています)' : push.state === 'loading' ? '確認中…' : 'オフ'}
            />
            {push.state === 'denied' ? (
              <Button title="iPhone の設定を開く" variant="secondary" onPress={() => void Linking.openSettings()} style={{ marginTop: 8 }} />
            ) : push.state === 'undetermined' ? (
              <Button title="通知を受け取る" variant="secondary" loading={push.busy} onPress={() => void push.enable()} style={{ marginTop: 8 }} />
            ) : null}
          </Card>

          <SectionTitle>通知する内容</SectionTitle>
          <Card>
            <Text style={{ color: c.textSub, fontSize: 13, lineHeight: 19, marginBottom: 6 }}>
              このスマートフォンで、何が起きたときに通知するかを選べます。設定はこのアプリの中だけで完結します(Web版の設定は要りません)。
            </Text>
            {kinds.map((k) => (
              <View key={k.key} style={styles.accountRow}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={{ color: c.text, fontSize: 15 }}>{k.label}</Text>
                  <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 1 }}>{k.description}</Text>
                </View>
                <Switch
                  accessibilityLabel={`${k.label}の通知`}
                  value={mutedKinds !== null && !mutedKinds.includes(k.key)}
                  disabled={mutedKinds === null}
                  onValueChange={(v) => void toggleKind(k.key, v)}
                />
              </View>
            ))}
            {kinds.length === 0 && mutedKinds === null ? (
              <Text style={{ color: c.textMuted, fontSize: 13 }}>読み込み中…</Text>
            ) : null}
          </Card>

          <SectionTitle>公式アカウントごとの通知</SectionTitle>
          <Card>
            <Text style={{ color: c.textSub, fontSize: 13, lineHeight: 19, marginBottom: 6 }}>
              このスマートフォンで、通知を受け取る公式アカウントを選べます(オフにしたアカウントの新着は、通知されません)。
            </Text>
            {acc.accounts.map((a) => (
              <View key={a.id} style={styles.accountRow}>
                <Text style={{ color: c.text, fontSize: 15, flex: 1, marginRight: 12 }} numberOfLines={1}>
                  {accountLabel(a)}
                </Text>
                <Switch
                  accessibilityLabel={`${accountLabel(a)}の通知`}
                  value={muted !== null && !muted.includes(a.id)}
                  disabled={muted === null}
                  onValueChange={(v) => void toggleAccount(a.id, v)}
                />
              </View>
            ))}
            {mutedError ? (
              <Text style={{ color: c.danger, fontSize: 13, marginTop: 6 }} accessibilityRole="alert">
                {mutedError}
              </Text>
            ) : null}
          </Card>
        </>
      ) : null}

      <SectionTitle>アプリ</SectionTitle>
      <Card>
        <Row label="バージョン" value={version} />
      </Card>

      <SectionTitle>サポート</SectionTitle>
      <Card>
        <Pressable onPress={() => openPage('/privacy')} accessibilityRole="link" accessibilityLabel="プライバシーポリシーを開く" style={styles.pageLink}>
          <Text style={{ color: c.primaryText, fontSize: 15, fontWeight: '600' }}>プライバシーポリシー</Text>
          <Ionicons name="open-outline" size={16} color={c.primaryText} />
        </Pressable>
        <Pressable onPress={() => openPage('/support')} accessibilityRole="link" accessibilityLabel="サポートを開く" style={styles.pageLink}>
          <Text style={{ color: c.primaryText, fontSize: 15, fontWeight: '600' }}>サポート・お問い合わせ</Text>
          <Ionicons name="open-outline" size={16} color={c.primaryText} />
        </Pressable>
      </Card>

      <Button title="ログアウト" variant="danger" onPress={logout} style={{ marginTop: 28 }} />

      <SectionTitle>アカウントの削除</SectionTitle>
      <Card>
        <Text style={{ color: c.textSub, fontSize: 13, lineHeight: 19 }}>
          アカウントの削除を申請できます。申請するとすべての端末からログアウトされ、以後ログインできなくなります。
          {staff?.role === 'owner' ? '\nオーナーのアカウントは、beyond admin の管理画面から、または別のオーナーに依頼して削除します。' : ''}
        </Text>
        {staff?.role !== 'owner' ? (
          <Button title="アカウントの削除を申請" variant="secondary" loading={deleting} onPress={() => void requestDeletion()} style={{ marginTop: 10 }} />
        ) : null}
        {deleteError ? (
          <Text style={{ color: c.danger, fontSize: 13, marginTop: 8 }} accessibilityRole="alert">
            {deleteError}
          </Text>
        ) : null}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8 },
  accountRow: { minHeight: MIN_TAP, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pageLink: { minHeight: MIN_TAP, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  link: {
    minHeight: MIN_TAP + 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
});

export default withReadableWidth(SettingsScreen);
