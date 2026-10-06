// LEGACY. The model adapter of the closed 31-field planner: it asks for a plan
// and normalises what comes back.
//
// The envelope is the part worth keeping and is written out here only because
// the adapter is: temperature 0 because the same question should produce the
// same query and creativity has no value in a filter set, a strict json_schema
// so the shape cannot drift, and one shared error mapping. The new SQL
// generator should be built the same way.

import { PlannerError, RESPONSES_ENDPOINT, openAiFailure } from "../assistant-model.js";
import { INTENTS } from "../assistant-prompt.js";
import { systemPrompt, planResponseSchema, compactPlan, contextNote, historyNote } from "./assistant-plan-prompt.js";

export const DEFAULT_PLANNER_MODEL = "gpt-4o-mini";

// Normalises whatever the model returned into the shape the route expects, and
// refuses anything outside it rather than passing a surprise downstream.
function readPlannerOutput(parsed) {
  if (!parsed || typeof parsed !== "object") throw new PlannerError("The assistant returned no plan.");
  const intent = INTENTS.includes(parsed.intent) ? parsed.intent : null;
  if (!intent) throw new PlannerError(`The assistant returned an unknown intent "${parsed.intent}".`);
  return {
    intent,
    followUp: parsed.followUp === true,
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
    async plan(question, { units, context, history } = {}) {
      const response = await call(RESPONSES_ENDPOINT, {
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
            ...(historyNote(history) ? [{ role: "system", content: historyNote(history) }] : []),
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
        throw openAiFailure(response.status, await response.text().catch(() => ""), "planner");
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
export function legacyPlannerFor(env) {
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
