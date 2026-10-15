// 入力欄の中の、色付きボックス(タグ)の編集の計算。画面に依存しない純粋な関数だけ。
//
// 【考え方】React Native の入力欄(TextInput)は、中の文字と見える文字を変えられない。そこで、
//   - 本文を「文字」と「ボックス(タグ)」の並び(セグメント)で持つ(本文の文字列は、タグコードつきの形のまま)
//   - 入力欄には、ボックスを「 LINE名 」のような日本語の名前の文字で見せ、その部分だけ色を付ける(文章の中に、並んで入る)
//   - 利用者が打ったり消したりしたら、「前の表示」と「いまの表示」の差から、何が変わったかを割り出して、セグメントに戻す
// ボックスは、ひとかたまり: 一部でも消されたら、ボックスごと消える。ボックスの中に文字を打たれたら、ボックスの後ろに入れる。

import { splitTags, formTag, NAME_TAG, REAL_NAME_TAG } from './broadcast';

/** ボックスの左右に付ける、改行されない空白(ボックスに余白を持たせる) */
export const CHIP_PAD = '\u00A0';

export type TagTone = 'name' | 'realName' | 'form' | 'other';

export type Seg = { kind: 'text'; text: string } | { kind: 'tag'; code: string };

/** タグコード({{name}} など)の、ボックスの色の系統 */
export function tagTone(code: string): TagTone {
  if (code === NAME_TAG) return 'name';
  if (code === REAL_NAME_TAG) return 'realName';
  if (code.startsWith('{{form_url:')) return 'form';
  return 'other';
}

/** ボックスに出す日本語の名前。formNames は フォームID → フォーム名 */
export function tagLabel(code: string, formNames?: ReadonlyMap<string, string>): string {
  if (code === NAME_TAG) return 'LINE名';
  if (code === REAL_NAME_TAG) return '本名';
  const m = code.match(/^\{\{form_url:([^}\s]+)\}\}$/);
  if (m) {
    const name = formNames?.get(m[1]);
    return name ? `フォーム：${name}` : 'フォーム';
  }
  return code.replace(/^\{\{\s*|\s*\}\}$/g, '');
}

function tagCodeOf(p: ReturnType<typeof splitTags>[number]): string | null {
  if (p.kind === 'name') return NAME_TAG;
  if (p.kind === 'realName') return REAL_NAME_TAG;
  if (p.kind === 'form') return formTag(p.formId);
  if (p.kind === 'other') return `{{${p.code}}}`;
  return null;
}

/** 本文(タグコードつき)を、セグメントの並びにする */
export function toSegs(text: string): Seg[] {
  const out: Seg[] = [];
  for (const p of splitTags(text)) {
    const code = tagCodeOf(p);
    if (code === null) pushText(out, (p as { text: string }).text);
    else out.push({ kind: 'tag', code });
  }
  return out;
}

/** セグメントを、本文(タグコードつき)に戻す */
export function segsToText(segs: Seg[]): string {
  return segs.map((s) => (s.kind === 'text' ? s.text : s.code)).join('');
}

/** 入力欄に出す文字(ボックスは、日本語の名前に両側の空白を付けたもの) */
export function segDisplay(seg: Seg, formNames?: ReadonlyMap<string, string>): string {
  return seg.kind === 'text' ? seg.text : `${CHIP_PAD}${tagLabel(seg.code, formNames)}${CHIP_PAD}`;
}

export function displayOf(segs: Seg[], formNames?: ReadonlyMap<string, string>): string {
  return segs.map((s) => segDisplay(s, formNames)).join('');
}

function pushText(out: Seg[], text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.kind === 'text') last.text += text;
  else out.push({ kind: 'text', text });
}

// 1文字ずつの「セル」に分けて編集する(ボックスは、1つのセル。表示では、複数の文字ぶんの幅を持つ)
type Cell = { len: number; text?: string; code?: string };

function toCells(segs: Seg[], formNames?: ReadonlyMap<string, string>): Cell[] {
  const cells: Cell[] = [];
  for (const s of segs) {
    if (s.kind === 'tag') {
      cells.push({ len: segDisplay(s, formNames).length, code: s.code });
    } else {
      // サロゲートペア(絵文字など)も、表示の長さ(UTF-16)で数える
      for (let i = 0; i < s.text.length; ) {
        const cp = s.text.codePointAt(i) as number;
        const ch = String.fromCodePoint(cp);
        cells.push({ len: ch.length, text: ch });
        i += ch.length;
      }
    }
  }
  return cells;
}

function fromCells(cells: Cell[]): Seg[] {
  const out: Seg[] = [];
  for (const c of cells) {
    if (c.code !== undefined) out.push({ kind: 'tag', code: c.code });
    else pushText(out, c.text ?? '');
  }
  return out;
}

function withOffsets(cells: Cell[]): Array<Cell & { a: number; b: number }> {
  let pos = 0;
  return cells.map((c) => {
    const a = pos;
    pos += c.len;
    return { ...c, a, b: pos };
  });
}

/**
 * 利用者が入力欄を編集したあと(前の表示 → いまの表示)を、セグメントに反映する。
 * 前後の差(共通の先頭・末尾を除いた部分)を「消された範囲」と「入れられた文字」とみなす。
 */
export function applyEdit(segs: Seg[], oldDisplay: string, newDisplay: string, formNames?: ReadonlyMap<string, string>): Seg[] {
  if (oldDisplay === newDisplay) return segs;
  const max = Math.min(oldDisplay.length, newDisplay.length);
  let p = 0;
  while (p < max && oldDisplay[p] === newDisplay[p]) p++;
  let s = 0;
  while (s < max - p && oldDisplay[oldDisplay.length - 1 - s] === newDisplay[newDisplay.length - 1 - s]) s++;
  const removedStart = p;
  const removedEnd = oldDisplay.length - s;
  const inserted = newDisplay.slice(p, newDisplay.length - s);

  const cells = withOffsets(toCells(segs, formNames));
  // 消された範囲に、少しでもかかったセルは消える(ボックスは、ひとかたまり)
  const kept = cells.filter((c) => !(removedEnd > removedStart && c.a < removedEnd && c.b > removedStart));
  // 入れる位置: 位置 p 以降で最初に残っているセルの前。ボックスの途中なら、ボックスの後ろ
  let at = kept.findIndex((c) => c.a >= p);
  if (at === -1) at = kept.length;
  const insertCells = toCells([{ kind: 'text', text: inserted }]);
  return fromCells([...kept.slice(0, at), ...insertCells, ...kept.slice(at)]);
}

/**
 * カーソル位置(表示の位置)に、ボックスを入れる。選択範囲があれば置き換える。
 * 戻り値のカーソルは、入れたボックスの直後(表示の位置)。
 */
export function insertTag(
  segs: Seg[],
  start: number,
  end: number,
  code: string,
  formNames?: ReadonlyMap<string, string>,
): { segs: Seg[]; cursor: number } {
  const total = displayOf(segs, formNames).length;
  const a0 = Math.max(0, Math.min(Math.min(start, end), total));
  const b0 = Math.max(a0, Math.min(Math.max(start, end), total));
  const cells = withOffsets(toCells(segs, formNames));
  const kept = cells.filter((c) => !(b0 > a0 && c.a < b0 && c.b > a0));
  let at = kept.findIndex((c) => c.a >= a0);
  if (at === -1) at = kept.length;
  const chip: Cell = { len: segDisplay({ kind: 'tag', code }, formNames).length, code };
  const next = [...kept.slice(0, at), chip, ...kept.slice(at)];
  const offsets = withOffsets(next);
  return { segs: fromCells(next), cursor: offsets[at].b };
}

/** 本文の最後に、ボックスを足す(カーソル位置が分からないとき) */
export function appendTag(segs: Seg[], code: string, formNames?: ReadonlyMap<string, string>): { segs: Seg[]; cursor: number } {
  const total = displayOf(segs, formNames).length;
  return insertTag(segs, total, total, code, formNames);
}
