/**
 * テンプレート(Lステップの「テンプレート」と同じ作り)の入力データと、LINEへ送る形への変換。
 *
 * 【考え方】
 * 画面(Web)と、保存・送信(Worker)で、同じ変換を使う。画面のプレビューと、実際に届くものが食い違わないようにするため。
 *  - 入力データ(editor_data): 画面に入れた内容そのまま。編集画面を開き直すときに使う。
 *  - 変換後(message_type / message_content): 送信に使う形。既存の配信・シナリオ・自動応答は、これだけを見て送る。
 *
 * 【変換後の形(既存の送り方を壊さない)】
 *  - 文章 1通 → message_type='text'(本文そのまま)
 *  - 画像(リンクなし) → 'image'({originalContentUrl, previewImageUrl}。従来と同じ)
 *  - フレックス・カルーセル・紹介 → 'flex'(Flex の contents。従来と同じ)
 *  - それ以外(スタンプ・位置情報・音声・動画・画像リンク付き・質問・2通以上)→ 'flex' + {"lineMessages":[LINEのメッセージ…]}。
 *    既存の保存先は 'text' / 'image' / 'flex' しか入れられない(DBの制約)ため、'flex' の箱に「そのまま送る」目印を付けて入れる。
 *    送るとき(buildMessage / buildMessages)がこの目印を見て、LINEのメッセージとして取り出す。
 */

export const TEMPLATE_RAW_KEY = 'lineMessages';

/** 1通の文章の上限(LINEは5000。Lステップは約4,500で分割する) */
export const TEXT_SPLIT_LENGTH = 4500;
/** 文章全体の上限(4,500字 × 5通) */
export const TEXT_MAX_LENGTH = 22500;

export type TemplateKind = 'standard' | 'flex' | 'pack';

export type EditorType =
  | 'text'
  | 'sticker'
  | 'image'
  | 'question'
  | 'carousel'
  | 'location'
  | 'referral'
  | 'audio'
  | 'video'
  | 'flex';

export const EDITOR_TYPE_LABEL: Record<EditorType, string> = {
  text: 'テキスト',
  sticker: 'スタンプ',
  image: '画像',
  question: '質問',
  carousel: 'カルーセル',
  location: '位置情報',
  referral: '紹介',
  audio: '音声',
  video: '動画',
  flex: 'フレックスメッセージ',
};

/** 標準メッセージのタブの並び(Lステップと同じ) */
export const STANDARD_EDITOR_TYPES: EditorType[] = ['text', 'sticker', 'image', 'question', 'carousel', 'location', 'referral', 'audio', 'video'];

export interface LineMessageLike {
  type: string;
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────
// 共通: URL設定(本文中のURLごとの設定)・送信者
// ─────────────────────────────────────────────────────────────

export interface LinkSetting {
  url: string;
  /** サイト登録名 */
  name: string;
  /** 転送画面で実行する JavaScript */
  script?: string;
  /** 転送先を変える(記録は元のURLへのアクセスとして数える) */
  redirectTo?: string;
  /** 有効期限 */
  expire?: {
    mode: 'datetime' | 'elapsed_days' | 'elapsed_datetime';
    /** datetime: 2026-10-21T00:00 */
    at?: string;
    days?: number;
    time?: string;
    redirectUrl?: string;
  } | null;
  /** 訪問時のアクション(友だち追加時設定のアクションと同じ形) */
  actions?: unknown[];
}

export interface UrlSettings {
  noShorten?: boolean;
  links?: LinkSetting[];
}

export interface SenderInfo {
  name?: string | null;
  iconUrl?: string | null;
}

// ─────────────────────────────────────────────────────────────
// 入力データ(種別ごと)
// ─────────────────────────────────────────────────────────────

export interface TextData {
  text: string;
  urlSettings?: UrlSettings;
}

export interface StickerData {
  packageId: string;
  stickerId: string;
}

export type ImageLayout = 'none' | 'link1' | 'link2' | 'link3' | 'link4' | 'link5' | 'link6' | 'link7' | 'link8' | 'custom';

export interface ImageArea {
  /** none=使用しない / url=URLを開く / message=ユーザーメッセージ送信 */
  kind: 'none' | 'url' | 'message';
  url?: string;
  text?: string;
  /** 0〜1 の割合(画像全体に対する位置と大きさ) */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ImageData {
  imageUrl: string;
  /** 元画像の大きさ(画像リンクの領域の計算に使う) */
  width?: number;
  height?: number;
  layout: ImageLayout;
  areas: ImageArea[];
  /** PC版・通知欄での代替テキスト */
  altText?: string;
  urlSettings?: UrlSettings;
}

/** 選んだあとの動き(質問・カルーセル共通) */
export interface ChoiceBehavior {
  kind: 'none' | 'url' | 'tel' | 'friend_add' | 'mail' | 'form' | 'scenario' | 'event' | 'calendar' | 'actions';
  /** url / 電話番号 / @LINE ID / メールアドレス / フォームID / シナリオID / イベントID / カレンダーID */
  value?: string;
  /** 'scenario' のとき: move=移動 / stop=停止 */
  scenarioOp?: 'move' | 'stop';
  /** 'actions': 友だち追加時設定のアクションと同じ形 */
  actions?: unknown[];
}

export interface ReplyDef {
  mode: 'text' | 'template';
  text?: string;
  templateId?: string | null;
}

export interface ChoiceDef {
  label: string;
  behavior: ChoiceBehavior;
  /** ボタンを押したときに「友だちの発言」として送る文章(空なら選択肢の文字) */
  userMessage?: string;
  noUserMessage?: boolean;
  /** 選択時の返信(詳細設定) */
  reply?: ReplyDef;
  /** 二度押しのときの返信 */
  repeatReply?: ReplyDef;
  addTagIds?: string[];
  removeTagIds?: string[];
  fieldId?: string | null;
  fieldValue?: string;
}

export interface QuestionData {
  /** 前文(テキストメッセージで流れる) */
  lead?: string;
  question: string;
  choices: [ChoiceDef, ChoiceDef];
  altText?: string;
  /** 'single'=1つのみタップ可能 / 'both'=両方タップ可能 */
  answerMode?: 'single' | 'both';
  urlSettings?: UrlSettings;
  detail?: boolean;
}

export interface CarouselPanel {
  title?: string;
  text: string;
  imageUrl?: string;
  choices: ChoiceDef[];
}

export type TapLimit = 'none' | 'carousel_once' | 'panel_once' | 'choice_once';

export interface CarouselData {
  panels: CarouselPanel[];
  altText?: string;
  tapLimit?: TapLimit;
  /** 上限を超えたとき: 'same'=全選択肢で同じ / 'each'=選択肢ごと */
  limitScope?: 'same' | 'each';
  limitReply?: 'default' | 'none';
  limitActions?: unknown[];
  urlSettings?: UrlSettings;
}

export interface LocationData {
  title: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
}

export interface ReferralData {
  text: string;
  /** @xxxx */
  accountId: string;
  urlSettings?: UrlSettings;
  detail?: boolean;
}

export interface AudioData {
  url: string;
  /** ミリ秒 */
  durationMs: number;
  name?: string;
}

export interface VideoData {
  url: string;
  previewUrl: string;
  name?: string;
}

// ── フレックス(ビジュアルエディタ) ──

export type FlexBlockAction = { kind: 'url'; url: string } | { kind: 'message'; text: string } | { kind: 'tel'; value: string } | { kind: 'actions'; actions: unknown[] } | { kind: 'none' };

export interface FlexBlockBase {
  id: string;
  background?: string | null;
  margin?: 'none' | 'sm' | 'md' | 'lg';
}

export type FlexBlock =
  | (FlexBlockBase & { type: 'title'; title: string; subtitle?: string })
  | (FlexBlockBase & { type: 'text'; text: string; border?: boolean })
  | (FlexBlockBase & { type: 'button'; label: string; action: FlexBlockAction; styled?: boolean })
  | (FlexBlockBase & {
      type: 'image';
      url: string;
      shape?: 'fit' | 'square' | 'wide' | 'tall';
      label?: string;
      title?: string;
      subtitle?: string;
      action?: FlexBlockAction;
      actionLabel?: string;
    })
  | (FlexBlockBase & { type: 'video'; url: string; previewUrl: string; action?: FlexBlockAction });

export interface FlexPanel {
  background?: string | null;
  blocks: FlexBlock[];
}

export interface FlexEditorData {
  panels: FlexPanel[];
  /** テーマカラー(共通) */
  themeColor?: string;
  size?: 'nano' | 'micro' | 'kilo' | 'mega' | 'giga';
  altText?: string;
  /** タップ回数制限(回答率の集計に使う) */
  tapLimit?: TapLimit;
}

export type EditorData =
  | TextData
  | StickerData
  | ImageData
  | QuestionData
  | CarouselData
  | LocationData
  | ReferralData
  | AudioData
  | VideoData
  | FlexEditorData;

// ─────────────────────────────────────────────────────────────
// 変換
// ─────────────────────────────────────────────────────────────

export interface CompileContext {
  /** このテンプレートのID(質問・カルーセルを押したときの動きを、このIDで引く) */
  templateId: string;
  /** Worker の公開URL(画像リンク用 baseUrl に使う) */
  workerUrl: string;
  sender?: SenderInfo | null;
}

export interface CompiledTemplate {
  messageType: 'text' | 'image' | 'flex';
  messageContent: string;
  /** 通知文など(フレックス・カルーセル) */
  altText: string | null;
  /** 送る LINE メッセージ(順番どおり) */
  messages: LineMessageLike[];
}

const DEFAULT_ALT = '[LINEアプリよりご覧下さい]';

export function splitText(text: string, size = TEXT_SPLIT_LENGTH): string[] {
  if (text.length <= size) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > size) {
    // 改行で区切れるなら、そこで切る(単語の途中で切らない)
    let cut = rest.lastIndexOf('\n', size);
    if (cut < size * 0.6) cut = size;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest) out.push(rest);
  return out;
}

/** 選択肢を押したときの postback データ。Webhook がこれを読んで、設定した動きを実行する */
export function templatePostbackData(templateId: string, panel: number, choice: number): string {
  return `tpl:${templateId}:${panel}:${choice}`;
}

export function parseTemplatePostback(data: string): { templateId: string; panel: number; choice: number } | null {
  const m = /^tpl:([^:]+):(\d+):(\d+)$/.exec(data);
  if (!m) return null;
  return { templateId: m[1], panel: Number(m[2]), choice: Number(m[3]) };
}

function trimLabel(label: string, max = 20): string {
  const s = label.trim() || '　';
  return s.length > max ? s.slice(0, max) : s;
}

/** 選択肢が、押したときに Worker 側で処理が要るか(返信・タグ・情報欄・シナリオ・アクション実行・回数制限) */
export function choiceNeedsPostback(choice: ChoiceDef, tapLimited: boolean): boolean {
  const b = choice.behavior;
  if (tapLimited) return true;
  if (b.kind === 'scenario' || b.kind === 'actions' || b.kind === 'event' || b.kind === 'calendar') return true;
  if (choice.reply && ((choice.reply.mode === 'text' && (choice.reply.text ?? '').trim()) || (choice.reply.mode === 'template' && choice.reply.templateId))) return true;
  if (choice.repeatReply && ((choice.repeatReply.text ?? '').trim() || choice.repeatReply.templateId)) return true;
  if ((choice.addTagIds?.length ?? 0) > 0 || (choice.removeTagIds?.length ?? 0) > 0) return true;
  if (choice.fieldId) return true;
  return false;
}

function choiceAction(templateId: string, panel: number, index: number, choice: ChoiceDef, tapLimited: boolean, liffBase: string | null): LineMessageLike {
  const label = trimLabel(choice.label);
  const b = choice.behavior;
  const userMessage = choice.noUserMessage ? '' : (choice.userMessage ?? '').trim();

  if (b.kind === 'url' && b.value) return { type: 'uri', label, uri: b.value };
  if (b.kind === 'tel' && b.value) return { type: 'uri', label, uri: `tel:${b.value.replace(/[^\d+]/g, '')}` };
  if (b.kind === 'mail' && b.value) return { type: 'uri', label, uri: `mailto:${b.value}` };
  if (b.kind === 'friend_add' && b.value) {
    const id = b.value.startsWith('@') ? b.value : `@${b.value}`;
    return { type: 'uri', label, uri: `https://line.me/R/ti/p/${encodeURIComponent(id)}` };
  }
  if (b.kind === 'form' && b.value) {
    // フォームのリンクは、送る直前に展開される({{form_url:ID}})
    return { type: 'uri', label, uri: `{{form_url:${b.value}}}` };
  }

  if (choiceNeedsPostback(choice, tapLimited)) {
    const action: LineMessageLike = { type: 'postback', label, data: templatePostbackData(templateId, panel, index) };
    if (userMessage) action.displayText = userMessage.slice(0, 300);
    return action;
  }
  void liffBase;
  return { type: 'message', label, text: (userMessage || choice.label.trim() || label).slice(0, 300) };
}

function actionOfFlex(a: FlexBlockAction | undefined, label: string): LineMessageLike | null {
  if (!a || a.kind === 'none') return null;
  if (a.kind === 'url') return { type: 'uri', label, uri: a.url };
  if (a.kind === 'tel') return { type: 'uri', label, uri: `tel:${a.value.replace(/[^\d+]/g, '')}` };
  if (a.kind === 'message') return { type: 'message', label, text: a.text };
  return null;
}

const IMAGE_LAYOUT_AREAS: Record<Exclude<ImageLayout, 'none' | 'custom'>, Array<[number, number, number, number]>> = {
  link1: [[0, 0, 1, 1]],
  link2: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]],
  link3: [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]],
  link4: [[0, 0, 1, 1 / 3], [0, 1 / 3, 1, 1 / 3], [0, 2 / 3, 1, 1 / 3]],
  link5: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
  link6: [[0, 0, 1, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
  link7: [[0, 0, 1, 0.5], [0, 0.5, 1, 0.25], [0, 0.75, 1, 0.25]],
  link8: [[0, 0, 1 / 3, 0.5], [1 / 3, 0, 1 / 3, 0.5], [2 / 3, 0, 1 / 3, 0.5], [0, 0.5, 1 / 3, 0.5], [1 / 3, 0.5, 1 / 3, 0.5], [2 / 3, 0.5, 1 / 3, 0.5]],
};

export const IMAGE_LAYOUT_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** 画像リンクの形(なし・カスタム以外)の、領域の位置と大きさ */
export function imageLayoutAreas(layout: ImageLayout): Array<[number, number, number, number]> {
  if (layout === 'none' || layout === 'custom') return [];
  return IMAGE_LAYOUT_AREAS[layout];
}

/** 画像のURLから、R2 のキー(`{uuid}.{ext}`)を取り出す */
export function imageKeyOf(url: string): string | null {
  const m = /\/images\/([^/?#]+)$/.exec(url);
  return m ? m[1] : null;
}

function withSender<T extends LineMessageLike>(msg: T, sender?: SenderInfo | null): T {
  if (!sender || (!sender.name && !sender.iconUrl)) return msg;
  const s: Record<string, string> = {};
  if (sender.name) s.name = sender.name.slice(0, 20);
  if (sender.iconUrl) s.iconUrl = sender.iconUrl;
  return { ...msg, sender: s };
}

function toCompiled(messages: LineMessageLike[], altText: string | null, preferred?: { type: 'flex'; contents: unknown } | { type: 'image'; content: string } | { type: 'text'; text: string }): CompiledTemplate {
  if (preferred?.type === 'text') return { messageType: 'text', messageContent: preferred.text, altText, messages };
  if (preferred?.type === 'image') return { messageType: 'image', messageContent: preferred.content, altText, messages };
  if (preferred?.type === 'flex') return { messageType: 'flex', messageContent: JSON.stringify(preferred.contents), altText, messages };
  return { messageType: 'flex', messageContent: JSON.stringify({ [TEMPLATE_RAW_KEY]: messages }), altText, messages };
}

function flexMessage(altText: string, contents: unknown, sender?: SenderInfo | null): LineMessageLike {
  return withSender({ type: 'flex', altText: altText.slice(0, 400) || DEFAULT_ALT, contents }, sender);
}

export function compileTemplate(editorType: EditorType, data: EditorData, ctx: CompileContext): CompiledTemplate {
  const sender = ctx.sender ?? null;
  switch (editorType) {
    case 'text': {
      const d = data as TextData;
      const parts = splitText(d.text ?? '');
      if (parts.length === 1 && !sender?.name && !sender?.iconUrl) {
        return toCompiled([{ type: 'text', text: parts[0] }], null, { type: 'text', text: parts[0] });
      }
      return toCompiled(parts.map((t) => withSender({ type: 'text', text: t }, sender)), null);
    }
    case 'sticker': {
      const d = data as StickerData;
      return toCompiled([withSender({ type: 'sticker', packageId: String(d.packageId), stickerId: String(d.stickerId) }, sender)], null);
    }
    case 'image': {
      const d = data as ImageData;
      if (d.layout === 'none' || !d.areas?.some((a) => a.kind !== 'none')) {
        const msg = withSender({ type: 'image', originalContentUrl: d.imageUrl, previewImageUrl: d.imageUrl }, sender);
        if (sender?.name || sender?.iconUrl) return toCompiled([msg], null);
        return toCompiled([msg], null, { type: 'image', content: JSON.stringify({ originalContentUrl: d.imageUrl, previewImageUrl: d.imageUrl }) });
      }
      const key = imageKeyOf(d.imageUrl);
      const width = 1040;
      const height = Math.max(1, Math.round(width * ((d.height ?? width) / (d.width ?? width))));
      const actions = d.areas
        .filter((a) => a.kind !== 'none')
        .map((a) => {
          const area = { x: Math.round(a.x * width), y: Math.round(a.y * height), width: Math.round(a.w * width), height: Math.round(a.h * height) };
          if (a.kind === 'url') return { type: 'uri', linkUri: a.url ?? '', area };
          return { type: 'message', text: (a.text ?? '').slice(0, 400), area };
        });
      const baseUrl = key ? `${ctx.workerUrl.replace(/\/$/, '')}/imagemap/${key}` : d.imageUrl;
      return toCompiled([withSender({ type: 'imagemap', baseUrl, altText: (d.altText || DEFAULT_ALT).slice(0, 1500), baseSize: { width, height }, actions }, sender)], d.altText || null);
    }
    case 'question': {
      const d = data as QuestionData;
      const tapLimited = (d.answerMode ?? 'single') === 'single';
      const out: LineMessageLike[] = [];
      if ((d.lead ?? '').trim()) out.push(withSender({ type: 'text', text: (d.lead ?? '').slice(0, 5000) }, sender));
      out.push(
        withSender(
          {
            type: 'template',
            altText: (d.altText || d.question || DEFAULT_ALT).slice(0, 400),
            template: {
              type: 'confirm',
              text: d.question.slice(0, 240),
              actions: d.choices.map((c, i) => choiceAction(ctx.templateId, 0, i, c, tapLimited, null)),
            },
          },
          sender,
        ),
      );
      return toCompiled(out, d.altText || null);
    }
    case 'carousel': {
      const d = data as CarouselData;
      const tapLimited = (d.tapLimit ?? 'carousel_once') !== 'none';
      const bubbles = d.panels.map((p, pi) => ({
        type: 'bubble',
        size: 'kilo',
        ...(p.imageUrl ? { hero: { type: 'image', url: p.imageUrl, size: 'full', aspectRatio: '1024:678', aspectMode: 'cover' } } : {}),
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            ...(p.title?.trim() ? [{ type: 'text', text: p.title.slice(0, 40), weight: 'bold', size: 'md', wrap: true }] : []),
            { type: 'text', text: p.text.slice(0, 120) || '　', size: 'sm', color: '#666666', wrap: true },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: p.choices.map((c, ci) => ({ type: 'button', style: 'link', height: 'sm', action: choiceAction(ctx.templateId, pi, ci, c, tapLimited, null) })),
        },
      }));
      const contents = bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles };
      const alt = d.altText || d.panels[0]?.title || d.panels[0]?.text || DEFAULT_ALT;
      if (sender?.name || sender?.iconUrl) return toCompiled([flexMessage(alt, contents, sender)], alt);
      return toCompiled([flexMessage(alt, contents)], alt, { type: 'flex', contents });
    }
    case 'location': {
      const d = data as LocationData;
      return toCompiled([withSender({ type: 'location', title: d.title.slice(0, 100), address: d.address.slice(0, 100), latitude: d.latitude ?? 0, longitude: d.longitude ?? 0 }, sender)], null);
    }
    case 'referral': {
      const d = data as ReferralData;
      const id = d.accountId.startsWith('@') ? d.accountId : `@${d.accountId}`;
      const contents = {
        type: 'bubble',
        size: 'kilo',
        body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: d.text.slice(0, 60), wrap: true, weight: 'bold' }] },
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [{ type: 'button', style: 'primary', color: '#06C755', action: { type: 'uri', label: '友だちに追加する', uri: `https://line.me/R/ti/p/${encodeURIComponent(id)}` } }],
        },
      };
      const alt = d.text || DEFAULT_ALT;
      if (sender?.name || sender?.iconUrl) return toCompiled([flexMessage(alt, contents, sender)], alt);
      return toCompiled([flexMessage(alt, contents)], alt, { type: 'flex', contents });
    }
    case 'audio': {
      const d = data as AudioData;
      return toCompiled([withSender({ type: 'audio', originalContentUrl: d.url, duration: Math.max(1, Math.round(d.durationMs)) }, sender)], null);
    }
    case 'video': {
      const d = data as VideoData;
      return toCompiled([withSender({ type: 'video', originalContentUrl: d.url, previewImageUrl: d.previewUrl }, sender)], null);
    }
    case 'flex': {
      const d = data as FlexEditorData;
      const contents = compileFlexPanels(d, ctx);
      const alt = d.altText || firstFlexText(d) || DEFAULT_ALT;
      if (sender?.name || sender?.iconUrl) return toCompiled([flexMessage(alt, contents, sender)], alt);
      return toCompiled([flexMessage(alt, contents)], alt, { type: 'flex', contents });
    }
  }
}

function firstFlexText(d: FlexEditorData): string {
  for (const p of d.panels) {
    for (const b of p.blocks) {
      if (b.type === 'title') return b.title;
      if (b.type === 'text') return b.text;
    }
  }
  return '';
}

const FLEX_MARGIN: Record<string, string> = { none: 'none', sm: 'sm', md: 'md', lg: 'lg' };
const FLEX_SHAPE_RATIO: Record<string, string> = { square: '1:1', wide: '20:13', tall: '3:4' };

function compileFlexPanels(d: FlexEditorData, ctx: CompileContext): unknown {
  const theme = d.themeColor || '#06C755';
  const tapLimited = (d.tapLimit ?? 'none') !== 'none';
  void tapLimited;
  const bubbles = d.panels.map((p, pIdx) => {
    const hero: unknown[] = [];
    const body: unknown[] = [];
    for (const [bi, b] of p.blocks.entries()) {
      const margin = FLEX_MARGIN[b.margin ?? 'md'];
      const box = (inner: unknown, extra: Record<string, unknown> = {}) => ({
        type: 'box',
        layout: 'vertical',
        margin,
        ...(b.background ? { backgroundColor: b.background } : {}),
        ...extra,
        contents: [inner],
      });
      if (b.type === 'title') {
        body.push(box({ type: 'text', text: b.title || '　', weight: 'bold', size: 'xl', wrap: true }));
        if (b.subtitle) body.push({ type: 'text', text: b.subtitle, size: 'sm', color: '#888888', wrap: true, margin: 'xs' });
      } else if (b.type === 'text') {
        body.push(box({ type: 'text', text: b.text || '　', size: 'sm', wrap: true }, b.border ? { borderWidth: 'light', borderColor: '#DDDDDD', paddingAll: 'md', cornerRadius: 'md' } : {}));
      } else if (b.type === 'button') {
        const action = actionOfFlex(b.action, trimLabel(b.label)) ?? { type: 'postback', label: trimLabel(b.label), data: templatePostbackData(ctx.templateId, pIdx, bi) };
        body.push({
          type: 'button',
          margin,
          style: b.styled ? 'primary' : 'link',
          ...(b.styled ? { color: b.background || theme } : {}),
          action,
        });
      } else if (b.type === 'image') {
        const action = actionOfFlex(b.action, trimLabel(b.actionLabel || b.label || '開く')) ?? (b.action?.kind === 'actions' ? { type: 'postback', label: trimLabel(b.actionLabel || b.label || '開く'), data: templatePostbackData(ctx.templateId, pIdx, bi) } : null);
        const img = {
          type: 'image',
          url: b.url,
          size: 'full',
          aspectMode: b.shape === 'fit' || !b.shape ? 'fit' : 'cover',
          ...(b.shape && b.shape !== 'fit' ? { aspectRatio: FLEX_SHAPE_RATIO[b.shape] ?? '20:13' } : {}),
          ...(action ? { action } : {}),
        };
        if (p.blocks[0] === b && !b.title && !b.subtitle && !b.label) hero.push(img);
        else {
          body.push({ ...img, margin });
          if (b.title) body.push({ type: 'text', text: b.title, weight: 'bold', wrap: true, margin: 'sm' });
          if (b.subtitle) body.push({ type: 'text', text: b.subtitle, size: 'sm', color: '#888888', wrap: true });
        }
      } else if (b.type === 'video') {
        const action = actionOfFlex(b.action, '再生') ?? (b.action?.kind === 'actions' ? { type: 'postback', label: '再生', data: templatePostbackData(ctx.templateId, pIdx, bi) } : null);
        hero.push({
          type: 'video',
          url: b.url,
          previewUrl: b.previewUrl,
          altContent: { type: 'image', size: 'full', aspectRatio: '16:9', aspectMode: 'cover', url: b.previewUrl },
          aspectRatio: '16:9',
          ...(action ? { action } : {}),
        });
      }
    }
    return {
      type: 'bubble',
      size: d.size ?? 'mega',
      ...(hero[0] ? { hero: hero[0] } : {}),
      ...(p.background ? { styles: { body: { backgroundColor: p.background } } } : {}),
      body: { type: 'box', layout: 'vertical', contents: body.length ? body : [{ type: 'text', text: '　' }] },
    };
  });
  return bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles };
}

// ─────────────────────────────────────────────────────────────
// 送るときの取り出し
// ─────────────────────────────────────────────────────────────

/** 'flex' の保存内容が「そのまま送る LINE メッセージ」の箱か。そうなら中身を返す */
export function parseRawMessages(messageType: string, messageContent: string): LineMessageLike[] | null {
  if (messageType !== 'flex') return null;
  try {
    const parsed = JSON.parse(messageContent) as Record<string, unknown>;
    const raw = parsed?.[TEMPLATE_RAW_KEY];
    if (Array.isArray(raw) && raw.length > 0) return raw as LineMessageLike[];
  } catch {
    /* 通常の Flex */
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// 検査(保存前)・一覧に出す文章
// ─────────────────────────────────────────────────────────────

export function validateTemplate(editorType: EditorType, data: EditorData): string[] {
  const errs: string[] = [];
  const need = (cond: unknown, msg: string) => {
    if (!cond) errs.push(msg);
  };
  switch (editorType) {
    case 'text': {
      const d = data as TextData;
      need((d.text ?? '').trim(), '本文を入力してください');
      need((d.text ?? '').length <= TEXT_MAX_LENGTH, `本文は${TEXT_MAX_LENGTH.toLocaleString('ja-JP')}文字までです`);
      break;
    }
    case 'sticker': {
      const d = data as StickerData;
      need(d.packageId && d.stickerId, 'スタンプを選択してください');
      break;
    }
    case 'image': {
      const d = data as ImageData;
      need(d.imageUrl, '画像を選択してください');
      for (const [i, a] of (d.areas ?? []).entries()) {
        const name = IMAGE_LAYOUT_LABELS[i] ?? String(i + 1);
        if (a.kind === 'url') need((a.url ?? '').trim(), `領域${name}のURLを入力してください`);
        if (a.kind === 'message') need((a.text ?? '').trim(), `領域${name}のユーザーメッセージを入力してください`);
      }
      break;
    }
    case 'question': {
      const d = data as QuestionData;
      need((d.question ?? '').trim(), '質問文を入力してください');
      need((d.question ?? '').length <= 160, '質問文は160文字までです');
      d.choices.forEach((c, i) => {
        need((c.label ?? '').trim(), `選択肢${i + 1}を入力してください`);
        errs.push(...validateBehavior(c.behavior, `選択肢${i + 1}`));
      });
      break;
    }
    case 'carousel': {
      const d = data as CarouselData;
      need(d.panels.length >= 1 && d.panels.length <= 10, 'パネルは1〜10枚です');
      d.panels.forEach((p, pi) => {
        need((p.text ?? '').trim(), `パネル#${pi + 1}の本文を入力してください`);
        need(p.choices.length >= 1 && p.choices.length <= 4, `パネル#${pi + 1}の選択肢は1〜4つです`);
        p.choices.forEach((c, ci) => {
          need((c.label ?? '').trim(), `パネル#${pi + 1}の選択肢${ci + 1}の名前を入力してください`);
          errs.push(...validateBehavior(c.behavior, `パネル#${pi + 1}の選択肢${ci + 1}`));
        });
      });
      break;
    }
    case 'location': {
      const d = data as LocationData;
      need((d.title ?? '').trim(), 'タイトルを入力してください');
      need((d.address ?? '').trim(), '表示する住所を入力してください');
      need(d.latitude != null && d.longitude != null, '地図でピンを置いてください');
      break;
    }
    case 'referral': {
      const d = data as ReferralData;
      need((d.text ?? '').trim(), '紹介文を入力してください');
      need((d.accountId ?? '').trim(), '紹介するLINEアカウントIDを入力してください');
      break;
    }
    case 'audio': {
      const d = data as AudioData;
      need(d.url, '音声を選択してください');
      break;
    }
    case 'video': {
      const d = data as VideoData;
      need(d.url, '動画を選択してください');
      need(d.previewUrl, 'サムネイルを選択してください');
      break;
    }
    case 'flex': {
      const d = data as FlexEditorData;
      need(d.panels.length >= 1 && d.panels.length <= 10, 'パネルは1〜10枚です');
      d.panels.forEach((p, pi) => {
        need(p.blocks.length >= 1, `パネル${pi + 1}にブロックを追加してください`);
        p.blocks.forEach((b, bi) => {
          const at = `パネル${pi + 1}のブロック${bi + 1}`;
          if (b.type === 'title') need(b.title.trim(), `${at}(タイトル)を入力してください`);
          if (b.type === 'text') need(b.text.trim(), `${at}(テキスト)を入力してください`);
          if (b.type === 'button') {
            need(b.label.trim(), `${at}(ボタン)の名前を入力してください`);
            need(b.action.kind !== 'none', `${at}(ボタン)のアクションを設定してください`);
          }
          if (b.type === 'image') need(b.url, `${at}(画像)を選択してください`);
          if (b.type === 'video') need(b.url && b.previewUrl, `${at}(動画)を選択してください`);
        });
      });
      break;
    }
  }
  return errs;
}

function validateBehavior(b: ChoiceBehavior, at: string): string[] {
  const need = (cond: unknown, msg: string) => (cond ? [] : [msg]);
  switch (b.kind) {
    case 'url':
      return need((b.value ?? '').trim(), `${at}のURLを入力してください`);
    case 'tel':
      return need((b.value ?? '').trim(), `${at}の電話番号を入力してください`);
    case 'friend_add':
      return need((b.value ?? '').trim(), `${at}のLINEアカウントIDを入力してください`);
    case 'mail':
      return need((b.value ?? '').trim(), `${at}のメールアドレスを入力してください`);
    case 'form':
      return need((b.value ?? '').trim(), `${at}の回答フォームを選択してください`);
    case 'scenario':
      return need((b.value ?? '').trim(), `${at}のシナリオを選択してください`);
    default:
      return [];
  }
}

/** 一覧の行・プレビューに出す、本文の頭(1行) */
export function describeTemplate(editorType: EditorType | null, data: unknown, fallback = ''): string {
  try {
    switch (editorType) {
      case 'text':
        return firstLine((data as TextData).text);
      case 'sticker':
        return '[スタンプ]';
      case 'image':
        return '[画像]';
      case 'question':
        return firstLine((data as QuestionData).question);
      case 'carousel': {
        const p = (data as CarouselData).panels?.[0];
        return `[カルーセル] ${firstLine(p?.title || p?.text || '')}`.trim();
      }
      case 'location':
        return `[位置情報] ${(data as LocationData).title}`.trim();
      case 'referral':
        return firstLine((data as ReferralData).text);
      case 'audio':
        return '[音声]';
      case 'video':
        return '[動画]';
      case 'flex':
        return `【フレックスメッセージ】${firstLine(firstFlexText(data as FlexEditorData))}`;
      default:
        return fallback;
    }
  } catch {
    return fallback;
  }
}

function firstLine(s: string | undefined | null): string {
  return (s ?? '').split('\n').find((l) => l.trim()) ?? '';
}

/** 新規の入力データ(各タブを開いたときの初期値) */
export function emptyEditorData(editorType: EditorType): EditorData {
  const choice = (label = ''): ChoiceDef => ({ label, behavior: { kind: 'none' }, reply: { mode: 'text', text: '' }, repeatReply: { mode: 'text', text: '' } });
  switch (editorType) {
    case 'text':
      return { text: '', urlSettings: { links: [] } } satisfies TextData;
    case 'sticker':
      return { packageId: '', stickerId: '' } satisfies StickerData;
    case 'image':
      return { imageUrl: '', layout: 'none', areas: [] } satisfies ImageData;
    case 'question':
      return { question: '', choices: [choice(), choice()], answerMode: 'single' } satisfies QuestionData;
    case 'carousel':
      return { panels: [{ title: '', text: '', choices: [choice()] }], tapLimit: 'carousel_once', limitScope: 'same', limitReply: 'default' } satisfies CarouselData;
    case 'location':
      return { title: '', address: '', latitude: null, longitude: null } satisfies LocationData;
    case 'referral':
      return { text: '', accountId: '' } satisfies ReferralData;
    case 'audio':
      return { url: '', durationMs: 0 } satisfies AudioData;
    case 'video':
      return { url: '', previewUrl: '' } satisfies VideoData;
    case 'flex':
      return { panels: [{ blocks: [] }], themeColor: '#06C755', size: 'mega' } satisfies FlexEditorData;
  }
}
