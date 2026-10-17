'use client'

import { useState, useEffect, useRef } from 'react'
import { api } from '@/lib/api'
import DefaultAvatar from '@/components/friends/default-avatar'
import { Button } from '@cloudflare/kumo/components/button'
import { Checkbox } from '@cloudflare/kumo/components/checkbox'
import { Input } from '@cloudflare/kumo/components/input'
import { Loader } from '@cloudflare/kumo/components/loader'

interface TestSendSectionProps {
  broadcastId: string
  accountId: string
  disabled: boolean
}

interface Candidate {
  id: string
  displayName: string
  pictureUrl: string | null
  recent?: boolean
}

/** 一度に選べる人数(サーバー側の上限と同じ) */
const MAX_PICK = 10

/** テスト送信: 友だちをその場で検索して(チェックボックスで複数)選ぶ。前回使った人は上に並ぶ */
export default function TestSendSection({ broadcastId, accountId, disabled }: TestSendSectionProps) {
  const [history, setHistory] = useState<Candidate[]>([])
  const [search, setSearch] = useState('')
  const [found, setFound] = useState<Candidate[]>([])
  const [searching, setSearching] = useState(false)
  // 選んだ人(検索を変えても残す)
  const [picked, setPicked] = useState<Map<string, Candidate>>(new Map())
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ sent: number; failed: number; at: string; error?: string } | null>(null)
  const searchSeq = useRef(0)

  const loadHistory = () => {
    api.accountSettings.getTestRecipientsWithHistory(accountId).then(res => {
      if (res.success) setHistory(res.data)
    }).catch(() => { /* 候補が出ないだけ。検索はできる */ })
  }

  useEffect(() => {
    setPicked(new Map())
    setSearch('')
    setFound([])
    loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  // 入力が止まってから検索(2文字以上)
  useEffect(() => {
    const word = search.trim()
    if (word.length < 2) { setFound([]); setSearching(false); return }
    const seq = ++searchSeq.current
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await api.friends.list({ search: word, accountId, limit: 20, includeTags: false })
        if (seq !== searchSeq.current) return
        if (res.success) {
          const items = (res.data as unknown as { items: Candidate[] }).items ?? res.data
          setFound((Array.isArray(items) ? items : []).map((f: Candidate) => ({ id: f.id, displayName: f.displayName, pictureUrl: f.pictureUrl })))
        }
      } catch { /* 検索できなかっただけ */ }
      finally { if (seq === searchSeq.current) setSearching(false) }
    }, 300)
    return () => clearTimeout(timer)
  }, [search, accountId])

  const toggle = (friend: Candidate, on: boolean) => {
    setPicked(prev => {
      const next = new Map(prev)
      if (on) {
        if (next.size >= MAX_PICK) return prev
        next.set(friend.id, friend)
      } else {
        next.delete(friend.id)
      }
      return next
    })
  }

  const handleTestSend = async () => {
    setSending(true)
    const at = () => new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
    try {
      const res = await api.broadcasts.testSend(broadcastId, [...picked.keys()])
      if (res.success) {
        setResult({ sent: res.sent ?? 0, failed: res.failed ?? 0, at: at() })
        loadHistory()
      } else {
        setResult({ sent: 0, failed: 0, at: at(), error: res.error ?? 'テスト送信に失敗しました' })
      }
    } catch (e) {
      setResult({ sent: 0, failed: 0, at: at(), error: e instanceof Error ? e.message : 'テスト送信に失敗しました' })
    } finally { setSending(false) }
  }

  const searchMode = search.trim().length >= 2
  const list = searchMode ? found : history
  const full = picked.size >= MAX_PICK

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-2">テスト送信</h3>
      <p className="text-xs text-gray-500 mb-2">送りたい友だちを検索して、チェックを入れてください(最大{MAX_PICK}人)。</p>

      <Input
        aria-label="テスト送信する友だちを検索"
        placeholder="友だちの名前で検索(2文字以上)…"
        value={search}
        onValueChange={setSearch}
      />

      <p className="mt-3 mb-1 text-xs font-semibold text-gray-600">
        {searchMode ? '検索結果' : '前回使った友だち'}
        {searching ? <span className="ml-2 inline-flex items-center gap-1 font-normal text-gray-400"><Loader size="sm" />検索中</span> : null}
      </p>
      <ul className="max-h-56 overflow-y-auto rounded-md border border-gray-100 divide-y divide-gray-100">
        {list.length === 0 ? (
          <li className="px-3 py-3 text-xs text-gray-400">
            {searchMode ? (searching ? '' : '見つかりません') : '履歴はまだありません。名前で検索してください。'}
          </li>
        ) : list.map(friend => {
          const checked = picked.has(friend.id)
          return (
            <li key={friend.id} className="flex items-center gap-2 px-3 py-2">
              {friend.pictureUrl ? (
                <img src={friend.pictureUrl} alt="" className="h-6 w-6 rounded-full" />
              ) : (
                <DefaultAvatar size="h-6 w-6" />
              )}
              <Checkbox
                label={friend.displayName}
                checked={checked}
                disabled={!checked && full}
                onCheckedChange={(on) => toggle(friend, on)}
              />
            </li>
          )
        })}
      </ul>

      <p className="mt-3 text-xs text-gray-500">
        {picked.size === 0
          ? '送る友だちが選ばれていません。'
          : `選択中(${picked.size}人): ${[...picked.values()].map(f => f.displayName).join('、')}`}
      </p>
      <div className="mt-2">
        <Button
          onClick={handleTestSend}
          disabled={disabled || sending || picked.size === 0}
          variant="primary"
          loading={sending}
        >
          {sending ? 'テスト送信中...' : picked.size > 0 ? `選んだ${picked.size}人にテスト送信する` : 'テスト送信する'}
        </Button>
      </div>
      {result && (
        <p className={`text-xs mt-2 ${result.error ? 'text-red-600' : 'text-green-600'}`}>
          {result.error
            ? `${result.at} ${result.error}`
            : `${result.at} テスト送信済み (${result.sent}名成功${result.failed > 0 ? `, ${result.failed}名失敗` : ''})`}
        </p>
      )}
    </div>
  )
}
