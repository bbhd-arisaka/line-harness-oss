import { Hono } from 'hono';
import type { Env } from '../index.js';

const openapi = new Hono<Env>();

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'LINE OSS CRM API',
    version: '0.2.0',
    description: 'Open-source LINE Official Account CRM/marketing automation API. API-first design for Claude Code / AI agent integration.',
    license: { name: 'MIT' },
  },
  servers: [{ url: '/', description: 'Current server' }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'API Key passed as Bearer token',
      },
    },
    schemas: {
      ApiResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: {},
          error: { type: 'string' },
        },
      },
      Friend: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          lineUserId: { type: 'string' },
          displayName: { type: 'string', nullable: true },
          pictureUrl: { type: 'string', nullable: true },
          statusMessage: { type: 'string', nullable: true },
          isFollowing: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          tags: { type: 'array', items: { $ref: '#/components/schemas/Tag' } },
        },
      },
      Tag: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          color: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Scenario: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          description: { type: 'string', nullable: true },
          triggerType: { type: 'string', enum: ['friend_add', 'tag_added', 'manual'] },
          triggerTagId: { type: 'string', nullable: true },
          isActive: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ScenarioStep: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          scenarioId: { type: 'string' },
          stepOrder: { type: 'integer' },
          delayMinutes: { type: 'integer' },
          messageType: { type: 'string', enum: ['text', 'image', 'flex'] },
          messageContent: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Broadcast: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          messageType: { type: 'string', enum: ['text', 'image', 'flex'] },
          messageContent: { type: 'string' },
          targetType: { type: 'string', enum: ['all', 'tag', 'segment', 'multi-account-dedup'] },
          targetTagId: { type: 'string', nullable: true },
          accountIds: { type: 'array', items: { type: 'string' }, nullable: true },
          dedupPriority: { type: 'array', items: { type: 'string' }, nullable: true },
          failedAccountIds: { type: 'array', items: { type: 'string' }, nullable: true },
          status: { type: 'string', enum: ['draft', 'scheduled', 'sending', 'sent'] },
          scheduledAt: { type: 'string', nullable: true },
          sentAt: { type: 'string', nullable: true },
          totalCount: { type: 'integer' },
          successCount: { type: 'integer' },
          lastError: {
            type: 'string',
            nullable: true,
            description: '直近の送信失敗理由 (LINE プランクォータ不足ガード等)。送信成功で null に戻る。',
          },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', nullable: true },
          phone: { type: 'string', nullable: true },
          externalId: { type: 'string', nullable: true },
          displayName: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      LineAccount: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          channelId: { type: 'string' },
          name: { type: 'string' },
          isActive: { type: 'boolean' },
          country: { type: 'string', nullable: true },
          role: { type: 'string', nullable: true },
          displayOrder: { type: 'integer' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ConversionPoint: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          eventType: { type: 'string' },
          value: { type: 'number', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      ConversionEvent: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          conversionPointId: { type: 'string' },
          friendId: { type: 'string' },
          userId: { type: 'string', nullable: true },
          affiliateCode: { type: 'string', nullable: true },
          metadata: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Affiliate: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          code: { type: 'string' },
          commissionRate: { type: 'number' },
          isActive: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      AffiliateReport: {
        type: 'object',
        properties: {
          affiliateId: { type: 'string' },
          affiliateName: { type: 'string' },
          code: { type: 'string' },
          commissionRate: { type: 'number' },
          totalClicks: { type: 'integer' },
          totalConversions: { type: 'integer' },
          totalRevenue: { type: 'number' },
        },
      },
    },
  },
  paths: {
    // ── Friends ─────────────────────────────────────────────────────────────
    '/api/friends': {
      get: {
        tags: ['Friends'],
        summary: '友だち一覧取得',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          { name: 'tagId', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Paginated friends list' } },
      },
    },
    '/api/friends/count': {
      get: { tags: ['Friends'], summary: '友だち数取得', responses: { '200': { description: 'Count' } } },
    },
    '/api/friends/{id}': {
      get: {
        tags: ['Friends'],
        summary: '友だち詳細取得',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Friend with tags' }, '404': { description: 'Not found' } },
      },
    },
    '/api/friends/{id}/tags': {
      post: {
        tags: ['Friends'],
        summary: '友だちにタグ追加',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { tagId: { type: 'string' } }, required: ['tagId'] } } } },
        responses: { '201': { description: 'Tag added' } },
      },
    },
    '/api/friends/{id}/tags/{tagId}': {
      delete: {
        tags: ['Friends'],
        summary: '友だちからタグ削除',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'tagId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Tag removed' } },
      },
    },
    // ── Tags ────────────────────────────────────────────────────────────────
    '/api/tags': {
      get: { tags: ['Tags'], summary: 'タグ一覧取得', responses: { '200': { description: 'All tags' } } },
      post: {
        tags: ['Tags'],
        summary: 'タグ作成',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, color: { type: 'string' } }, required: ['name'] } } } },
        responses: { '201': { description: 'Tag created' } },
      },
    },
    '/api/tags/{id}': {
      delete: {
        tags: ['Tags'],
        summary: 'タグ削除',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Tag deleted' } },
      },
    },
    // ── Scenarios ────────────────────────────────────────────────────────────
    '/api/scenarios': {
      get: { tags: ['Scenarios'], summary: 'シナリオ一覧取得', responses: { '200': { description: 'All scenarios' } } },
      post: {
        tags: ['Scenarios'],
        summary: 'シナリオ作成',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, triggerType: { type: 'string' }, description: { type: 'string' }, triggerTagId: { type: 'string' }, isActive: { type: 'boolean' } }, required: ['name', 'triggerType'] } } } },
        responses: { '201': { description: 'Scenario created' } },
      },
    },
    '/api/scenarios/{id}': {
      get: {
        tags: ['Scenarios'],
        summary: 'シナリオ詳細取得 (ステップ含む)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Scenario with steps' } },
      },
      put: {
        tags: ['Scenarios'],
        summary: 'シナリオ更新',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Updated' } },
      },
      delete: {
        tags: ['Scenarios'],
        summary: 'シナリオ削除',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/scenarios/{id}/enrollments': {
      get: {
        tags: ['Scenarios'],
        summary: 'エンロール個票（今どこで、なぜ止まっているか）',
        description:
          '`stats` は「何人が進行中か」しか返さないため、配信が進まないときに原因を特定できない。\n' +
          'こちらは1人ずつ **現在ステップ / 次の配信予定 / 次ステップの条件** まで返す。\n\n' +
          '`nextStep.nextStepOnFalse` が `null` のとき、条件が false でも**順次次のステップへ進む**\n' +
          '（待機はしない）。分岐させたい場合だけ step_order を指定する。\n\n' +
          'クエリ: `status`（active/paused/completed 等で絞り込み）、`limit`（既定100・最大500）。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'status', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 100, maximum: 500 } },
        ],
        responses: { '200': { description: 'Enrollments' }, '404': { description: 'Scenario not found' } },
      },
    },
    '/api/scenarios/{id}/steps': {
      post: {
        tags: ['Scenarios'],
        summary: 'ステップ追加',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '201': { description: 'Step created' } },
      },
    },
    '/api/scenarios/{id}/steps/{stepId}': {
      put: {
        tags: ['Scenarios'],
        summary: 'ステップ更新',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'stepId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Updated' } },
      },
      delete: {
        tags: ['Scenarios'],
        summary: 'ステップ削除',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'stepId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/scenarios/{id}/enroll/{friendId}': {
      post: {
        tags: ['Scenarios'],
        summary: '手動エンロール',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'friendId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '201': { description: 'Enrolled' } },
      },
    },
    // ── Broadcasts ───────────────────────────────────────────────────────────
    '/api/broadcasts': {
      get: { tags: ['Broadcasts'], summary: '配信一覧取得', responses: { '200': { description: 'All broadcasts' } } },
      post: {
        tags: ['Broadcasts'],
        summary: '配信作成',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' }, messageType: { type: 'string' }, messageContent: { type: 'string' }, targetType: { type: 'string' }, targetTagId: { type: 'string' }, accountIds: { type: 'array', items: { type: 'string' } }, dedupPriority: { type: 'array', items: { type: 'string' } }, scheduledAt: { type: 'string' } }, required: ['title', 'messageType', 'messageContent', 'targetType'] } } } },
        responses: { '201': { description: 'Broadcast created' } },
      },
    },
    '/api/broadcasts/{id}': {
      get: {
        tags: ['Broadcasts'],
        summary: '配信詳細取得',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Broadcast' } },
      },
      put: { tags: ['Broadcasts'], summary: '配信更新', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Updated' } } },
      delete: { tags: ['Broadcasts'], summary: '配信削除', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Deleted' } } },
    },
    '/api/broadcasts/{id}/send': {
      post: {
        tags: ['Broadcasts'],
        summary: '即時配信',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Sent' } },
      },
    },
    '/api/broadcasts/dedup-preview': {
      post: {
        tags: ['Broadcasts'],
        summary: '複数アカ重複除外の事前プレビュー',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  accountIds: { type: 'array', items: { type: 'string' } },
                  dedupPriority: { type: 'array', items: { type: 'string' } },
                },
                required: ['accountIds', 'dedupPriority'],
              },
            },
          },
        },
        responses: { '200': { description: 'Preview computed (totalSelected, uniqueRecipients, reduction, perAccount)' } },
      },
    },
    // ── Users (UUID Cross-Account) ──────────────────────────────────────────
    '/api/users': {
      get: { tags: ['Users'], summary: '内部ユーザー一覧取得', responses: { '200': { description: 'All users' } } },
      post: {
        tags: ['Users'],
        summary: '内部ユーザー作成',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string' }, phone: { type: 'string' }, externalId: { type: 'string' }, displayName: { type: 'string' } } } } } },
        responses: { '201': { description: 'User created' } },
      },
    },
    '/api/users/match': {
      post: {
        tags: ['Users'],
        summary: 'メール/電話でユーザー検索',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string' }, phone: { type: 'string' } } } } } },
        responses: { '200': { description: 'Matched user' }, '404': { description: 'Not found' } },
      },
    },
    '/api/users/{id}': {
      get: { tags: ['Users'], summary: 'ユーザー詳細取得', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'User' } } },
      put: { tags: ['Users'], summary: 'ユーザー更新', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Updated' } } },
      delete: { tags: ['Users'], summary: 'ユーザー削除', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Deleted' } } },
    },
    '/api/users/{id}/link': {
      post: {
        tags: ['Users'],
        summary: '友だちをUUIDにリンク',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { friendId: { type: 'string' } }, required: ['friendId'] } } } },
        responses: { '200': { description: 'Linked' } },
      },
    },
    '/api/users/{id}/accounts': {
      get: {
        tags: ['Users'],
        summary: 'UUID紐付き友だち一覧',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Linked friends/accounts' } },
      },
    },
    // ── LINE Accounts ───────────────────────────────────────────────────────
    '/api/line-accounts': {
      get: { tags: ['LINE Accounts'], summary: 'LINEアカウント一覧', responses: { '200': { description: 'All LINE accounts' } } },
      post: {
        tags: ['LINE Accounts'],
        summary: 'LINEアカウント登録',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { channelId: { type: 'string' }, name: { type: 'string' }, channelAccessToken: { type: 'string' }, channelSecret: { type: 'string' } }, required: ['channelId', 'name', 'channelAccessToken', 'channelSecret'] } } } },
        responses: { '201': { description: 'Account created' } },
      },
    },
    '/api/line-accounts/delivery-health': {
      get: {
        tags: ['LINE Accounts'],
        summary: 'アカウント別 配信健全性 (クォータ残・友だち/ブロック前日比・今月配信数)',
        description:
          'アクティブな全アカウントについて、LINE 月間クォータ (上限/消費/残り) と前日時点の友だち数・ブロック数 (前日比つき)、当月の push 配信数を一括で返す。残クォータが配信可能友だち数を下回ると quotaAlert=true (全員配信が完走できない状態)。',
        responses: { '200': { description: 'Per-account delivery health snapshot' } },
      },
    },
    '/api/line-accounts/order': {
      patch: {
        tags: ['LINE Accounts'],
        summary: 'アカウント表示順を一括更新 (drag-drop reorder)',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  ordered: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        displayOrder: { type: 'integer' },
                      },
                      required: ['id', 'displayOrder'],
                    },
                  },
                },
                required: ['ordered'],
              },
            },
          },
        },
        responses: { '200': { description: 'Order updated' } },
      },
    },
    '/api/imports': {
      get: { tags: ['Imports'], summary: 'データ引き継ぎの実行履歴(オーナー専用)', responses: { '200': { description: 'Import batches' } } },
    },
    '/api/imports/lstep/plan': {
      post: {
        tags: ['Imports'],
        summary: 'Lステップ引き継ぎの計画(何も書き込まない・オーナー専用)',
        description: '取り込み用データを検証し、作られる友だち情報欄・タグ、変わる友だちの件数を返す。',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['definitions'], properties: { definitions: { type: 'object' }, friends: { type: 'array', items: { type: 'object' } } } } } } },
        responses: { '200': { description: 'Plan' }, '400': { description: 'Invalid dataset' }, '404': { description: 'Account not found' } },
      },
    },
    '/api/imports/lstep/start': {
      post: {
        tags: ['Imports'],
        summary: 'Lステップ引き継ぎを開始し、友だち情報欄・タグを作る(オーナー専用)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['definitions'], properties: { definitions: { type: 'object' } } } } } },
        responses: { '201': { description: 'Batch created (batchId)' }, '400': { description: 'Invalid dataset' }, '404': { description: 'Account not found' } },
      },
    },
    '/api/imports/lstep/{batchId}/friends': {
      post: {
        tags: ['Imports'],
        summary: '友だちの本名・友だち情報・タグを反映する(1回100人まで・オーナー専用)',
        parameters: [{ name: 'batchId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['friends'], properties: { friends: { type: 'array', items: { type: 'object' } } } } } } },
        responses: { '200': { description: 'Applied counts' }, '400': { description: 'Invalid friends' }, '404': { description: 'Batch not found' }, '409': { description: 'Batch already finished' } },
      },
    },
    '/api/imports/lstep/{batchId}/forms': {
      post: {
        tags: ['Imports'],
        summary: 'フォームの代入先(登録先)を直し、足りない隠し項目を足す(オーナー専用)',
        description: '変更前のフォーム定義を記録し、「元に戻す」で復元できる。',
        parameters: [{ name: 'batchId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['configs'], properties: { configs: { type: 'array', items: { type: 'object' } } } } } } },
        responses: { '200': { description: 'Applied counts' }, '400': { description: 'Invalid configs' }, '404': { description: 'Batch not found' }, '409': { description: 'Batch already finished' } },
      },
    },
    '/api/imports/lstep/{batchId}/submissions': {
      post: {
        tags: ['Imports'],
        summary: 'Lステップの回答結果を回答履歴に取り込む(1回100件まで・同じ回答は2回入らない・オーナー専用)',
        parameters: [{ name: 'batchId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['submissions'], properties: { submissions: { type: 'array', items: { type: 'object' } } } } } } },
        responses: { '200': { description: 'Added / skipped / detached counts' }, '400': { description: 'Invalid submissions' }, '404': { description: 'Batch not found' }, '409': { description: 'Batch already finished' } },
      },
    },
    '/api/imports/lstep/{batchId}/messages': {
      post: {
        tags: ['Imports'],
        summary: 'Lステップのトーク履歴を取り込む(1回200件まで・同じメッセージは2回入らない・オーナー専用)',
        description: '取り込んだメッセージには取り込みバッチの印を付け、「元に戻す」で、その分だけを消せる。トークの未読・未対応の表示は変えない。',
        parameters: [{ name: 'batchId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['messages'], properties: { messages: { type: 'array', items: { type: 'object' } } } } } } },
        responses: { '200': { description: 'Added / skipped counts' }, '400': { description: 'Invalid messages' }, '404': { description: 'Batch not found' }, '409': { description: 'Batch already finished' } },
      },
    },
    '/api/friend-searches': {
      get: {
        tags: ['Friends'],
        summary: '保存した検索の一覧(アカウントごと)',
        parameters: [{ name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Saved searches' }, '400': { description: 'lineAccountId is required' }, '403': { description: 'Account not allowed' } },
      },
      post: {
        tags: ['Friends'],
        summary: '検索条件を保存(Lステップの「この条件を保存」相当)',
        description: 'filter は、友だちリストの詳細検索の条件(GET /api/friends の filter と同じ形)。検証してから保存する。',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['lineAccountId', 'name', 'filter'], properties: { lineAccountId: { type: 'string' }, name: { type: 'string' }, filter: { type: 'object' } } } } } },
        responses: { '201': { description: 'Created' }, '400': { description: 'Invalid request' }, '403': { description: 'Account not allowed' } },
      },
    },
    '/api/friend-searches/{id}': {
      delete: {
        tags: ['Friends'],
        summary: '保存した検索を削除',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' }, '404': { description: 'Not found' } },
      },
    },
    '/api/notification-settings': {
      get: {
        tags: ['Notifications'],
        summary: '通知設定の一覧(公式アカウントごと・管理者以上)。1つも無い古いアカウントは、標準の設定をオフで作る',
        parameters: [{ name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Settings' }, '400': { description: 'lineAccountId missing' }, '403': { description: 'Account not allowed' } },
      },
      post: {
        tags: ['Notifications'],
        summary: '通知設定を作る(通知先は、beyond admin に登録・検証済みの宛先だけ)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['lineAccountId', 'title', 'timings', 'destinations'], properties: { lineAccountId: { type: 'string' }, title: { type: 'string' }, status: { type: 'string', enum: ['on', 'off'] }, schedule: { type: 'object' }, timings: { type: 'array', items: {} }, filterTagIds: { type: 'array', items: { type: 'string' } }, destinations: { type: 'array', items: { type: 'object' } } } } } } },
        responses: { '201': { description: 'Created' }, '400': { description: 'Invalid input / unknown destination' }, '403': { description: 'Account not allowed' } },
      },
    },
    '/api/notification-settings/catalog': {
      get: { tags: ['Notifications'], summary: '選べる通知タイミングの一覧(Lステップと同じ分け方)', responses: { '200': { description: 'Catalog' } } },
    },
    '/api/notification-settings/{id}': {
      put: {
        tags: ['Notifications'],
        summary: '通知設定を更新する(オン/オフの切り替えも)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { '200': { description: 'Updated' }, '400': { description: 'Invalid input' }, '404': { description: 'Not found' } },
      },
      delete: {
        tags: ['Notifications'],
        summary: '通知設定を削除する',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' }, '404': { description: 'Not found' } },
      },
    },
    '/api/notification-settings/{id}/test': {
      post: {
        tags: ['Notifications'],
        summary: 'テスト通知を、その設定の通知先すべてへ送る',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Results per destination' }, '400': { description: 'beyond admin not linked' }, '404': { description: 'Not found' } },
      },
    },
    '/api/notification-settings/{id}/deliveries': {
      get: {
        tags: ['Notifications'],
        summary: '直近の通知の送信記録(失敗の確認用)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Recent deliveries' }, '404': { description: 'Not found' } },
      },
    },
    '/api/friends/{id}/refresh-profile': {
      post: { tags: ['Friends'], summary: 'プロフィール画像などを、LINEから取り直す(画像が出なかったとき用。1時間以内に取り直していればLINEには聞かない)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Refreshed profile' }, '404': { description: 'Friend not found' } } },
    },
    '/api/reserve/calendars': {
      get: { tags: ['Reserve'], summary: 'カレンダー予約: カレンダーの一覧(稼働状態・承認待ち件数・予約URL)', responses: { '200': { description: 'OK' } } },
      post: { tags: ['Reserve'], summary: 'カレンダー予約: カレンダーを作る', responses: { '200': { description: 'OK' } } },
    },
    '/api/reserve/calendars/{id}': {
      get: { tags: ['Reserve'], summary: 'カレンダー予約: カレンダーの全設定(予約枠・コース・紐づけ・予約URLなど)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
      patch: { tags: ['Reserve'], summary: 'カレンダー予約: カレンダー名の変更・友だち予約の稼働/停止', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
      delete: { tags: ['Reserve'], summary: 'カレンダー予約: カレンダーを削除する', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/api/reserve/calendars/{id}/copy': {
      post: { tags: ['Reserve'], summary: 'カレンダー予約: カレンダーをコピーする(設定・シフトのみ)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/api/reserve/calendars/{id}/settings/{section}': {
      put: { tags: ['Reserve'], summary: 'カレンダー予約: 設定の1区分を保存(reception/slotSettings/courseSettings/screen/actions/reminders/follow/external)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'section', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/api/reserve/calendars/{id}/slots': {
      post: { tags: ['Reserve'], summary: 'カレンダー予約: 予約枠を作る', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/api/reserve/slots/{slotId}': {
      put: { tags: ['Reserve'], summary: 'カレンダー予約: 予約枠を更新する', parameters: [{ name: 'slotId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
      delete: { tags: ['Reserve'], summary: 'カレンダー予約: 予約枠を削除する', parameters: [{ name: 'slotId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/api/reserve/slots/{slotId}/duplicate': {
      post: { tags: ['Reserve'], summary: 'カレンダー予約: 予約枠を複製する', parameters: [{ name: 'slotId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/api/reserve/calendars/{id}/slots-order': {
      put: { tags: ['Reserve'], summary: 'カレンダー予約: 予約枠の並び順を保存する', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/api/reserve/calendars/{id}/courses': {
      post: { tags: ['Reserve'], summary: 'カレンダー予約: コースを作る', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/api/reserve/courses/{courseId}': {
      put: { tags: ['Reserve'], summary: 'カレンダー予約: コースを更新する', parameters: [{ name: 'courseId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
      delete: { tags: ['Reserve'], summary: 'カレンダー予約: コースを削除する', parameters: [{ name: 'courseId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/api/reserve/courses/{courseId}/duplicate': {
      post: { tags: ['Reserve'], summary: 'カレンダー予約: コースを複製する', parameters: [{ name: 'courseId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/api/reserve/calendars/{id}/courses-order': {
      put: { tags: ['Reserve'], summary: 'カレンダー予約: コースの並び順を保存する', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/api/reserve/calendars/{id}/links': {
      put: { tags: ['Reserve'], summary: 'カレンダー予約: 予約枠とコースの紐づけを保存する', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/api/reserve/calendars/{id}/shifts': {
      get: { tags: ['Reserve'], summary: 'カレンダー予約: シフトの一覧(from・to・slotIds)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
      post: { tags: ['Reserve'], summary: 'カレンダー予約: シフトを作る(繰り返しも可)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/api/reserve/shifts/{shiftId}': {
      put: { tags: ['Reserve'], summary: 'カレンダー予約: シフトを更新する(scope=this/following/all)', parameters: [{ name: 'shiftId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
      delete: { tags: ['Reserve'], summary: 'カレンダー予約: シフトを削除する(scope=this/following/all)', parameters: [{ name: 'shiftId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/api/reserve/calendars/{id}/google-connections': {
      get: { tags: ['Reserve'], summary: 'カレンダー予約: 連携に使えるGoogleカレンダーの接続の一覧', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/api/reserve/friends/{friendId}/bookings': {
      get: { tags: ['Reserve'], summary: 'カレンダー予約: ある友だちの予約の一覧(全カレンダー分。友だち詳細のタブ用)', parameters: [{ name: 'friendId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/api/reserve/calendars/{id}/bookings': {
      get: { tags: ['Reserve'], summary: 'カレンダー予約: 予約の一覧(日・月・リスト用。絞り込みつき)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
      post: { tags: ['Reserve'], summary: 'カレンダー予約: 管理者が予約・ブロック枠を登録する', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/api/reserve/calendars/{id}/bookings.csv': {
      get: { tags: ['Reserve'], summary: 'カレンダー予約: 予約の一覧をCSVでダウンロードする', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/api/reserve/bookings/{bid}': {
      get: { tags: ['Reserve'], summary: 'カレンダー予約: 予約の詳細(操作履歴・友だちの直近の予約つき)', parameters: [{ name: 'bid', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
      put: { tags: ['Reserve'], summary: 'カレンダー予約: 管理者が予約を変更する(メモ・完了後のステータスも)', parameters: [{ name: 'bid', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
      delete: { tags: ['Reserve'], summary: 'カレンダー予約: 予約を削除する', parameters: [{ name: 'bid', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/api/reserve/bookings/{bid}/cancel': {
      post: { tags: ['Reserve'], summary: 'カレンダー予約: 管理者が予約をキャンセルする', parameters: [{ name: 'bid', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/api/reserve/bookings/{bid}/decision': {
      post: { tags: ['Reserve'], summary: 'カレンダー予約: リクエスト(新規・変更・キャンセル)を承認・否認する', parameters: [{ name: 'bid', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/api/reserve/calendars/{id}/visited': {
      post: { tags: ['Reserve'], summary: 'カレンダー予約: 来店/来場済みにする(個別・一括。フォローを実行するか選べる)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/api/reserve/calendars/{id}/notices': {
      get: { tags: ['Reserve'], summary: 'カレンダー予約: お知らせ(新規予約・承認待ち)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/api/reserve/calendars/{id}/site-links': {
      post: { tags: ['Reserve'], summary: 'カレンダー予約: 予約枠・コースを指定した予約URLを発行する', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/api/reserve/calendars/{id}/site-links/{linkId}': {
      delete: { tags: ['Reserve'], summary: 'カレンダー予約: 発行した予約URLを削除する', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'linkId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/api/liff/reserve/config': {
      get: { tags: ['Reserve'], summary: 'カレンダー予約(LIFF): 予約画面の設定・選べる予約枠とコース', responses: { '200': { description: 'OK' } } },
    },
    '/api/liff/reserve/availability': {
      get: { tags: ['Reserve'], summary: 'カレンダー予約(LIFF): 期間の空き(◯/✕)', responses: { '200': { description: 'OK' } } },
    },
    '/api/liff/reserve/bookings': {
      post: { tags: ['Reserve'], summary: 'カレンダー予約(LIFF): 友だちが予約する', responses: { '200': { description: 'OK' } } },
    },
    '/api/liff/reserve/me': {
      get: { tags: ['Reserve'], summary: 'カレンダー予約(LIFF): 友だちの予約履歴', responses: { '200': { description: 'OK' } } },
    },
    '/api/liff/reserve/bookings/{id}': {
      get: { tags: ['Reserve'], summary: 'カレンダー予約(LIFF): 予約の確認', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/api/liff/reserve/bookings/{id}/change': {
      post: { tags: ['Reserve'], summary: 'カレンダー予約(LIFF): 友だちが予約を変更する(リクエスト制ならリクエスト)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/api/liff/reserve/bookings/{id}/cancel': {
      post: { tags: ['Reserve'], summary: 'カレンダー予約(LIFF): 友だちが予約をキャンセルする(リクエスト制ならリクエスト)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } },
    },
    '/api/friend-add-settings': {
      get: { tags: ['Friends'], summary: '友だち追加時設定(新規友だち/再フォロー・導入前からの友だち)を取得', parameters: [{ name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Settings' } } },
    },
    '/api/friend-add-settings/{kind}': {
      put: { tags: ['Friends'], summary: '友だち追加時設定を保存(kind = new | returning)', parameters: [{ name: 'kind', in: 'path', required: true, schema: { type: 'string', enum: ['new', 'returning'] } }, { name: 'lineAccountId', in: 'query', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { scenarioId: { type: 'string', nullable: true }, actions: { type: 'array', items: { type: 'object' } } } } } } }, responses: { '200': { description: 'Saved' }, '400': { description: 'Invalid' } } },
    },
    '/api/notification-destinations/mail': {
      post: {
        tags: ['Notifications'],
        summary: 'メールの通知先を beyond admin に登録する(確認メールが届き、リンクを開くと通知先として選べる)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email'], properties: { email: { type: 'string' }, displayName: { type: 'string' } } } } } },
        responses: { '200': { description: 'Verification mail sent' }, '400': { description: 'Invalid email / not linked' } },
      },
    },
    '/api/notification-destinations': {
      get: { tags: ['Notifications'], summary: '通知先の候補(beyond admin に登録・検証済みのLINE・メール宛先)', responses: { '200': { description: 'Destinations' } } },
    },
    '/api/imports/lstep/review': {
      get: {
        tags: ['Imports'],
        summary: '照合できなかった人の確認リスト(オーナー専用)',
        parameters: [{ name: 'accountId', in: 'query', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Review items' }, '400': { description: 'accountId missing' } },
      },
      post: {
        tags: ['Imports'],
        summary: '照合できなかった人の確認リストを入れ替える(確認済みの人は残す・500件まで・オーナー専用)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['accountId', 'items'], properties: { accountId: { type: 'string' }, items: { type: 'array', items: { type: 'object' } } } } } } },
        responses: { '200': { description: 'inserted / keptResolved' }, '400': { description: 'Invalid items' }, '404': { description: 'Account not found' } },
      },
    },
    '/api/imports/lstep/review/{id}': {
      put: {
        tags: ['Imports'],
        summary: '照合できなかった人を、確認済みにする/未確認に戻す(メモつき)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'resolved'] }, note: { type: 'string' }, decision: { type: 'string', nullable: true, enum: ['same', 'different'] } } } } } },
        responses: { '200': { description: 'Updated' }, '400': { description: 'Invalid status' }, '404': { description: 'Not found' } },
      },
    },
    '/api/imports/lstep/review/{id}/link': {
      post: {
        tags: ['Imports'],
        summary: 'beyond line の友だちと Lステップの人を、手で結びつける(両方の行に相手を記録・オーナー専用)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['partnerRowId'], properties: { partnerRowId: { type: 'string' } } } } } },
        responses: { '200': { description: 'Linked rows' }, '400': { description: 'Invalid pair' }, '404': { description: 'Not found' } },
      },
    },
    '/api/imports/lstep/review/{id}/unlink': {
      post: {
        tags: ['Imports'],
        summary: '手で結びつけたのを解除する(相手の行も一緒に戻す・オーナー専用)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Unlinked rows' }, '400': { description: 'Not linked' }, '404': { description: 'Not found' } },
      },
    },
    '/api/imports/lstep/messages/remove': {
      post: {
        tags: ['Imports'],
        summary: '取り込んだトーク履歴のうち、別人の記録が混ざったメッセージを1件ずつ取り除く(1回50件まで・オーナー専用)',
        description: '取り込みの印が付いたメッセージだけが対象(LINEと直接やりとりした分には触れない)。取り除く前の行は記録に残り、その記録の「元に戻す」で戻せる。',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['friendId', 'messageIds'], properties: { friendId: { type: 'string' }, messageIds: { type: 'array', items: { type: 'string' } }, reason: { type: 'string' } } } } } },
        responses: { '200': { description: 'batchId / removed / skipped' }, '400': { description: 'Invalid request' }, '404': { description: 'Friend not found' } },
      },
    },
    '/api/imports/lstep/targets': {
      get: {
        tags: ['Imports'],
        summary: '突き合わせの相手(取り込み先アカウントの友だち・フォーム・アカウント一覧)を返す(読み取りのみ・オーナー専用)',
        parameters: [{ name: 'accountId', in: 'query', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'accounts / friends / forms' }, '400': { description: 'accountId missing' }, '404': { description: 'Account not found' } },
      },
    },
    '/api/imports/lstep/{batchId}/finish': {
      post: {
        tags: ['Imports'],
        summary: 'Lステップ引き継ぎを完了にする(オーナー専用)',
        parameters: [{ name: 'batchId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Finished' }, '409': { description: 'Cannot finish' } },
      },
    },
    '/api/imports/{batchId}/undo': {
      post: {
        tags: ['Imports'],
        summary: '取り込みを丸ごと元に戻す(オーナー専用)',
        description: '変更前の値に戻し、取り込みで作ったタグ・友だち情報欄(まだ使われていないもの)を消す。',
        parameters: [{ name: 'batchId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Undone' }, '404': { description: 'Batch not found' }, '409': { description: 'Already undone' } },
      },
    },
    '/api/staff/{id}/accounts': {
      put: {
        tags: ['Staff'],
        summary: 'スタッフが見られる公式アカウントを設定する(オーナー専用)',
        description:
          '`accountIds` に指定したアカウントの友だち・トークだけを、そのスタッフが扱えるようにする。空配列 = 制限なし(全アカウント)。' +
          'オーナーは常に全アカウントのため制限できない。制限されたスタッフは、アカウント別に安全と確認済みの API(友だち・トーク・タグの参照)以外は 403。' +
          '存在しないアカウント ID を含む場合は 400(意図せず「制限なし」になるのを防ぐ)。',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['accountIds'],
                properties: { accountIds: { type: 'array', items: { type: 'string' } } },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Saved (`accountIds`: null = unrestricted)' },
          '400': { description: 'Invalid ids, or owner cannot be restricted' },
          '404': { description: 'Staff member not found' },
        },
      },
    },
    '/api/line-accounts/{id}/setup-liff': {
      post: {
        tags: ['Accounts'],
        summary: 'LIFF を自動作成して割り当てる',
        description:
          'アカウントに登録済みの LINE ログインチャネル ID・シークレットを使って、LINE の LIFF API で LIFF を作成(または既存を再利用)し、' +
          'エンドポイント URL(`?liffId=` 付き)を設定して `liffId` を割り当てる。何度呼んでも安全。' +
          'アカウントの登録・更新時にも、ログインチャネルが登録済みで LIFF ID が空なら自動で実行される(結果はレスポンスの `liffSetup`)。' +
          '※ LINE ログインチャネル自体の作成は LINE Developers コンソールでの手作業が必要(LINE 側に API が無い)。',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'LIFF assigned (`liffSetup.status` = created | reused)' },
          '400': { description: 'Login channel not registered, or wrong ID/secret (message explains)' },
          '404': { description: 'Account not found' },
        },
      },
    },
    '/api/line-accounts/{id}': {
      get: { tags: ['LINE Accounts'], summary: 'LINEアカウント詳細', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Account' } } },
      patch: {
        tags: ['LINE Accounts'],
        summary: 'LINEアカウント部分更新',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  isActive: { type: 'boolean' },
                  country: { type: 'string', nullable: true },
                  role: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Updated' } },
      },
      put: { tags: ['LINE Accounts'], summary: 'LINEアカウント更新', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Updated' } } },
      delete: { tags: ['LINE Accounts'], summary: 'LINEアカウント削除', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Deleted' } } },
    },
    // ── Conversions ─────────────────────────────────────────────────────────
    '/api/conversions/points': {
      get: { tags: ['Conversions'], summary: 'CV ポイント一覧', responses: { '200': { description: 'All conversion points' } } },
      post: {
        tags: ['Conversions'],
        summary: 'CV ポイント作成',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, eventType: { type: 'string' }, value: { type: 'number' } }, required: ['name', 'eventType'] } } } },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/conversions/points/{id}': {
      delete: {
        tags: ['Conversions'],
        summary: 'CV ポイント削除',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/conversions/track': {
      post: {
        tags: ['Conversions'],
        summary: 'コンバージョン記録',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { conversionPointId: { type: 'string' }, friendId: { type: 'string' }, userId: { type: 'string' }, affiliateCode: { type: 'string' }, metadata: { type: 'object' } }, required: ['conversionPointId', 'friendId'] } } } },
        responses: { '201': { description: 'Tracked' } },
      },
    },
    '/api/conversions/events': {
      get: {
        tags: ['Conversions'],
        summary: 'CV イベント一覧',
        parameters: [
          { name: 'conversionPointId', in: 'query', schema: { type: 'string' } },
          { name: 'friendId', in: 'query', schema: { type: 'string' } },
          { name: 'affiliateCode', in: 'query', schema: { type: 'string' } },
          { name: 'startDate', in: 'query', schema: { type: 'string' } },
          { name: 'endDate', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Events' } },
      },
    },
    '/api/conversions/report': {
      get: {
        tags: ['Conversions'],
        summary: 'CV レポート',
        parameters: [
          { name: 'startDate', in: 'query', schema: { type: 'string' } },
          { name: 'endDate', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Aggregated report' } },
      },
    },
    // ── Affiliates ──────────────────────────────────────────────────────────
    '/api/affiliates': {
      get: { tags: ['Affiliates'], summary: 'アフィリエイト一覧', responses: { '200': { description: 'All affiliates' } } },
      post: {
        tags: ['Affiliates'],
        summary: 'アフィリエイト作成',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, code: { type: 'string' }, commissionRate: { type: 'number' } }, required: ['name', 'code'] } } } },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/affiliates/{id}': {
      get: { tags: ['Affiliates'], summary: 'アフィリエイト詳細', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Affiliate' } } },
      put: { tags: ['Affiliates'], summary: 'アフィリエイト更新', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Updated' } } },
      delete: { tags: ['Affiliates'], summary: 'アフィリエイト削除', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Deleted' } } },
    },
    '/api/affiliates/{id}/report': {
      get: {
        tags: ['Affiliates'],
        summary: 'アフィリエイトレポート',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'startDate', in: 'query', schema: { type: 'string' } },
          { name: 'endDate', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Report' } },
      },
    },
    '/api/affiliates/click': {
      post: {
        tags: ['Affiliates'],
        summary: 'クリック記録',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { code: { type: 'string' }, url: { type: 'string' } }, required: ['code'] } } } },
        responses: { '201': { description: 'Recorded' } },
      },
    },
    // ── Webhook ─────────────────────────────────────────────────────────────
    // ── Forms ───────────────────────────────────────────────────────────
    // 2026-08-25 追記。構築記録 §6-2「フォーム URL がどこにも出てこない」—
    // 作成レスポンスに URL フィールドが無く、`/f/{id}` 等の推測は全部 404。
    // 正解は「LIFF を `?form={formId}` 付きで開く」で、これはクライアント JS を
    // 解析しないと分からない状態だった。ここに書いておけば読むだけで済む。
    '/api/forms': {
      get: { tags: ['Forms'], summary: 'フォーム一覧', responses: { '200': { description: 'Forms' } } },
      post: {
        tags: ['Forms'],
        summary: 'フォーム作成',
        description:
          '`name` のみ必須。`fields` は `[{name,label,type,required,options}]`（type: text/email/tel/number/textarea/select/radio 等）。\n\n' +
          '**レスポンスに公開 URL は含まれない。** 回答画面は LIFF を `?form={id}` 付きで開いて表示する ' +
          '（`/r/{slug}?form={id}` でも可 — クエリは LIFF へパススルーされる）。友だちには ' +
          '`POST /api/liff/send-form-link` 経由でリンクが自動プッシュされる。\n\n' +
          '`onSubmitTagId` / `onSubmitScenarioId` で送信時のタグ付け・シナリオ登録、' +
          '`saveToMetadata` で回答を友だちのメタデータへ保存できる。',
        responses: { '201': { description: 'Created' }, '400': { description: 'name is required' } },
      },
    },
    '/api/forms/{id}': {
      get: { tags: ['Forms'], summary: 'フォーム取得', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Form' } } },
      put: { tags: ['Forms'], summary: 'フォーム更新', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Updated' } } },
      delete: { tags: ['Forms'], summary: 'フォーム削除', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Deleted' } } },
    },
    '/api/forms/{id}/submissions': {
      get: { tags: ['Forms'], summary: '回答一覧', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Submissions' } } },
    },
    '/api/forms/{id}/duplicate': {
      post: {
        tags: ['Forms'],
        summary: 'フォームを複製',
        description: 'Lステップの回答フォーム一覧の「コピー」相当。名前に「のコピー」を付けた新規フォームを作成する。',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '201': { description: 'Created' }, '404': { description: 'Form not found' } },
      },
    },
    '/api/forms/folders': {
      get: { tags: ['Forms'], summary: 'フォームフォルダ一覧', responses: { '200': { description: 'Folders' } } },
      post: {
        tags: ['Forms'],
        summary: 'フォームフォルダ作成',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, displayOrder: { type: 'integer' } }, required: ['name'] } } } },
        responses: { '201': { description: 'Created' }, '400': { description: 'name is required' } },
      },
    },
    '/api/forms/folders/{id}': {
      put: { tags: ['Forms'], summary: 'フォームフォルダ更新', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Updated' } } },
      delete: {
        tags: ['Forms'],
        summary: 'フォームフォルダ削除',
        description: '所属していたフォームは自動的に未分類(folderId=null)へ移動する。フォーム自体は削除されない。',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/forms/{id}/submit': {
      post: { tags: ['Forms'], summary: '回答送信（公開）', description: 'LIFF の回答画面から呼ばれる。', security: [], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Submitted' } } },
    },
    '/api/forms/integrations/google-sheets': {
      get: {
        tags: ['Forms'],
        summary: 'Googleスプレッドシート連携の設定状況',
        description: 'サービスアカウントが設定済みか、共有先として使うメールアドレスを返す(スプレッドシートをこのアドレスへ編集者共有する必要がある)。',
        responses: { '200': { description: 'Service account status' } },
      },
    },

    // ── Friend Field Definitions（友だち情報欄管理）───────────────────
    '/api/friend-fields/folders': {
      get: { tags: ['FriendFields'], summary: 'フォルダ一覧', responses: { '200': { description: 'Folders' } } },
      post: {
        tags: ['FriendFields'],
        summary: 'フォルダ作成',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, displayOrder: { type: 'integer' } }, required: ['name'] } } } },
        responses: { '201': { description: 'Created' }, '400': { description: 'name is required' } },
      },
    },
    '/api/friend-fields/folders/reorder': {
      post: {
        tags: ['FriendFields'],
        summary: 'フォルダの並び替え',
        description: '渡した `ids` の順に display_order を振り直す（画面のドラッグ&ドロップ用）。',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] } } } },
        responses: { '200': { description: 'Reordered' } },
      },
    },
    '/api/friend-fields/folders/{id}': {
      put: { tags: ['FriendFields'], summary: 'フォルダ更新', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Updated' } } },
      delete: {
        tags: ['FriendFields'],
        summary: 'フォルダ削除',
        description: '所属していた項目は自動的に未分類(folderId=null)へ移動する。項目自体は削除されない。',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/friend-fields/definitions': {
      get: {
        tags: ['FriendFields'],
        summary: '項目定義一覧',
        description: '`withCounts=true` を付けると、各項目に値が入っている友だちの人数 `friendCount` も返す。',
        parameters: [{ name: 'withCounts', in: 'query', required: false, schema: { type: 'boolean' } }],
        responses: { '200': { description: 'Field definitions' } },
      },
      post: {
        tags: ['FriendFields'],
        summary: '項目定義を作成',
        description:
          '`fieldKey` は `friends.metadata` の実際の JSON キーになる（作成後の変更不可。省略すると自動採番。既存キーと重複していたら 400）。\n\n' +
          '`fieldType` は text(標準)/textarea(長文)/image/pdf/date(年月日)/datetime(日時)/select(選択肢)、旧形式の number/radio/checkbox。' +
          'select/radio/checkbox のときだけ `options` と、その並びに対応する色 `optionColors` を使う。',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { folderId: { type: 'string', nullable: true }, fieldKey: { type: 'string' }, label: { type: 'string' }, fieldType: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, optionColors: { type: 'array', items: { type: 'string' } }, defaultValue: { type: 'string', nullable: true }, displayOrder: { type: 'integer' } }, required: ['label'] } } } },
        responses: { '201': { description: 'Created' }, '400': { description: 'label is required, or fieldKey already in use' } },
      },
    },
    '/api/friend-fields/definitions/reorder': {
      post: {
        tags: ['FriendFields'],
        summary: '項目定義の並び替え',
        description: '渡した `ids` の順に display_order を振り直す（画面のドラッグ&ドロップ用）。',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] } } } },
        responses: { '200': { description: 'Reordered' } },
      },
    },
    '/api/friend-fields/definitions/{id}/copy': {
      post: {
        tags: ['FriendFields'],
        summary: '項目定義をコピー',
        description: '名前に「のコピー」を付け、`fieldKey` は新規採番して複製する。友だちに登録済みの値はコピーしない。',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '201': { description: 'Copied' }, '404': { description: 'Not found' } },
      },
    },
    '/api/friend-fields/definitions/{id}': {
      put: { tags: ['FriendFields'], summary: '項目定義を更新', description: '`fieldKey` は変更できない。folderId/label/fieldType/options/optionColors/isFavorite(★)/defaultValue/displayOrder のみ更新可。', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Updated' } } },
      delete: { tags: ['FriendFields'], summary: '項目定義を削除', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Deleted' } } },
    },

    // ── メディア・回答フォームの添付ファイル ────────────────────────────
    '/api/media': {
      get: {
        tags: ['Forms'],
        summary: '登録メディア一覧',
        description:
          'R2 にアップロード済みの画像(`POST /api/images` で登録したもの)を新しい順に返す。' +
          '回答フォームの個人情報(`form-uploads/`)は含まない。フォームの画像ブロックや配信で再利用する。',
        responses: { '200': { description: 'Media list' } },
      },
    },
    '/api/form-uploads/{formId}/{file}': {
      get: {
        tags: ['Forms'],
        summary: '回答フォームの添付ファイルを取得(管理者のみ)',
        description: '回答者が「ファイル」ブロックで添付した画像/PDF。個人情報のため公開URLにはせず、管理者の認証が必要。',
        parameters: [
          { name: 'formId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'file', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'File' }, '404': { description: 'Not found' } },
      },
    },

    // ── Entry Routes（流入リンク）─────────────────────────────────────
    // 2026-08-25 追記。MCP にも OpenAPI にも無かったため、AI エージェントが
    // Traffic Pool だけ作って「タグもシナリオも発火しない /r/」を量産する事故が起きた。
    // entry_routes が ref 名前空間を所有し、tagId / scenarioId / poolId を持つ。
    '/api/entry-routes': {
      get: { tags: ['Links'], summary: '流入リンク一覧', responses: { '200': { description: 'Entry routes' } } },
      post: {
        tags: ['Links'],
        summary: '流入リンク作成（/r/{refCode} に「何をするか」を紐付ける）',
        description:
          '**Traffic Pool だけでは不十分。** Pool は「どの LINE アカウントへ振り分けるか」しか決めず、\n' +
          'タグ自動付与・起動シナリオは entry_route が持つ。Pool だけ作るとコンソールの流入リンク画面に\n' +
          '**（未登録）** と表示され、タグもシナリオも発火しない。\n\n' +
          '`refCode` を Traffic Pool の `slug` と同じ値にすると両者が紐づく。`poolId` に pool の id を渡すこと。',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['refCode', 'name'],
                properties: {
                  refCode: { type: 'string', description: 'URL に入る識別子。`/r/{refCode}` になる' },
                  name: { type: 'string', description: 'コンソールの一覧に出る表示名' },
                  tagId: { type: 'string', nullable: true, description: '友だち追加時に自動付与するタグ' },
                  scenarioId: { type: 'string', nullable: true, description: '友だち追加時に自動開始するシナリオ' },
                  poolId: { type: 'string', nullable: true, description: '振り分け先 Traffic Pool の id' },
                  introTemplateId: { type: 'string', nullable: true, description: '追加直後に push するテンプレート' },
                  redirectUrl: { type: 'string', nullable: true },
                  runAccountFriendAddScenarios: { type: 'boolean' },
                  isActive: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Created' }, '400': { description: 'refCode and name are required / 予約語' } },
      },
    },
    '/api/entry-routes/{id}': {
      get: { tags: ['Links'], summary: '流入リンク取得', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Entry route' } } },
      patch: { tags: ['Links'], summary: '流入リンク更新', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Updated' } } },
      delete: { tags: ['Links'], summary: '流入リンク削除', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Deleted' } } },
    },
    '/api/entry-routes/{id}/funnel': {
      get: {
        tags: ['Links'],
        summary: '流入ファネル分析',
        description: 'クリック → 友だち追加 → タグ付与 の到達数。ランディング離脱は仕様上見えない（重複計上を避けるため landing で ref_tracking を書かない）。',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Funnel' } },
      },
    },
    // ── Links（流入経路とクリック計測は別物）────────────────────────────
    // 構築記録 §6-4「/t と /r の取り違え」— 役割の違いがどこにも書かれておらず、
    // SNS 用に `/t`（チャット内用）を納品してしまった。ここで明示する。
    '/r/{ref}': {
      get: {
        tags: ['Links'],
        summary: '【流入経路】友だち追加リファラルリンク（SNS・外部向け）',
        description:
          '**外部（SNS投稿・広告・名刺など）に貼るのはこちら。** LINE の友だち追加へ誘導し、' +
          '追加した友だちの `refCode` に流入元が記録される。トラフィックプール ' +
          '(`POST /api/traffic-pools`) の `slug` がそのまま `{ref}` になる。\n\n' +
          '**クエリは LIFF へパススルーされる**ので、追加直後の着地先を指定できる:\n' +
          '- `?page=webinar&slug={webinarSlug}` — 追加後そのままウェビナー視聴画面へ\n' +
          '- `?form={formId}` — 追加後にフォーム回答画面へ（友だちにはリンクも自動プッシュ）\n\n' +
          '`page` に渡せるのは `salon-book` / `event` / `event-me` / `webinar` のみ。' +
          '`form` / `book` は友だち追加ゲートを迂回してしまうため意図的に除外されている。',
        security: [],
        parameters: [
          { name: 'ref', in: 'path', required: true, schema: { type: 'string' }, description: 'トラフィックプールの slug' },
          { name: 'page', in: 'query', required: false, schema: { type: 'string', enum: ['salon-book', 'event', 'event-me', 'webinar'] } },
          { name: 'slug', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'form', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'LIFF への誘導ページ' } },
      },
    },
    '/t/{linkId}': {
      get: {
        tags: ['Links'],
        summary: '【クリック計測】トラッキングリンク（チャット内向け）',
        description:
          '**LINE のトーク内に貼るのはこちら。** クリック数を計測し、設定に応じてタグ付け・' +
          'シナリオ登録・イントロメッセージのプッシュを行ってから `destinationUrl` へリダイレクトする。\n\n' +
          '**SNS には貼らないこと。** 流入経路の記録は `/r/{ref}` の役割で、こちらは' +
          '「既に友だちである人がトーク内で押した」ことの計測に特化している。' +
          '取り違えると流入元が記録されない（構築記録 §6-4）。',
        security: [],
        parameters: [{ name: 'linkId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '302': { description: 'destinationUrl へリダイレクト' } },
      },
    },
    '/api/tracked-links': {
      get: { tags: ['Links'], summary: 'トラッキングリンク一覧', responses: { '200': { description: 'Links' } } },
      post: {
        tags: ['Links'],
        summary: 'トラッキングリンク作成（チャット内用）',
        description:
          '`destinationUrl` が必須。`tagId` / `scenarioId` でクリック時の自動アクション、' +
          '`introMessageTemplateId` で友だち追加直後のプッシュを指定できる。\n\n' +
          'テンプレート本文の `{formUrl}` プレースホルダは**このイントロ／リワード配信でのみ展開される**。' +
          'シナリオのステップ本文では展開されないので注意（構築記録 §6-3）。',
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/traffic-pools': {
      get: { tags: ['Links'], summary: 'トラフィックプール一覧', responses: { '200': { description: 'Pools' } } },
      post: {
        tags: ['Links'],
        summary: 'トラフィックプール作成（= /r/{slug} の発行）',
        description:
          '`slug` / `name` / `activeAccountId` が必須。作成すると `/r/{slug}` が使えるようになり、' +
          'そこから追加した友だちの `refCode` に `{slug}` が記録される。\n\n' +
          '**これだけではタグ自動付与・起動シナリオは動かない。** Pool が決めるのは振り分け先アカウントだけで、' +
          '流入時の挙動は `POST /api/entry-routes`（同じ `refCode`・`poolId` にこの pool の id）が持つ。' +
          '作らないとコンソールの流入リンク画面に（未登録）と出る。',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['slug', 'name', 'activeAccountId'],
                properties: {
                  slug: { type: 'string', description: 'URL に入る。例 `sns-main` → `/r/sns-main`' },
                  name: { type: 'string' },
                  activeAccountId: { type: 'string', description: '流入を受けるLINEアカウントのID' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Created' }, '400': { description: 'slug, name, and activeAccountId are required' } },
      },
    },
    '/api/traffic-pools/{id}': {
      put: { tags: ['Links'], summary: 'プール更新（配信先アカウントの切替）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Updated' } } },
      delete: { tags: ['Links'], summary: 'プール削除', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Deleted' } } },
    },
    // ── Webinars ────────────────────────────────────────────────────────
    // 2026-08-25 追記。オートウェビナー一式は OpenAPI に1本も載っておらず、
    // 構築を試みた利用者が「動画アップロードの口が見つからない」まま20以上の
    // エンドポイントを推測で叩き、最終的に OSS のソースを読んで発見する、という
    // 事故が起きた（構築記録 §6-5「最長の詰まり」）。MCP にも webinar 系ツールが
    // 無いため、ここが唯一の発見経路になる。
    '/api/webinars': {
      get: { tags: ['Webinars'], summary: 'ウェビナー一覧', responses: { '200': { description: 'Webinars' } } },
      post: {
        tags: ['Webinars'],
        summary: 'ウェビナー作成',
        description: 'title と slug が必須。slug は視聴 URL `/webinar/{slug}` に入る。',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title', 'slug'],
                properties: {
                  title: { type: 'string' },
                  slug: { type: 'string', description: '英数字とハイフン。視聴 URL に入る' },
                  status: { type: 'string', enum: ['draft', 'active', 'archived'] },
                  durationSeconds: { type: 'number', description: '動画の長さ（秒）' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Created' }, '409': { description: 'slug_taken' } },
      },
    },
    '/api/webinars/{id}': {
      get: { tags: ['Webinars'], summary: 'ウェビナー取得', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Webinar' } } },
      put: {
        tags: ['Webinars'],
        summary: 'ウェビナー更新（公開状態・スケジュール・従来CTA）',
        description:
          'schedule は `{type:"daily",time:"HH:MM"}` / `{type:"weekly",time,days:[0-6]}` / ' +
          '`{type:"once",at:ISO8601}` の配列。時刻は JST 固定。\n\n' +
          '従来 CTA（`cta`）は label・url・showAtSeconds が**3つとも必須**で、' +
          'showAtSeconds は**数値**（文字列は 400 invalid_cta）。新しい複数 CTA は ' +
          '`PUT /api/webinars/{id}/ctas` を使う。',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  slug: { type: 'string' },
                  status: { type: 'string', enum: ['draft', 'active', 'archived'] },
                  durationSeconds: { type: 'number' },
                  schedule: { type: 'array', items: { type: 'object' } },
                  cta: {
                    type: 'object',
                    nullable: true,
                    required: ['label', 'url', 'showAtSeconds'],
                    properties: {
                      label: { type: 'string' },
                      url: { type: 'string', description: 'http(s) 必須' },
                      showAtSeconds: { type: 'number', description: '数値のみ。文字列だと invalid_cta' },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Updated' }, '400': { description: 'invalid_cta / invalid_schedule など' } },
      },
      delete: { tags: ['Webinars'], summary: 'ウェビナー削除', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Deleted' } } },
    },
    '/api/webinars/{id}/assets/{revision}/{path}': {
      put: {
        tags: ['Webinars'],
        summary: '動画アセット（HLS）アップロード',
        description:
          'ffmpeg の HLS 出力を1ファイルずつ送る。`revision` は**数字のみ**（`master.m3u8` を直に置こうとすると ' +
          '400 `revision must be digits` が返る — これがルート発見の決め手になる）。\n\n' +
          '拡張子は `.m3u8` と `.ts` のみ。1ファイル 20MB 以内。R2 の ' +
          '`webinars/{slug}/{revision}/{path}` に格納される。\n\n' +
          '`master.m3u8` は**最後に**送ること。途中で中断しても、セグメント欠けの master が残らない。\n\n' +
          '生成例:\n' +
          '```\n' +
          'ffmpeg -i INPUT.mp4 -map 0:v:0 -map 0:a:0 -c copy \\\n' +
          '  -var_stream_map "v:0,a:0" -master_pl_name master.m3u8 \\\n' +
          '  -f hls -hls_time 6 -hls_playlist_type vod -hls_list_size 0 \\\n' +
          '  -hls_segment_filename "OUT/%v/seg_%05d.ts" "OUT/%v/index.m3u8"\n' +
          '```',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'revision', in: 'path', required: true, schema: { type: 'string', pattern: '^\\d+$' } },
          { name: 'path', in: 'path', required: true, schema: { type: 'string' }, description: '例 `master.m3u8` / `0/index.m3u8` / `0/seg_00001.ts`' },
        ],
        requestBody: { required: true, content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } },
        responses: {
          '200': { description: 'Stored' },
          '400': { description: 'revision must be digits / only .m3u8 and .ts may be uploaded / too large' },
        },
      },
    },
    '/api/webinars/{id}/video': {
      post: {
        tags: ['Webinars'],
        summary: '動画リビジョンの確定（アップロード完了）',
        description:
          'master.m3u8 を読み、variant を解析し、参照されている**全セグメントが R2 に実在するか**を ' +
          'サーバー側で検証してから `video_prefix` を切り替える。欠けがあれば 400 で、視聴者は ' +
          '古いリビジョンのまま影響を受けない。',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['revision', 'durationSeconds'],
                properties: {
                  revision: { type: 'string', pattern: '^\\d+$' },
                  durationSeconds: { type: 'number', description: '正の数' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'videoPrefix を返す' }, '400': { description: 'upload is incomplete' } },
      },
    },
    '/api/webinars/{id}/ctas': {
      get: { tags: ['Webinars'], summary: 'CTA一覧', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'CTAs' } } },
      put: {
        tags: ['Webinars'],
        summary: 'CTA一括置換（最大20件）',
        description:
          '全置換。`kind:"form"` なら `formId` 必須（存在と有効性をサーバーが検証）、' +
          '`kind:"url"` なら `url` 必須（http(s)）。`autoOpen` で自動表示。all-or-nothing 検証。',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['ctas'],
                properties: {
                  ctas: {
                    type: 'array',
                    maxItems: 20,
                    items: {
                      type: 'object',
                      required: ['atSeconds', 'kind', 'title', 'buttonLabel'],
                      properties: {
                        atSeconds: { type: 'number', minimum: 0 },
                        kind: { type: 'string', enum: ['form', 'url'] },
                        title: { type: 'string', maxLength: 100 },
                        body: { type: 'string', maxLength: 300, nullable: true },
                        buttonLabel: { type: 'string', maxLength: 50 },
                        autoOpen: { type: 'boolean' },
                        formId: { type: 'string', nullable: true },
                        url: { type: 'string', nullable: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'count を返す' }, '400': { description: 'invalid_cta / form_not_found / form_inactive' } },
      },
    },
    '/api/webinars/{id}/comments': {
      get: { tags: ['Webinars'], summary: 'コメント一覧', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Comments' } } },
      put: {
        tags: ['Webinars'],
        summary: 'コメント一括置換（仕込みコメント）',
        description:
          '全置換。`atSeconds` が**負の値は開始前の待機ルーム**コメント（-3600 まで）。' +
          '`authorName` は50文字以内。',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['comments'],
                properties: {
                  comments: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['atSeconds', 'authorName', 'body'],
                      properties: {
                        atSeconds: { type: 'number', minimum: -3600 },
                        authorName: { type: 'string', maxLength: 50 },
                        body: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'count を返す' }, '400': { description: 'invalid_comment' } },
      },
    },
    '/api/webinars/{id}/analytics': {
      get: {
        tags: ['Webinars'],
        summary: '視聴分析',
        description: '視聴・離脱位置・CTAクリック・フォーム到達をセッション単位で集計。管理画面と同一データ。',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Analytics' } },
      },
    },
    '/api/webinars/{id}/user-comments': {
      get: { tags: ['Webinars'], summary: '視聴者の生コメント一覧', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Comments' } } },
    },
    '/webhook': {
      post: {
        tags: ['Webhook'],
        summary: 'LINE Messaging API Webhook',
        description: 'LINE プラットフォームからのWebhookイベントを受信。署名検証あり、常に200を返す。',
        security: [],
        responses: { '200': { description: 'OK' } },
      },
    },
  },
  tags: [
    { name: 'Friends', description: '友だち管理' },
    { name: 'Tags', description: 'タグ管理' },
    { name: 'Scenarios', description: 'ステップ配信シナリオ' },
    { name: 'Broadcasts', description: '一斉配信' },
    { name: 'Users', description: 'UUID Cross-Account ユーザー管理' },
    { name: 'LINE Accounts', description: 'マルチLINEアカウント管理' },
    { name: 'Conversions', description: 'コンバージョン計測' },
    { name: 'Affiliates', description: 'アフィリエイト管理' },
    { name: 'Forms', description: 'フォーム（LIFF 内で回答）' },
    { name: 'Links', description: '流入経路(/r) とクリック計測(/t) — 役割が違うので取り違えないこと' },
    { name: 'Webinars', description: 'オートウェビナー（動画・CTA・コメント・分析）' },
    { name: 'Webhook', description: 'LINE Webhook' },
  ],
};

// GET /openapi.json - raw spec
openapi.get('/openapi.json', (c) => {
  return c.json(spec);
});

// GET /docs - Swagger UI
openapi.get('/docs', (c) => {
  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>LINE CRM API Docs</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
    });
  </script>
</body>
</html>`;
  return c.html(html);
});

export { openapi };
