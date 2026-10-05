// Assistant routes. Authentication, role, CSRF and forced-password checks have
// already run in handleApi() before this is reached, exactly as for enhancedApi.
//
// The whole surface is read-only. There is no route here that writes project
// data, and the release scope is deliberately search/report only — creating or
// editing records through conversation is not part of it.

import { validatePlan, runPlan, describePlan, planSchemaPrompt, availableUnits, PLAN_LIMIT_MAX } from "./assistant-plan.js";
import { plannerFor, PlannerError } from "./assistant-model.js";
import { messageFor, scopeNote } from "./assistant-prompt.js";

// A refused plan is reported with its reasons so the model can correct itself on
// the next turn, rather than being silently coerced into something that would
// answer a different question from the one asked.
// A rejection names what was wrong and what is available instead. The reasons
// come from validatePlan(), which already explains each one; this joins them
// into something a person can act on rather than a bare "invalid".
function refusalMessage(problems, units) {
  const reasons = (problems || []).filter(Boolean);
  if (!reasons.length) return "I could not turn that into a query I am allowed to run." + scopeNote(units);
  const joined = reasons.length === 1 ? reasons[0] : reasons.map((r) => `• ${r}`).join("\n");
  return `I could not run that query.\n${joined}`;
}

export async function assistantApi(request, env, user, role, scope, helpers) {
  const { json, error } = helpers, url = new URL(request.url);
  if (!url.pathname.startsWith("/api/assistant/")) return null;

  // The plan vocabulary, for building the model's system prompt. Served rather
  // than duplicated client-side so the browser and the validator cannot drift.
  if (request.method === "GET" && url.pathname === "/api/assistant/schema") {
    const units = await availableUnits(env.DB, scope);
    return json({ schema: planSchemaPrompt({ units }), units, limitMax: PLAN_LIMIT_MAX });
  }

  if (url.pathname === "/api/assistant/query") {
    if (request.method !== "POST") return error("Method not allowed.", 405);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return error("A query plan is required.");

    // The unit vocabulary is this user's own, so a unit outside their scope is
    // refused the same way a misspelling is, and cannot be used to discover
    // which other units exist.
    const units = await availableUnits(env.DB, scope);
    const { plan, problems } = validatePlan(body.plan, { units });
    if (!plan) {
      return json({ ok: false, error: refusalMessage(problems, units), problems }, 400);
    }

    const result = await runPlan(env.DB, plan, scope);

    // One audit row per query: who asked, the plan, and how many rows it
    // matched. Never the rows themselves — the audit trail records actions, not
    // the contents of what was read, which is the same rule the backup download
    // follows.
    await env.DB.prepare(`
      INSERT INTO audit_log (action, entity_type, entity_key, actor_id, actor_email, details)
      VALUES ('assistant_query', 'assistant', ?, ?, ?, ?)
    `).bind(
      `plan:${result.total}`, user.id, user.email,
      JSON.stringify({ plan, total: result.total, returned: result.returned, scoped: scope !== null }),
    ).run();

    return json({
      ok: true,
      total: result.total,
      returned: result.returned,
      truncated: result.truncated,
      limit: result.limit,
      rows: result.rows,
      sources: result.sources,
      // Shown beside the answer so a misread question is visible to the user
      // instead of producing a confident answer to something else.
      description: result.description,
      plan,
    });
  }

  // Question in, answer out. The model's only job is to produce a plan; the plan
  // is then validated and executed by exactly the same code /query uses, so a
  // question cannot reach data a plan could not.
  if (url.pathname === "/api/assistant/ask") {
    if (request.method !== "POST") return error("Method not allowed.", 405);
    const body = await request.json().catch(() => null);
    const question = typeof body?.question === "string" ? body.question.trim() : "";
    if (!question) return error("A question is required.");
    if (question.length > 500) return error("That question is too long. Keep it under 500 characters.");

    const planner = plannerFor(env);
    if (!planner) return error("The assistant is not configured on this environment.", 503);

    const units = await availableUnits(env.DB, scope);
    let outcome;
    try {
      outcome = await planner.plan(question, { units });
    } catch (problem) {
      if (problem instanceof PlannerError) return error(problem.message, problem.status);
      throw problem;
    }

    // Intents that are answered from the message alone never touch the
    // database. A refusal is a successful response, not an error: the user asked
    // something this assistant will not do, and saying so plainly is the answer.
    if (["definition", "help", "clarify", "refuse", "off_topic"].includes(outcome.intent)) {
      await recordAsk(env, user, outcome, null, scope);
      return json({
        ok: true, intent: outcome.intent, language: outcome.language,
        // Never null: a refusal or an out-of-scope question must say why, and
        // say what can be asked instead.
        message: messageFor(outcome.intent, outcome.message, units),
        rows: [], sources: [], total: 0,
      });
    }

    // The model's plan is validated exactly as a hand-written one would be. It
    // is not trusted because it came from the model.
    const { plan, problems } = validatePlan(outcome.plan, { units });
    if (!plan) {
      await recordAsk(env, user, outcome, null, scope);
      return json({
        ok: false, intent: outcome.intent, language: outcome.language,
        error: refusalMessage(problems, units), problems,
      }, 400);
    }

    const result = await runPlan(env.DB, plan, scope);
    await recordAsk(env, user, outcome, result, scope);
    return json({
      ok: true,
      intent: outcome.intent,
      language: outcome.language,
      message: outcome.message,
      total: result.total,
      returned: result.returned,
      truncated: result.truncated,
      limit: result.limit,
      rows: result.rows,
      sources: result.sources,
      description: result.description,
      plan,
    });
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

export { describePlan };
