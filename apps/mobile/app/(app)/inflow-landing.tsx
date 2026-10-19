import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Button, Card, SectionTitle } from '../../src/components/ui';
import { LandingPreview } from '../../src/components/landing-preview';
import { withReadableWidth } from '../../src/components/readable-width';
import { describeError } from '../../src/lib/errors';
import {
  applyLandingPreset,
  isHexColor,
  LANDING_COLOR_FIELDS,
  LANDING_DEFAULTS,
  LANDING_PRESETS,
  LANDING_STEPPERS,
  type LandingColorKey,
  type LandingStyle,
} from '../../src/lib/inflow';
import { pickAndUploadImage } from '../../src/state/image-upload';
import { getLandingDraft, setLandingDraft } from '../../src/state/inflow-draft';
import { MIN_TAP, useColors } from '../../src/theme/theme';

const PREVIEW_SCALE = 0.5;

function Stepper({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  const c = useColors();
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <View style={styles.stepRow}>
      <Text style={{ color: c.text, fontSize: 14, flex: 1 }}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}を減らす`} disabled={value <= min} onPress={() => onChange(clamp(value - step))} style={[styles.stepBtn, { borderColor: c.border, opacity: value <= min ? 0.4 : 1 }]}>
        <Text style={{ color: c.text, fontSize: 20, fontWeight: '700' }}>−</Text>
      </Pressable>
      <Text style={{ color: c.text, fontSize: 15, fontWeight: '700', width: 64, textAlign: 'center' }}>{value}{unit}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}を増やす`} disabled={value >= max} onPress={() => onChange(clamp(value + step))} style={[styles.stepBtn, { borderColor: c.border, opacity: value >= max ? 0.4 : 1 }]}>
        <Text style={{ color: c.text, fontSize: 20, fontWeight: '700' }}>＋</Text>
      </Pressable>
    </View>
  );
}

/** 友だち追加ページのデザイン。上のプレビューを見ながら、文言・色・背景画像・透過・角丸を変えられる */
function InflowLandingScreen() {
  const c = useColors();
  const { url } = useLocalSearchParams<{ url?: string }>();
  const [style, setStyleState] = useState<LandingStyle>(() => getLandingDraft());
  const [busy, setBusy] = useState<'bg' | 'icon' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setStyle = useCallback((next: LandingStyle) => {
    setStyleState(next);
    setLandingDraft(next);
  }, []);
  const set = (patch: Partial<LandingStyle>) => setStyle({ ...style, ...patch });
  const setColor = (key: LandingColorKey, v: string) => setStyle({ ...style, colors: { ...(style.colors ?? {}), [key]: v.trim() || null } });

  async function chooseImage(kind: 'bg' | 'icon') {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      const u = await pickAndUploadImage();
      if (u) set(kind === 'bg' ? { bgImageUrl: u } : { iconUrl: u });
    } catch (e) {
      setError(describeError(e, '画像を設定できませんでした'));
    } finally {
      setBusy(null);
    }
  }

  const input = (label: string, key: 'title' | 'subtitle' | 'buttonText' | 'pcTitle', max: number, extra?: { multiline?: boolean }) => (
    <View style={{ marginTop: 12 }}>
      <Text style={[styles.label, { color: c.textMuted }]}>{label}</Text>
      <TextInput
        value={style[key] ?? ''}
        onChangeText={(v) => set({ [key]: v } as Partial<LandingStyle>)}
        maxLength={max}
        placeholder={key in LANDING_DEFAULTS ? String((LANDING_DEFAULTS as Record<string, unknown>)[key]) : undefined}
        placeholderTextColor={c.textMuted}
        accessibilityLabel={label}
        multiline={extra?.multiline}
        style={[styles.input, { backgroundColor: c.inputBackground, color: c.text }]}
      />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      {/* プレビューは、上に固定。下の設定を動かしながら、すぐ確かめられる */}
      <View style={[styles.previewBar, { backgroundColor: c.chatBackground, borderBottomColor: c.border }]}>
        <LandingPreview style={style} scale={PREVIEW_SCALE} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SectionTitle>デザインのひな形</SectionTitle>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {LANDING_PRESETS.map((p) => (
            <Pressable key={p.id} accessibilityRole="button" onPress={() => setStyle(applyLandingPreset(style, p.id))} style={[styles.chip, { borderColor: c.border, backgroundColor: c.card }]}>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 14 }}>{p.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <SectionTitle>文言</SectionTitle>
        <Card>
          {input('見出し', 'title', 60)}
          {input('見出しの下の説明', 'subtitle', 120)}
          {input('ボタンの文字', 'buttonText', 30)}
          <View style={{ marginTop: 12 }}>
            <Text style={[styles.label, { color: c.textMuted }]}>ボタンの下の文(iPhone)</Text>
            <TextInput
              value={style.hintText ?? ''}
              onChangeText={(v) => set({ hintText: v })}
              maxLength={120}
              editable={style.showHint !== false}
              placeholder={LANDING_DEFAULTS.hintText}
              placeholderTextColor={c.textMuted}
              accessibilityLabel="ボタンの下の文"
              style={[styles.input, { backgroundColor: c.inputBackground, color: c.text, opacity: style.showHint === false ? 0.5 : 1 }]}
            />
            <Pressable accessibilityRole="switch" accessibilityState={{ checked: style.showHint !== false }} onPress={() => set({ showHint: style.showHint === false })} style={styles.toggleRow}>
              <View style={[styles.check, { borderColor: c.border, backgroundColor: style.showHint !== false ? c.primary : c.card }]} />
              <Text style={{ color: c.text, fontSize: 14 }}>表示する</Text>
            </Pressable>
          </View>
          <View style={{ marginTop: 12 }}>
            <Text style={[styles.label, { color: c.textMuted }]}>「うまく開けない方は」の行</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TextInput value={style.helpText ?? ''} onChangeText={(v) => set({ helpText: v })} maxLength={40} editable={style.showHelp !== false} placeholder={LANDING_DEFAULTS.helpText} placeholderTextColor={c.textMuted} accessibilityLabel="うまく開けない方への文" style={[styles.input, { flex: 2, backgroundColor: c.inputBackground, color: c.text, opacity: style.showHelp === false ? 0.5 : 1 }]} />
              <TextInput value={style.helpLinkText ?? ''} onChangeText={(v) => set({ helpLinkText: v })} maxLength={20} editable={style.showHelp !== false} placeholder={LANDING_DEFAULTS.helpLinkText} placeholderTextColor={c.textMuted} accessibilityLabel="リンクの文字" style={[styles.input, { flex: 1, backgroundColor: c.inputBackground, color: c.text, opacity: style.showHelp === false ? 0.5 : 1 }]} />
            </View>
            <Pressable accessibilityRole="switch" accessibilityState={{ checked: style.showHelp !== false }} onPress={() => set({ showHelp: style.showHelp === false })} style={styles.toggleRow}>
              <View style={[styles.check, { borderColor: c.border, backgroundColor: style.showHelp !== false ? c.primary : c.card }]} />
              <Text style={{ color: c.text, fontSize: 14 }}>表示する</Text>
            </Pressable>
          </View>
          {input('パソコンで開いたときの見出し', 'pcTitle', 60)}
        </Card>

        <SectionTitle>背景画像</SectionTitle>
        <Card>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title={style.bgImageUrl ? '画像を選び直す' : '画像を選ぶ'} variant="secondary" loading={busy === 'bg'} onPress={() => void chooseImage('bg')} style={{ flex: 1 }} />
            {style.bgImageUrl ? <Button title="外す" variant="secondary" onPress={() => set({ bgImageUrl: null })} /> : null}
          </View>
        </Card>

        <SectionTitle>色</SectionTitle>
        <Card>
          {LANDING_COLOR_FIELDS.map((f) => {
            const current = style.colors?.[f.key] ?? '';
            const shown = isHexColor(current) ? current : LANDING_DEFAULTS.colors[f.key];
            return (
              <View key={f.key} style={styles.colorRow}>
                <View style={[styles.swatch, { backgroundColor: shown, borderColor: c.border }]} />
                <Text style={{ color: c.text, fontSize: 14, flex: 1 }}>{f.label}</Text>
                <TextInput
                  value={current}
                  onChangeText={(v) => setColor(f.key, v)}
                  placeholder={LANDING_DEFAULTS.colors[f.key]}
                  placeholderTextColor={c.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={7}
                  accessibilityLabel={`${f.label}の色`}
                  style={[styles.input, { width: 116, backgroundColor: c.inputBackground, color: c.text, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) }]}
                />
              </View>
            );
          })}
        </Card>

        <SectionTitle>透過・ぼかし・角の丸み</SectionTitle>
        <Card>
          {LANDING_STEPPERS.map((st) => (
            <Stepper key={st.key} label={st.label} value={style[st.key] ?? LANDING_DEFAULTS[st.key]} min={st.min} max={st.max} step={st.step} unit={st.unit} onChange={(v) => set({ [st.key]: v } as Partial<LandingStyle>)} />
          ))}
        </Card>

        <SectionTitle>アイコン</SectionTitle>
        <Card>
          <Pressable accessibilityRole="switch" accessibilityState={{ checked: style.showIcon !== false }} onPress={() => set({ showIcon: style.showIcon === false })} style={styles.toggleRow}>
            <View style={[styles.check, { borderColor: c.border, backgroundColor: style.showIcon !== false ? c.primary : c.card }]} />
            <Text style={{ color: c.text, fontSize: 14 }}>表示する</Text>
          </Pressable>
          {style.showIcon === false ? null : (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <Button title={style.iconUrl ? '画像を選び直す' : '自分の画像にする'} variant="secondary" loading={busy === 'icon'} onPress={() => void chooseImage('icon')} style={{ flex: 1 }} />
              {style.iconUrl ? <Button title="外す" variant="secondary" onPress={() => set({ iconUrl: null })} /> : null}
            </View>
          )}
        </Card>

        {error ? <Text style={{ color: c.danger, fontSize: 14, marginTop: 12 }} accessibilityRole="alert">{error}</Text> : null}
        {url ? <Button title="実際のページを見る" variant="secondary" onPress={() => void Linking.openURL(`${url}${url.includes('?') ? '&' : '?'}preview=1`)} style={{ marginTop: 16 }} /> : null}
        <Button title="すべて既定に戻す" variant="secondary" onPress={() => setStyle({})} style={{ marginTop: 10 }} />
        {busy ? <ActivityIndicator style={{ marginTop: 12 }} color={c.primary} /> : null}
      </ScrollView>
    </View>
  );
}

export default withReadableWidth(InflowLandingScreen);

const styles = StyleSheet.create({
  previewBar: { alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  content: { padding: 16, gap: 8, paddingBottom: 48 },
  label: { fontSize: 12, marginBottom: 4 },
  input: { minHeight: MIN_TAP, borderRadius: 10, paddingHorizontal: 12, fontSize: 16 },
  chip: { minHeight: 40, borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, justifyContent: 'center' },
  colorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 1 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  stepBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, minHeight: 32 },
  check: { width: 20, height: 20, borderRadius: 6, borderWidth: 1 },
});
