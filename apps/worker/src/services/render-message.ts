// Broadcast template variables are expanded by L Harness before calling
// the Messaging API. LINE's official textV2.substitution supports mentions
// and LINE emoji only; it does not provide arbitrary recipient-name strings.
// name = LINE名(友だちの表示名)、real_name = 本名(友だち情報の「本名」。未登録の人には LINE名を入れる)
export const SUPPORTED_BROADCAST_VARIABLES = new Set(['name', 'real_name', 'liff_id']);

const BROADCAST_VARIABLE_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function getBroadcastVariables(content: string): string[] {
  return [...new Set([...content.matchAll(BROADCAST_VARIABLE_RE)].map((m) => m[1].trim()))];
}

/**
 * フォームのタグコード `{{form_url:フォームID}}` は、送信の直前に、配信アカウントの LIFF リンクへ展開される(form-link.ts)。
 * 展開前の本文を検査するときは、未対応の変数として扱わない(展開できずに残った場合は、展開後の
 * assertNoUnresolvedBroadcastVariables が止める)。
 */
const FORM_TAG_VARIABLE_RE = /^form_url:\S+$/;

export function getUnsupportedBroadcastVariables(content: string): string[] {
  return getBroadcastVariables(content).filter(
    (name) => !SUPPORTED_BROADCAST_VARIABLES.has(name) && !FORM_TAG_VARIABLE_RE.test(name),
  );
}

export function hasRecipientVariables(content: string): boolean {
  const vars = getBroadcastVariables(content);
  return vars.includes('name') || vars.includes('real_name');
}

/** 本名の差し込みを使っているか(使うときは、本名が未登録の人の数を、送る前に知らせる) */
export function usesRealName(content: string): boolean {
  return getBroadcastVariables(content).includes('real_name');
}

export interface BroadcastRenderContext {
  liffId?: string | null;
  /** LINE名 */
  displayName?: string | null;
  /** 本名(未登録なら、{{real_name}} には LINE名を入れる) */
  realName?: string | null;
}

export function renderMessageContent(
  content: string,
  liffIdOrContext: string | null | BroadcastRenderContext,
): string {
  const context: BroadcastRenderContext = typeof liffIdOrContext === 'object'
    ? liffIdOrContext ?? {}
    : { liffId: liffIdOrContext };

  let result = content;
  if (context.liffId) result = result.replace(/\{\{\s*liff_id\s*\}\}/g, context.liffId);
  if (context.displayName) result = result.replace(/\{\{\s*name\s*\}\}/g, context.displayName);
  const real = context.realName?.trim() || context.displayName;
  if (real) result = result.replace(/\{\{\s*real_name\s*\}\}/g, real);
  return result;
}

function renderJsonValue(value: unknown, context: BroadcastRenderContext): unknown {
  if (typeof value === 'string') return renderMessageContent(value, context);
  if (Array.isArray(value)) return value.map((item) => renderJsonValue(item, context));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        renderMessageContent(key, context),
        renderJsonValue(item, context),
      ]),
    );
  }
  return value;
}

/**
 * Flex content is JSON. Replacing raw bytes would break the JSON when a LINE
 * display name contains a quote, backslash, or newline, so render parsed string
 * values and serialize them again. Text content remains unchanged except for
 * the requested variables.
 */
export function renderBroadcastMessageContent(
  messageType: string,
  content: string,
  context: BroadcastRenderContext,
): string {
  if (messageType !== 'flex') return renderMessageContent(content, context);
  const parsed = JSON.parse(content) as unknown;
  return JSON.stringify(renderJsonValue(parsed, context));
}

export function assertNoUnresolvedBroadcastVariables(content: string): void {
  const unresolved = getBroadcastVariables(content);
  if (unresolved.length > 0) {
    throw new Error(`Unresolved broadcast variables: ${unresolved.map((v) => `{{${v}}}`).join(', ')}`);
  }
}
