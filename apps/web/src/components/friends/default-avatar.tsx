/**
 * プロフィール画像がない友だちの表示。普通のLINEと同じ、灰色の丸に白い人型。
 * 大きさは、Tailwind のクラスで決める(例 h-10 w-10)。
 */
export default function DefaultAvatar({ size = 'h-10 w-10', className = '' }: { size?: string; className?: string }) {
  return (
    <span className={`relative inline-block ${size} flex-shrink-0 overflow-hidden rounded-full bg-[#c5cbd3] ${className}`} role="img" aria-label="プロフィール画像なし">
      <svg viewBox="0 0 40 40" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <circle cx="20" cy="15.5" r="6.8" fill="#ffffff" />
        <ellipse cx="20" cy="38" rx="13.5" ry="11.5" fill="#ffffff" />
      </svg>
    </span>
  )
}
