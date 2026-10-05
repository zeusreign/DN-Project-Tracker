// Assistant routes. Authentication, role, CSRF and forced-password checks have
// already run in handleApi() before this is reached, exactly as for enhancedApi.
//
// The whole surface is read-only. There is no route here that writes project
// data, and the release scope is deliberately search/report only — creating or
// editing records through conversation is not part of it.

import { validatePlan, runPlan, describePlan, planSchemaPrompt, availableUnits, summarisePlan, PLAN_LIMIT_MAX } from "./assistant-plan.js";
import { plannerFor, mintVoiceSession, PlannerError } from "./assistant-model.js";
import { messageFor, scopeNote, voiceInstructions, VOICE_TOOLS } from "./assistant-prompt.js";

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

// Is this search term the question restated, rather than something to look for?
//
// It matters because dropping the two is not equally safe. "Over 100K budget"
// alongside minAmount 100000 says nothing the plan has not already said, so
// dropping it loses nothing. "Asbestos" alongside unit Gaming is a real
// condition: dropping that and returning every Gaming project would answer a
// question nobody asked, so the search stays and the answer is honestly empty.
//
// The signal is correspondence: a number in the text that a numeric field
// already carries, or text made entirely of words that describe the plan rather
// than name a record. One content word the list does not know - a venue, a
// supplier, a material - is enough to keep the search, which is the side to err
// on: keeping it yields an honestly empty answer, dropping it yields a confident
// wrong one.
const PLAN_WORDS = new Set([
  // what the plan's own fields are called
  "project", "projects", "budget", "budgets", "risk", "risks", "high", "medium",
  "low", "rated", "schedule", "scheduling", "cost", "costs", "variance",
  "overrun", "approved", "forecast", "anticipated", "final", "turnover",
  "status", "phase", "capital", "development", "unit", "units", "manager",
  // the words people use for those same things
  "issue", "issues", "problem", "problems", "trouble", "concern", "concerns",
  "exposure", "slipped", "slip", "slipping", "delayed", "delay", "delays",
  "late", "behind", "overbudget", "spend", "spending",
  // comparisons and quantities
  "over", "under", "above", "below", "more", "less", "than", "at", "least",
  "most", "day", "days", "week", "weeks", "month", "months", "year", "years",
  "k", "m", "usd", "dollars", "dollar",
  // the shape of a question, which carries no meaning to search for
  "give", "show", "list", "find", "get", "tell", "me", "us", "which", "what",
  "that", "those", "these", "have", "has", "having", "with", "without", "and",
  "or", "not", "the", "a", "an", "of", "in", "on", "is", "are", "any", "all",
  "projects_with", "please",
]);

export function restatesThePlan(plan) {
  const text = String(plan.search).toLowerCase().trim();

  // The same value already sitting in a field of its own. "What is John
  // Kolkowski working on" came back with manager and search both set to his
  // name: the manager filter was right, and the search looked for a person in
  // project names and venues, which matched nothing and emptied 18 projects.
  // A name is a real search term, so no vocabulary test can catch this - what
  // gives it away is that the plan already says it somewhere better.
  for (const field of ["manager", "requestor", "unit"]) {
    const value = plan[field];
    if (typeof value === "string" && value.trim() && value.trim().toLowerCase() === text) return true;
  }

  const numbers = [plan.minAmount, plan.minVariance, plan.minDelayDays]
    .filter((value) => typeof value === "number");
  for (const value of numbers) {
    const written = [
      String(value),
      value >= 1000 ? `${value / 1000}k` : null,
      value >= 1000000 ? `${value / 1000000}m` : null,
    ].filter(Boolean);
    if (written.some((form) => text.includes(form))) return true;
  }
  const words = text.split(/[^a-z0-9]+/).filter(Boolean);
  return words.length > 0 && words.every((word) => PLAN_WORDS.has(word) || /^\d+$/.test(word));
}

// Does the question actually point back at the previous answer?
//
// The model declares followUp, and declares it wrongly often enough to matter:
// "give projects with high budget risks" came back as a follow-up and was
// answered inside eleven unrelated projects, finding none of the five. A
// question that genuinely depends on the previous answer says so in words, so
// the declaration is only honoured when the wording agrees with it. Being wrong
// in this direction widens the search, which for a question with a subject of
// its own is what was asked anyway.
const BACK_REFERENCE = /\b(these|those|them|they|their|theirs|it|its|that|this|same|ones|above|previous|earlier|instead|also|narrow|exclude|just those|of the above)\b/i;

export function refersBack(question) {
  return BACK_REFERENCE.test(String(question || ""));
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
      // Anything else - a dropped connection to the model most often - became an
      // unhandled 500 with no body, which the browser showed as "the tracker
      // could not complete the request". That named the wrong thing: the tracker
      // was fine, the call to the model was not.
      console.log(`assistant ask failed: ${problem && problem.message}`);
      return error("The assistant could not be reached just now. Try that again.", 502);
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

    // ids may only ever name records the previous answer returned. Left to the
    // prompt the model invents them - a question with no context at all came
    // back with ids [1, 2], which are real projects and the wrong ones. Scope
    // still applied, so nothing leaked, but the answer would have been a
    // confident list of two unrelated projects.
    // A follow-up is narrowed by the server, not by the model copying ids back.
    // Asked "which of these have a budget over 2M", the model declared the
    // follow-up but left the ids out, so the question was answered across the
    // whole portfolio: 14 projects where 8 of the previous 11 qualified. The ids
    // are ours already; the model only has to say that the question follows on.
    const followsOn = outcome.followUp && refersBack(question);
    if (followsOn && context && context.ids && context.ids.length && !plan.ids) {
      plan.ids = context.ids;
    }

    if (plan.ids) {
      const allowed = new Set((context && context.ids) || []);
      const kept = plan.ids.filter((id) => allowed.has(id));
      if (kept.length !== plan.ids.length) {
        if (kept.length) plan.ids = kept;
        else delete plan.ids;
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
      if (fromContext && !followsOn) {
        delete plan.ids;
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
      }
    }

    // A search that restates the question is dropped before the query runs, not
    // rescued after it returns nothing. Matching word by word means such a
    // search now finds noise rather than nothing - "budget over 1" matches any
    // project whose update mentions a budget - and a wrongly narrowed answer
    // never reaches the zero that a rescue waits for.
    // "Every project that is not complete" came back with excludeComplete and
    // status Active together, which answers a narrower question: it drops the
    // ones on hold, in closeout or awaiting a status, all of which the question
    // asked to see. The two are redundant in any case - a status already decides
    // completeness - and when the status word appears nowhere in the question,
    // it is the invented half.
    if (plan.excludeComplete && plan.status
      && !question.toLowerCase().includes(plan.status.toLowerCase())) {
      delete plan.status;
    }

    const realFilters = Object.keys(plan).filter((key) => key !== "search" && key !== "limit"
      && key !== "sort" && key !== "unit" && key !== "ids"
      && key !== "includeUpdates" && key !== "includePhotos");
    if (plan.search && realFilters.length && restatesThePlan(plan)) delete plan.search;

    let result = await runPlan(env.DB, plan, scope);

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
      // Built from the plan that ran, so it states what was actually searched
      // for rather than that something was found. It also carries what the
      // notices used to: a question read wrongly produces a sentence that does
      // not match what was asked.
      summary: summarisePlan(plan, result.total),
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
