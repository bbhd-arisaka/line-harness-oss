'use client'

import { useEffect, useState } from 'react'
import { api, fetchApi } from '@/lib/api'
import type { ModalLookups } from './action-settings-modal'

const EMPTY: ModalLookups = { tags: [], templates: [], menus: [], fields: [], reminders: [], conversions: [], forms: [], scenarios: [] }

/** アクション設定ダイアログで選べるもの(タグ・テンプレート・リッチメニュー・友だち情報欄・リマインダ・コンバージョン・フォーム・シナリオ)を読み込む */
export function useActionLookups(accountId: string, reserve?: { change: boolean }): ModalLookups {
  const [lookups, setLookups] = useState<ModalLookups>(EMPTY)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [sc, tg, tp, mn, fd, rm, cv, fm] = await Promise.all([
        api.scenarios.list({ accountId }).catch(() => null),
        api.tags.list().catch(() => null),
        api.templates.list().catch(() => null),
        api.richMenuGroups.list(accountId).catch(() => null),
        fetchApi<{ success: boolean; data: Array<{ field_key?: string; fieldKey?: string; label: string }> }>('/api/friend-fields/definitions').catch(() => null),
        api.reminders.list().catch(() => null),
        api.conversions.points().catch(() => null),
        fetchApi<{ success: boolean; data: Array<{ id: string; name: string }> }>('/api/forms').catch(() => null),
      ])
      if (cancelled) return
      setLookups({
        scenarios: sc && sc.success ? sc.data.map((x) => ({ id: x.id, name: x.name })) : [],
        tags: tg && tg.success ? tg.data.map((x) => ({ id: x.id, name: x.name })) : [],
        templates: tp && tp.success ? tp.data.map((x) => ({ id: x.id, name: x.name })) : [],
        menus: mn && mn.success ? mn.data.filter((x) => x.status === 'published').map((x) => ({ id: x.id, name: x.name })) : [],
        fields: fd && fd.success ? fd.data.map((f) => ({ fieldKey: (f.fieldKey ?? f.field_key) as string, label: f.label })) : [],
        reminders: rm && rm.success ? rm.data.map((x) => ({ id: x.id, name: x.name })) : [],
        conversions: cv && cv.success ? cv.data.map((x) => ({ id: x.id, name: x.name })) : [],
        forms: fm && fm.success ? fm.data.map((x) => ({ id: x.id, name: x.name })) : [],
        reserve,
      })
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, reserve?.change])

  return lookups
}
