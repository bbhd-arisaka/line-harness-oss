import { useCallback, useEffect, useState } from 'react';
import { Image, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import type { FriendAddInfo } from '../../src/lib/types';
import { useColors } from '../../src/theme/theme';

/** いま見ている公式アカウントの、友だち追加用の QR コードと URL。QR は写真アプリに保存でき、URL はワンタップでコピーできる */
function FriendAddScreen() {
  const c = useColors();
  const { selected } = useAccounts();
  const accountId = selected?.id ?? null;
  const [info, setInfo] = useState<FriendAddInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; text: string } | null>(null);

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

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function copyUrl() {
    if (!info) return;
    try {
      await Clipboard.setStringAsync(info.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setSaveMessage({ ok: false, text: 'コピーできませんでした。URLを長く押して、コピーしてください。' });
    }
  }

  async function saveQr() {
    if (!info) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      // 写真アプリへの「追加」だけの許可(写真を見る許可は求めない)
      const perm = await MediaLibrary.requestPermissionsAsync(true);
      if (!perm.granted) {
        setSaveMessage({ ok: false, text: '写真への保存が許可されていません。iPhoneの設定で「写真」への追加を許可してください。' });
        return;
      }
      const file = new File(Paths.cache, qrFileName(info.name, info.basicId));
      file.create({ overwrite: true });
      file.write(info.qrPngBase64, { encoding: 'base64' });
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

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.content}>
      <Card style={{ alignItems: 'center' }}>
        <Text style={{ color: c.text, fontSize: 16, fontWeight: '700', textAlign: 'center' }}>{selected ? accountLabel(selected) : info.name}</Text>
        <Text style={{ color: c.textMuted, fontSize: 13, marginTop: 2 }}>ID: {info.basicId}</Text>
        <View style={[styles.qrBox, { borderColor: c.border }]}>
          <Image source={{ uri: qrDataUri(info.qrPngBase64) }} style={styles.qr} accessibilityLabel="友だち追加のQRコード" resizeMode="contain" />
        </View>
        <Text style={{ color: c.textSub, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 8 }}>
          お客様にこのQRコードを読み取ってもらうと、このアカウントを友だち追加できます。
        </Text>
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
          {info.url}
        </Text>
        <Button title={copied ? 'コピーしました' : 'URLをコピー'} variant="secondary" onPress={() => void copyUrl()} style={{ marginTop: 12 }} />
      </Card>
    </ScrollView>
  );
}

export default withReadableWidth(FriendAddScreen);

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  qrBox: { marginTop: 12, padding: 12, backgroundColor: '#ffffff', borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  qr: { width: 240, height: 240 },
});
