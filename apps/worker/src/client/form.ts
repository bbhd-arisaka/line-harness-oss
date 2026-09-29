/**
 * LIFF Form Page — Dynamic form renderer for LINE surveys / questionnaires
 *
 * Flow:
 * 1. Fetch form definition from API using form ID from query params
 * 2. Render form fields dynamically (text, email, select, radio, etc.)
 * 3. On submit: POST to /api/forms/:id/submit with user's lineUserId
 * 4. Show success message (auto-close in LINE app)
 *
 * URL format: https://liff.line.me/{LIFF_ID}?page=form&id={FORM_ID}
 */

declare const liff: {
  init(config: { liffId: string }): Promise<void>;
  isLoggedIn(): boolean;
  login(opts?: { redirectUri?: string }): void;
  getProfile(): Promise<{ userId: string; displayName: string; pictureUrl?: string }>;
  getIDToken(): string | null;
  isInClient(): boolean;
  closeWindow(): void;
};

const UUID_STORAGE_KEY = 'lh_uuid';
const FORM_VERSION = '2.1.0'; // cache buster

interface FormField {
  name: string;
  label: string;
  type:
    | 'text' | 'email' | 'tel' | 'number' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'date'
    // Lステップ互換で追加: 都道府県プルダウン・ファイル添付・表示専用の見出し2種
    | 'prefecture' | 'file' | 'heading' | 'subheading' | 'paragraph'
    // Lステップ新形式のブロック。どちらも回答データを持たない表示専用。
    | 'image' | 'button';
  required?: boolean;
  options?: string[];
  placeholder?: string;
  columns?: number;
  imageUrl?: string;
  buttonLabel?: string;
  buttonUrl?: string;
  // Lステップ準拠の編集画面のセクション。0=共通ヘッダ(全セクションの先頭に表示)、1以降=各セクション。未指定は1。
  section?: number;
  // Lステップ準拠のブロック設定: 説明文・初期値・入力文字数の上限・非表示(値だけ送る)
  description?: string;
  defaultValue?: string;
  maxLength?: number;
  hidden?: boolean;
  // 選択系ブロックの「その他」「初期表示」。
  allowOther?: boolean;
  defaultOptions?: string[];
  // 画像ブロックのサイズ・クリック時のリンク、ボタンブロックのスタイル・色。
  imageSize?: 'small' | 'normal' | 'large';
  imageLinkUrl?: string;
  buttonStyle?: 'default' | 'outline' | 'rounded';
  buttonColor?: string;
}

const PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
  '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
  '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
  '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
];

/** 表示専用(見出し)で、回答データを持たない項目タイプ。 */
const DISPLAY_ONLY_TYPES: FormField['type'][] = ['heading', 'subheading', 'paragraph', 'image', 'button'];

interface FormDef {
  id: string;
  name: string;
  description: string | null;
  fields: FormField[];
  isActive: boolean;
  hideProfile?: boolean;
  hasSubmitWebhook: boolean;
  webhookOrigin: string | null;
  webhookGateId: string | null;
  onSubmitMessageContent?: string | null;
  onSubmitWebhookFailMessage?: string | null;
  consultationWebinarSlug?: string | null;
  primaryColor?: string | null;
  thanksUrl?: string | null;
  // Lステップの「カラー/デザイン設定」相当。customDesignEnabled が OFF の
  // フォームでは API が返さないため、すべて undefined のまま既定配色になる。
  backgroundColor?: string | null;
  formBackgroundColor?: string | null;
  headerImageUrl?: string | null;
  backgroundImageUrl?: string | null;
  hideHeaderIcon?: boolean;
  customCss?: string | null;
  // Lステップ新形式の5色テーマ(メイン/サブ/アクセント/エラー/テキスト)+フォント。
  // primaryColor が「アクセント」に相当する。
  themeMainColor?: string | null;
  themeSubColor?: string | null;
  themeErrorColor?: string | null;
  themeTextColor?: string | null;
  themeFont?: string | null;
  // Lステップの「回答復元」相当。restorePreviousAnswer が OFF、または前回の
  // 回答が無ければ null。
  previousAnswer?: Record<string, unknown> | null;
  // Lステップ「オプション設定」相当(ページタイトル・ボタン文言・確認ダイアログなど)
  lstepOptions?: LstepOptions;
  isNotStarted?: boolean;
  isExpired?: boolean;
  isFull?: boolean;
  // 定員に達した選択肢(項目名 → 選択肢)
  fullOptions?: Record<string, string[]>;
}

interface LstepOptions {
  pageTitle?: string;
  submitLabel?: string;
  nextLabel?: string;
  buttonStyle?: 'default' | 'rounded' | 'square';
  buttonColor?: string;
  sectionHeaderStyle?: 'page-number' | 'progress' | 'none';
  confirmDialog?: boolean;
  startsAt?: string | null;
  backgroundImageOpacity?: number;
}

interface ConsultationSlot {
  date: string;
  start: string;
  end: string;
  startsAt: string;
}

interface ConsultationAvailability {
  calendarReady: boolean;
  fallbackUrl: string | null;
  menu: { id: string; name: string; durationMinutes: number };
  staff: { id: string; name: string };
  slots: ConsultationSlot[];
  existingBooking: {
    bookingId: string;
    status: string;
    startsAt: string;
    meetUrl: string | null;
  } | null;
}

interface BookedConsultation {
  bookingId: string;
  status: 'confirmed';
  startsAt: string;
  endsAt: string;
  meetUrl: string;
  externalEventId: string;
  created: boolean;
}

interface XFollowerSuggestion {
  username: string;
  displayName: string;
  profileImageUrl: string | null;
}

interface FormState {
  formDef: FormDef | null;
  xHarnessBaseUrl: string | null;
  profile: { userId: string; displayName: string; pictureUrl?: string } | null;
  friendId: string | null;
  submitting: boolean;
  verifiedXUsername: string;
  /**
   * Tracked link id that brought the user to this form (`?ref=` query param,
   * propagated from /r/:ref → LIFF). When present, the server uses the
   * tracked link's reward_template_id (per-campaign reward) instead of the
   * friend's first-touch attribution.
   */
  refTrackedLinkId: string | null;
}

const state: FormState = {
  formDef: null,
  xHarnessBaseUrl: null,
  profile: null,
  friendId: null,
  submitting: false,
  verifiedXUsername: '',
  refTrackedLinkId: null,
};

// Replier pool loading state (shared between renderFormPage and attachXAutocomplete)
let _replierPoolReady = false;

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function apiCall(path: string, options?: RequestInit): Promise<Response> {
  const idToken = liff.getIDToken();
  return fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      ...options?.headers,
    },
  });
}

function getGateId(): string | null {
  const gateParam = new URLSearchParams(window.location.search).get('gate');
  return gateParam || state.formDef?.webhookGateId || null;
}

function getApp(): HTMLElement {
  return document.getElementById('app')!;
}

// ========== Field Rendering ==========

function renderField(field: FormField, previousValue?: unknown): string {
  // 見出し類は入力を持たない。Lステップの「中見出し」「小見出し」に相当。
  if (field.type === 'heading') {
    return `<h2 class="form-section-heading">${escapeHtml(field.label)}</h2>`;
  }
  if (field.type === 'subheading') {
    return `<h3 class="form-section-subheading">${escapeHtml(field.label)}</h3>`;
  }
  // 同意書・プライバシーポリシー等の長文表示用(Lステップは項目間に自由文を挟める)。
  if (field.type === 'paragraph') {
    const html = escapeHtml(field.label).replace(/\n/g, '<br>');
    return `<p class="form-paragraph">${html}</p>`;
  }
  // Lステップ新形式の「画像」「ボタン」ブロック。どちらも回答データを持たない。
  if (field.type === 'image') {
    const src = safeHttpsUrl(field.imageUrl);
    if (!src) return '';
    const width = field.imageSize === 'small' ? '50%' : field.imageSize === 'large' ? '100%' : '80%';
    const img = `<img class="form-block-image" style="width:${width};margin-left:auto;margin-right:auto" src="${escapeHtml(src)}" alt="${escapeHtml(field.label)}" />`;
    const link = safeHttpsUrl(field.imageLinkUrl);
    return link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${img}</a>` : img;
  }
  if (field.type === 'button') {
    const href = safeHttpsUrl(field.buttonUrl);
    if (!href) return '';
    const color = /^#[0-9a-fA-F]{3,8}$/.test(field.buttonColor ?? '') ? field.buttonColor! : '';
    const styleParts: string[] = [];
    if (color) {
      if (field.buttonStyle === 'outline') styleParts.push(`background:#fff;color:${color};border:2px solid ${color}`);
      else styleParts.push(`background:${color};color:#fff`);
    }
    if (field.buttonStyle === 'rounded') styleParts.push('border-radius:999px');
    const style = styleParts.length > 0 ? ` style="${styleParts.join(';')}"` : '';
    return `<a class="form-block-button"${style} href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(field.buttonLabel || field.label)}</a>`;
  }

  // 「非表示」ブロック: 画面には出さず、初期値だけを回答データとして送る。
  if (field.hidden && field.type !== 'radio' && field.type !== 'checkbox' && field.type !== 'select' && field.type !== 'prefecture' && field.type !== 'file') {
    return `<input type="hidden" name="${escapeHtml(field.name)}" value="${escapeHtml(field.defaultValue ?? '')}" />`;
  }

  const required = field.required && !field.hidden ? ' required' : '';
  const maxLen = field.maxLength && field.maxLength > 0 ? ` maxlength="${field.maxLength}"` : '';
  const descriptionHtml = field.description
    ? `<p class="form-field-description">${escapeHtml(field.description).replace(/\n/g, '<br>')}</p>`
    : '';
  const placeholder = field.placeholder ? ` placeholder="${escapeHtml(field.placeholder)}"` : '';
  const requiredMark = field.required ? '<span class="required-mark">*</span>' : '';

  // If this is an x_username field, render a fuzzy-search autocomplete input
  if (field.name === 'x_username') {
    return `
      <div class="form-field">
        <label class="form-label" for="field-${escapeHtml(field.name)}">
          ${escapeHtml(field.label)}${requiredMark}
        </label>
        <div class="x-autocomplete-wrap">
          <input
            type="text"
            name="${escapeHtml(field.name)}"
            id="field-${escapeHtml(field.name)}"
            class="form-input x-autocomplete-input"
            placeholder="${field.placeholder ? escapeHtml(field.placeholder) : 'X ID or 名前で検索（3文字以上）'}"
            autocomplete="off"
            ${required} />
          <ul class="x-suggest-list" id="x-suggest-list" hidden></ul>
          <p class="x-suggest-hint" id="x-suggest-hint" hidden>3文字以上入力してください</p>
        </div>
        <div class="x-conditions" id="x-conditions" hidden></div>
        <p class="x-conditions-result" id="x-conditions-result" hidden></p>
      </div>
    `;
  }

  let inputHtml = '';

  const prevStr = typeof previousValue === 'string' ? previousValue : (field.defaultValue ?? '');
  const prevChecked = Array.isArray(previousValue) ? previousValue.map(String) : [];

  switch (field.type) {
    case 'textarea':
      inputHtml = `<textarea
        name="${escapeHtml(field.name)}"
        id="field-${escapeHtml(field.name)}"
        class="form-textarea"
        rows="4"
        ${placeholder}${maxLen}${required}>${escapeHtml(prevStr)}</textarea>`;
      break;

    case 'select': {
      const full = state.formDef?.fullOptions?.[field.name] ?? [];
      const hasPrev = typeof previousValue === 'string' && previousValue !== '';
      const initial = hasPrev ? prevStr : (field.defaultOptions?.[0] ?? '');
      const opts = (field.options ?? [])
        .map((o) => {
          const isFull = full.includes(o);
          return `<option value="${escapeHtml(o)}"${o === initial ? ' selected' : ''}${isFull ? ' disabled' : ''}>${escapeHtml(o)}${isFull ? '(満員)' : ''}</option>`;
        })
        .join('');
      const otherOpt = field.allowOther ? '<option value="__other__">その他</option>' : '';
      inputHtml = `<select
        name="${escapeHtml(field.name)}"
        id="field-${escapeHtml(field.name)}"
        class="form-select"${required}>
        <option value="">選択してください</option>
        ${opts}${otherOpt}
      </select>${field.allowOther ? `<input type="text" class="form-input other-input" data-other-for="${escapeHtml(field.name)}" placeholder="その他の内容を入力" hidden style="margin-top:8px" />` : ''}`;
      break;
    }

    case 'radio': {
      const full = state.formDef?.fullOptions?.[field.name] ?? [];
      const hasPrev = typeof previousValue === 'string' && previousValue !== '';
      const initial = hasPrev ? prevStr : (field.defaultOptions?.[0] ?? '');
      const radios = (field.options ?? [])
        .map((o) => {
          const isFull = full.includes(o);
          return `<label class="radio-label"${isFull ? ' style="opacity:.5"' : ''}>
              <input type="radio" name="${escapeHtml(field.name)}" value="${escapeHtml(o)}"${required}${o === initial ? ' checked' : ''}${isFull ? ' disabled' : ''} />
              ${escapeHtml(o)}${isFull ? '(満員)' : ''}
            </label>`;
        })
        .join('');
      const other = field.allowOther
        ? `<label class="radio-label"><input type="radio" name="${escapeHtml(field.name)}" value="__other__"${required} /> その他 <input type="text" class="form-input other-input" data-other-for="${escapeHtml(field.name)}" placeholder="内容を入力" style="margin-left:8px;padding:6px 8px" /></label>`
        : '';
      inputHtml = `<div class="radio-group${field.columns === 2 ? ' two-col' : ''}">${radios}${other}</div>`;
      break;
    }

    case 'checkbox': {
      const full = state.formDef?.fullOptions?.[field.name] ?? [];
      const initialChecked = Array.isArray(previousValue) ? prevChecked : (field.defaultOptions ?? []);
      const boxes = (field.options ?? [])
        .map((o) => {
          const isFull = full.includes(o);
          return `<label class="checkbox-label"${isFull ? ' style="opacity:.5"' : ''}>
              <input type="checkbox" name="${escapeHtml(field.name)}" value="${escapeHtml(o)}"${initialChecked.includes(o) ? ' checked' : ''}${isFull ? ' disabled' : ''} />
              ${escapeHtml(o)}${isFull ? '(満員)' : ''}
            </label>`;
        })
        .join('');
      const other = field.allowOther
        ? `<label class="checkbox-label"><input type="checkbox" name="${escapeHtml(field.name)}" value="__other__" /> その他 <input type="text" class="form-input other-input" data-other-for="${escapeHtml(field.name)}" placeholder="内容を入力" style="margin-left:8px;padding:6px 8px" /></label>`
        : '';
      inputHtml = `<div class="checkbox-group${field.columns === 2 ? ' two-col' : ''}">${boxes}${other}</div>`;
      break;
    }

    case 'prefecture': {
      const opts = PREFECTURES.map((p) => `<option value="${p}"${p === prevStr ? ' selected' : ''}>${p}</option>`).join('');
      inputHtml = `<select
        name="${escapeHtml(field.name)}"
        id="field-${escapeHtml(field.name)}"
        class="form-select"${required}>
        <option value="">選択してください</option>
        ${opts}
      </select>`;
      break;
    }

    case 'file':
      // 添付ファイルは Cloudflare Workers 側のアップロード先が未実装のため、
      // ファイル名のみを回答データとして保存する(実ファイルは送らない)。
      inputHtml = `<input
        type="file"
        name="${escapeHtml(field.name)}"
        id="field-${escapeHtml(field.name)}"
        class="form-input"
        ${required} />`;
      break;

    default:
      inputHtml = `<input
        type="${escapeHtml(field.type)}"
        name="${escapeHtml(field.name)}"
        id="field-${escapeHtml(field.name)}"
        class="form-input"
        value="${escapeHtml(prevStr)}"
        ${placeholder}${maxLen}${required} />`;
      break;
  }

  return `
    <div class="form-field"${field.hidden ? ' hidden' : ''}>
      <label class="form-label" for="field-${escapeHtml(field.name)}">
        ${escapeHtml(field.label)}${requiredMark}
      </label>
      ${descriptionHtml}
      ${inputHtml}
    </div>
  `;
}

// ========== Styles ==========

function injectStyles(): void {
  if (document.getElementById('form-styles')) return;
  const style = document.createElement('style');
  style.id = 'form-styles';
  style.textContent = `
    /* Lステップの「デザイン設定」相当。フォームごとに --form-accent 等を上書きできる */
    :root {
      --form-accent: #06C755;
      --form-page-bg: transparent;
      --form-page-bg-image: none;
      --form-card-bg: #fff;
      /* Lステップ新形式の5色テーマ(メイン/サブ/エラー/テキスト)。アクセントは--form-accent。 */
      --form-main: #333;
      --form-sub: #666;
      --form-error: #e53e3e;
      --form-text: #333;
      --form-font: inherit;
    }
    .form-page { font-family: var(--form-font); }
    .form-page {
      position: relative;
      background-color: var(--form-page-bg);
      isolation: isolate;
    }
    /* 背景画像は疑似要素に敷いて、Lステップの「透明度」スライダー相当を効かせる */
    .form-page::before {
      content: ''; position: absolute; inset: 0; z-index: -1;
      background-image: var(--form-page-bg-image);
      background-size: cover; background-position: top center;
      opacity: var(--form-page-bg-image-opacity, 1);
    }
    .form-header-image {
      display: block; width: 100%; max-width: 100%; border-radius: 8px;
      margin-bottom: 16px; object-fit: cover;
    }
    .form-section-heading {
      margin: 28px 0 12px; padding: 10px 14px; border-radius: 8px;
      background: var(--form-accent); color: #fff; font-size: 16px; font-weight: 700;
    }
    .form-section-heading:first-child { margin-top: 0; }
    .form-section-subheading {
      margin: 16px 0 6px; font-size: 14px; font-weight: 700; color: var(--form-accent);
    }
    .form-paragraph {
      margin: 8px 0; font-size: 13px; line-height: 1.7; color: #555; white-space: pre-wrap;
    }
    .form-block-image { display: block; width: 100%; border-radius: 10px; margin: 12px 0; }
    .form-block-button {
      display: block; width: 100%; box-sizing: border-box; margin: 12px 0; padding: 13px 16px;
      border-radius: 999px; background: var(--form-accent); color: #fff; text-align: center;
      text-decoration: none; font-size: 15px; font-weight: 700;
    }
    .form-block-button:active { opacity: 0.85; }
    .form-page { max-width: 480px; margin: 0 auto; padding: 16px; }
    .form-header { text-align: center; margin-bottom: 24px; }
    .form-header h1 { font-size: 20px; color: var(--form-main); margin-bottom: 8px; }
    .form-description { font-size: 14px; color: var(--form-sub); }
    .form-profile { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 12px; }
    .form-profile img { width: 36px; height: 36px; border-radius: 50%; }
    .form-profile span { font-size: 14px; font-weight: 600; }
    .form-body { background: var(--form-card-bg); border-radius: 12px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .form-field { margin-bottom: 20px; }
    .form-label { display: block; font-size: 14px; font-weight: 600; color: var(--form-text); margin-bottom: 6px; }
    .required-mark { color: var(--form-error); margin-left: 2px; }
    .form-input, .form-textarea, .form-select {
      width: 100%; padding: 12px; border: 1.5px solid #e0e0e0; border-radius: 8px;
      font-size: 16px; font-family: inherit; background: #fafafa;
      transition: border-color 0.15s; box-sizing: border-box;
      -webkit-appearance: none;
    }
    .form-input:focus, .form-textarea:focus, .form-select:focus {
      outline: none; border-color: var(--form-accent); background: #fff;
    }
    .form-textarea { resize: vertical; min-height: 80px; }
    .form-select { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23666' d='M6 8L1 3h10z'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; }
    .radio-group, .checkbox-group { display: flex; flex-direction: column; gap: 10px; }
    .radio-group.two-col, .checkbox-group.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .radio-label, .checkbox-label {
      display: flex; align-items: center; gap: 8px; font-size: 15px; color: #333;
      padding: 10px 12px; background: #fafafa; border-radius: 8px; border: 1.5px solid #e0e0e0;
      cursor: pointer; transition: border-color 0.15s;
    }
    .radio-label:has(input:checked), .checkbox-label:has(input:checked) {
      border-color: var(--form-accent); background: #e8faf0;
    }
    .radio-label input, .checkbox-label input { accent-color: var(--form-accent); width: 18px; height: 18px; }
    .radio-label input[type="radio"] { appearance: none; -webkit-appearance: none; width: 18px; height: 18px; border: 2px solid #ccc; border-radius: 50%; background: #fff; cursor: pointer; }
    .radio-label input[type="radio"]:checked { background: #fff; border-color: var(--form-accent); border-width: 5px; }
    .submit-btn {
      width: 100%; padding: 14px; border: none; border-radius: 8px;
      background: var(--form-accent); color: #fff; font-size: 16px; font-weight: 700;
      cursor: pointer; font-family: inherit; margin-top: 8px; transition: opacity 0.15s;
    }
    .submit-btn:active { opacity: 0.85; }
    .form-field-description { font-size: 12px; color: #777; margin: -2px 0 8px; line-height: 1.5; }
    .submit-btn.secondary { background: #fff; color: var(--form-accent); border: 1.5px solid var(--form-accent); }
    .section-nav { display: flex; gap: 10px; }
    .section-nav .submit-btn { flex: 1; }
    .section-indicator { text-align: center; font-size: 13px; color: #666; margin: 4px 0 12px; }
    .section-progress { height: 6px; background: #e6e6e6; border-radius: 3px; overflow: hidden; margin: 4px 0 14px; }
    .section-progress > span { display: block; height: 100%; background: var(--form-accent); }
    .submit-btn:disabled { background: #bbb; cursor: not-allowed; }
    .form-error { color: var(--form-error); font-size: 12px; margin-top: 4px; }
    .form-error-msg { color: var(--form-error); font-size: 14px; margin: 8px 0; text-align: center; }
    .x-loading-spinner {
      width: 28px; height: 28px; border: 3px solid #333; border-top-color: #1D9BF0;
      border-radius: 50%; animation: x-spin 0.8s linear infinite;
    }
    @keyframes x-spin { to { transform: rotate(360deg); } }
    .x-autocomplete-wrap { position: relative; }
    .x-suggest-list {
      position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 100;
      background: #1a1a1a; border: 1.5px solid #333; border-radius: 8px;
      list-style: none; margin: 0; padding: 4px 0; box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      max-height: 240px; overflow-y: auto;
    }
    .x-suggest-item {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px; cursor: pointer; transition: background 0.1s;
    }
    .x-suggest-item:hover, .x-suggest-item.focused { background: #2a2a2a; }
    .x-suggest-avatar {
      width: 32px; height: 32px; border-radius: 50%; object-fit: cover; flex-shrink: 0;
      background: #333;
    }
    .x-suggest-avatar-placeholder {
      width: 32px; height: 32px; border-radius: 50%; background: #444;
      display: flex; align-items: center; justify-content: center;
      font-size: 14px; color: #aaa; flex-shrink: 0;
    }
    .x-suggest-names { display: flex; flex-direction: column; overflow: hidden; }
    .x-suggest-display { font-size: 14px; font-weight: 600; color: #f0f0f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .x-suggest-username { font-size: 12px; color: #888; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .x-suggest-hint { font-size: 12px; color: #888; margin-top: 4px; }
    .x-conditions-card {
      margin-top: 12px;
      padding: 16px;
      background: #111;
      border-radius: 12px;
      border: 1px solid #222;
    }
    .x-condition-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 0;
      border-bottom: 1px solid #1a1a1a;
      font-size: 14px;
      color: #ccc;
    }
    .x-condition-row:last-child { border-bottom: none; }
    .x-condition-check {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: bold;
      flex-shrink: 0;
    }
    .x-condition-check.pass {
      background: rgba(6, 199, 85, 0.15);
      color: var(--form-accent);
      border: 2px solid var(--form-accent);
    }
    .x-condition-check.fail {
      background: rgba(229, 62, 62, 0.15);
      color: #e53e3e;
      border: 2px solid #e53e3e;
    }
    .x-condition-check.na {
      background: rgba(255,255,255,0.05);
      color: #555;
      border: 2px solid #333;
    }
    .x-condition-check.checking {
      background: rgba(255,255,255,0.05);
      color: #888;
      border: 2px solid #444;
    }
    .x-condition-check.checking .spin {
      display: inline-block;
      animation: spin 1s linear infinite;
      font-size: 12px;
    }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .x-conditions-summary {
      margin-top: 12px;
      padding: 10px 16px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      text-align: center;
    }
    .x-conditions-summary.pass {
      background: rgba(6, 199, 85, 0.1);
      color: var(--form-accent);
      border: 1px solid rgba(6, 199, 85, 0.3);
    }
    .x-conditions-summary.fail {
      background: rgba(229, 62, 62, 0.1);
      color: #e53e3e;
      border: 1px solid rgba(229, 62, 62, 0.3);
    }
    .form-success { text-align: center; padding: 40px 20px; }
    .form-success .check { width: 64px; height: 64px; border-radius: 50%; background: var(--form-accent); color: #fff; font-size: 32px; line-height: 64px; margin: 0 auto 16px; }
    .form-success h2 { font-size: 20px; color: var(--form-accent); margin-bottom: 12px; }
    .form-success p { font-size: 14px; color: var(--form-sub); line-height: 1.6; }
    .consultation-card { background:#fff; border-radius:16px; padding:20px; box-shadow:0 1px 4px rgba(0,0,0,.1); }
    .consultation-head { text-align:center; margin-bottom:20px; }
    .consultation-head .calendar-icon { font-size:32px; line-height:1; }
    .consultation-head h2 { margin:8px 0 6px; font-size:21px; color:#1f2937; }
    .consultation-head p { margin:0; font-size:13px; line-height:1.6; color:#6b7280; }
    .consultation-date { margin-top:18px; }
    .consultation-date h3 { margin:0 0 8px; font-size:14px; color:#374151; }
    .consultation-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
    .slot-btn { border:1.5px solid var(--form-accent); border-radius:9px; padding:11px 4px; background:#fff; color:#049f45; font-size:14px; font-weight:700; cursor:pointer; }
    .slot-btn:active { background:#ecfdf3; }
    .slot-btn:disabled { opacity:.45; cursor:not-allowed; }
    .consultation-status { margin:14px 0 0; text-align:center; font-size:13px; color:#dc2626; font-weight:600; }
    .consultation-loading { text-align:center; padding:44px 20px; }
    .consultation-loading h2 { margin:14px 0 6px; font-size:20px; color:#1f2937; }
    .consultation-loading p { margin:0; color:#6b7280; font-size:14px; }
    .consultation-spinner { width:30px; height:30px; margin:0 auto; border:3px solid #d1fae5; border-top-color:var(--form-accent); border-radius:50%; animation:x-spin .8s linear infinite; }
    .consultation-empty { margin:16px 0 0; padding:18px; border-radius:12px; background:#f9fafb; text-align:center; color:#6b7280; font-size:14px; }
    .consultation-primary { display:block; width:100%; box-sizing:border-box; margin-top:16px; padding:13px 16px; border:0; border-radius:999px; background:var(--form-accent); color:#fff; text-align:center; text-decoration:none; font-size:15px; font-weight:700; cursor:pointer; }
    .consultation-secondary { display:block; margin:14px auto 0; border:0; background:transparent; color:#6b7280; font-size:13px; text-decoration:underline; cursor:pointer; }
    .consultation-confirmed { text-align:center; }
    .consultation-confirmed .check { font-size:38px; }
    .consultation-confirmed h2 { margin:8px 0; color:#1f2937; font-size:21px; }
    .consultation-confirmed .time { margin:14px 0; padding:13px; border-radius:12px; background:#ecfdf3; color:#166534; font-size:17px; font-weight:700; }
    .consultation-confirmed .note { color:#6b7280; font-size:12px; line-height:1.6; }
  `;
  document.head.appendChild(style);
}

// ========== Main Render ==========

function render(): void {
  const { formDef, profile } = state;
  if (!formDef) return;

  injectStyles();
  if (formDef.lstepOptions?.pageTitle) document.title = formDef.lstepOptions.pageTitle;
  // フォームごとのアクセントカラー(Lステップの「デザイン設定」相当)。未設定ならデフォルト(LINE緑)のまま。
  if (formDef.primaryColor) {
    document.documentElement.style.setProperty('--form-accent', formDef.primaryColor);
  }
  if (formDef.backgroundColor) {
    document.documentElement.style.setProperty('--form-page-bg', formDef.backgroundColor);
  }
  if (formDef.formBackgroundColor) {
    document.documentElement.style.setProperty('--form-card-bg', formDef.formBackgroundColor);
  }
  if (formDef.lstepOptions?.backgroundImageOpacity != null) {
    document.documentElement.style.setProperty('--form-page-bg-image-opacity', String(formDef.lstepOptions.backgroundImageOpacity / 100));
  }
  const safeBgImageUrl = safeHttpsUrl(formDef.backgroundImageUrl);
  if (safeBgImageUrl) {
    document.documentElement.style.setProperty('--form-page-bg-image', `url("${safeBgImageUrl}")`);
  }
  if (formDef.themeMainColor) {
    document.documentElement.style.setProperty('--form-main', formDef.themeMainColor);
  }
  if (formDef.themeSubColor) {
    document.documentElement.style.setProperty('--form-sub', formDef.themeSubColor);
  }
  if (formDef.themeErrorColor) {
    document.documentElement.style.setProperty('--form-error', formDef.themeErrorColor);
  }
  if (formDef.themeTextColor) {
    document.documentElement.style.setProperty('--form-text', formDef.themeTextColor);
  }
  if (formDef.themeFont) {
    const FONT_STACKS: Record<string, string> = {
      'ゴシック': '"Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif',
      '明朝': '"Hiragino Mincho ProN", "Noto Serif JP", serif',
      '丸ゴシック': '"Hiragino Maru Gothic ProN", "Rounded Mplus 1c", sans-serif',
    };
    document.documentElement.style.setProperty('--form-font', FONT_STACKS[formDef.themeFont] ?? formDef.themeFont);
  }
  if (formDef.customCss) {
    let customStyleEl = document.getElementById('form-custom-css') as HTMLStyleElement | null;
    if (!customStyleEl) {
      customStyleEl = document.createElement('style');
      customStyleEl.id = 'form-custom-css';
      document.head.appendChild(customStyleEl);
    }
    customStyleEl.textContent = formDef.customCss;
  }
  const app = getApp();
  const safeHeaderImageUrl = safeHttpsUrl(formDef.headerImageUrl);
  const headerImageHtml = safeHeaderImageUrl
    ? `<img class="form-header-image" src="${escapeHtml(safeHeaderImageUrl)}" alt="" />`
    : '';
  const profileHtml = (formDef.hideHeaderIcon || formDef.hideProfile || !profile?.pictureUrl)
    ? ''
    : `<div class="form-profile">
        <img src="${profile.pictureUrl}" alt="" />
        <span>${escapeHtml(profile.displayName)} さん</span>
      </div>`;

  // Split fields: survey fields (page 1) vs x_username field (page 2)
  const surveyFields = formDef.fields.filter((f) => f.name !== 'x_username');
  const xUsernameField = formDef.fields.find((f) => f.name === 'x_username');
  const hasTwoPages = !!xUsernameField && formDef.hasSubmitWebhook;

  const surveyFieldsHtml = surveyFields
    .map((f) => renderField(f, formDef.previousAnswer?.[f.name]))
    .join('');
  const xFieldHtml = xUsernameField ? renderField(xUsernameField, formDef.previousAnswer?.[xUsernameField.name]) : '';

  if (hasTwoPages) {
    // ─── 2-page layout ───
    app.innerHTML = `
      <div class="form-page">
        <div class="form-header">
          ${headerImageHtml}
          <h1>${escapeHtml(formDef.name).replace(/\\n|\n/g, '<br>')}</h1>
          ${formDef.description && !formDef.hasSubmitWebhook ? `<p class="form-description">${escapeHtml(formDef.description).replace(/\\n|\n/g, '<br>')}</p>` : ''}
          ${profileHtml}
        </div>
        <!-- Page 1: Survey -->
        <div id="form-page-1">
          <form id="survey-form" class="form-body" novalidate>
            ${surveyFieldsHtml}
            <button type="submit" class="submit-btn" id="nextBtn">次へ →</button>
          </form>
        </div>
        <!-- Page 2: X-Link -->
        <div id="form-page-2" hidden>
          <div class="form-header" style="padding-top:0">
            <h1>X-Link で受け取り</h1>
          </div>
          <form id="liff-form" class="form-body" novalidate>
            ${xFieldHtml}
            <button type="submit" class="submit-btn" id="submitBtn">X Harness を受け取る</button>
          </form>
        </div>
      </div>
    `;

    // Page 1 → Page 2 transition
    document.getElementById('survey-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Validate survey fields
      for (const field of surveyFields) {
        if (!field.required || field.hidden) continue;
        if (field.type === 'checkbox') {
          const checked = document.querySelectorAll<HTMLInputElement>(`input[name="${field.name}"]:checked`);
          if (checked.length === 0) {
            showFieldError(`${field.label} は必須項目です`);
            return;
          }
        } else if (field.type === 'radio') {
          const checked = document.querySelector<HTMLInputElement>(`input[name="${field.name}"]:checked`);
          if (!checked) {
            showFieldError(`${field.label} は必須項目です`);
            return;
          }
        } else {
          const el = document.querySelector<HTMLInputElement>(`[name="${field.name}"]`);
          if (!el || !el.value.trim()) {
            showFieldError(`${field.label} は必須項目です`);
            return;
          }
        }
      }

      // Save survey data (partial submit)
      const nextBtn = document.getElementById('nextBtn') as HTMLButtonElement;
      nextBtn.disabled = true;
      nextBtn.textContent = '保存中...';

      const surveyData: Record<string, unknown> = {};
      for (const field of surveyFields) {
        if (field.type === 'checkbox') {
          surveyData[field.name] = Array.from(document.querySelectorAll<HTMLInputElement>(`input[name="${field.name}"]:checked`)).map((el) => el.value);
        } else if (field.type === 'radio') {
          surveyData[field.name] = document.querySelector<HTMLInputElement>(`input[name="${field.name}"]:checked`)?.value ?? '';
        } else {
          surveyData[field.name] = (document.querySelector<HTMLInputElement>(`[name="${field.name}"]`)?.value ?? '').trim();
        }
      }

      try {
        await apiCall(`/api/forms/${formDef.id}/partial`, {
          method: 'POST',
          body: JSON.stringify({ data: surveyData }),
        });
      } catch { /* non-blocking */ }

      // Transition to page 2
      document.getElementById('form-page-1')!.hidden = true;
      document.getElementById('form-page-2')!.hidden = false;
      window.scrollTo(0, 0);

      // Show loading overlay if replier pool is still loading
      if (!_replierPoolReady) {
        const xInput = document.querySelector<HTMLInputElement>('.x-autocomplete-input');
        if (xInput) xInput.disabled = true;
        const wrap = document.querySelector('.x-autocomplete-wrap');
        if (wrap) {
          const overlay = document.createElement('div');
          overlay.id = 'x-loading-overlay';
          overlay.innerHTML = '<div class="x-loading-spinner"></div><p>X連携データを読み込み中...</p>';
          overlay.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:12px;padding:24px 0;color:#888;font-size:14px;';
          wrap.parentElement?.insertBefore(overlay, wrap);
        }
      }
    });

    attachFormEvents();
  } else {
    // ─── Single page layout / Lステップ準拠のセクション分割 ───
    const opts = formDef.lstepOptions ?? {};
    const headerFields = formDef.fields.filter((f) => f.section === 0);
    const bodyFields = formDef.fields.filter((f) => f.section !== 0);
    const sectionNumbers = [...new Set(bodyFields.map((f) => f.section ?? 1))].sort((a, b) => a - b);
    const sections = sectionNumbers.length > 0 ? sectionNumbers : [1];
    const multi = sections.length > 1;
    const headerHtml = headerFields
      .map((f) => renderField(f, formDef.previousAnswer?.[f.name]))
      .join('');
    const sectionsHtml = sections
      .map((num, idx) => {
        const inner = bodyFields
          .filter((f) => (f.section ?? 1) === num)
          .map((f) => renderField(f, formDef.previousAnswer?.[f.name]))
          .join('');
        const isLast = idx === sections.length - 1;
        const style = opts.sectionHeaderStyle ?? 'page-number';
        const indicator = !multi || style === 'none'
          ? ''
          : style === 'progress'
            ? `<div class="section-progress"><span style="width:${Math.round(((idx + 1) / sections.length) * 100)}%"></span></div>`
            : `<div class="section-indicator">${idx + 1} / ${sections.length}</div>`;
        const nav = isLast
          ? `<div class="section-nav">${idx > 0 ? '<button type="button" class="submit-btn secondary" data-section-prev>戻る</button>' : ''}<button type="submit" class="submit-btn" id="submitBtn">${escapeHtml(submitLabel())}</button></div>`
          : `<div class="section-nav">${idx > 0 ? '<button type="button" class="submit-btn secondary" data-section-prev>戻る</button>' : ''}<button type="button" class="submit-btn" data-section-next>${escapeHtml(opts.nextLabel || '次へ')}</button></div>`;
        return `<div class="form-section-page" data-section-index="${idx}"${idx === 0 ? '' : ' hidden'}>${indicator}${inner}${nav}</div>`;
      })
      .join('');
    app.innerHTML = `
      <div class="form-page">
        <div class="form-header">
          ${headerImageHtml}
          <h1>${escapeHtml(formDef.name).replace(/\\n|\n/g, '<br>')}</h1>
          ${formDef.description && !formDef.hasSubmitWebhook ? `<p class="form-description">${escapeHtml(formDef.description).replace(/\\n|\n/g, '<br>')}</p>` : ''}
          ${profileHtml}
        </div>
        <form id="liff-form" class="form-body" novalidate>
          ${headerHtml}
          ${sectionsHtml}
        </form>
      </div>
    `;
    applyButtonStyle();
    if (multi) attachSectionNav(sections.length);

    attachFormEvents();
  }
}

/** 送信ボタンの文言(Lステップの「送信ボタン文言」)。未設定なら「送信する」。 */
function submitLabel(): string {
  return state.formDef?.lstepOptions?.submitLabel?.trim() || '送信する';
}

/** ボタンスタイル・色(Lステップの「ボタン設定」)を反映する。 */
function applyButtonStyle(): void {
  const opts = state.formDef?.lstepOptions;
  if (!opts) return;
  const root = document.documentElement;
  if (opts.buttonColor) root.style.setProperty('--form-accent', opts.buttonColor);
  const radius = opts.buttonStyle === 'rounded' ? '999px' : opts.buttonStyle === 'square' ? '0' : '';
  if (radius) {
    let el = document.getElementById('form-button-style') as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = 'form-button-style';
      document.head.appendChild(el);
    }
    el.textContent = `.submit-btn { border-radius: ${radius} !important; }`;
  }
}

/** 指定した項目群の必須チェック。エラーがあれば文言を返す。 */
function validateFields(fields: FormField[]): string | null {
  for (const field of fields) {
    if (!field.required || field.hidden) continue;
    if (field.type === 'checkbox') {
      if (document.querySelectorAll<HTMLInputElement>(`input[name="${field.name}"]:checked`).length === 0) {
        return `${field.label} は必須項目です`;
      }
    } else if (field.type === 'radio') {
      if (!document.querySelector<HTMLInputElement>(`input[name="${field.name}"]:checked`)) {
        return `${field.label} は必須項目です`;
      }
    } else {
      const el = document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${field.name}"]`);
      if (!el || !el.value.trim()) return `${field.label} は必須項目です`;
    }
  }
  return null;
}

/** セクション(ページ)の「次へ」「戻る」。次へ進む前にそのセクションの必須項目を検証する。 */
function attachSectionNav(total: number): void {
  const pages = Array.from(document.querySelectorAll<HTMLElement>('.form-section-page'));
  const sectionNumbers = [...new Set((state.formDef?.fields ?? []).filter((f) => f.section !== 0).map((f) => f.section ?? 1))].sort((a, b) => a - b);
  const show = (idx: number) => {
    pages.forEach((p, i) => { p.hidden = i !== idx; });
    window.scrollTo(0, 0);
  };
  pages.forEach((page, idx) => {
    page.querySelector('[data-section-next]')?.addEventListener('click', () => {
      const num = sectionNumbers[idx];
      const err = validateFields((state.formDef?.fields ?? []).filter((f) => f.section !== 0 && (f.section ?? 1) === num));
      page.querySelector('.form-error-msg')?.remove();
      if (err) {
        const el = document.createElement('p');
        el.className = 'form-error-msg';
        el.textContent = err;
        page.querySelector('.section-nav')?.before(el);
        return;
      }
      if (idx + 1 < total) show(idx + 1);
    });
    page.querySelector('[data-section-prev]')?.addEventListener('click', () => { if (idx > 0) show(idx - 1); });
  });
}

async function showSubmitConditions(conditions: Record<string, boolean | null>, passed: boolean): Promise<void> {
  const existing = document.getElementById('submit-conditions');
  if (existing) existing.remove();

  const labels: Array<[string, string]> = [['reply', 'リプライ'], ['like', 'いいね'], ['repost', 'リポスト'], ['follow', 'フォロー']];

  const container = document.createElement('div');
  container.id = 'submit-conditions';
  container.innerHTML = '<div class="x-conditions-card" id="condition-card"></div>';

  const btn = document.getElementById('submitBtn');
  btn?.parentElement?.insertBefore(container, btn);

  const card = document.getElementById('condition-card')!;

  // Animate each condition one by one
  for (const [key, label] of labels) {
    const val = conditions[key];
    if (val === null || val === undefined) continue; // skip non-required

    // Show "checking" state
    const row = document.createElement('div');
    row.className = 'x-condition-row';
    row.innerHTML = `<div class="x-condition-check checking"><span class="spin">⏳</span></div><span>${label}を確認中...</span>`;
    card.appendChild(row);

    // Wait for dramatic effect
    await new Promise(r => setTimeout(r, 600));

    // Reveal result
    if (val) {
      row.innerHTML = `<div class="x-condition-check pass">✓</div><span>${label}</span>`;
    } else {
      row.innerHTML = `<div class="x-condition-check fail">✗</div><span>${label}</span>`;
    }
  }

  // Final summary after all checks
  await new Promise(r => setTimeout(r, 400));

  const summary = document.createElement('div');
  if (passed) {
    summary.className = 'x-conditions-summary pass';
    summary.textContent = '🎉 条件クリア！';
  } else {
    summary.className = 'x-conditions-summary fail';
    summary.innerHTML = '条件を満たしていません<br><span style="font-size:12px;font-weight:normal">ポストにいいね・リプライ・リポストしてから再度お試しください</span>';
  }
  container.appendChild(summary);
}

function renderWebhookSuccess(message: string): void {
  const app = getApp();
  const lines = message.split('\n').map((l) => `<p>${escapeHtml(l)}</p>`).join('');
  app.innerHTML = `
    <div class="form-page">
      <div class="success-card">
        <div class="success-icon">🎉</div>
        <h2>おめでとうございます！</h2>
        <div class="success-message">${lines}</div>
        <button class="close-btn" id="closeBtn">閉じる</button>
      </div>
    </div>
  `;

  document.getElementById('closeBtn')?.addEventListener('click', () => {
    if (liff.isInClient()) {
      liff.closeWindow();
    } else {
      window.close();
    }
  });
}

function renderSuccess(): void {
  const app = getApp();
  app.innerHTML = `
    <div class="form-page">
      <div class="success-card">
        <div class="success-icon">✓</div>
        <h2>送信完了！</h2>
        <p class="success-message">${escapeHtml(state.formDef?.lstepOptions?.thanksText?.trim() || 'ご回答ありがとうございました。').replace(/\n/g, '<br>')}</p>
        <button class="close-btn" id="closeBtn">閉じる</button>
      </div>
    </div>
  `;

  document.getElementById('closeBtn')?.addEventListener('click', () => {
    if (liff.isInClient()) {
      liff.closeWindow();
    } else {
      window.close();
    }
  });

  // Auto-close after 3s inside LINE
  if (liff.isInClient()) {
    setTimeout(() => {
      try { liff.closeWindow(); } catch { /* ignore */ }
    }, 3000);
  }
}

function consultationDateTime(startsAt: string): string {
  return new Date(startsAt).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function consultationDateLabel(date: string): string {
  return new Date(`${date}T00:00:00+09:00`).toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  });
}

function safeHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function closeFormWindow(): void {
  if (liff.isInClient()) {
    liff.closeWindow();
  } else {
    window.close();
  }
}

function renderConsultationConfirmed(booking: BookedConsultation): void {
  const app = getApp();
  const meetUrl = safeHttpsUrl(booking.meetUrl);
  app.innerHTML = `
    <div class="form-page">
      <div class="consultation-card consultation-confirmed">
        <div class="check">✅</div>
        <h2>個別相談が確定しました</h2>
        <div class="time">${escapeHtml(consultationDateTime(booking.startsAt))}</div>
        ${meetUrl ? `<a class="consultation-primary" href="${escapeHtml(meetUrl)}" target="_blank" rel="noreferrer">Google Meetを確認する</a>` : ''}
        <p class="note">LINEにも参加リンクを送りました。前日と開始1時間前にもお知らせします。</p>
        <button class="consultation-secondary" id="closeConsultationBtn">閉じる</button>
      </div>
    </div>
  `;
  document.getElementById('closeConsultationBtn')?.addEventListener('click', closeFormWindow);
  window.scrollTo(0, 0);
}

function renderConsultationFallback(
  webinarSlug: string,
  message: string,
  fallbackUrl: string | null = null,
): void {
  const app = getApp();
  const safeFallbackUrl = safeHttpsUrl(fallbackUrl);
  app.innerHTML = `
    <div class="form-page">
      <div class="consultation-card">
        <div class="consultation-head">
          <div class="calendar-icon">📅</div>
          <h2>回答を受け付けました</h2>
          <p>${escapeHtml(message)}</p>
        </div>
        ${safeFallbackUrl ? `<a class="consultation-primary" href="${escapeHtml(safeFallbackUrl)}">予約カレンダーを開く</a>` : '<button class="consultation-primary" id="retryConsultationBtn">空き枠を再読み込み</button>'}
        <button class="consultation-secondary" id="closeConsultationBtn">あとで予約する</button>
      </div>
    </div>
  `;
  document.getElementById('retryConsultationBtn')?.addEventListener('click', () => {
    void renderConsultationBooking(webinarSlug);
  });
  document.getElementById('closeConsultationBtn')?.addEventListener('click', closeFormWindow);
  window.scrollTo(0, 0);
}

function renderConsultationSlots(
  webinarSlug: string,
  availability: ConsultationAvailability,
): void {
  const existing = availability.existingBooking;
  if (existing?.status === 'confirmed' && existing.meetUrl) {
    renderConsultationConfirmed({
      bookingId: existing.bookingId,
      status: 'confirmed',
      startsAt: existing.startsAt,
      endsAt: '',
      meetUrl: existing.meetUrl,
      externalEventId: '',
      created: false,
    });
    return;
  }

  if (!availability.calendarReady) {
    renderConsultationFallback(
      webinarSlug,
      '空き枠を自動取得できませんでした。予約カレンダーから日時を選んでください。',
      availability.fallbackUrl,
    );
    return;
  }

  const grouped = availability.slots.reduce<Record<string, ConsultationSlot[]>>((all, slot) => {
    (all[slot.date] ??= []).push(slot);
    return all;
  }, {});
  const slotHtml = Object.entries(grouped).map(([date, slots]) => `
    <section class="consultation-date">
      <h3>${escapeHtml(consultationDateLabel(date))}</h3>
      <div class="consultation-grid">
        ${slots.map((slot) => `<button class="slot-btn" data-starts-at="${escapeHtml(slot.startsAt)}">${escapeHtml(slot.start)}</button>`).join('')}
      </div>
    </section>
  `).join('');

  const app = getApp();
  app.innerHTML = `
    <div class="form-page">
      <div class="consultation-card">
        <div class="consultation-head">
          <div class="calendar-icon">📅</div>
          <h2>このまま相談日時を確定</h2>
          <p>空いている15分枠だけを表示しています。<br>選ぶとGoogle Meetまで自動発行されます。</p>
        </div>
        ${slotHtml || '<div class="consultation-empty">現在、選べる枠がありません。</div>'}
        <p class="consultation-status" id="consultationStatus" hidden></p>
        <button class="consultation-secondary" id="closeConsultationBtn">あとで予約する</button>
      </div>
    </div>
  `;

  document.querySelectorAll<HTMLButtonElement>('.slot-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const startsAt = button.dataset.startsAt;
      if (!startsAt) return;
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.slot-btn'));
      const status = document.getElementById('consultationStatus');
      buttons.forEach((item) => { item.disabled = true; });
      const original = button.textContent;
      button.textContent = '確定中...';
      if (status) status.hidden = true;
      try {
        const response = await apiCall(
          `/api/liff/webinars/${encodeURIComponent(webinarSlug)}/consultation-book`,
          { method: 'POST', body: JSON.stringify({ startsAt }) },
        );
        const json = await response.json() as {
          ok?: boolean;
          data?: BookedConsultation;
          error?: string;
        };
        if (!response.ok || !json.ok || !json.data) {
          if (response.status === 409) {
            await renderConsultationBooking(webinarSlug);
            return;
          }
          throw new Error(json.error || '日程を確定できませんでした');
        }
        renderConsultationConfirmed(json.data);
      } catch {
        buttons.forEach((item) => { item.disabled = false; });
        button.textContent = original;
        if (status) {
          status.textContent = '日程を確定できませんでした。もう一度お試しください。';
          status.hidden = false;
        }
      }
    });
  });
  document.getElementById('closeConsultationBtn')?.addEventListener('click', closeFormWindow);
  window.scrollTo(0, 0);
}

async function renderConsultationBooking(webinarSlug: string): Promise<void> {
  const app = getApp();
  app.innerHTML = `
    <div class="form-page">
      <div class="consultation-card consultation-loading">
        <div class="consultation-spinner"></div>
        <h2>回答を受け付けました</h2>
        <p>実際の空き枠を確認しています...</p>
      </div>
    </div>
  `;
  window.scrollTo(0, 0);
  try {
    const response = await apiCall(
      `/api/liff/webinars/${encodeURIComponent(webinarSlug)}/consultation-slots`,
    );
    const json = await response.json() as {
      ok?: boolean;
      data?: ConsultationAvailability;
      error?: string;
    };
    if (!response.ok || !json.ok || !json.data) {
      throw new Error(json.error || 'availability_failed');
    }
    renderConsultationSlots(webinarSlug, json.data);
  } catch {
    renderConsultationFallback(
      webinarSlug,
      '空き枠を読み込めませんでした。通信環境を確認して、もう一度お試しください。',
    );
  }
}

function renderFormError(message: string): void {
  const app = getApp();
  app.innerHTML = `
    <div class="form-page">
      <div class="card">
        <h2 style="color: var(--form-error);">エラー</h2>
        <p class="error">${escapeHtml(message)}</p>
      </div>
    </div>
  `;
}

function showFieldError(message: string): void {
  const existing = getApp().querySelector('.form-error-msg');
  if (existing) existing.remove();
  const errEl = document.createElement('p');
  errEl.className = 'form-error-msg';
  errEl.textContent = message;
  const btn = document.getElementById('nextBtn') || document.getElementById('submitBtn');
  btn?.parentElement?.insertBefore(errEl, btn);
}

function renderLoading(): void {
  const app = getApp();
  app.innerHTML = `
    <div class="form-page">
      <div class="card" style="text-align:center;padding:40px 20px;">
        <div class="loading-spinner"></div>
        <p style="margin-top:12px;color:#718096;">読み込み中...</p>
      </div>
    </div>
  `;
}

// ========== Form Submission ==========

/** 「その他」を選んだときの回答値。入力内容を括弧書きで付ける(例: その他(友人の紹介))。 */
function resolveOther(fieldName: string, value: string): string {
  if (value !== '__other__') return value;
  const input = document.querySelector<HTMLInputElement>(`[data-other-for="${fieldName}"]`);
  const text = (input?.value ?? '').trim();
  return text ? `その他(${text})` : 'その他';
}

function collectFormData(): Record<string, unknown> {
  const { formDef } = state;
  if (!formDef) return {};

  const result: Record<string, unknown> = {};

  for (const field of formDef.fields) {
    if (field.type === 'checkbox') {
      const checked = Array.from(
        document.querySelectorAll<HTMLInputElement>(
          `input[name="${field.name}"]:checked`,
        ),
      ).map((el) => resolveOther(field.name, el.value));
      result[field.name] = checked;
    } else if (field.type === 'radio') {
      const checked = document.querySelector<HTMLInputElement>(
        `input[name="${field.name}"]:checked`,
      );
      result[field.name] = resolveOther(field.name, checked?.value ?? '');
    } else {
      const el = document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        `[name="${field.name}"]`,
      );
      result[field.name] = field.type === 'select' ? resolveOther(field.name, el?.value ?? '') : (el?.value ?? '');
    }
  }

  return result;
}

function validateForm(): string | null {
  const { formDef } = state;
  if (!formDef) return null;

  for (const field of formDef.fields) {
    if (!field.required || field.hidden) continue;

    if (field.type === 'checkbox') {
      const checked = document.querySelectorAll<HTMLInputElement>(
        `input[name="${field.name}"]:checked`,
      );
      if (checked.length === 0) return `${field.label} は必須項目です`;
    } else if (field.type === 'radio') {
      const checked = document.querySelector<HTMLInputElement>(
        `input[name="${field.name}"]:checked`,
      );
      if (!checked) return `${field.label} は必須項目です`;
    } else {
      const el = document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        `[name="${field.name}"]`,
      );
      if (!el || !el.value.trim()) return `${field.label} は必須項目です`;
    }
  }

  return null;
}

async function submitForm(): Promise<void> {
  if (state.submitting || !state.formDef) return;

  const validationError = validateForm();
  if (validationError) {
    const existing = getApp().querySelector('.form-error-msg');
    if (existing) existing.remove();
    const errEl = document.createElement('p');
    errEl.className = 'form-error-msg';
    errEl.textContent = validationError;
    const submitBtn = document.getElementById('submitBtn');
    submitBtn?.parentElement?.insertBefore(errEl, submitBtn);
    return;
  }

  if (state.formDef.lstepOptions?.confirmDialog && !window.confirm('この内容で送信しますか?')) return;

  state.submitting = true;
  const submitBtn = document.getElementById('submitBtn') as HTMLButtonElement | null;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '送信中...';
  }

  try {
    const data = collectFormData();
    console.log('Form data collected:', JSON.stringify(data));

    // Webhook gate — pre-verified by /repliers endpoint
    if (state.formDef.hasSubmitWebhook) {
      // Check that user was selected from pre-verified repliers list
      const xField = ((data.x_username as string) ?? '').trim().replace(/^@/, '');
      if (!xField || xField !== state.verifiedXUsername) {
        state.submitting = false;
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = submitLabel(); }
        const existing = getApp().querySelector('.form-error-msg');
        if (existing) existing.remove();
        const errEl = document.createElement('p');
        errEl.className = 'form-error-msg';
        errEl.textContent = !xField
          ? 'X IDを入力してください'
          : 'X IDを入力後、入力欄の外をタップして確認してください';
        submitBtn?.parentElement?.insertBefore(errEl, submitBtn);
        return;
      }

      // Show success animation (conditions already verified by repliers endpoint)
      const allPassConditions: Record<string, boolean | null> = {
        reply: true,
        like: true,
        repost: true,
        follow: true,
      };
      if (submitBtn) submitBtn.textContent = '判定中...';
      await showSubmitConditions(allPassConditions, true);
      await new Promise(r => setTimeout(r, 500));

      // Webhook passed — submit data to server, then show success
      // If message is Flex JSON, show generic success (Flex is sent via LINE push)
      const rawMsg = state.formDef.onSubmitMessageContent || '条件をクリアしました！';
      const successMsg = rawMsg.trimStart().startsWith('{') ? '特典をLINEでお送りしました！' : rawMsg;
      // Fall through to submit below, then show webhook success
      const webhookBody: Record<string, unknown> = { data: { ...data } };
      if (state.refTrackedLinkId) webhookBody.trackedLinkId = state.refTrackedLinkId;

      const webhookSubmitRes = await apiCall(`/api/forms/${state.formDef.id}/submit`, {
        method: 'POST',
        body: JSON.stringify(webhookBody),
      });
      if (!webhookSubmitRes.ok) {
        const errText = await webhookSubmitRes.text().catch(() => '');
        let errMsg = '送信に失敗しました';
        try { const errData = JSON.parse(errText); errMsg = errData.error || errMsg; } catch { errMsg = errText || errMsg; }
        throw new Error(`${webhookSubmitRes.status}: ${errMsg}`);
      }
      // Check server-side webhook recheck result
      const submitResult = await webhookSubmitRes.clone().json().catch(() => null) as { data?: { webhookPassed?: boolean } } | null;
      if (submitResult?.data?.webhookPassed === false) {
        throw new Error(state.formDef.onSubmitWebhookFailMessage || '条件を満たしていません');
      }
      renderWebhookSuccess(successMsg);
      return;
    }

    const body: Record<string, unknown> = { data };
    if (state.refTrackedLinkId) body.trackedLinkId = state.refTrackedLinkId;
    console.log('Submitting to:', `/api/forms/${state.formDef.id}/submit`);

    const res = await apiCall(`/api/forms/${state.formDef.id}/submit`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    console.log('Response status:', res.status);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let errMsg = '送信に失敗しました';
      try { const errData = JSON.parse(errText); errMsg = errData.error || errMsg; } catch { errMsg = errText || errMsg; }
      throw new Error(`${res.status}: ${errMsg}`);
    }

    if (state.formDef.consultationWebinarSlug) {
      await renderConsultationBooking(state.formDef.consultationWebinarSlug);
    } else if (state.formDef.thanksUrl) {
      // Lステップの「サンクスページURL」相当。設定時は既定の完了画面より優先する。
      window.location.href = state.formDef.thanksUrl;
    } else {
      renderSuccess();
    }
  } catch (err) {
    state.submitting = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = submitLabel();
    }
    const existing = getApp().querySelector('.form-error-msg');
    if (existing) existing.remove();
    const errEl = document.createElement('p');
    errEl.className = 'form-error-msg';
    errEl.textContent = err instanceof Error ? err.message : '送信に失敗しました';
    const btn = document.getElementById('submitBtn');
    btn?.parentElement?.insertBefore(errEl, btn);
  }
}

function attachXAutocomplete(): void {
  const input = document.querySelector<HTMLInputElement>('.x-autocomplete-input');
  if (!input) return;

  const suggestList = document.getElementById('x-suggest-list') as HTMLUListElement | null;
  const hint = document.getElementById('x-suggest-hint');
  const conditionsEl = document.getElementById('x-conditions');
  const conditionsResult = document.getElementById('x-conditions-result');
  if (!suggestList) return;

  let verifyTimer: ReturnType<typeof setTimeout> | null = null;
  let focusedIndex = -1;
  let replierPool: XFollowerSuggestion[] = [];

  // Prefetch repliers on form load
  const gateIdForPool = getGateId();
  if (state.xHarnessBaseUrl && gateIdForPool) {
    fetch(`${state.xHarnessBaseUrl}/api/engagement-gates/${encodeURIComponent(gateIdForPool)}/repliers`)
      .then(r => r.json())
      .then((json: { success: boolean; data?: XFollowerSuggestion[] }) => {
        replierPool = json.data ?? [];
        _replierPoolReady = true;
        // If page 2 is already visible, remove loading overlay
        const overlay = document.getElementById('x-loading-overlay');
        if (overlay) {
          overlay.remove();
          input.disabled = false;
          input.focus();
        }
      })
      .catch(() => {
        _replierPoolReady = true;
        const overlay = document.getElementById('x-loading-overlay');
        if (overlay) {
          overlay.remove();
          input.disabled = false;
        }
      });
  } else {
    _replierPoolReady = true;
  }

  function hideConditions(): void {
    if (conditionsEl) conditionsEl.hidden = true;
    if (conditionsResult) conditionsResult.hidden = true;
  }

  function hideSuggestions(): void {
    suggestList!.hidden = true;
    suggestList!.innerHTML = '';
    focusedIndex = -1;
    if (hint) hint.hidden = true;
  }

  function selectSuggestion(username: string): void {
    input!.value = username;
    state.verifiedXUsername = username;
    hideSuggestions();
    input!.focus();
    void triggerVerify(username);
  }

  function updateFocus(items: NodeListOf<Element>): void {
    items.forEach((el, i) => {
      el.classList.toggle('focused', i === focusedIndex);
    });
    const focused = items[focusedIndex] as HTMLElement | undefined;
    focused?.scrollIntoView({ block: 'nearest' });
  }

  interface VerifyCondition {
    type: string;
    label: string;
    required: boolean;
    passed: boolean;
  }

  interface VerifyResult {
    eligible: boolean;
    userNotFound?: boolean;
    conditions?: VerifyCondition[];
  }

  function renderConditions(result: VerifyResult): void {
    if (!conditionsEl || !conditionsResult) return;

    if (result.userNotFound) {
      conditionsEl.hidden = true;
      conditionsResult.innerHTML = '❌ Xアカウントが見つかりません<br><span style="font-size:11px;font-weight:normal">IDを確認してもう一度お試しください</span>';
      conditionsResult.className = 'x-conditions-summary fail';
      conditionsResult.hidden = false;
      return;
    }

    const conditionDefs = [
      { key: 'reply', label: 'リプライ' },
      { key: 'like', label: 'いいね' },
      { key: 'repost', label: 'リポスト' },
      { key: 'follow', label: 'フォロー' },
    ];

    const conditions = result.conditions ?? [];

    // Build a lookup by type
    const condMap: Record<string, VerifyCondition> = {};
    for (const c of conditions) {
      condMap[c.type] = c;
    }

    let rowsHtml = '';
    for (const def of conditionDefs) {
      const cond = condMap[def.key];
      if (!cond) continue; // not part of this gate, skip
      if (!cond.required) {
        rowsHtml += `
          <div class="x-condition-row">
            <div class="x-condition-check na">—</div>
            <span>${escapeHtml(def.label)}</span>
          </div>`;
      } else if (cond.passed) {
        rowsHtml += `
          <div class="x-condition-row">
            <div class="x-condition-check pass">✓</div>
            <span>${escapeHtml(def.label)}</span>
          </div>`;
      } else {
        rowsHtml += `
          <div class="x-condition-row">
            <div class="x-condition-check fail">✗</div>
            <span>${escapeHtml(def.label)}</span>
          </div>`;
      }
    }

    if (rowsHtml) {
      conditionsEl.innerHTML = `<div class="x-conditions-card">${rowsHtml}</div>`;
      conditionsEl.hidden = false;
    } else {
      conditionsEl.hidden = true;
    }

    if (result.eligible) {
      conditionsResult.textContent = '🎉 条件クリア！特典を受け取れます';
      conditionsResult.className = 'x-conditions-summary pass';
    } else {
      conditionsResult.textContent = '条件を満たしていません';
      conditionsResult.className = 'x-conditions-summary fail';
    }
    conditionsResult.hidden = false;
  }

  async function triggerVerify(username: string): Promise<void> {
    const clean = username.trim().replace(/^@/, '');
    if (!state.xHarnessBaseUrl || !clean) return;
    const gateId = getGateId();
    if (!gateId) return;

    try {
      const url = `${state.xHarnessBaseUrl}/api/engagement-gates/${encodeURIComponent(gateId)}/verify?username=${encodeURIComponent(clean)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('verify failed');
      const json = await res.json() as { success: boolean; data?: VerifyResult };
      const verifyData = json.data;
      if (verifyData) {
        renderConditions(verifyData);
        // Mark as verified so submit is allowed even without selecting from suggestions
        // Allow submit for any verified user (server-side webhook does final eligibility check)
        if (!verifyData.userNotFound) {
          state.verifiedXUsername = clean;
          if (input) input.value = clean; // normalize input (strip @)
        }
      }
    } catch {
      // Hide stale gate condition rows before showing the error message
      hideConditions();
      // Show helpful message on verify error (e.g. X API down)
      if (conditionsResult) {
        conditionsResult.innerHTML = '⚠️ 確認中にエラーが発生しました<br><span style="font-size:11px;font-weight:normal">しばらく待ってからもう一度お試しください</span>';
        conditionsResult.className = 'x-conditions-summary fail';
        conditionsResult.hidden = false;
      }
    }
  }

  function showSuggestions(suggestions: XFollowerSuggestion[]): void {
    suggestList!.innerHTML = '';
    focusedIndex = -1;

    if (suggestions.length === 0) {
      suggestList!.hidden = true;
      if (hint) {
        hint.innerHTML = replierPool.length === 0
          ? '<span style="color:#e53e3e">⏳ まだリアクションがありません</span><br><span style="font-size:11px;color:#888">ポストにリポスト＆フォローしてから再度お試しください</span>'
          : '<span style="color:#888">候補に表示されなくても、そのままIDを入力して送信できます</span>';
        hint.hidden = false;
      }
      return;
    }

    if (hint) hint.hidden = true;
    for (const s of suggestions) {
      const li = document.createElement('li');
      li.className = 'x-suggest-item';
      li.dataset.username = s.username;
      const avatarHtml = s.profileImageUrl
        ? `<img class="x-suggest-avatar" src="${escapeHtml(s.profileImageUrl)}" alt="" />`
        : `<div class="x-suggest-avatar-placeholder">@</div>`;
      li.innerHTML = `
        ${avatarHtml}
        <div class="x-suggest-names">
          <span class="x-suggest-display">${escapeHtml(s.displayName)}</span>
          <span class="x-suggest-username">@${escapeHtml(s.username)}</span>
        </div>
      `;
      li.addEventListener('mousedown', (e) => {
        e.preventDefault(); // prevent input blur before click
        selectSuggestion(s.username);
      });
      suggestList!.appendChild(li);
    }
    suggestList!.hidden = false;
  }

  input.addEventListener('input', () => {
    const q = input.value.trim().replace(/^@/, ''); // strip leading @
    if (verifyTimer !== null) clearTimeout(verifyTimer);
    // Clear verified flag when user types manually
    if (q !== state.verifiedXUsername) state.verifiedXUsername = '';

    if (!q) {
      hideSuggestions();
      hideConditions();
      return;
    }

    if (q.length < 3) {
      hideSuggestions();
      hideConditions();
      if (hint) { hint.textContent = '3文字以上入力してください'; hint.hidden = false; }
      return;
    }

    if (hint) hint.hidden = true;
    const qLower = q.toLowerCase();
    const matches = replierPool.filter(r =>
      r.username.toLowerCase().includes(qLower) ||
      r.displayName.toLowerCase().includes(qLower)
    ).slice(0, 5);
    showSuggestions(matches);
  });

  input.addEventListener('keydown', (e) => {
    const items = suggestList!.querySelectorAll('.x-suggest-item');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusedIndex = Math.min(focusedIndex + 1, items.length - 1);
      updateFocus(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusedIndex = Math.max(focusedIndex - 1, 0);
      updateFocus(items);
    } else if (e.key === 'Enter' && focusedIndex >= 0) {
      e.preventDefault();
      const focused = items[focusedIndex] as HTMLElement;
      const username = focused.dataset.username;
      if (username) selectSuggestion(username);
    } else if (e.key === 'Escape') {
      hideSuggestions();
    }
  });

  input.addEventListener('blur', () => {
    // Small delay so mousedown on suggestion can fire first
    setTimeout(() => {
      hideSuggestions();
      // Trigger verify on blur if input has a value
      const username = input.value.trim().replace(/^@/, '');
      if (username && getGateId()) {
        if (verifyTimer !== null) clearTimeout(verifyTimer);
        verifyTimer = setTimeout(() => {
          void triggerVerify(username);
        }, 300);
      }
    }, 150);
  });
}

function attachFormEvents(): void {
  // プルダウンで「その他」を選んだときだけ、内容の入力欄を出す
  document.querySelectorAll<HTMLSelectElement>('select.form-select').forEach((sel) => {
    const other = document.querySelector<HTMLInputElement>(`[data-other-for="${sel.name}"]`);
    if (!other || other.type !== 'text') return;
    sel.addEventListener('change', () => { other.hidden = sel.value !== '__other__'; });
  });
  const form = document.getElementById('liff-form');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    void submitForm();
  });
  attachXAutocomplete();
}

// ========== Init ==========

export async function initForm(formId: string | null): Promise<void> {
  if (!formId) {
    renderFormError('フォームIDが指定されていません');
    return;
  }

  renderLoading();

  try {
    // Fetch profile and form definition in parallel
    const [profile, res] = await Promise.all([
      liff.getProfile(),
      apiCall(`/api/forms/${formId}`),
    ]);

    state.profile = profile;

    // Try to get friendId from local storage (set by main UUID linking flow)
    try {
      state.friendId = localStorage.getItem(UUID_STORAGE_KEY);
    } catch {
      // silent
    }

    // Silent UUID linking (best-effort, so friend metadata saves correctly)
    const rawIdToken = liff.getIDToken();
    if (rawIdToken) {
      apiCall('/api/liff/link', {
        method: 'POST',
        body: JSON.stringify({
          idToken: rawIdToken,
          displayName: profile.displayName,
          existingUuid: state.friendId,
        }),
      }).then(async (linkRes) => {
        if (linkRes.ok) {
          const data = await linkRes.json() as { success: boolean; data?: { userId?: string } };
          if (data?.data?.userId) {
            try {
              localStorage.setItem(UUID_STORAGE_KEY, data.data.userId);
              state.friendId = data.data.userId;
            } catch { /* silent */ }
          }
        }
      }).catch(() => { /* silent */ });
    }

    if (!res.ok) {
      if (res.status === 404) {
        renderFormError('フォームが見つかりません');
      } else {
        renderFormError('フォームの読み込みに失敗しました');
      }
      return;
    }

    const json = await res.json() as { success: boolean; data?: FormDef };
    if (!json.success || !json.data) {
      renderFormError('フォームの読み込みに失敗しました');
      return;
    }

    if (!json.data.isActive) {
      renderFormError('このフォームは現在受付を停止しています');
      return;
    }

    if (json.data.isNotStarted) {
      renderFormError('この回答フォームはまだ回答を受け付けていません');
      return;
    }
    if (json.data.isExpired) {
      renderFormError('この回答フォームは回答期限を過ぎています');
      return;
    }
    if (json.data.isFull) {
      renderFormError('この回答フォームは先着数に達しました');
      return;
    }

    state.formDef = json.data;

    // Use only the trusted origin derived from the stored webhook. The raw
    // webhook path/query and secret headers never reach the browser.
    const urlParams = new URLSearchParams(window.location.search);
    const xhParam = urlParams.get('xh');
    const requestedOrigin = xhParam?.replace(/\/$/, '') ?? null;
    state.xHarnessBaseUrl =
      requestedOrigin && requestedOrigin === json.data.webhookOrigin
        ? requestedOrigin
        : json.data.webhookOrigin;

    // Capture tracked link ref so submit can attribute reward to this campaign
    const refParam = urlParams.get('ref');
    if (refParam) {
      state.refTrackedLinkId = refParam;
    }

    render();

    // Record form open event (fire-and-forget)
    apiCall(`/api/forms/${state.formDef!.id}/opened`, {
      method: 'POST',
      body: JSON.stringify({}),
    }).catch(() => { /* silent */ });
  } catch (err) {
    renderFormError(err instanceof Error ? err.message : 'エラーが発生しました');
  }
}
