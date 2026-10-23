// beyond line の API の応答の型(apps/worker/src/routes/*.ts の実装を読んで合わせたもの)。
// リポジトリ内の他パッケージ(@line-crm/shared)には依存しない。

export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export type StaffRole = 'owner' | 'admin' | 'staff' | string;

export interface Staff {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
}

/** POST /api/app/login の data */
export interface LoginResult {
  token: string;
  expiresAt: string;
  staff: Staff;
}

/** GET /api/line-accounts の1件(許可されたアカウントだけ返る。秘密情報は含まれない) */
export interface LineAccount {
  id: string;
  channelId: string;
  name: string;
  isActive: boolean;
  displayName: string;
  pictureUrl: string | null;
  basicId: string | null;
  /** Lステップと並行運用中のとき、転送先の URL(自動送信はしない。一斉配信は送れる) */
  lstepForwardUrl?: string | null;
  stats?: { friendCount: number; activeScenarios: number; messagesThisMonth: number };
}

/** GET /api/broadcasts の1件 */
export interface BroadcastItem {
  id: string;
  title: string;
  messageType: string;
  messageContent: string;
  targetType: string;
  targetTagId: string | null;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  totalCount: number;
  successCount: number;
  lineAccountId: string | null;
  /** 配信するメッセージの全部(1通目+2通目以降。最大5通)。順番がそのまま配信順。古いサーバーでは無い */
  messages?: Array<{ type: string; content: string; altText?: string | null }>;
  messageCount?: number;
  /** 条件で絞り込んだ配信のとき、保存された条件 */
  segmentConditions: { operator?: string; rules?: unknown[] } | null;
  lastError: string | null;
  createdAt: string;
  /** LINEが集計した開封・クリック(配信の翌日から)。まだ取れていないときは null。古いサーバーでは無い */
  insight?: BroadcastInsight | null;
}

/** 配信の開封・クリック(人数と、配信した人に対する割合 0〜1) */
export interface BroadcastInsight {
  delivered: number | null;
  uniqueImpression: number | null;
  uniqueClick: number | null;
  openRate: number | null;
  clickRate: number | null;
}

/** GET /api/broadcasts/:id/progress */
export interface BroadcastProgress {
  status: string;
  totalCount: number;
  successCount: number;
  batchOffset: number;
}

/** GET /api/forms の1件(配信の本文に、回答フォームのリンクを入れるときの選択肢) */
export interface FormOption {
  id: string;
  name: string;
  isActive?: boolean;
}

/** GET /api/templates の1件(トークから送れるテンプレート) */
export interface TemplateOption {
  id: string;
  name: string;
  category?: string;
  /** text / flex / image */
  messageType: string;
  /** text=本文(差し込みのタグコードつき)・image=LINE が求める JSON の文字列・flex=Flex の JSON */
  messageContent: string;
}

/** GET /api/tags の1件 */
export interface TagItem {
  id: string;
  name: string;
  color?: string | null;
}

/** GET /api/line-accounts/:id/friend-add: 友だち追加用の URL と QR コード(PNG を base64 で) */
export interface FriendAddInfo {
  accountId: string;
  name: string;
  basicId: string;
  url: string;
  qrPngBase64: string;
}

/** GET /api/chats/:id/form-answers/:submissionId: フォームの回答結果 */
export interface FormAnswerDetail {
  submissionId: string;
  formId: string;
  formName: string;
  friendId: string;
  friendName: string;
  answeredAt: string;
  items: { label: string; value: string; isFile?: boolean }[];
}

/** GET /api/app/push-settings: この端末の通知設定。通知の種類の一覧(kinds)はサーバーが返す */
export interface PushSettings {
  mutedAccountIds: string[];
  /** accountId を付けて取ったとき: その公式アカウントの通知を止めているか */
  accountMuted?: boolean;
  /** 止めている通知の種類(accountId を付けたときは、その公式アカウントの設定) */
  mutedKinds: string[];
  kinds: { key: string; label: string; description: string }[];
}

/** chats.status: unread=未対応 / in_progress=対応中 / resolved=対応済み */
export type ChatStatus = 'unread' | 'in_progress' | 'resolved';

/** GET /api/chats/message-search の1件(友だちごとに、新しい該当メッセージ1件) */
export interface MessageSearchHit {
  friendId: string;
  name: string;
  displayName: string | null;
  pictureUrl: string | null;
  direction: string;
  snippet: string;
  createdAt: string;
  /** その友だちの該当メッセージの数 */
  hits: number;
}

/** GET /api/chats の1件。id は friend_id と同じ */
export interface ChatSummary {
  id: string;
  friendId: string;
  friendName: string;
  friendPictureUrl: string | null;
  operatorId: string | null;
  status: ChatStatus;
  notes: string | null;
  /** ピン留め中(一覧の上に出る) */
  pinned?: boolean;
  lastMessageAt: string | null;
  /** text のときだけ本文(先頭200文字)。それ以外は null */
  lastMessageContent: string | null;
  lastMessageDirection: 'incoming' | 'outgoing' | null;
  lastMessageType: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ChatMessage {
  id: string;
  direction: 'incoming' | 'outgoing';
  /** text / image / sticker / flex / audio / video / file / location など */
  messageType: string;
  /** text=本文、image=JSON({originalContentUrl,previewImageUrl}) か "[画像]"、flex=JSON、sticker=JSON か "[スタンプ]" */
  content: string;
  createdAt: string;
  /** 送信の出どころ: manual=スタッフの手動 / system=一斉配信・シナリオ・自動応答など(受信・古いサーバーは無し) */
  origin?: 'manual' | 'system' | null;
}

/** トークに残る出来事のログ(タグ・ブロック・フォーム回答など)。type は増えるので string */
export interface ChatEvent {
  id: string;
  type: string;
  /** 表示用に完成した日本語 */
  text: string;
  /** 操作した人(スタッフ名・システム・フォーム・自動・LINE)。無ければ null */
  actor: string | null;
  createdAt: string;
}

/** GET /api/chats/:id */
export interface ChatDetail {
  id: string;
  friendId: string;
  friendName: string;
  friendPictureUrl: string | null;
  /** ピン留め中 */
  pinned?: boolean;
  /** false = ブロックされている(送信できない)。古いサーバーでは無い */
  isFollowing?: boolean;
  operatorId: string | null;
  status: ChatStatus;
  notes: string | null;
  lastMessageAt: string | null;
  createdAt: string | null;
  messages: ChatMessage[];
  /** 出来事のログ(時刻の昇順)。古いサーバーでは無い */
  events?: ChatEvent[];
}

/** PUT /api/chats/:id の data */
export interface UpdatedChat {
  id: string;
  friendId: string;
  operatorId: string | null;
  status: ChatStatus;
  notes: string | null;
}

/** PUT /api/friends/:id/profile のリクエスト(送った項目だけ更新される。本名は20文字まで) */
export interface FriendProfileInput {
  realName?: string | null;
  memo?: string | null;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  createdAt?: string;
}

/** GET /api/friends の1件(includeChatStatus なし) */
export interface Friend {
  id: string;
  lineUserId: string;
  displayName: string | null;
  pictureUrl: string | null;
  statusMessage: string | null;
  isFollowing: boolean;
  metadata: Record<string, unknown>;
  realName: string | null;
  memo: string | null;
  refCode: string | null;
  lineAccountId: string | null;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
  tags: Tag[];
}

/** GET /api/friends */
export interface FriendPage {
  items: Friend[];
  total: number;
  /** 友だち中の人数(ブロック中を除く)。公式アカウントを指定した1ページ目だけ付く */
  followingTotal?: number;
  page: number;
  limit: number;
  hasNextPage: boolean;
}

/** GET /api/friends/:id(フォーム回答つき。アプリでは使わない部分は省略) */
export type FriendDetail = Friend & {
  /** 流入経路分析の流入経路(この友だちの流入経路)。無ければ null */
  inflowRoute?: { id: string; name: string } | null;
};

/** GET /api/friend-fields/definitions の1件(友だち情報欄の定義) */
export interface FriendFieldDefinition {
  id: string;
  folderId: string | null;
  fieldKey: string;
  label: string;
  fieldType: string;
  options: string[];
  optionColors?: string[];
  displayOrder: number;
}

/** GET /api/friend-fields/folders の1件(友だち情報欄のフォルダ) */
export interface FriendFieldFolder {
  id: string;
  name: string;
  displayOrder: number;
}

/** GET /api/friends/:id/rich-menu */
export interface FriendRichMenu {
  id: string | null;
  name: string | null;
  isDefault: boolean;
  chatBarText: string | null;
  groupName: string | null;
  pageName: string | null;
  accountId: string | null;
}
