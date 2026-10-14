'use client'

import { useEffect, useRef, useState } from 'react'
import { apiUrl } from '@/lib/api'
import { chatEventsUrl, parseChatEvent, reconnectDelayMs, type ChatEventMessage } from '@/lib/chat-events-client'

export type ChatEventsStatus = 'connecting' | 'open' | 'closed'

const PING_MS = 25_000

/**
 * トークの新着の合図(WebSocket)を受け取る。お客様のメッセージ・友だち追加・フォーム回答・他の人の送信のたびに、
 * サーバーから「どの友だちのトークか」という小さな合図が届く。切れたら、間隔を空けながら自動でつなぎ直す。
 * つなぎ直したとき(最初の接続も含む)は onOpen が呼ばれる: 切れている間の取りこぼしを、画面側で取り直すため。
 */
export function useChatEvents(onEvent: (e: ChatEventMessage) => void, onOpen: () => void): ChatEventsStatus {
  const [status, setStatus] = useState<ChatEventsStatus>('connecting')
  const onEventRef = useRef(onEvent)
  const onOpenRef = useRef(onOpen)
  onEventRef.current = onEvent
  onOpenRef.current = onOpen

  useEffect(() => {
    let ws: WebSocket | null = null
    let stopped = false
    let attempt = 0
    let pingTimer: ReturnType<typeof setInterval> | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    const clearTimers = () => {
      if (pingTimer) clearInterval(pingTimer)
      if (retryTimer) clearTimeout(retryTimer)
      pingTimer = undefined
      retryTimer = undefined
    }

    const connect = () => {
      if (stopped) return
      let url: string
      try {
        url = chatEventsUrl(apiUrl())
      } catch {
        setStatus('closed')
        return
      }
      setStatus('connecting')
      const socket = new WebSocket(url)
      ws = socket
      socket.onopen = () => {
        attempt = 0
        setStatus('open')
        // 眠っているサーバー側を起こさない、つなぎっぱなしの確認(サーバーが自動で pong を返す)
        pingTimer = setInterval(() => {
          try {
            socket.send('ping')
          } catch {
            /* 切れたら onclose でつなぎ直す */
          }
        }, PING_MS)
        onOpenRef.current()
      }
      socket.onmessage = (m) => {
        if (m.data === 'pong') return
        const e = parseChatEvent(m.data)
        if (e) onEventRef.current(e)
      }
      socket.onclose = () => {
        if (pingTimer) clearInterval(pingTimer)
        pingTimer = undefined
        setStatus('closed')
        if (stopped) return
        retryTimer = setTimeout(connect, reconnectDelayMs(attempt++))
      }
      socket.onerror = () => {
        try {
          socket.close()
        } catch {
          /* すでに閉じている */
        }
      }
    }

    // タブに戻ったとき、切れていればすぐにつなぎ直す
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || stopped) return
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        clearTimers()
        attempt = 0
        connect()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    connect()

    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVisible)
      clearTimers()
      try {
        ws?.close()
      } catch {
        /* すでに閉じている */
      }
    }
  }, [])

  return status
}
