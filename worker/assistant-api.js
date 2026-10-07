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

import { availableUnits, scopedViews } from "./assistant-schema.js";
import { mintVoiceSession, PlannerError, sqlGeneratorFor, answererFor } from "./assistant-model.js";
import { voiceInstructions, messageFor } from "./assistant-prompt.js";
import { REALTIME_TOOLS, TOOL_LABELS, runTool, ToolError } from "./assistant-tools.js";
import { chooseView, buildView, countsWholePortfolio } from "./assistant-views.js";
import { runSql, hydrateProjects, SqlRejected } from "./assistant-sql.js";
import { sealTurn, openTurn } from "./assistant-context.js";
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
// The developer's view of what ran. Off unless ASSISTANT_DEBUG is "true", which
// production asserts it is not: the queries carry no secrets and the scope
// applies either way, but handing every reader the shape of the database
// invites probing at it.
//
// Both engines pass through here. The SQL engine supplies its own statement,
// already wrapped in the scoped views; the planner supplies a plan and builds
// one, which is why that branch takes a builder rather than importing it -
// nothing on the active path may reach into legacy.
function debugFor(env, { plan, scope, result, outcome, question, sql, inner, rejected, planQueries }) {
  if (env.ASSISTANT_DEBUG !== "true") return undefined;
  let statement = sql || null, bindings, countSql;
  if (!statement && plan && typeof planQueries === "function") {
    const built = planQueries(plan, scope);
    statement = built.rows.sql;
    bindings = built.rows.bindings;
    countSql = formatSql(built.count.sql);
  }
  return {
    question,
    intent: outcome ? outcome.intent : "plan",
    followUp: outcome ? outcome.followUp : undefined,
    language: outcome ? outcome.language : undefined,
    plan: plan || undefined,
    // What the model wrote, before the worker wrapped it. This is the line a
    // developer reads first: the rest is the scoping the worker added.
    generated: inner ? formatSql(inner) : undefined,
    rejected: rejected || undefined,
    scope: scope || "unrestricted",
    where: statement ? whereOf(statement) : undefined,
    sql: statement ? formatSql(statement) : undefined,
    bindings,
    countSql,
    total: result ? result.total : 0,
    returned: result ? result.returned : 0,
    truncated: result ? result.truncated : false,
    aggregate: result ? result.aggregate : undefined,
    tables: result ? result.tables : undefined,
    usage: outcome ? outcome.usage : undefined,
  };
}

// The routes that answer a question by reading the database. In the new
// architecture these belong to the SQL generator and validator; until that
// exists they are served by the legacy planner, and only where it is switched
// on. Production leaves it off, so an environment without a query engine says
// so plainly rather than answering from a planner nobody meant to ship.
const QUERY_PATHS = new Set([
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
        instructions: voiceInstructions({
          units,
          name: user.name || user.email,
          today: new Date().toISOString().slice(0, 10),
        }),
        tools: REALTIME_TOOLS,
      });
      return json({ ...session, tools: REALTIME_TOOLS, labels: TOOL_LABELS, units });
    } catch (problem) {
      if (problem instanceof PlannerError) return error(problem.message, problem.status);
      throw problem;
    }
  }

  if (url.pathname === "/api/assistant/ask") {
    return askWithSql(request, env, user, role, scope, helpers);
  }

  // One data tool, run on behalf of the realtime voice model.
  //
  // The browser executes the tool call the model asked for and posts it here.
  // That is deliberate: the client then holds the result - and its View - before
  // the model has said a word, so the screen is already right while the sentence
  // is still being spoken.
  //
  // Nothing about the model's request widens what this reader may see. The tool
  // takes named filters, never SQL, and every statement it builds runs against
  // this session's scoped views. A forged id in `ids` reaches a row the reader
  // could already open or it reaches nothing.
  if (url.pathname === "/api/assistant/tool") {
    if (request.method !== "POST") return error("Method not allowed.", 405);
    const body = await request.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name : "";
    try {
      const outcome = await runTool(env.DB, name, body?.arguments, scope);
      await recordAsk(env, user, { intent: `tool:${name}`, language: "n/a", sql: null },
        { total: outcome.view.count ?? 0, returned: 0, truncated: false }, scope);
      return json({ ok: true, ...outcome, label: TOOL_LABELS[name] || "working" });
    } catch (problem) {
      if (problem instanceof ToolError) return error(problem.message, 400);
      console.log(`assistant tool ${name} failed: ${problem && problem.message}`);
      return error("That lookup could not be completed.", 502);
    }
  }

  // The planner's own routes, for as long as it is switched on. It is not the
  // active path: /ask above never reaches it.
  if (QUERY_PATHS.has(url.pathname)) {
    if (!legacyPlannerEnabled(env)) {
      return error("That endpoint belonged to the previous query engine and is no longer served.", 410);
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

// --- The query engine --------------------------------------------------------
// Question in, answer out. The model writes a SELECT; the worker checks it,
// binds it to this reader's scoped views, caps it, runs it, and then asks the
// model to put the result into words. The model never touches D1 and never
// decides what the reader may see.
async function askWithSql(request, env, user, role, scope, helpers) {
  const { json, error } = helpers;
  if (request.method !== "POST") return error("Method not allowed.", 405);
  const body = await request.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) return error("A question is required.");
  if (question.length > 500) return error("That question is too long. Keep it under 500 characters.");

  const generator = sqlGeneratorFor(env);
  if (!generator) return error("The assistant is not configured on this environment.", 503);

  // What the previous answer returned and what was asked before it. Both come
  // from the browser and are therefore untrusted, but neither can widen what
  // this reader sees: the scoped views are applied to whatever query comes
  // back, so a forged id reaches nothing they could not already open.
  // The previous turns, which the browser carries. Each one is a sealed token
  // this worker issued: the query inside it never reached the page, so a
  // follow-up works with ASSISTANT_DEBUG off exactly as it does with it on.
  // Opening one proves only that we sealed it; nothing in it widens what this
  // reader may see, because the scoped views are applied to whatever query
  // comes back regardless.
  const raw = body.context && typeof body.context === "object" ? body.context : null;
  const sealed = raw && typeof raw.token === "string" ? await openTurn(env, raw.token, user) : null;
  const context = raw
    ? {
      // The ids are the browser's own copy of what it was shown, so they are
      // taken either way; the conditions only come from a token we sealed.
      ids: Array.isArray(raw.ids)
        ? raw.ids.filter((id) => Number.isInteger(id) && id > 0).slice(0, 50)
        : (sealed ? sealed.ids : []),
      total: Number.isInteger(raw.total) ? raw.total : (sealed ? sealed.total : undefined),
      sql: sealed ? sealed.sql : undefined,
      entity: sealed ? sealed.entity : undefined,
    }
    : null;
  const history = [];
  for (const turn of Array.isArray(body.history) ? body.history.slice(-6) : []) {
    if (!turn || typeof turn.question !== "string" || !turn.question.trim()) continue;
    const opened = typeof turn.token === "string" ? await openTurn(env, turn.token, user) : null;
    history.push({
      question: turn.question.trim().slice(0, 300),
      intent: typeof turn.intent === "string" ? turn.intent.slice(0, 20) : undefined,
      total: Number.isInteger(turn.total) ? turn.total : (opened ? opened.total : undefined),
      sql: opened ? opened.sql : undefined,
    });
  }

  const units = await availableUnits(env.DB, scope);
  // The date comes from the runtime, never from the model. Without it "this
  // year" resolved to the model's training data and every relative date in the
  // audit came back wrong.
  const today = new Date().toISOString().slice(0, 10);

  let outcome;
  try {
    outcome = await generator.generate(question, { units, today, role, context, history });
  } catch (problem) {
    if (problem instanceof PlannerError) return error(problem.message, problem.status);
    console.log(`assistant sql generation failed: ${problem && problem.message}`);
    return error("The assistant could not be reached just now. Try that again.", 502);
  }

  // Intents answered from the message alone never reach the database.
  if (outcome.intent !== "search" && outcome.intent !== "report") {
    await recordAsk(env, user, { ...outcome, plan: null }, null, scope);
    return json({
      ok: true, intent: outcome.intent, language: outcome.language,
      message: messageFor(outcome.intent, outcome.message, units),
      rows: [], sources: [], total: 0,
      debug: debugFor(env, { plan: null, scope, result: null, outcome, question }),
    });
  }
  if (!outcome.sql) {
    return json({
      ok: true, intent: "unsupported", language: outcome.language,
      message: messageFor("unsupported", outcome.message, units),
      rows: [], sources: [], total: 0,
    });
  }

  // The worker is the boundary. A refused query is handed back to the model
  // once with the reason: it usually wrote something expressible a different
  // way, and a second attempt is cheaper than a dead end. A query refused
  // twice is reported rather than run.
  let result = null, rejected = null, sql = outcome.sql;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      result = await runSql(env.DB, sql, scope, { limit: body.limit });
      rejected = null;
      break;
    } catch (problem) {
      if (!(problem instanceof SqlRejected)) {
        console.log(`assistant query failed: ${problem && problem.message}`);
        return error("That question could not be answered against the Tracker's records.", 502);
      }
      rejected = problem;
      if (attempt === 1) break;
      try {
        const retry = await generator.generate(question, {
          units, today, role, context, history, retryReason: problem.message,
        });
        if (retry.intent !== "search" && retry.intent !== "report") {
          await recordAsk(env, user, { ...retry, plan: null }, null, scope);
          return json({
            ok: true, intent: retry.intent, language: retry.language,
            message: messageFor(retry.intent, retry.message, units),
            rows: [], sources: [], total: 0,
          });
        }
        if (!retry.sql) break;
        sql = retry.sql;
        outcome = { ...retry, usage: outcome.usage };
      } catch {
        break;
      }
    }
  }
  if (!result) {
    await recordAsk(env, user, { ...outcome, plan: null }, null, scope);
    return json({
      ok: true, intent: "unsupported", language: outcome.language,
      message: "That question cannot be answered from the records this assistant can read."
        + (rejected ? ` ${rejected.message}` : ""),
      rows: [], sources: [], total: 0,
      debug: debugFor(env, { plan: null, scope, result: null, outcome, question, sql, rejected: rejected && rejected.message }),
    });
  }

  // The records for the evidence panel, which are not the same thing as the
  // rows the query returned: the model selects what answers the question, the
  // panel needs the whole project. Read back through the same scoped views, so
  // this can only ever show what the query was already allowed to find.
  const records = result.aggregate ? [] : await hydrateProjects(env.DB, result.rows, scope);

  // The result goes back to the model for a sentence. If that call fails the
  // answer is still correct - the rows and the counts are already in hand - so
  // a plain sentence is written here rather than failing the whole question.
  const answerer = answererFor(env);
  let summary = fallbackSummary(result), answerUsage = null;
  if (answerer) {
    try {
      const spoken = await answerer.answer(question, result, { language: outcome.language, today });
      if (spoken.text) { summary = spoken.text; answerUsage = spoken.usage; }
    } catch (problem) {
      console.log(`assistant answer failed: ${problem && problem.message}`);
    }
  }

  await recordAsk(env, user, { ...outcome, plan: null, answerUsage }, result, scope);

  // Sealed for the next question. The browser stores it with the transcript and
  // hands it back; it cannot read it, and neither can anything else.
  const token = await sealTurn(env, {
    question, sql: result.inner, total: result.total, intent: outcome.intent,
    entity: result.entity,
    ids: records.length ? records.map((row) => row.id) : result.rows.map((row) => row.id),
  }, user);

  // The same result, looked at two ways: one or two sentences for the
  // conversation, and one workspace component for everything else. The model
  // proposed which component; chooseView checks that against what actually came
  // back and overrules it when they disagree.
  const kind = chooseView(outcome.view, { result, records });
  const view = buildView(kind, { result, records });

  // "How many projects are there?" is the first question anyone asks, and a
  // number on its own is a worse answer than the same number with its shape.
  // Only when the count provably covers the reader's whole portfolio, so the
  // breakdown cannot describe a different set from the figure above it.
  if (kind === "figure" && countsWholePortfolio(result)) {
    view.data.breakdown = await unitBreakdown(env.DB, scope);
  }

  // Two separate things: the sentence for the conversation, and the records for
  // the evidence panel. A list of rows does not belong in the sentence.
  return json({
    view,
    ok: true,
    intent: outcome.intent,
    language: outcome.language,
    followUp: outcome.followUp,
    summary,
    total: result.total,
    returned: result.returned,
    truncated: result.truncated,
    limit: result.limit,
    aggregate: result.aggregate,
    token,
    // What one matched row is, and how many distinct projects those rows are
    // about. A query joined to activity updates matches update rows: saying
    // "40 projects" of 40 updates across 30 projects is exactly the confident
    // wrong answer this feature exists to avoid.
    entity: result.entity,
    entityLabel: result.entityLabel,
    fannedOut: result.fannedOut,
    projects: result.projects || undefined,
    // The structured records the UI builds its cards from. When a question is
    // not about projects at all - a count, a group, a list of updates - there
    // are none, and the answer stands on its own.
    rows: records.length ? records : result.rows,
    // What the query itself returned, kept separate so a developer can see the
    // difference between what was asked for and what the panel was given.
    data: result.rows,
    sources: records.map((row) => ({ id: row.id, name: row.name, date: row.reporting_period })),
    // What was searched for, in words, so a misread question is visible beside
    // the answer rather than hidden behind a confident sentence.
    description: describeResult(result, question),
    sql: undefined,
    debug: debugFor(env, { plan: null, scope, result, outcome, question, sql: result.sql, inner: result.inner }),
  });
}

// The portfolio by business unit, through the same scoped views every other
// read goes through, so it can only ever describe what the reader may see.
async function unitBreakdown(db, scope) {
  try {
    const views = scopedViews(scope);
    const rows = await db.prepare(`${views.sql}
      SELECT business_unit AS label, COUNT(*) AS value
      FROM projects GROUP BY business_unit ORDER BY value DESC, business_unit`)
      .bind(...views.bindings).all();
    const results = rows.results || [];
    // One group is not a breakdown, it is the same number again.
    return results.length > 1 ? results : null;
  } catch {
    // Context, not the answer. A figure without it is still correct.
    return null;
  }
}

// Used when the answering call cannot be made. Correct, if plainer.
function fallbackSummary(result) {
  if (result.aggregate && result.rows.length === 1) {
    const values = Object.entries(result.rows[0])
      .map(([key, value]) => `${key.replace(/_/g, " ")}: ${value === null ? "not recorded" : value}`);
    return values.join(", ") + ".";
  }
  if (!result.total) return "No records matched that question.";
  return result.truncated
    ? `${result.total} records match. The first ${result.returned} are listed.`
    : `${result.total} record${result.total === 1 ? "" : "s"} matched.`;
}

// A short statement of what the query actually covered, built from its own
// shape rather than from the question, so the two can be compared.
function describeResult(result, question) {
  const parts = [];
  if (result.aggregate) parts.push("A single figure");
  else parts.push(`${result.total} matching record${result.total === 1 ? "" : "s"}`);
  if (result.truncated) parts.push(`showing the first ${result.returned}`);
  const tables = (result.tables || []).filter((t) => t !== "projects");
  if (tables.length) parts.push("including " + tables.join(" and ").replace(/_/g, " "));
  return parts;
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
        // The plan for the legacy planner, the query for the SQL engine. The
        // query is what makes an answer reproducible after the fact, which is
        // the whole reason this row exists; the rows it returned are still
        // never recorded.
        plan: outcome.plan || null,
        sql: outcome.sql || null,
        total: result ? result.total : null,
        returned: result ? result.returned : null,
        truncated: result ? result.truncated : null,
        scoped: scope !== null,
        usage: outcome.usage || null,
        answerUsage: outcome.answerUsage || null,
      }),
    ).run();
  } catch {
    // Recording only. A failed audit write must not fail the answer, which is
    // the same choice the profile-photo import makes.
  }
}
