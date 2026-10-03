import { useColorScheme } from 'react-native';

// beyond line の見た目: 緑(#06c755)を基調に。Web の globals.css(#069e04 / #f7f8fa / #101828 / #e4e7ec)に合わせる。
export interface Colors {
  background: string;
  card: string;
  text: string;
  textSub: string;
  textMuted: string;
  border: string;
  /** アクセント(アイコン・選択中の表示) */
  primary: string;
  /** 文字が白のボタンの背景(コントラストを確保した緑) */
  primaryButton: string;
  primarySoft: string;
  primaryText: string;
  danger: string;
  dangerSoft: string;
  warning: string;
  warningSoft: string;
  bubbleIncoming: string;
  bubbleIncomingText: string;
  bubbleOutgoing: string;
  bubbleOutgoingText: string;
  chatBackground: string;
  inputBackground: string;
}

export const lightColors: Colors = {
  background: '#f7f8fa',
  card: '#ffffff',
  text: '#101828',
  textSub: '#475467',
  textMuted: '#667085',
  border: '#e4e7ec',
  primary: '#06c755',
  primaryButton: '#069e04',
  primarySoft: '#e7f8ee',
  primaryText: '#058503',
  danger: '#d92d20',
  dangerSoft: '#fef3f2',
  warning: '#b54708',
  warningSoft: '#fffaeb',
  bubbleIncoming: '#ffffff',
  bubbleIncomingText: '#101828',
  bubbleOutgoing: '#a7e99e',
  bubbleOutgoingText: '#0b2a0a',
  chatBackground: '#e9edf2',
  inputBackground: '#f2f4f7',
};

export const darkColors: Colors = {
  background: '#0b0f14',
  card: '#151a21',
  text: '#f2f4f7',
  textSub: '#cbd2dc',
  textMuted: '#98a2b3',
  border: '#2a313b',
  primary: '#2fd677',
  primaryButton: '#0a8a09',
  primarySoft: '#10301d',
  primaryText: '#4fe08a',
  danger: '#f97066',
  dangerSoft: '#3a1512',
  warning: '#fdb022',
  warningSoft: '#3a2a0a',
  bubbleIncoming: '#232a33',
  bubbleIncomingText: '#f2f4f7',
  bubbleOutgoing: '#1f7a3d',
  bubbleOutgoingText: '#ffffff',
  chatBackground: '#10151b',
  inputBackground: '#1d232b',
};

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? darkColors : lightColors;
}

/** タップ領域の最小(iOS の推奨 44pt) */
export const MIN_TAP = 44;
