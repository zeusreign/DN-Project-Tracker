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

    // What the previous answer returned, so "which of these" narrows it rather
    // than silently searching the whole portfolio again. It arrives from the
    // browser and is therefore untrusted, but it can only ever narrow: runPlan
    // applies the user's scope regardless of what ids are named, so a forged
    // list reaches nothing the caller could not already see.
    const raw = body.context && typeof body.context === "object" ? body.context : null;
    const context = raw && Array.isArray(raw.ids)
      ? {
        ids: raw.ids.filter((id) => Number.isInteger(id) && id > 0).slice(0, 50),
        total: Number.isInteger(raw.total) ? raw.total : undefined,
        description: Array.isArray(raw.description)
          ? raw.description.filter((part) => typeof part === "string").slice(0, 12)
          : undefined,
        // Re-validated rather than trusted: it came from the browser, and it is
        // shown to the model as the previous question's conditions.
        plan: raw.plan && typeof raw.plan === "object" && !Array.isArray(raw.plan)
          ? validatePlan(raw.plan).plan || undefined
          : undefined,
      }
      : null;

    // The questions asked so far, so a correction can be told from a narrowing.
    // Untrusted, like the context: capped, string-checked, and every plan
    // re-validated. None of it widens what the caller may see.
    const history = Array.isArray(body.history)
      ? body.history.slice(-6)
        .filter((turn) => turn && typeof turn.question === "string" && turn.question.trim())
        .map((turn) => ({
          question: turn.question.trim().slice(0, 300),
          intent: typeof turn.intent === "string" ? turn.intent.slice(0, 20) : undefined,
          total: Number.isInteger(turn.total) ? turn.total : undefined,
          plan: turn.plan && typeof turn.plan === "object" && !Array.isArray(turn.plan)
            ? validatePlan(turn.plan).plan || undefined
            : undefined,
        }))
      : [];

    const planner = plannerFor(env);
    if (!planner) return error("The assistant is not configured on this environment.", 503);

    const units = await availableUnits(env.DB, scope);
    let outcome;
    try {
      outcome = await planner.plan(question, { units, context, history });
    } catch (problem) {
      if (problem instanceof PlannerError) return error(problem.message, problem.status);
      throw problem;
    }

    // Intents that are answered from the message alone never touch the
    // database. A refusal is a successful response, not an error: the user asked
    // something this assistant will not do, and saying so plainly is the answer.
    if (["definition", "help", "clarify", "refuse", "off_topic", "unsupported"].includes(outcome.intent)) {
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

    // The model declares whether this question depends on the previous answer.
    // When it does not, ids carried in from the context are the previous answer
    // leaking into a new question - "give projects with high budget risks" is
    // not a question about the one project just shown - so they are dropped.
    const notices = [];

    // ids may only ever name records the previous answer returned. Left to the
    // prompt the model invents them - a question with no context at all came
    // back with ids [1, 2], which are real projects and the wrong ones. Scope
    // still applied, so nothing leaked, but the answer would have been a
    // confident list of two unrelated projects.
    if (plan.ids) {
      const allowed = new Set((context && context.ids) || []);
      const kept = plan.ids.filter((id) => allowed.has(id));
      if (kept.length !== plan.ids.length) {
        if (kept.length) plan.ids = kept;
        else delete plan.ids;
        notices.push("Answered across every project: this question did not follow on from the previous answer.");
      }
    }

    if (plan.ids && context && context.ids && context.ids.length) {
      const fromContext = plan.ids.every((id) => context.ids.includes(id));
      // Only when the model says this is not a follow-up. An earlier version
      // also dropped the context whenever a search term was present, which threw
      // away the context of a genuine follow-up - "which of these are above 50k"
      // carries a restated search the dead-search retry below is there to
      // handle, and answering it across the whole portfolio is a different
      // question.
      if (fromContext && !outcome.followUp) {
        delete plan.ids;
        notices.push("Searched every project, not only the previous answer.");
      }
    }

    // "Not high" keeps everything rated Medium, Low or Not Rated. The model
    // keeps also setting the positive field - scheduleRisk Low beside
    // excludeScheduleRisk High - which demands exactly Low and drops the rest.
    // Two prompt rules did not stop it, so the contradiction is resolved here:
    // the exclusion is what the question said, the positive is invented.
    for (const rating of ["budget", "schedule"]) {
      const positive = `${rating}Risk`;
      const negative = `exclude${rating[0].toUpperCase()}${rating.slice(1)}Risk`;
      if (plan[positive] && plan[negative] && plan[positive] !== plan[negative]) {
        delete plan[positive];
        notices.push(`Read “not ${plan[negative]}” as any other ${rating} rating, not only ${rating === "budget" ? "one" : "one"} in particular.`);
      }
    }

    let result = await runPlan(env.DB, plan, scope);

    // A free-text search that matches nothing empties the whole result, even
    // when every other filter was right. The model keeps restating the question
    // in it - "budget over 50000" is not a project name - and a prompt rule did
    // not stop that, so the server handles it: retry once without the search and
    // say so. The alternative is answering "none" to a question with ten
    // answers, which is the failure this assistant exists to avoid.
    //
    // Only when something else was actually asked for. Dropping the search from
    // a plan that is nothing but a search would answer a different question.
    // ids are not a filter the question asked for - they are the previous
    // answer. A plan of {ids, search} is a new subject the model wrongly kept
    // context on, so dropping the search would hand back the previous answer as
    // though it answered this question. That is worse than finding nothing.
    const otherFilters = Object.keys(plan).filter((key) => key !== "search" && key !== "limit"
      && key !== "sort" && key !== "unit" && key !== "ids");
    if (result.total === 0 && plan.search && otherFilters.length) {
      const widened = { ...plan };
      delete widened.search;
      const retry = await runPlan(env.DB, widened, scope);
      if (retry.total > 0) {
        notices.push(`No project matched “${plan.search}”, so that part was ignored.`);
        result = retry;
        plan.search = undefined;
        delete plan.search;
      }
    }

    await recordAsk(env, user, outcome, result, scope);
    return json({
      ok: true,
      intent: outcome.intent,
      language: outcome.language,
      followUp: outcome.followUp,
      message: outcome.message,
      total: result.total,
      returned: result.returned,
      truncated: result.truncated,
      limit: result.limit,
      rows: result.rows,
      sources: result.sources,
      description: result.description,
      // Only corrections are meant for the reader: they explain a result that
      // would otherwise look wrong. The filter list stays in the payload for the
      // audit row and the tests, but is no longer shown.
      notices,
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
