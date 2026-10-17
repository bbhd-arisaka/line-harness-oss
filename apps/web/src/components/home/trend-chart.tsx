import type { HomeTrendRow } from '@/lib/api'

const W = 720
const H = 220
const PAD = { top: 16, right: 48, bottom: 28, left: 40 }

/** "2026-10-18" → "10/18" */
function md(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`
}

/** 目盛りをきりのよい数にする */
function niceMax(v: number): number {
  if (v <= 4) return 4
  const pow = 10 ** Math.floor(Math.log10(v))
  const n = v / pow
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow
}

/**
 * 友だち数の推移。棒=その日の登録(上・緑)とブロック(下・赤)、線=有効な友だち数(青・右の目盛り)。
 * 画像ライブラリは使わず、SVG で描く(軽く、画面の幅に合わせて伸び縮みする)。
 */
export default function TrendChart({ rows }: { rows: HomeTrendRow[] }) {
  if (rows.length === 0) return null
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const maxBar = niceMax(Math.max(1, ...rows.map((r) => Math.max(r.added, r.blocked))))
  const midY = PAD.top + innerH / 2
  const barScale = innerH / 2 / maxBar

  const actives = rows.map((r) => r.active)
  let lo = Math.min(...actives)
  let hi = Math.max(...actives)
  if (hi - lo < 4) {
    const c = (hi + lo) / 2
    lo = c - 2
    hi = c + 2
  }
  const pad = (hi - lo) * 0.15
  lo -= pad
  hi += pad
  const lineY = (v: number) => PAD.top + innerH - ((v - lo) / (hi - lo)) * innerH

  const slot = innerW / rows.length
  const barW = Math.min(18, slot * 0.5)
  const cx = (i: number) => PAD.left + slot * i + slot / 2
  const linePath = rows.map((r, i) => `${i === 0 ? 'M' : 'L'}${cx(i).toFixed(1)},${lineY(r.active).toFixed(1)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="友だち数の推移(登録・ブロック・有効な友だち数)">
      {/* 中央線(0) */}
      <line x1={PAD.left} x2={W - PAD.right} y1={midY} y2={midY} stroke="#d4d4d8" strokeWidth={1} />
      {/* 左の目盛り(棒) */}
      {[maxBar, 0, -maxBar].map((v) => (
        <text key={v} x={PAD.left - 6} y={midY - v * barScale + 3} textAnchor="end" fontSize={10} fill="#71717a">
          {Math.abs(v)}
        </text>
      ))}
      {/* 右の目盛り(線) */}
      {[hi, (hi + lo) / 2, lo].map((v, i) => (
        <text key={i} x={W - PAD.right + 6} y={lineY(v) + 3} fontSize={10} fill="#2563eb">
          {Math.round(v).toLocaleString('ja-JP')}
        </text>
      ))}
      {rows.map((r, i) => (
        <g key={r.date}>
          <title>{`${md(r.date)}  登録 ${r.added}・ブロック ${r.blocked}・有効な友だち ${r.active.toLocaleString('ja-JP')}`}</title>
          {r.added > 0 ? <rect x={cx(i) - barW / 2} y={midY - r.added * barScale} width={barW} height={r.added * barScale} rx={2} fill="#16a34a" /> : null}
          {r.blocked > 0 ? <rect x={cx(i) - barW / 2} y={midY} width={barW} height={r.blocked * barScale} rx={2} fill="#ef4444" /> : null}
          {i % 2 === (rows.length - 1) % 2 ? (
            <text x={cx(i)} y={H - 8} textAnchor="middle" fontSize={10} fill="#71717a">
              {md(r.date)}
            </text>
          ) : null}
        </g>
      ))}
      <path d={linePath} fill="none" stroke="#2563eb" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {rows.map((r, i) => (
        <circle key={r.date} cx={cx(i)} cy={lineY(r.active)} r={i === rows.length - 1 ? 4 : 2.5} fill="#2563eb" stroke="#ffffff" strokeWidth={1.5} />
      ))}
    </svg>
  )
}
