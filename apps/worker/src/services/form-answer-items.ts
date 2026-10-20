/**
 * 回答結果(form_submissions.data)を、画面に出す「項目名 + 値」の一覧にする。
 * Web版・アプリの両方が同じ形で使う(GET /api/chats/:id/form-answers/:submissionId)。
 */

export interface AnswerItem {
  label: string;
  /** 表示用の文字(未回答は「-」)。ファイルのときは、ファイルを開くURL */
  value: string;
  /** アップロードされたファイル(値はURL) */
  isFile?: boolean;
}

interface FieldDef {
  name?: unknown;
  label?: unknown;
  type?: unknown;
}

/**
 * 見出し・小見出し・説明文・画像・ボタンなど、回答の無いブロック。
 * フォーム編集画面の「表示だけの部品」(heading / subheading / paragraph / image / button)と同じものを含める。
 * (小見出しが抜けていると、「お名前」の小見出しと「お名前」の入力欄が、同じ項目名で2つ並んでしまう)
 */
const NON_ANSWER_TYPES = new Set(['heading', 'subheading', 'paragraph', 'image', 'button', 'description', 'divider', 'section', 'text_block']);

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw) as T;
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (Array.isArray(value)) return value.length === 0 ? '-' : value.map((v) => display(v)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** 内部の項目(_で始まる)・見出しなどの表示だけの部品は出さない。フォームの項目の並び順で、そのあとに、定義に無い回答(空でないもの)を足す */
export function buildAnswerItems(fieldsJson: string | null | undefined, dataJson: string | null | undefined): AnswerItem[] {
  const fields = parseJson<FieldDef[]>(fieldsJson, []);
  const data = parseJson<Record<string, unknown>>(dataJson, {});
  const items: AnswerItem[] = [];
  const used = new Set<string>();
  const isFileValue = (v: unknown): v is string => typeof v === 'string' && /\/api\/form-uploads\//.test(v);

  for (const f of Array.isArray(fields) ? fields : []) {
    const name = typeof f.name === 'string' ? f.name : '';
    if (!name || name.startsWith('_')) continue;
    // 表示だけの部品は出さない。回答のデータ側にも同じ名前の空の値が入っていることがあるので、あとで「定義に無い回答」として出さないよう、使用済みにする
    used.add(name);
    if (typeof f.type === 'string' && NON_ANSWER_TYPES.has(f.type)) continue;
    const label = typeof f.label === 'string' && f.label.trim() ? f.label : name;
    const v = data[name];
    items.push(isFileValue(v) ? { label, value: v, isFile: true } : { label, value: display(v) });
  }
  for (const [name, v] of Object.entries(data)) {
    if (used.has(name) || name.startsWith('_')) continue;
    // 定義に無く、中身も空の回答は出さない(項目名が内部の名前のまま並ぶだけになる)
    if (display(v) === '-') continue;
    items.push(isFileValue(v) ? { label: name, value: v, isFile: true } : { label: name, value: display(v) });
  }
  return items;
}
