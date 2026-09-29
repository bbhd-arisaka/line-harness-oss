'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { Modal } from './modal'

interface DialogState {
  kind: 'confirm' | 'alert'
  title?: string
  message: string
  okLabel: string
  cancelLabel: string
  danger: boolean
}

interface Dialogs {
  /** ブラウザ標準の confirm の代わり。OK なら true。 */
  confirm: (message: string, opts?: { title?: string; okLabel?: string; cancelLabel?: string; danger?: boolean }) => Promise<boolean>
  /** ブラウザ標準の alert の代わり。 */
  alert: (message: string, opts?: { title?: string; okLabel?: string }) => Promise<void>
}

const Ctx = createContext<Dialogs | null>(null)

/** window.confirm / window.alert の置き換え。暗い背景+ぼかし+フェードのポップアップで表示する。 */
export function DialogsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState | null>(null)
  const [open, setOpen] = useState(false)
  const resolver = useRef<((v: boolean) => void) | null>(null)

  const show = useCallback((s: DialogState) => new Promise<boolean>((resolve) => {
    resolver.current?.(false)
    resolver.current = resolve
    setState(s)
    setOpen(true)
  }), [])

  const close = useCallback((result: boolean) => {
    setOpen(false)
    resolver.current?.(result)
    resolver.current = null
  }, [])

  const api = useMemo<Dialogs>(() => ({
    confirm: (message, opts) => show({
      kind: 'confirm',
      message,
      title: opts?.title,
      okLabel: opts?.okLabel ?? 'OK',
      cancelLabel: opts?.cancelLabel ?? 'キャンセル',
      danger: opts?.danger ?? false,
    }),
    alert: async (message, opts) => {
      await show({ kind: 'alert', message, title: opts?.title, okLabel: opts?.okLabel ?? 'OK', cancelLabel: '', danger: false })
    },
  }), [show])

  return (
    <Ctx.Provider value={api}>
      {children}
      <Modal open={open} onClose={() => close(false)} maxWidthClass="max-w-md" align="center">
        {state && (
          <div>
            {state.title && <h2 className="border-b border-[#e3e3e6] px-6 py-4 text-base font-bold text-[#069e04]">{state.title}</h2>}
            <p className="whitespace-pre-line px-6 py-6 text-sm leading-relaxed text-[#414143]">{state.message}</p>
            <div className="flex justify-end gap-3 border-t border-[#e3e3e6] px-6 py-4">
              {state.kind === 'confirm' && (
                <button type="button" onClick={() => close(false)} className="h-10 min-w-24 rounded border border-[#cacace] bg-white px-4 text-sm hover:bg-[#f7f7f9]">
                  {state.cancelLabel}
                </button>
              )}
              <button
                type="button"
                autoFocus
                onClick={() => close(true)}
                className={`h-10 min-w-24 rounded px-4 text-sm font-bold text-white ${state.danger ? 'bg-[#e5451f] hover:bg-[#c93a19]' : 'bg-[#069e04] hover:bg-[#058503]'}`}
              >
                {state.okLabel}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </Ctx.Provider>
  )
}

export function useDialogs(): Dialogs {
  const v = useContext(Ctx)
  if (!v) {
    // Provider の外(ログイン画面など)では、標準ダイアログにフォールバックする
    return {
      confirm: async (m) => window.confirm(m),
      alert: async (m) => { window.alert(m) },
    }
  }
  return v
}
