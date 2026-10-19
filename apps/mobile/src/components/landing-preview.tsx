import { Image, ImageBackground, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { resolveLandingView, type LandingStyle } from '../lib/inflow';

/** 画面の幅の基準(実際のページの、スマホでの見え方に近い大きさ)。この大きさで作って、縮めて見せる */
export const LANDING_PREVIEW_W = 360;
export const LANDING_PREVIEW_H = 560;

/**
 * 友だち追加ページのプレビュー(実際のページに近い見た目)。編集のたびに、すぐ変わる。
 * 実際のページとの違い: 「カードの後ろのぼかし」は、アプリでは表示されない(実際のページには効く)
 */
export function LandingPreview({ style, scale }: { style: LandingStyle; scale: number }) {
  const v = resolveLandingView(style);
  const w = LANDING_PREVIEW_W;
  const h = LANDING_PREVIEW_H;
  const page = (
    <View style={[styles.page, { backgroundColor: v.colors.pageBg }]}>
      {v.bgImage ? (
        <ImageBackground source={{ uri: v.bgImage }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : null}
      {v.veil ? <View style={[StyleSheet.absoluteFill, { backgroundColor: v.veil }]} /> : null}
      <View style={styles.center}>
        <View style={[styles.card, { backgroundColor: v.cardBg, borderRadius: v.cardRadius }]}>
          {v.showIcon ? (
            v.iconUrl ? (
              <Image source={{ uri: v.iconUrl }} style={styles.icon} />
            ) : (
              <View style={[styles.icon, { backgroundColor: v.colors.button, alignItems: 'center', justifyContent: 'center' }]}>
                <Ionicons name="chatbubble" size={30} color={v.colors.buttonText} />
              </View>
            )
          ) : null}
          <Text style={[styles.title, { color: v.colors.text }]}>{v.title}</Text>
          {v.subtitle ? <Text style={[styles.sub, { color: v.muted }]}>{v.subtitle}</Text> : null}
          <View style={[styles.btn, { backgroundColor: v.buttonBg, borderRadius: v.buttonRadius }]}>
            <Text style={[styles.btnText, { color: v.colors.buttonText }]}>{v.buttonText}</Text>
          </View>
          {v.hintText ? <Text style={[styles.hint, { color: v.muted }]}>{v.hintText}</Text> : null}
          {v.helpText ? <Text style={[styles.help, { color: v.muted }]}>{v.helpText}</Text> : null}
        </View>
      </View>
    </View>
  );
  return (
    <View style={{ width: w * scale, height: h * scale, borderRadius: 18 * scale + 6, overflow: 'hidden', borderWidth: 3, borderColor: '#2b2b2e' }} accessibilityLabel="友だち追加ページのプレビュー">
      <View style={{ width: w, height: h, transform: [{ scale }], transformOrigin: 'top left' }}>{page}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { width: '100%', padding: 28, paddingTop: 36, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.09, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } },
  icon: { width: 64, height: 64, borderRadius: 18, marginBottom: 20, overflow: 'hidden' },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center', lineHeight: 30 },
  sub: { fontSize: 14, lineHeight: 24, textAlign: 'center', marginTop: 10 },
  btn: { width: '100%', minHeight: 56, marginTop: 28, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  btnText: { fontSize: 17, fontWeight: '700' },
  hint: { fontSize: 12, lineHeight: 21, textAlign: 'center', marginTop: 14 },
  help: { fontSize: 12, textAlign: 'center', marginTop: 20, textDecorationLine: 'underline' },
});
