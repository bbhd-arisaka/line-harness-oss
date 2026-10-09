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
  stats?: { friendCount: number; activeScenarios: number; messagesThisMonth: number };
}

/** GET /api/app/push-settings: この端末の通知設定。通知の種類の一覧(kinds)はサーバーが返す */
export interface PushSettings {
  mutedAccountIds: string[];
  mutedKinds: string[];
  kinds: { key: string; label: string; description: string }[];
}

/** chats.status: unread=未対応 / in_progress=対応中 / resolved=対応済み */
export type ChatStatus = 'unread' | 'in_progress' | 'resolved';

/** GET /api/chats の1件。id は friend_id と同じ */
export interface ChatSummary {
  id: string;
  friendId: string;
  friendName: string;
  friendPictureUrl: string | null;
  operatorId: string | null;
  status: ChatStatus;
  notes: string | null;
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

/** PUT /api/friends/:id/profile のリクエスト(送った項目だけ更新される。本名・システム表示名は20文字まで) */
export interface FriendProfileInput {
  realName?: string | null;
  systemDisplayName?: string | null;
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
  systemDisplayName: string | null;
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
  page: number;
  limit: number;
  hasNextPage: boolean;
}

/** GET /api/friends/:id(フォーム回答つき。アプリでは使わない部分は省略) */
export type FriendDetail = Friend;

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
