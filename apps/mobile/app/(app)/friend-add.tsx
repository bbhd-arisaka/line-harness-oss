import { useCallback, useMemo, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as MediaLibrary from 'expo-media-library/legacy';
import { File, Paths } from 'expo-file-system';
import { api } from '../../src/state/services';
import { useAccounts } from '../../src/state/session';
import { Button, Card, ErrorView, LoadingView } from '../../src/components/ui';
import { withReadableWidth } from '../../src/components/readable-width';
import { accountLabel } from '../../src/lib/accounts';
import { describeError } from '../../src/lib/errors';
import { qrDataUri, qrFileName } from '../../src/lib/friend-add';
import type { InflowRoute } from '../../src/lib/inflow';
import { qrPngBase64 } from '../../src/lib/qr-png';
import { getSelectedInflow, setSelectedInflow } from '../../src/state/inflow-selection';
import type { FriendAddInfo } from '../../src/lib/types';
import { useColors } from '../../src/theme/theme';

/** 流入経路の名前(長いときは省く) */
const chipLabel = (name: string) => (Array.from(name).length > 14 ? `${Array.from(name).slice(0, 14).join('')}…` : name);

/**
 * いま見ている公式アカウントの、友だち追加用の QR コードと URL。流入経路ごとに切り替えて見られる(「基本」=流入経路なし)。
 * QR は写真アプリに保存でき、URL はワンタップでコピーできる。流入経路は、ここから作る・編集する
 */
function FriendAddScreen() {
  const c = useColors();
  const router = useRouter();
  const { selected } = useAccounts();
  const accountId = selected?.id ?? null;
  const [info, setInfo] = useState<FriendAddInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [routes, setRoutes] = useState<InflowRoute[]>([]);
  const [routeId, setRouteId] = useState<string | null>(getSelectedInflow());
  const route = useMemo(() => routes.find((r) => r.id === routeId) ?? null, [routes, routeId]);

  const load = useCallback(async () => {
    if (!accountId) {
      setError('公式アカウントが選ばれていません');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setInfo(await api.getFriendAdd(accountId));
    } catch (e) {
      setError(describeError(e, '友だち追加のURLを取得できませんでした'));
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  // 流入経路は、編集の画面から戻るたびに読み直す(取れなくても、基本のQRは見られる)
  const loadRoutes = useCallback(async () => {
    if (!accountId) return;
    try {
      const res = await api.listInflowRoutes(accountId);
      setRoutes(res.items);
      setRouteId(getSelectedInflow());
    } catch {
      setRoutes([]);
    }
  }, [accountId]);

  useFocusEffect(
    useCallback(() => {
      if (!info) void load();
      void loadRoutes();
    }, [load, loadRoutes, info]),
  );

  const shownUrl = route ? route.url : (info?.url ?? '');

  function choose(id: string | null) {
    setSelectedInflow(id);
    setRouteId(id);
    setSaveMessage(null);
  }

  async function copyUrl() {
    if (!info) return;
    try {
      await Clipboard.setStringAsync(shownUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setSaveMessage({ ok: false, text: 'コピーできませんでした。URLを長く押して、コピーしてください。' });
    }
  }

  async function saveQr() {
    if (!info) return;
    const base64 = route ? qrPngBase64(route.url, { scale: 10, margin: 4 }) : info.qrPngBase64;
    const routeFile = route ? route.name.replace(/[\\/:*?"<>|\s@]+/g, '').slice(0, 40) || route.refCode : '';
    const fileName = route ? `流入経路QR_${routeFile}.png` : qrFileName(info.name, info.basicId);
    setSaving(true);
    setSaveMessage(null);
    try {
      // 写真アプリへの「追加」だけの許可(写真を見る許可は求めない)
      const perm = await MediaLibrary.requestPermissionsAsync(true);
      if (!perm.granted) {
        setSaveMessage({ ok: false, text: '写真への保存が許可されていません。iPhoneの設定で「写真」への追加を許可してください。' });
        return;
      }
      const file = new File(Paths.cache, fileName);
      file.create({ overwrite: true });
      file.write(base64, { encoding: 'base64' });
      await MediaLibrary.saveToLibraryAsync(file.uri);
      try {
        file.delete();
      } catch {
        // キャッシュなので、消せなくても問題ない
      }
      setSaveMessage({ ok: true, text: '写真アプリに保存しました。' });
    } catch (e) {
      setSaveMessage({ ok: false, text: describeError(e, '保存できませんでした') });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingView />;
  if (error || !info) return <ErrorView message={error ?? '取得できませんでした'} onRetry={() => void load()} />;

  const qrSource = route ? qrDataUri(qrPngBase64(route.url, { scale: 8, margin: 4 })) : qrDataUri(info.qrPngBase64);

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.content}>
      {/* 流入経路の切り替え。「基本」=流入経路なしの、公式アカウントそのものの友だち追加 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
        {[{ id: null as string | null, label: '基本' }, ...routes.map((r) => ({ id: r.id as string | null, label: chipLabel(r.name) }))].map((o) => {
          const active = o.id === null ? route === null : route?.id === o.id;
          return (
            <Pressable
              key={o.id ?? 'base'}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => choose(o.id)}
              style={[styles.chip, { borderColor: active ? c.primary : c.border, backgroundColor: active ? c.primarySoft : c.card }]}
            >
              <Text style={{ color: active ? c.primaryText : c.text, fontWeight: '700', fontSize: 14 }}>{o.label}</Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="新しい流入経路を作る"
          onPress={() => router.push('/inflow-edit')}
          style={[styles.chip, { borderColor: c.border, backgroundColor: c.card }]}
        >
          <Text style={{ color: c.primaryText, fontWeight: '700', fontSize: 14 }}>＋ 流入経路</Text>
        </Pressable>
      </ScrollView>

      <Card style={{ alignItems: 'center' }}>
        <Text style={{ color: c.text, fontSize: 16, fontWeight: '700', textAlign: 'center' }}>{route ? route.name : selected ? accountLabel(selected) : info.name}</Text>
        {route ? (
          route.qrText ? <Text style={{ color: c.textSub, fontSize: 14, marginTop: 2 }}>{route.qrText}</Text> : null
        ) : (
          <Text style={{ color: c.textMuted, fontSize: 13, marginTop: 2 }}>ID: {info.basicId}</Text>
        )}
        <View style={[styles.qrBox, { borderColor: c.border }]}>
          <Image source={{ uri: qrSource }} style={styles.qr} accessibilityLabel="友だち追加のQRコード" resizeMode="contain" />
        </View>
        <Button title={saving ? '保存しています…' : 'QRコードを画像で保存'} onPress={() => void saveQr()} loading={saving} style={{ alignSelf: 'stretch', marginTop: 12 }} />
        {saveMessage ? (
          <Text style={{ color: saveMessage.ok ? c.primaryText : c.danger, fontSize: 13, marginTop: 8, textAlign: 'center' }} accessibilityRole="alert">
            {saveMessage.text}
          </Text>
        ) : null}
      </Card>

      <Card>
        <Text style={{ color: c.textMuted, fontSize: 12 }}>友だち追加URL</Text>
        <Text selectable style={{ color: c.text, fontSize: 15, marginTop: 4, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) }}>
          {shownUrl}
        </Text>
        <Button title={copied ? 'コピーしました' : 'URLをコピー'} variant="secondary" onPress={() => void copyUrl()} style={{ marginTop: 12 }} />
      </Card>

      {route ? (
        <Card>
          <View style={styles.statsRow}>
            <Text style={{ color: c.textMuted, fontSize: 13 }}>集計</Text>
            <Text style={{ color: c.text, fontSize: 16, fontWeight: '700' }}>
              {(route.people ?? 0).toLocaleString('ja-JP')}人({(route.times ?? 0).toLocaleString('ja-JP')}回)
            </Text>
          </View>
          {route.legacy ? null : (
            <Button title="編集" variant="secondary" onPress={() => router.push({ pathname: '/inflow-edit', params: { id: route.id } })} style={{ marginTop: 12 }} />
          )}
        </Card>
      ) : null}
    </ScrollView>
  );
}

export default withReadableWidth(FriendAddScreen);

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  chips: { gap: 8, paddingRight: 8 },
  chip: { minHeight: 40, borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, justifyContent: 'center' },
  statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  qrBox: { marginTop: 12, padding: 12, backgroundColor: '#ffffff', borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  qr: { width: 240, height: 240 },
});
