import { describe, expect, it, vi } from 'vitest'
import { copyText, qrFileName } from './friend-add-qr'

describe('qrFileName', () => {
  it('ファイル名に使えない文字・空白・@ を除く。名前が空なら line', () => {
    expect(qrFileName('エクラブロウ イオンモール土岐店', '@123abcde')).toBe('友だち追加QR_エクラブロウイオンモール土岐店_123abcde.png')
    expect(qrFileName('a/b:c*?', '')).toBe('友だち追加QR_abc.png')
    expect(qrFileName('   ', '@x')).toBe('友だち追加QR_line_x.png')
  })
})

describe('copyText', () => {
  it('clipboard が使えれば、それでコピーする', async () => {
    const writeText = vi.fn(async () => {})
    expect(await copyText('https://x', {} as Document, { clipboard: { writeText } } as unknown as Navigator)).toBe(true)
    expect(writeText).toHaveBeenCalledWith('https://x')
  })
  it('clipboard が失敗したら、選択+コピーの方法に切り替える。それも失敗なら false', async () => {
    const ta = { value: '', setAttribute: vi.fn(), style: {} as Record<string, string>, select: vi.fn() }
    const execCommand = vi.fn(() => true)
    const doc = {
      createElement: vi.fn(() => ta),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      execCommand,
    } as unknown as Document
    const nav = {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error('denied')
        }),
      },
    } as unknown as Navigator
    expect(await copyText('https://x', doc, nav)).toBe(true)
    expect(ta.value).toBe('https://x')
    execCommand.mockReturnValue(false)
    expect(await copyText('https://x', doc, nav)).toBe(false)
  })
})
