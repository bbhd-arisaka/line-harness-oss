'use client'

import Header from '@/components/layout/header'
import { MediaLibrary } from '@/components/media/media-picker'

export default function MediaPage() {
  return (
    <div>
      <Header title="登録メディア一覧" description="配信やフォームで使う画像を登録・管理できます。画像をクリックするとURLをコピーします。" />
      <MediaLibrary />
    </div>
  )
}
