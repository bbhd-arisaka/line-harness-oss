'use client'

import { TEXT_MAX_LENGTH } from '@line-crm/shared'
import type { TextData } from '@line-crm/shared'
import MessageField from '../message-field'
import UrlSettingsSection from '../url-settings'
import type { TabProps } from './types'

/** テキスト: 本文(4,500文字を超えたら複数のメッセージに分割・全体で22,500文字まで)+URL設定 */
export default function TextEditor({ value, onChange, env }: TabProps<TextData>) {
  return (
    <div className="space-y-6">
      <MessageField
        label="本文"
        required
        badges={['短縮URL対応']}
        value={value.text}
        onChange={(text) => onChange({ ...value, text })}
        maxLength={TEXT_MAX_LENGTH}
        rows={10}
        note="約4,500文字を超えた場合は複数のメッセージに分割されます。"
      />
      <UrlSettingsSection value={value.urlSettings} onChange={(urlSettings) => onChange({ ...value, urlSettings })} sourceText={() => value.text} lookups={env.lookups} accountId={env.accountId} />
    </div>
  )
}
