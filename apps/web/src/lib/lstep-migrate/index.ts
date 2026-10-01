/**
 * Lステップ → beyond line 引き継ぎ: 変換処理のまとめ(純粋関数のみ。fetch / DOM / Node API は使わない)。
 */
import { buildFormsDataset, type FormReport, type FormsBuild } from './build-forms'
import { buildFriendsDataset, type FriendsBuild } from './build-friends'
import { buildMessages, messagesEnvelope, type MessageStats } from './build-messages'
import { matchFriends, type MatchResult, type MatchSummary, type ReviewItem } from './match'
import type { BeyondForm, BeyondFriend, DatasetEnvelope, DatasetMessage, LstepPackage } from './types'

export * from './types'
export { parseCsv, csvById } from './csv'
export { matchFriends, beyondOf, groupByOwner, buildReview } from './match'
export type { MatchResult, MatchSummary, MatchHow, ReviewItem, MatchOptions } from './match'
export { buildFriendsDataset } from './build-friends'
export { buildFormsDataset, mapColumns, findBeyondForm } from './build-forms'
export type { FormReport, ColumnAssignment } from './build-forms'
export { buildMessages, convertMessage } from './build-messages'

export interface BeyondContext {
  friends: BeyondFriend[]
  forms: BeyondForm[]
  /** 取り込み先の beyond line の公式アカウントID */
  accountId: string
  accountName: string
}

/** 人が決めたこと(画面の「要確認」で選んだもの) */
export interface Decisions {
  /** Lステップの友だちID → beyond の友だちID */
  manualPicks?: Record<string, string>
  /** Lステップのフォームid(lid) → beyond のフォームid */
  formPicks?: Record<string, string>
}

export interface MigrationSummary {
  friends: {
    /** Lステップの記録数(CSV + 一覧) */
    lstepTotal: number
    /** beyond の友だちと対応づいた Lステップの記録数 */
    matched: number
    /** 取り込む友だち数(beyond の友だち単位) */
    importable: number
    duplicates: number
    manualApplied: number
    /** 有効なのに決まらなかった(要確認)人数 */
    needsReview: number
    /** 要確認のうち、友だち情報・タグが入っている人数 */
    needsReviewWithData: number
    blockedUnmatched: number
    withTags: number
    withValues: number
  }
  definitions: { folders: number; fields: number; tags: number }
  forms: {
    lstepForms: number
    mapped: number
    unmatched: number
    answers: number
    answersWithFriend: number
    answersWithoutFriend: number
    hiddenFieldsAdded: number
  }
  messages: { total: number; friends: number }
  warnings: string[]
}

export interface MigrationResult {
  matches: MatchResult[]
  matchSummary: MatchSummary
  /** 自動で決められなかった有効な友だち(候補つき) */
  review: ReviewItem[]
  /** 未対応のフォーム(候補つき) */
  unmatchedForms: FormReport[]
  friends: FriendsBuild
  forms: FormsBuild
  messages: DatasetMessage[]
  messageStats: MessageStats
  /** 取り込み画面に渡す3つのファイル(友だち情報・タグ → フォーム → トーク履歴) */
  datasets: { friends: DatasetEnvelope; forms: DatasetEnvelope; messages: DatasetEnvelope }
  summary: MigrationSummary
}

export function buildAll(
  pkg: LstepPackage,
  beyond: BeyondContext,
  decisions: Decisions = {},
  opts: { builtAt?: string } = {},
): MigrationResult {
  const builtAt = opts.builtAt ?? new Date().toISOString()
  const { results: matches, summary: matchSummary, review } = matchFriends(pkg, beyond.friends, { manualPicks: decisions.manualPicks })
  const friends = buildFriendsDataset(pkg, matches, beyond.accountId, beyond.accountName, { builtAt })
  const forms = buildFormsDataset(pkg, matches, beyond.forms, {
    formPicks: decisions.formPicks, accountId: beyond.accountId, accountName: beyond.accountName, builtAt,
  })
  const { messages, stats: messageStats } = buildMessages(pkg, matches)
  const datasets = {
    friends: friends.dataset,
    forms: forms.dataset,
    messages: messagesEnvelope(messages, beyond.accountId, beyond.accountName, builtAt),
  }
  const fr = friends.dataset.friends
  const summary: MigrationSummary = {
    friends: {
      lstepTotal: matchSummary.total,
      matched: matchSummary.matched,
      importable: fr.length,
      duplicates: friends.report.duplicates.length,
      manualApplied: matchSummary.manualApplied,
      needsReview: review.length,
      needsReviewWithData: review.filter((r) => r.hasData).length,
      blockedUnmatched: matchSummary.blockedUnmatched,
      withTags: fr.filter((f) => f.tags.length).length,
      withValues: fr.filter((f) => Object.keys(f.values).length).length,
    },
    definitions: { folders: friends.dataset.folders.length, fields: friends.dataset.fields.length, tags: friends.dataset.tags.length },
    forms: {
      lstepForms: forms.forms.length,
      mapped: forms.forms.filter((f) => f.status === 'mapped').length,
      unmatched: forms.unmatchedForms.length,
      answers: forms.submissions.length,
      answersWithFriend: forms.submissions.filter((s) => s.beyondFriendId).length,
      answersWithoutFriend: forms.submissions.filter((s) => !s.beyondFriendId).length,
      hiddenFieldsAdded: forms.configs.reduce((n, c) => n + (c.addFields?.length ?? 0), 0),
    },
    messages: { total: messages.length, friends: messageStats.friends },
    warnings: [...(pkg.warnings || []), ...friends.report.warnings, ...forms.warnings],
  }
  return { matches, matchSummary, review, unmatchedForms: forms.unmatchedForms, friends, forms, messages, messageStats, datasets, summary }
}
