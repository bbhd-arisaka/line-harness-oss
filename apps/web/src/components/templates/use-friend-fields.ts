'use client'

import { useEffect, useState } from 'react'
import { fetchApi } from '@/lib/api'

export interface FriendFieldOption {
  fieldKey: string
  label: string
  folderId: string | null
}
export interface FriendFieldFolderOption {
  id: string
  name: string
}

interface Cache {
  fields: FriendFieldOption[]
  folders: FriendFieldFolderOption[]
}

let cache: Cache | null = null
let inflight: Promise<Cache> | null = null

function load(): Promise<Cache> {
  if (cache) return Promise.resolve(cache)
  if (!inflight) {
    inflight = Promise.all([
      fetchApi<{ success: boolean; data: Array<{ fieldKey: string; label: string; folderId: string | null }> }>('/api/friend-fields/definitions'),
      fetchApi<{ success: boolean; data: Array<{ id: string; name: string }> }>('/api/friend-fields/folders'),
    ])
      .then(([defs, folders]) => {
        cache = {
          fields: defs.success ? defs.data.map((d) => ({ fieldKey: d.fieldKey, label: d.label, folderId: d.folderId ?? null })) : [],
          folders: folders.success ? folders.data.map((f) => ({ id: f.id, name: f.name })) : [],
        }
        return cache
      })
      .catch(() => (cache = cache ?? { fields: [], folders: [] }))
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

/** 友だち情報欄(とフォルダ)。テキストの「友だち情報」メニューと、枠の表示名に使う。1回だけ読んで使い回す */
export function useFriendFields(): Cache & { loaded: boolean; labels: Map<string, string> } {
  const [state, setState] = useState<Cache | null>(cache)
  useEffect(() => {
    let alive = true
    void load().then((c) => {
      if (alive) setState(c)
    })
    return () => {
      alive = false
    }
  }, [])
  const fields = state?.fields ?? []
  return { fields, folders: state?.folders ?? [], loaded: state !== null, labels: new Map(fields.map((f) => [f.fieldKey, f.label])) }
}
