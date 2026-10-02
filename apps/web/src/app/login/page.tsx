'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getApiBase } from '@/lib/api-base'
import { withBasePath } from '@/lib/base-path'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Input } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'

export default function LoginPage() {
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  // beyond admin のID・パスワードでのログイン(サーバーで有効なときだけ案内する)
  const [beyondAdminLogin, setBeyondAdminLogin] = useState<string | null>(null)
  const [showApiKey, setShowApiKey] = useState(true)

  useEffect(() => {
    const apiUrl = getApiBase()
    if (!apiUrl) return
    let cancelled = false
    ;(async () => {
      try {
        // すでに beyond admin でログイン済みなら、そのまま入る
        const session = await fetch(`${apiUrl}/api/auth/session`, { credentials: 'include' })
        if (session.ok) {
          const data = await session.json()
          if (data?.success && data?.data) {
            if (data.data.name) localStorage.setItem('lh_staff_name', data.data.name)
            if (data.data.role) localStorage.setItem('lh_staff_role', data.data.role)
            if (data.data.external) localStorage.setItem('lh_login_via', 'beyond-admin')
            if (data.csrfToken) localStorage.setItem('lh_csrf', data.csrfToken)
            if (!cancelled) router.replace('/')
            return
          }
        }
        const res = await fetch(`${apiUrl}/api/auth/config`)
        const cfg = await res.json()
        if (!cancelled && cfg?.data?.beyondAdmin?.loginUrl) {
          setBeyondAdminLogin(cfg.data.beyondAdmin.loginUrl as string)
          setShowApiKey(false)
        }
      } catch {
        // 設定が読めなければ、従来どおり API キーのログインだけ
      }
    })()
    return () => { cancelled = true }
  }, [router])

  const goBeyondAdmin = () => {
    if (!beyondAdminLogin) return
    // ログインしたあと、この管理画面のトップに戻ってくる
    const back = `${window.location.origin}${withBasePath('/')}`
    window.location.href = `${beyondAdminLogin}?next=${encodeURIComponent(back)}`
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const apiUrl = getApiBase()
      if (!apiUrl) {
        setError('NEXT_PUBLIC_API_URL is not set in build env')
        setLoading(false)
        return
      }
      // Exchange the API key for an HttpOnly session cookie. The key is never
      // stored in localStorage (removes the XSS-exposed credential).
      const res = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      })

      if (res.ok) {
        localStorage.removeItem('lh_api_key')
        try {
          const loginData = await res.json()
          if (loginData.success && loginData.data) {
            localStorage.removeItem('lh_login_via')
            localStorage.setItem('lh_staff_name', loginData.data.name)
            localStorage.setItem('lh_staff_role', loginData.data.role)
          }
          // Cache the CSRF token for mutating requests (double-submit).
          if (loginData.csrfToken) {
            localStorage.setItem('lh_csrf', loginData.csrfToken)
          }
        } catch {
          // Profile / CSRF caching is best-effort.
        }
        router.push('/')
      } else if (res.status === 401) {
        setError('APIキーが正しくありません')
      } else {
        // Surface topology / configuration errors (e.g. cross-site cookie guard).
        let message = 'ログインに失敗しました'
        try {
          const data = await res.json()
          if (data?.error) message = data.error
        } catch {
          // keep default message
        }
        setError(message)
      }
    } catch {
      setError('接続に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-kumo-brand p-4">
      <LayerCard className="w-full max-w-sm p-8 shadow-xl">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-kumo-brand text-kumo-inverse font-bold text-lg mx-auto mb-3">
            B
          </div>
          <h1 className="text-xl font-bold text-gray-900">beyond line</h1>
          <p className="text-sm text-gray-500 mt-1">管理画面にログイン</p>
        </div>

        {beyondAdminLogin ? (
          <div className="mb-4">
            <Button type="button" variant="primary" className="w-full" onClick={goBeyondAdmin}>
              ID・パスワードでログイン
            </Button>
            <p className="mt-2 text-center text-xs text-gray-500">beyond admin と同じメールアドレス・パスワードでログインします</p>
            {!showApiKey ? (
              <Button type="button" variant="secondary" size="xs" className="mt-4 w-full" onClick={() => setShowApiKey(true)}>
                APIキーでログイン(管理者用)
              </Button>
            ) : null}
          </div>
        ) : null}

        {showApiKey ? (
        <form onSubmit={handleLogin}>
          <div className="mb-4">
            <Input
              label="API Key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="APIキーを入力"
              autoFocus
            />
          </div>

          {error && <Banner className="mb-4" size="sm" variant="error" title="ログインできませんでした" description={error} />}

          <Button
            type="submit"
            variant="primary"
            loading={loading}
            disabled={loading || !apiKey}
            className="w-full"
          >
            ログイン
          </Button>
        </form>
        ) : null}
      </LayerCard>
    </div>
  )
}
