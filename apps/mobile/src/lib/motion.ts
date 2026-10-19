import { LayoutAnimation, Platform, UIManager } from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) UIManager.setLayoutAnimationEnabledExperimental(true);

/**
 * 次の画面の変化(行の並び替え・追加・削除・高さの変化)を、なめらかに動かす。
 * 状態を変える直前に呼ぶ。動きは短く(240ms)・控えめ(ゆっくり出入りする)。
 */
export function animateLayout(): void {
  LayoutAnimation.configureNext({
    duration: 240,
    create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    update: { type: LayoutAnimation.Types.easeInEaseOut },
    delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  });
}
