// The model call, behind a one-method interface.
//
// Everything above this file works without a model: the planner is resolved
// from env, so a test or a preview can supply a stub and exercise every path —
// refusals, clarification, scope, audit — with no network and no API key. That
// is deliberate: the parts of this feature that can be wrong in costly ways are
// the permission and correctness paths, and they should not need a paid call to
// test.

import { systemPrompt, planResponseSchema, compactPlan, contextNote, INTENTS } from "./assistant-prompt.js";

export const DEFAULT_PLANNER_MODEL = "gpt-4o-mini";
const ENDPOINT = "https://api.openai.com/v1/responses";

export class PlannerError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "PlannerError";
    this.status = status;
  }
}

// Normalises whatever the model returned into the shape the route expects, and
// refuses anything outside it rather than passing a surprise downstream.
function readPlannerOutput(parsed) {
  if (!parsed || typeof parsed !== "object") throw new PlannerError("The assistant returned no plan.");
  const intent = INTENTS.includes(parsed.intent) ? parsed.intent : null;
  if (!intent) throw new PlannerError(`The assistant returned an unknown intent "${parsed.intent}".`);
  return {
    intent,
    language: typeof parsed.language === "string" ? parsed.language.slice(0, 40) : "English",
    message: typeof parsed.message === "string" && parsed.message.trim() ? parsed.message.trim() : null,
    plan: compactPlan(parsed.plan),
  };
}

export function openAiPlanner({ apiKey, model = DEFAULT_PLANNER_MODEL, fetchImpl }) {
  if (!apiKey) throw new PlannerError("No OpenAI API key is configured.", 503);
  const call = fetchImpl || fetch;
  return {
    model,
    async plan(question, { units, context } = {}) {
      const response = await call(ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          // Deterministic: the same question should produce the same plan, and
          // creativity has no value when the output is a filter set.
          temperature: 0,
          max_output_tokens: 800,
          input: [
            { role: "system", content: systemPrompt({ units }) },
            // The previous answer, when there was one. Sent as its own system
            // turn rather than folded into the question, so a question that
            // happens to contain id-like numbers cannot be read as context.
            ...(contextNote(context) ? [{ role: "system", content: contextNote(context) }] : []),
            { role: "user", content: question },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "tracker_query_plan",
              strict: true,
              schema: planResponseSchema({ units }),
            },
          },
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        // The upstream body can carry the key's organisation and quota details,
        // so only the status travels any further than this log line.
        console.log(`assistant planner failed: ${response.status} ${detail.slice(0, 300)}`);
        throw new PlannerError(
          response.status === 401 ? "The assistant's API key was rejected."
            : response.status === 429 ? "The assistant is rate limited. Try again shortly."
            : "The assistant could not be reached.",
          response.status === 401 ? 503 : 502,
        );
      }

      const body = await response.json();
      const text = typeof body.output_text === "string" && body.output_text
        ? body.output_text
        : (body.output || [])
          .flatMap((item) => item.content || [])
          .map((part) => part.text)
          .filter(Boolean)
          .join("");
      let parsed;
      try { parsed = JSON.parse(text); } catch {
        throw new PlannerError("The assistant's reply was not valid JSON.");
      }
      return {
        ...readPlannerOutput(parsed),
        usage: {
          model,
          inputTokens: body.usage?.input_tokens ?? null,
          outputTokens: body.usage?.output_tokens ?? null,
        },
      };
    },
  };
}

// Resolution order: an injected planner first, so tests and previews can run
// the whole feature without a key; then a real one built from the secret.
export function plannerFor(env) {
  if (env.ASSISTANT_PLANNER && typeof env.ASSISTANT_PLANNER.plan === "function") {
    return env.ASSISTANT_PLANNER;
  }
  if (!env.OPENAI_API_KEY) return null;
  return openAiPlanner({
    apiKey: env.OPENAI_API_KEY,
    model: env.ASSISTANT_PLANNER_MODEL || DEFAULT_PLANNER_MODEL,
  });
}

export { readPlannerOutput };
