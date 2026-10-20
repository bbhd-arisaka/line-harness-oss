'use client'

import type { ChoiceDef, QuestionData } from '@line-crm/shared'
import MessageField from '../message-field'
import UrlSettingsSection from '../url-settings'
import ChoiceEditor from './choice-editor'
import { labelCls } from './types'
import type { TabProps } from './types'

/** 質問(確認テンプレート): 前文・質問文(160文字)・2つの選択肢(各20文字)。詳細設定ONで、返信・タグ・友だち情報・二度押しの返信も出る */
export default function QuestionEditor({ value, onChange, env }: TabProps<QuestionData>) {
  const setChoice = (i: 0 | 1, c: ChoiceDef) => {
    const choices: [ChoiceDef, ChoiceDef] = i === 0 ? [c, value.choices[1]] : [value.choices[0], c]
    onChange({ ...value, choices })
  }
  return (
    <div className="space-y-6">
      <MessageField
        label="前文"
        value={value.lead ?? ''}
        onChange={(lead) => onChange({ ...value, lead })}
        maxLength={4500}
        rows={4}
        toolbar={['name', 'friend', 'emoji']}
        note="入力すると、質問の前にテキストメッセージとして送られます。"
      />
      <MessageField
        label="質問文"
        required
        badges={['短縮URL対応']}
        value={value.question}
        onChange={(question) => onChange({ ...value, question })}
        maxLength={160}
        rows={4}
        toolbar={['name', 'friend', 'emoji']}
      />

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs font-bold">
          <input type="checkbox" checked={!!value.detail} onChange={(e) => onChange({ ...value, detail: e.target.checked })} className="accent-[#069e04]" />
          詳細設定
        </label>
      </div>

      {value.detail ? (
        <div>
          <div className={labelCls}>タップ制限</div>
          <div className="flex gap-4 text-xs">
            {([['single', '1つのみタップ可能'], ['both', '両方タップ可能']] as const).map(([k, l]) => (
              <label key={k} className="flex items-center gap-1">
                <input type="radio" checked={(value.answerMode ?? 'single') === k} onChange={() => onChange({ ...value, answerMode: k })} className="accent-[#069e04]" />
                {l}
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <ChoiceEditor title="選択肢1" value={value.choices[0]} onChange={(c) => setChoice(0, c)} env={env} detail={!!value.detail} labelMax={20} />
        <ChoiceEditor title="選択肢2" value={value.choices[1]} onChange={(c) => setChoice(1, c)} env={env} detail={!!value.detail} labelMax={20} />
      </div>

      <MessageField
        label="PC版・通知欄での代替テキスト"
        value={value.altText ?? ''}
        onChange={(altText) => onChange({ ...value, altText })}
        maxLength={400}
        rows={3}
        toolbar={['name', 'friend', 'emoji']}
        placeholder="[LINEアプリよりご覧下さい]"
      />

      <UrlSettingsSection
        value={value.urlSettings}
        onChange={(urlSettings) => onChange({ ...value, urlSettings })}
        sourceText={() => [value.lead ?? '', value.question, ...value.choices.map((c) => (c.behavior.kind === 'url' ? c.behavior.value ?? '' : ''))].join('\n')}
        lookups={env.lookups}
        accountId={env.accountId}
      />
    </div>
  )
}
