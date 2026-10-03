import { Hono } from 'hono';
import { verifySignature, LineClient } from '@line-crm/line-sdk';
import type { WebhookRequestBody, WebhookEvent, TextEventMessage } from '@line-crm/line-sdk';
import { createStickerMessageContent } from '@line-crm/shared';
import {
  upsertFriend,
  updateFriendFollowStatus,
  getFriendByLineUserId,
  getFriendByLineUserIdForAccount,
  getScenarios,
  enrollFriendInScenario,
  upsertChatOnMessage,
  getLineAccounts,
  jstNow,
  getEntryRouteByRefCode,
  getMessageTemplateById,
} from '@line-crm/db';
import type { EntryRoute, Friend } from '@line-crm/db';
import { fireEvent } from '../services/event-bus.js';
import { matchAndReply } from '../services/auto-reply.js';
import { buildMessage } from '../services/step-delivery.js';
import { pushImmediateFirstStep } from '../services/immediate-first-step.js';
import type { Env } from '../index.js';
import { awardActivityMileage } from '../services/activity-mileage.js';
import { replyViaHarnessProxy } from '../services/line-proxy-send.js';
import type { HarnessProxyDispatch } from '../services/line-proxy-send.js';
import { dispatchLineProxyLocally } from '../services/local-line-proxy.js';
import { ensureSchedulerArmed } from '../durable-objects/tenant-scheduler.js';
import { notifyIncomingMessage } from '../services/push-notify.js';
import type { IncomingMessageNotice } from '../services/push-notify.js';

const webhook = new Hono<Env>();

// LINE webhook bodies are small (events array). Cap defends against unauthenticated
// large-payload DoS before signature verification (#104). 1 MiB leaves room for
// bursty batched deliveries (~100 events × ~5 KB) while still well below the
// 128 MB Cloudflare Workers memory ceiling.
const MAX_WEBHOOK_BODY_SIZE = 1024 * 1024; // 1 MiB

async function ensureFriendFromWebhookUser(
  db: D1Database,
  lineClient: LineClient,
  userId: string,
  lineAccountId: string | null,
): Promise<Friend | null> {
  // 同じ人が複数アカウントの友だちでも、このアカウントの行だけを対象にする
  let friend = await getFriendByLineUserIdForAccount(db, userId, lineAccountId);

  if (!friend) {
    let profile: Awaited<ReturnType<LineClient['getProfile']>> | null = null;
    try {
      profile = await lineClient.getProfile(userId);
    } catch (err) {
      // A signed webhook already proves this user interacted with the bot.
      // If profile lookup is temporarily unavailable, keep the event processable
      // by creating the friend with the LINE userId and filling profile later.
      console.error('[webhook] Failed to get profile for unknown user', userId, err);
    }

    friend = await upsertFriend(db, {
      lineUserId: userId,
      lineAccountId,
      displayName: profile?.displayName ?? null,
      pictureUrl: profile?.pictureUrl ?? null,
      statusMessage: profile?.statusMessage ?? null,
    });
    console.log(`[webhook] auto-registered existing friend userId=${userId} friendId=${friend.id}`);
  }

  // 所属アカウントの書き換えは行わない(以前は別アカウントの行を奪っていた)
  return friend;
}

webhook.post('/webhook', async (c) => {
  // Pre-read size guard: reject before reading the body if Content-Length is oversized.
  const contentLengthHeader = c.req.header('Content-Length');
  if (contentLengthHeader) {
    const declared = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BODY_SIZE) {
      return c.json({ status: 'too_large' }, 413);
    }
  }

  const rawBody = await c.req.text();

  // Post-read size guard for the case where Content-Length was absent or untrustworthy.
  // Use UTF-8 byte count: `rawBody.length` counts UTF-16 code units, so multibyte
  // payloads (Japanese/emoji) would otherwise bypass the cap.
  const rawBodyByteLength = new TextEncoder().encode(rawBody).byteLength;
  if (rawBodyByteLength > MAX_WEBHOOK_BODY_SIZE) {
    return c.json({ status: 'too_large' }, 413);
  }

  const signature = c.req.header('X-Line-Signature') ?? '';
  const db = c.env.DB;

  // Cheap pre-reject for unsigned / malformed-signature requests. LINE signatures
  // are HMAC-SHA256 + base64 = 44 chars. This avoids D1 lookups and HMAC compute
  // for junk traffic on a public endpoint.
  const LINE_SIGNATURE_LENGTH = 44;
  if (signature.length !== LINE_SIGNATURE_LENGTH) {
    console.error('Missing or malformed LINE signature');
    return c.json({ status: 'ok' }, 200);
  }

  // Verify signature BEFORE JSON.parse so attacker-controlled bodies never reach the parser.
  // Fast path: try env default secret first so malformed/unauthenticated traffic
  //   fails fast without a D1 lookup. The main account is typically also registered
  //   in line_accounts; on env match we still look it up so matchedAccountId binds
  //   correctly for downstream account-scoped filters.
  // Slow path: iterate DB-registered accounts for genuinely multi-account installs.
  let channelAccessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
  let matchedAccountId: string | null = null;
  let valid = false;

  const envSecret = c.env.LINE_CHANNEL_SECRET;
  if (envSecret) {
    valid = await verifySignature(envSecret, rawBody, signature);
    if (valid) {
      const accounts = await getLineAccounts(db);
      const main = accounts.find(
        (a) => a.is_active && a.channel_secret === envSecret,
      );
      if (main) {
        channelAccessToken = main.channel_access_token;
        matchedAccountId = main.id;
      }
    }
  }

  if (!valid) {
    const accounts = await getLineAccounts(db);
    for (const account of accounts) {
      if (!account.is_active) continue;
      if (envSecret && account.channel_secret === envSecret) continue; // already tried via fast path
      const isValid = await verifySignature(account.channel_secret, rawBody, signature);
      if (isValid) {
        channelAccessToken = account.channel_access_token;
        matchedAccountId = account.id;
        valid = true;
        break;
      }
    }
  }

  if (!valid) {
    console.error('Invalid LINE signature');
    return c.json({ status: 'ok' }, 200);
  }

  let body: WebhookRequestBody;
  try {
    body = JSON.parse(rawBody) as WebhookRequestBody;
  } catch {
    console.error('Failed to parse webhook body');
    return c.json({ status: 'ok' }, 200);
  }

  const lineClient = new LineClient(channelAccessToken);

  // iOS アプリへのプッシュ通知(APNs 設定が無ければ何もしない)。
  // 背景で実行し、失敗しても Webhook の応答・処理には影響させない。
  const onIncoming = (notice: IncomingMessageNotice): void => {
    try {
      c.executionCtx.waitUntil(
        notifyIncomingMessage(c.env, db, notice).catch((err) => {
          console.error('[webhook] push notify failed', err instanceof Error ? err.message : 'error');
        }),
      );
    } catch (err) {
      console.error('[webhook] push notify failed', err instanceof Error ? err.message : 'error');
    }
  };

  // 非同期処理 — LINE は ~1s 以内のレスポンスを要求
  const processingPromise = (async () => {
    const proxyDispatch: HarnessProxyDispatch = (request) =>
      dispatchLineProxyLocally(request, c.env, c.executionCtx);
    for (const event of body.events) {
      try {
        await handleEvent(
          db,
          lineClient,
          event,
          channelAccessToken,
          matchedAccountId,
          c.env.WORKER_URL || new URL(c.req.url).origin,
          c.env.LIFF_URL,
          c.env.IMAGES,
          proxyDispatch,
          onIncoming,
        );
      } catch (err) {
        console.error('Error handling webhook event:', err);
      }
    }
  })();

  c.executionCtx.waitUntil(processingPromise);

  // 定期ジョブ用 DO の自己修復チェック。何らかの理由で alarm チェーンが
  // 切れていても、次に届いた webhook がここで直す。getAlarm() 1回で済む
  // 軽さなので毎リクエストで呼んでよい。応答を遅らせないよう waitUntil に
  // 逃がし、失敗しても webhook 応答（LINE 側の ~1s タイムアウト）には影響しない。
  c.executionCtx.waitUntil(ensureSchedulerArmed(c.env));

  return c.json({ status: 'ok' }, 200);
});

async function handleEvent(
  db: D1Database,
  lineClient: LineClient,
  event: WebhookEvent,
  lineAccessToken: string,
  lineAccountId: string | null = null,
  workerUrl?: string,
  liffUrl?: string,
  r2?: R2Bucket,
  proxyDispatch?: HarnessProxyDispatch,
  onIncoming?: (notice: IncomingMessageNotice) => void,
): Promise<void> {
  if (event.type === 'follow') {
    const userId =
      event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;

    console.log(`[follow] userId=${userId} lineAccountId=${lineAccountId}`);

    // プロフィール取得 & 友だち登録/更新
    let profile;
    try {
      profile = await lineClient.getProfile(userId);
    } catch (err) {
      console.error('Failed to get profile for', userId, err);
    }

    console.log(`[follow] profile=${profile?.displayName ?? 'null'}`);

    const friend = await upsertFriend(db, {
      lineUserId: userId,
      lineAccountId,
      displayName: profile?.displayName ?? null,
      pictureUrl: profile?.pictureUrl ?? null,
      statusMessage: profile?.statusMessage ?? null,
    });

    console.log(`[follow] friend.id=${friend.id} friend.line_account_id=${(friend as any).line_account_id}`);

    // 新規・再フォローのどちらでも、最初の友だち登録マイルを同じキーで非同期投入する。
    // first_followed_at を使うため再フォローやWebhook再送では二重加算されない。
    const firstFollowedAt = friend.first_followed_at ?? friend.created_at;
    await awardActivityMileage(db, {
      eventType: 'friend_registered',
      source: 'line_relationship',
      sourceEventId: `${friend.id}:friend_registered:${firstFollowedAt}`,
      friendId: friend.id,
      subjectKey: friend.id,
      metadata: { lineAccountId },
      occurredAt: firstFollowedAt,
    });

    // Resolve referral link (entry_route) for this friend.
    // /auth/callback (OAuth path) writes friends.ref_code in parallel with
    // this follow webhook, so the field can briefly be NULL when LINE
    // delivers the event. Retry a few times (~1s total) before giving up,
    // otherwise override mode and intro pushes silently fall back to the
    // account default whenever the webhook wins the race.
    const { getFriendById } = await import('@line-crm/db');
    let friendRefCode = (friend as { ref_code?: string | null }).ref_code ?? null;
    if (!friendRefCode) {
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const refreshed = await getFriendById(db, friend.id);
        const refreshedRef = (refreshed as { ref_code?: string | null } | null)?.ref_code ?? null;
        if (refreshedRef) {
          friendRefCode = refreshedRef;
          break;
        }
      }
    }
    const referralRoute: EntryRoute | null = friendRefCode
      ? await getEntryRouteByRefCode(db, friendRefCode)
      : null;
    const runAccountScenarios =
      !referralRoute || referralRoute.run_account_friend_add_scenarios !== 0;

    // friend_add シナリオに登録（このアカウントのシナリオのみ）
    // Skip entirely when a referral link explicitly overrides (run_account_friend_add_scenarios=0).
    const scenarios = runAccountScenarios ? await getScenarios(db) : [];
    for (const scenario of scenarios) {
      // Only trigger scenarios belonging to this account (or unassigned for backward compat)
      const scenarioAccountMatch = !scenario.line_account_id || !lineAccountId || scenario.line_account_id === lineAccountId;
      if (scenario.trigger_type === 'friend_add' && scenario.is_active && scenarioAccountMatch) {
        try {
          // INSERT OR IGNORE handles dedup via UNIQUE(friend_id, scenario_id)
          const friendScenario = await enrollFriendInScenario(db, friend.id, scenario.id);
          if (!friendScenario) continue; // already enrolled

          // Immediate delivery: step1 が「now 以前」にスケジュールされる場合のみ
          // replyMessage で即時送信する (reply token は無料・push 枠を消費しない)。
          // - relative + delay_minutes=0 → 即時
          // - elapsed + offset_days=0 + offset_minutes=0 → 即時
          // - absolute_time で過去時刻 → computeNextDeliveryAt が now に clamp するので即時
          // reply 失敗時 (2つ目のシナリオで token 消費済み等) は claim が解放され
          // cron が push で配信する。
          // skipCooldown: 60秒以内の再フォロー (前の enrollment が completed 済み)
          // でも必ず welcome を返す — 旧 webhook 実装のセマンティクスを維持。
          const sent = await pushImmediateFirstStep(
            db,
            friend.id,
            scenario.id,
            { defaultAccessToken: lineAccessToken, workerUrl },
            {
              enrollment: friendScenario,
              reply: { client: lineClient, replyToken: event.replyToken },
              skipCooldown: true,
            },
          );
          if (sent) console.log(`Immediate delivery: sent scenario ${scenario.id} step 1 to ${userId}`);
        } catch (err) {
          console.error('Failed to enroll friend in scenario', scenario.id, err);
        }
      }
    }

    // Referral link side-effects (intro push + dedicated scenario)
    if (referralRoute) {
      // Intro push from referral link
      if (referralRoute.intro_template_id) {
        try {
          const template = await getMessageTemplateById(db, referralRoute.intro_template_id);
          if (template) {
            const message = buildMessage(template.message_type, template.message_content);
            await lineClient.pushMessage(userId, [message]);
            console.log(`[follow] referral intro push sent route=${referralRoute.id}`);
          }
        } catch (err) {
          console.error('[follow] referral intro push failed', err);
        }
      }

      // Dedicated scenario enrollment from referral link. A delay-0 first
      // step is pushed immediately (same instant-welcome semantics as
      // friend_add / tag_added enrollments — previously this path always
      // waited for the next cron tick). pushMessage, not reply: the reply
      // token may already be consumed by an account friend_add scenario
      // above, and the intro push on this path uses pushMessage too.
      if (referralRoute.scenario_id) {
        try {
          const enrollment = await enrollFriendInScenario(db, friend.id, referralRoute.scenario_id);
          console.log(`[follow] referral scenario enrolled scenario=${referralRoute.scenario_id}`);
          if (enrollment) {
            await pushImmediateFirstStep(
              db,
              friend.id,
              referralRoute.scenario_id,
              { defaultAccessToken: lineAccessToken, workerUrl },
              { enrollment },
            );
          }
        } catch (err) {
          console.error('[follow] referral scenario enrollment failed', err);
        }
      }
    }

    // イベントバス発火: friend_add（replyToken は Step 0 で使用済みの可能性あり）
    await fireEvent(db, 'friend_add', { friendId: friend.id, eventData: { displayName: friend.display_name } }, lineAccessToken, lineAccountId);
    return;
  }

  if (event.type === 'unfollow') {
    const userId =
      event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;

    await updateFriendFollowStatus(db, userId, false, lineAccountId);
    return;
  }

  // Postback events — triggered by Flex buttons with action.type: "postback"
  // Uses the same auto_replies matching but without displaying text in chat
  if (event.type === 'postback') {
    const userId = event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;

    const friend = await ensureFriendFromWebhookUser(db, lineClient, userId, lineAccountId);
    if (!friend) return;

    const postbackData = (event as unknown as { postback: { data: string } }).postback.data;

    // postback の incoming 自体を messages_log に記録する。Rich Menu のタップで
    // 利用者が "コスト比較" などのアクションを起こした事実を chat 履歴で可視化する。
    // delivery_type='push' は厳密には push ではないが、incoming/non-test として
    // 既存 chat list / 詳細 SQL のフィルタを通すための妥当な値 (auto_reply text 同様)。
    try {
      await db
        .prepare(
          `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, line_account_id, created_at)
           VALUES (?, ?, 'incoming', 'text', ?, NULL, NULL, 'postback', ?, ?)`,
        )
        .bind(crypto.randomUUID(), friend.id, postbackData, lineAccountId ?? null, jstNow())
        .run();
    } catch (err) {
      console.error('Failed to log incoming postback', err);
    }

    // postback data を auto_replies にマッチさせて返信 (テキスト経路と共通)。
    // silent + automation で「返信なしでタグだけ付ける」構成もここで成立する。
    const { matched: postbackMatched, replyTokenConsumed: postbackReplyTokenConsumed } =
      await matchAndReply(db, lineClient, friend, postbackData, event.replyToken, {
        inputKind: 'postback',
        lineAccountId,
        workerUrl,
        liffUrl,
        logContext: 'postback',
        replyMessage: workerUrl
          ? (token, messages) => replyViaHarnessProxy(
              workerUrl,
              lineAccessToken,
              token,
              messages,
              proxyDispatch,
            )
          : undefined,
      });

    // イベントバス発火: 専用イベント postback_received。
    // postback.data を text に載せることで、IF-THEN 自動化の keyword /
    // keyword_exact 条件がリッチメニューのタップ（タグ付与等）に効く。
    // message_received を流用しないのは意図的 — 流用すると既存インストールの
    // message_received スコアリング・catch-all 自動化・送信 Webhook 購読者が
    // メニュータップで誤発火し、条件側に source を見る術がないため。
    // なお upsertChatOnMessage は呼ばない: メニュータップは自発メッセージでは
    // ないので、未対応 inbox を汚さないのが正しい (テキスト経路との意図的な差分)。
    await fireEvent(db, 'postback_received', {
      friendId: friend.id,
      eventData: { text: postbackData, matched: postbackMatched },
      replyToken: postbackReplyTokenConsumed ? undefined : event.replyToken,
    }, lineAccessToken, lineAccountId);

    return;
  }

  // 非テキストの受信メッセージ（スタンプ/画像/音声/動画/ファイル/位置情報等）もログに残す。
  // ここで早期 return することで、テキスト用の auto_reply / scenario 判定には進まない
  // （スタンプ単体に対するキーワードマッチは意味を持たないため）。inbox 抜けだけ防ぐ。
  if (event.type === 'message' && event.message.type !== 'text') {
    const userId = event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;
    const friend = await ensureFriendFromWebhookUser(db, lineClient, userId, lineAccountId);
    if (!friend) return;

    const msg = event.message as {
      id: string;
      type: string;
      fileName?: string;
      title?: string;
      packageId?: string | number;
      package_id?: string | number;
      stickerId?: string | number;
      sticker_id?: string | number;
      stickerResourceType?: string | number;
      sticker_resource_type?: string | number;
    };
    const labels: Record<string, string> = {
      sticker: '[スタンプ]',
      image: '[画像]',
      audio: '[音声]',
      video: '[動画]',
      file: msg.fileName ? `[ファイル: ${msg.fileName}]` : '[ファイル]',
      location: msg.title ? `[位置情報: ${msg.title}]` : '[位置情報]',
    };
    const content = labels[msg.type] ?? `[${msg.type}]`;

    // image の場合は LINE Content API でバイナリを取得 → R2 → JSON URL に置換。
    // 失敗時は labels[msg.type] のラベル文字列のまま (フォールバック)。
    let finalContent = content;
    if (msg.type === 'sticker') {
      const stickerContent = createStickerMessageContent(msg);
      if (stickerContent) {
        finalContent = JSON.stringify(stickerContent);
      }
    }
    if (msg.type === 'image' && r2 && workerUrl) {
      const lineMessageId = msg.id;
      const { fetchAndStoreIncomingImage } = await import('../services/incoming-image.js');
      const refs = await fetchAndStoreIncomingImage({
        r2,
        workerUrl,
        channelAccessToken: lineAccessToken,
        accountId: lineAccountId ?? 'unknown',
        messageId: lineMessageId,
      });
      if (refs) {
        finalContent = JSON.stringify(refs);
      }
    }

    const logId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, created_at)
         VALUES (?, ?, 'incoming', ?, ?, NULL, NULL, 'user', ?)`,
      )
      .bind(logId, friend.id, msg.type, finalContent, jstNow())
      .run();
    await awardActivityMileage(db, {
      eventType: 'message_received',
      source: 'line',
      sourceEventId: logId,
      friendId: friend.id,
      metadata: { messageType: msg.type },
    });
    // text と同様、非 text の自発メッセージ (画像/スタンプ等) でも chat を unread に戻す。
    // これが無いと resolved 除外 (unanswered-inbox CANDIDATES_SQL) が「解決済み後に
    // 画像だけ送ってきた友だち」をバッジ・未対応一覧から永久に落としてしまう。
    // 非 text は auto_reply keyword にマッチし得ないので常に要対応扱いで正しい。
    await upsertChatOnMessage(db, friend.id);
    // アプリへ通知(非 text は常に要対応扱い=unread にした場合と同じ)
    onIncoming?.({ friendId: friend.id, accountId: lineAccountId, messageType: msg.type, content: finalContent });
    return;
  }

  if (event.type === 'message' && event.message.type === 'text') {
    const textMessage = event.message as TextEventMessage;
    const userId =
      event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;

    const friend = await ensureFriendFromWebhookUser(db, lineClient, userId, lineAccountId);
    if (!friend) return;

    const incomingText = textMessage.text;
    const now = jstNow();
    const logId = crypto.randomUUID();

    // 受信メッセージをログに記録
    await db
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, created_at)
         VALUES (?, ?, 'incoming', 'text', ?, NULL, NULL, 'user', ?)`,
      )
      .bind(logId, friend.id, incomingText, now)
      .run();

    await awardActivityMileage(db, {
      eventType: 'message_received',
      source: 'line',
      sourceEventId: logId,
      friendId: friend.id,
      metadata: { messageType: 'text' },
      occurredAt: now,
    });

    // (以前ここにあった「体験を完了する」の別アカウント連動デモは、アカウント別の友だち分離のため廃止)

    // 自動返信チェック（このアカウントのルール + グローバルルールのみ）。
    // silent タイプは返信しないが matched=true になり unread / push を抑止する。
    const { matched, replyTokenConsumed } = await matchAndReply(
      db,
      lineClient,
      friend,
      incomingText,
      event.replyToken,
      {
        inputKind: 'text',
        lineAccountId,
        workerUrl,
        liffUrl,
        replyMessage: workerUrl
          ? (token, messages) => replyViaHarnessProxy(
              workerUrl,
              lineAccessToken,
              token,
              messages,
              proxyDispatch,
            )
          : undefined,
      },
    );

    // auto_replies にマッチしなかった = 自発メッセージ → unread にする
    if (!matched) {
      await upsertChatOnMessage(db, friend.id);
      // 自動返信で処理済み(matched)のものは、未対応にしないのと同じく通知もしない
      onIncoming?.({ friendId: friend.id, accountId: lineAccountId, messageType: 'text', content: incomingText });
    }

    // イベントバス発火: message_received
    // Pass replyToken only when auto_reply didn't actually consume it
    await fireEvent(db, 'message_received', {
      friendId: friend.id,
      eventData: { text: incomingText, matched },
      replyToken: replyTokenConsumed ? undefined : event.replyToken,
    }, lineAccessToken, lineAccountId);

    return;
  }
}

export { webhook };
