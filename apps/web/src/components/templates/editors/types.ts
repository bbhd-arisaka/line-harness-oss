import type { ModalLookups } from '@/components/friend-add/action-settings-modal'

/** 種類ごとの入力欄に渡す、共通の道具(公式アカウント・アクション設定で選べるもの) */
export interface EditorEnv {
  accountId: string
  lookups: ModalLookups
}

export interface TabProps<T> {
  value: T
  onChange: (v: T) => void
  env: EditorEnv
}

export const fieldCls = 'h-9 w-full rounded border border-[#cacace] px-3 text-sm outline-none focus:border-[#069e04] disabled:bg-[#f7f7f9] disabled:text-[#757578]'
export const labelCls = 'mb-1 flex items-center gap-1.5 text-xs font-bold'
export const btnLine = 'inline-flex h-9 items-center justify-center rounded border border-[#069e04] bg-white px-4 text-xs font-bold text-[#069e04] hover:bg-[#f3fbf3]'
