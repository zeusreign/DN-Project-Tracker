// Assistant routes. Authentication, role, CSRF and forced-password checks have
// already run in handleApi() before this is reached, exactly as for enhancedApi.
//
// The whole surface is read-only. There is no route here that writes project
// data, and the release scope is deliberately search/report only - creating or
// editing records through conversation is not part of it.
//
// What this file owns is everything a query engine needs around it: the routes,
// the guards, the conversation transport, the developer view of what ran, and
// the audit row. What turns a question into a query sits behind it and is being
// replaced: the structured planner is kept in ./legacy/ as a development-only
// fallback so this endpoint keeps answering while the SQL-generating engine is
// built.

import { availableUnits } from "./assistant-schema.js";
import { mintVoiceSession, PlannerError } from "./assistant-model.js";
import { voiceInstructions, VOICE_TOOLS } from "./assistant-prompt.js";
import { legacyPlanRoutes } from "./legacy/assistant-plan-route.js";

const BACK_REFERENCE = /\b(these|those|them|they|their|theirs|it|its|that|this|same|ones|above|previous|earlier|instead|also|narrow|exclude|just those|of the above)\b/i;

export function refersBack(question) {
  return BACK_REFERENCE.test(String(question || ""));
}

// Laid out so it can be read. Collapsing the statement to one line turned it
// into a wall that hid the only part anyone is looking at - the conditions.
// Depth is tracked so the CASE expressions inside the derived columns keep
// their own ANDs rather than being broken across lines with the real ones.
const SQL_KEYWORDS = ["FROM", "LEFT JOIN", "JOIN", "WHERE", "GROUP BY", "ORDER BY", "LIMIT"];

export function formatSql(sql) {
  const text = String(sql).replace(/\s+/g, " ").trim();
  let out = "";
  let depth = 0;
  // CASE ... END is not parenthesised in the select list, so bracket depth
  // alone let an AND from inside one be broken out as though it were a
  // condition of the query.
  let caseDepth = 0;
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") quoted = !quoted;
    if (!quoted) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;

      if (ch === " ") {
        const ahead = text.slice(i + 1);
        if (/^CASE\b/i.test(ahead)) caseDepth++;
        if (/^END\b/i.test(ahead)) caseDepth = Math.max(0, caseDepth - 1);
      }

      if (depth === 0 && caseDepth === 0 && ch === " ") {
        const rest = text.slice(i + 1);
        const keyword = SQL_KEYWORDS.find((word) => rest.toUpperCase().startsWith(word + " "));
        if (keyword) { out += "\n" + keyword; i += keyword.length; continue; }
        if (/^AND /i.test(rest)) { out += "\n  AND"; i += 3; continue; }
        if (/^OR /i.test(rest)) { out += "\n  OR"; i += 2; continue; }
      }
      // The column list is long and identical every time, so it wraps rather
      // than running off the side.
      if (depth === 0 && caseDepth === 0 && ch === ",") { out += ",\n  "; continue; }
    }
    out += ch;
  }
  return out.replace(/\n\s*\n/g, "\n").replace(/ +$/gm, "").trim();
}

// The conditions on their own. In practice this is the line a developer reads
// first, and digging it out of the full statement every time is a chore.
export function whereOf(sql) {
  const match = /\bWHERE\b([\s\S]*?)(?:\bORDER BY\b|\bLIMIT\b|$)/i.exec(String(sql).replace(/\s+/g, " "));
  return match ? formatSql("WHERE" + match[1]).replace(/^WHERE\s*/, "") : "";
}

// What a developer needs to see to tell a wrong answer from a wrong question:
// the plan the model produced, the SQL it became, and the values bound into it.
// Off unless the environment asks for it, and asserted off for production by
// scripts/check-deploy-target.sh.
function debugFor(env, { plan, scope, result, outcome, question }) {
  if (env.ASSISTANT_DEBUG !== "true") return undefined;
  const { rows, count } = planQueries(plan, scope);
  return {
    question,
    intent: outcome ? outcome.intent : "plan",
    followUp: outcome ? outcome.followUp : undefined,
    language: outcome ? outcome.language : undefined,
    plan,
    scope: scope || "unrestricted",
    where: whereOf(rows.sql),
    sql: formatSql(rows.sql),
    bindings: rows.bindings,
    countSql: formatSql(count.sql),
    total: result ? result.total : 0,
    returned: result ? result.returned : 0,
    loosened: result ? result.loosened : false,
    usage: outcome ? outcome.usage : undefined,
  };
}

// The routes that answer a question by reading the database. In the new
// architecture these belong to the SQL generator and validator; until that
// exists they are served by the legacy planner, and only where it is switched
// on. Production leaves it off, so an environment without a query engine says
// so plainly rather than answering from a planner nobody meant to ship.
const QUERY_PATHS = new Set([
  "/api/assistant/ask",
  "/api/assistant/query",
  "/api/assistant/schema",
]);

// Development only, and asserted off for production by
// scripts/check-deploy-target.sh alongside ASSISTANT_DEBUG.
export const legacyPlannerEnabled = (env) => env.ASSISTANT_LEGACY_PLANNER === "true";

export async function assistantApi(request, env, user, role, scope, helpers) {
  const { json, error } = helpers, url = new URL(request.url);
  if (!url.pathname.startsWith("/api/assistant/")) return null;

  // A short-lived credential for the browser's own realtime connection. The
  // account key stays here; what the browser gets expires in about a minute, so
  // this is called when a call starts and not when the page loads.
  //
  // It is a POST so the CSRF gate above applies: minting a credential is not a
  // read, and a page on another origin must not be able to start a call with
  // this user's session.
  if (url.pathname === "/api/assistant/voice-session") {
    if (request.method !== "POST") return error("Method not allowed.", 405);
    const units = await availableUnits(env.DB, scope);
    try {
      const session = await mintVoiceSession(env, {
        instructions: voiceInstructions({ units, name: user.name || user.email }),
        tools: VOICE_TOOLS,
      });
      return json({ ...session, tools: VOICE_TOOLS, units });
    } catch (problem) {
      if (problem instanceof PlannerError) return error(problem.message, problem.status);
      throw problem;
    }
  }

  if (QUERY_PATHS.has(url.pathname)) {
    if (!legacyPlannerEnabled(env)) {
      return error("The assistant's query engine is not available on this environment.", 503);
    }
    // The shared parts are handed over rather than imported back, so the
    // dependency runs one way: legacy knows nothing about this file.
    const answered = await legacyPlanRoutes(request, env, user, scope, helpers, {
      refersBack, debugFor, recordAsk, availableUnits,
    });
    if (answered) return answered;
  }

  return error("Not found.", 404);
}

// One audit row per question. It records the intent, the language, the plan,
// the row count and what the call cost in tokens — never the question text and
// never the rows. Transcripts live in the browser by decision; storing the
// question server-side would quietly reintroduce the retention that decision
// avoided, and the audit trail's existing rule is to record actions rather than
// the contents of what was read.
async function recordAsk(env, user, outcome, result, scope) {
  try {
    await env.DB.prepare(`
      INSERT INTO audit_log (action, entity_type, entity_key, actor_id, actor_email, details)
      VALUES ('assistant_ask', 'assistant', ?, ?, ?, ?)
    `).bind(
      `${outcome.intent}:${result ? result.total : 0}`, user.id, user.email,
      JSON.stringify({
        intent: outcome.intent,
        language: outcome.language,
        plan: outcome.plan,
        total: result ? result.total : null,
        returned: result ? result.returned : null,
        scoped: scope !== null,
        usage: outcome.usage || null,
      }),
    ).run();
  } catch {
    // Recording only. A failed audit write must not fail the answer, which is
    // the same choice the profile-photo import makes.
  }
}
