'use client'

import { useEffect, useState } from 'react'
import { fetchApi } from '@/lib/api'

export interface FormOption {
  id: string
  name: string
  folderId: string | null
}
export interface FormFolderOption {
  id: string
  name: string
}

interface Cache {
  forms: FormOption[]
  folders: FormFolderOption[]
}

let cache: Cache | null = null
let inflight: Promise<Cache> | null = null

/** フォーム一覧・フォルダを1回だけ取得して使い回す(青い枠の表示名・フォーム選択で共用)。 */
function load(force = false): Promise<Cache> {
  if (cache && !force) return Promise.resolve(cache)
  if (!inflight) {
    inflight = Promise.all([
      fetchApi<{ success: boolean; data: FormOption[] }>('/api/forms'),
      fetchApi<{ success: boolean; data: FormFolderOption[] }>('/api/forms/folders'),
    ])
      .then(([forms, folders]) => {
        cache = {
          forms: forms.success ? forms.data.map((f) => ({ id: f.id, name: f.name, folderId: f.folderId ?? null })) : [],
          folders: folders.success ? folders.data.map((f) => ({ id: f.id, name: f.name })) : [],
        }
        return cache
      })
      .catch(() => (cache = cache ?? { forms: [], folders: [] }))
      .finally(() => { inflight = null })
  }
  return inflight
}

export function useForms(): Cache & { loaded: boolean } {
  const [state, setState] = useState<Cache | null>(cache)
  useEffect(() => {
    let alive = true
    void load().then((c) => { if (alive) setState(c) })
    return () => { alive = false }
  }, [])
  return { forms: state?.forms ?? [], folders: state?.folders ?? [], loaded: state !== null }
}
