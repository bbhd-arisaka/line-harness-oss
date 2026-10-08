'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

// 画面を開いている間に、同じ友だちを何度も取り直さない
const attempted = new Set<string>()

/**
 * 友だちのプロフィール画像。LINEの画像URLは時間がたつと見られなくなることがあるため、
 * 表示できなかった(または画像が未取得の)ときは、LINEから取り直して表示し直す。
 * それでも画像がなければ、名前の頭文字を出す。
 */
export default function FriendAvatar({
  friendId,
  url,
  name,
  size = 'h-10 w-10',
  tone = 'bg-gray-200 text-gray-500',
  textSize = 'text-sm',
  className = '',
}: {
  friendId: string | null | undefined
  url: string | null | undefined
  name: string | null | undefined
  /** 大きさ(Tailwind のクラス。例 h-10 w-10) */
  size?: string
  /** 画像がないときの背景と文字色 */
  tone?: string
  textSize?: string
  className?: string
}) {
  const [src, setSrc] = useState<string | null>(url ?? null)

  useEffect(() => {
    setSrc(url ?? null)
  }, [url])

  const refresh = () => {
    if (!friendId || attempted.has(friendId)) {
      setSrc(null)
      return
    }
    attempted.add(friendId)
    api.friends
      .refreshProfile(friendId)
      .then((res) => setSrc(res.success && res.data.pictureUrl && res.data.pictureUrl !== src ? res.data.pictureUrl : null))
      .catch(() => setSrc(null))
  }

  // 画像が未取得の人も、一度だけ取り直してみる(登録時に取れなかった人)
  useEffect(() => {
    if (!url && friendId && !attempted.has(friendId)) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friendId, url])

  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className={`${size} flex-shrink-0 rounded-full object-cover ${className}`} onError={refresh} />
  }
  return (
    <span className={`flex ${size} flex-shrink-0 items-center justify-center rounded-full ${tone} ${textSize} ${className}`}>
      {(name || '?').charAt(0)}
    </span>
  )
}
