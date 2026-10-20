import { Dimensions } from 'react-native';
import { textScale } from '../lib/layout';

/** 文字の大きさ。iPhone はそのまま、iPad など広い画面では大きくする(読む画面で使う) */
export function fs(size: number): number {
  return Math.round(size * textScale(Dimensions.get('window').width));
}
