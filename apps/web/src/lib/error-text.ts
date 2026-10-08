import { ApiError } from './api'

/** 画面に出すエラーの文。サーバーが理由を返していれば、それを出す(「API error: 400」のような文は出さない) */
export function errorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.serverMessage ?? fallback
  if (err instanceof Error && err.message && !/^API error/.test(err.message)) return err.message
  return fallback
}
