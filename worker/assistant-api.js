// Assistant routes. Authentication, role, CSRF and forced-password checks have
// already run in handleApi() before this is reached, exactly as for enhancedApi.
//
// The whole surface is read-only. There is no route here that writes project
// data, and the release scope is deliberately search/report only — creating or
// editing records through conversation is not part of it.

import { validatePlan, runPlan, describePlan, planSchemaPrompt, availableUnits, PLAN_LIMIT_MAX } from "./assistant-plan.js";

// A refused plan is reported with its reasons so the model can correct itself on
// the next turn, rather than being silently coerced into something that would
// answer a different question from the one asked.
const REFUSED = "That request could not be turned into a valid query.";

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
    if (!plan) return json({ ok: false, error: REFUSED, problems }, 400);

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

  return error("Not found.", 404);
}

export { describePlan };
