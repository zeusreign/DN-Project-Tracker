// Conversation continuity without handing the reader the database.
//
// A follow-up - "which of those are not Gaming", "what is their total budget",
// "what about Corporate?" - needs the previous query, not just the ids it
// returned: the ids pin a set, the query carries the conditions that made it.
// Returning that query to the browser would hand every reader the shape of the
// schema, which is the one thing ASSISTANT_DEBUG exists to withhold.
//
// So the query goes back sealed. The browser stores an opaque string with the
// rest of its transcript and hands it back on the next question; the worker
// opens it and nobody else can. This keeps the existing architecture - the
// conversation lives in the browser, the worker stays stateless, no new table,
// no new retention - while the model gets exactly what it had before.
//
// The seal is not a permission boundary. A forged or replayed token reaches
// nothing, because the scoped views are applied to whatever query comes back
// regardless of where it came from. What the seal buys is that the contents
// cannot be read or edited by the page that holds them.

const VERSION = "a1";
const TTL_SECONDS = 2 * 60 * 60;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64Url = (bytes) => btoa(String.fromCharCode(...bytes))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (text) => {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

// The key is derived per worker, from a dedicated secret when one is set and
// from the API key otherwise. Either way it never leaves this file, and a
// deployment without an assistant has nothing to derive and seals nothing.
const keyCache = new Map();
async function sealingKey(env) {
  const secret = env.ASSISTANT_CONTEXT_SECRET || env.OPENAI_API_KEY;
  if (!secret) return null;
  if (keyCache.has(secret)) return keyCache.get(secret);
  const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode("dn-dc-assistant-context"), info: encoder.encode(VERSION) },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  keyCache.set(secret, key);
  return key;
}

// Seals one turn: the query that ran, the rows it named, and who it was for.
// Returns null rather than throwing, because a conversation that cannot be
// sealed should degrade to ids-only continuity, not fail the answer.
export async function sealTurn(env, turn, user) {
  try {
    const key = await sealingKey(env);
    if (!key) return null;
    const payload = JSON.stringify({
      q: String(turn.question || "").slice(0, 300),
      s: String(turn.sql || "").slice(0, 2000),
      i: Array.isArray(turn.ids) ? turn.ids.slice(0, 50) : [],
      t: Number.isInteger(turn.total) ? turn.total : null,
      n: turn.intent || null,
      e: turn.entity || null,
      u: user && user.id != null ? String(user.id) : null,
      x: Math.floor(Date.now() / 1000) + TTL_SECONDS,
    });
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(await crypto.subtle.encrypt(
      { name: "AES-GCM", iv }, key, encoder.encode(payload)));
    const joined = new Uint8Array(iv.length + sealed.length);
    joined.set(iv);
    joined.set(sealed, iv.length);
    return `${VERSION}.${toBase64Url(joined)}`;
  } catch {
    return null;
  }
}

// Opens one. Anything wrong with it - wrong version, tampered, expired, or
// sealed for a different user - returns null and the turn simply has less
// context than it might have had.
export async function openTurn(env, token, user) {
  if (typeof token !== "string" || !token.startsWith(`${VERSION}.`)) return null;
  try {
    const key = await sealingKey(env);
    if (!key) return null;
    const joined = fromBase64Url(token.slice(VERSION.length + 1));
    if (joined.length < 13) return null;
    const opened = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: joined.slice(0, 12) }, key, joined.slice(12));
    const payload = JSON.parse(decoder.decode(opened));
    if (!payload || typeof payload !== "object") return null;
    if (typeof payload.x === "number" && payload.x < Math.floor(Date.now() / 1000)) return null;
    // Bound to the reader it was issued to. Scope would stop a borrowed token
    // reaching anything either way; this stops one reader's conversation being
    // continued as another's, which would be confusing rather than dangerous.
    if (payload.u && user && user.id != null && payload.u !== String(user.id)) return null;
    return {
      question: typeof payload.q === "string" ? payload.q : "",
      sql: typeof payload.s === "string" && payload.s ? payload.s : null,
      ids: Array.isArray(payload.i) ? payload.i.filter((id) => Number.isInteger(id) && id > 0) : [],
      total: Number.isInteger(payload.t) ? payload.t : undefined,
      intent: typeof payload.n === "string" ? payload.n : undefined,
      entity: typeof payload.e === "string" ? payload.e : undefined,
    };
  } catch {
    return null;
  }
}
