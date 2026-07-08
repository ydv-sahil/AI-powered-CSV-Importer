/**
 * Parsing JSON that came out of a language model.
 *
 * Even in JSON mode, models occasionally wrap output in a markdown fence, prefix
 * it with "Here is the JSON:", or truncate mid-object when they hit the token
 * ceiling. This module recovers what it can and fails loudly when it can't.
 */

export class JsonRecoveryError extends Error {
  override readonly name = 'JsonRecoveryError';
}

/** Strip ```json … ``` fences and any prose before the first brace. */
function stripFences(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  return (fenced?.[1] ?? text).trim();
}

/**
 * Extract the outermost balanced `{…}` or `[…]`, ignoring braces inside strings.
 * Returns null when no balanced structure exists.
 */
function extractBalanced(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start === -1) return null;

  const open = text[start] as '{' | '[';
  const close = open === '{' ? '}' : ']';

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === open) depth++;
    else if (char === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

/**
 * A truncated response leaves us with `{"records":[{…},{…},{"name":"Pri`.
 * Everything before the last complete element is still perfectly good data.
 * Close the structure by hand and salvage it.
 */
function repairTruncated(text: string): string | null {
  const lastComplete = text.lastIndexOf('}');
  if (lastComplete === -1) return null;

  const head = text.slice(0, lastComplete + 1);

  // Re-walk to learn which brackets are still open, ignoring string contents.
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (const char of head) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{' || char === '[') stack.push(char);
    else if (char === '}' || char === ']') stack.pop();
  }

  const closers = stack
    .reverse()
    .map((open) => (open === '{' ? '}' : ']'))
    .join('');

  return head + closers;
}

/**
 * Best-effort parse of model output.
 * @throws {JsonRecoveryError} when nothing parseable can be recovered.
 */
export function parseLlmJson<T = unknown>(raw: string): T {
  const cleaned = stripFences(raw);

  const candidates = [
    cleaned,
    extractBalanced(cleaned),
    repairTruncated(extractBalanced(cleaned) ?? cleaned),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Try the next, more aggressive, recovery.
    }
  }

  const preview = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
  throw new JsonRecoveryError(`Model did not return parseable JSON. Received: ${preview}`);
}
