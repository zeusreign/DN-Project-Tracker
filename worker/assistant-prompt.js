// What the model is told, and the shape it must answer in.
//
// Both are generated from PLAN_FIELDS in assistant-plan.js rather than written
// out here, so the model can never be told about a field that does not exist,
// nor left unaware of one that does. The same declaration validates whatever
// comes back, so prompt, schema and validator move together or not at all.

import { PLAN_FIELDS, planSchemaPrompt } from "./assistant-plan.js";

// Intents, following the Ask the Tracker pilot so its UI needs no translation.
// Only "search" and "report" reach the database; the rest are answered from the
// message alone.
export const INTENTS = ["search", "report", "definition", "help", "clarify", "refuse", "off_topic"];

// Domain rules the model cannot infer from column names. Each one exists
// because getting it wrong produces a confident wrong answer rather than an
// error — the failure mode this whole feature has to avoid.
const DOMAIN_RULES = `
Domain rules for this tracker:
- "Days" means the current turnover date minus the original turnover date, in
  whole days. Positive means the project has slipped later.
- "Variance" means anticipated final cost minus approved budget. Positive means
  over budget. Never the other way round.
- "Current", "open" and "live" exclude archived projects. Archived projects are
  never returned at all, so you do not need to filter for that.
- Dates are plain YYYY-MM-DD text.
- A Capital project has a CAPP number; a Development project has an initiative
  number and sits in the development pipeline.
- Risk is rated separately for budget and for schedule. "High risk" with no
  further qualification means either of them is High.
- Amounts are in dollars with no currency symbol.`;

const BEHAVIOUR = `
How to answer:
- Translate the question into a plan. Do not write SQL and do not name tables or
  columns that are not plan fields.
- Set only the fields the question actually constrains. An absent field means no
  filter, which is almost always what a broad question wants.
- If the question asks to create, change, delete or approve anything, use intent
  "refuse": this assistant only reads.
- If the question is not about construction projects, budgets, schedules, risk,
  photos or activity updates, use intent "off_topic".
- If it names a venue or project ambiguously and the answer depends on which one
  is meant, use intent "clarify" and say what you need.
- If it asks what a column or term means, use intent "definition".
- Never invent a figure, a project name or a business unit. If a question names a
  business unit you were not given, use intent "clarify" and say so.
- Reply in the same language the question was asked in. The language of the
  question decides this, not any other setting.`;

export function systemPrompt({ units } = {}) {
  return [
    "You turn questions about Delaware North's Design & Construction project",
    "tracker into a structured query plan. You never see the database and you",
    "never write SQL; a plan is the only thing you produce.",
    "",
    DOMAIN_RULES.trim(),
    "",
    BEHAVIOUR.trim(),
    "",
    planSchemaPrompt({ units }).trim(),
  ].join("\n");
}

// --- Structured-output schema ------------------------------------------------
// Generated from the same field declarations. strict mode requires every
// property to be listed and nullable, so an omitted filter arrives as null and
// validatePlan() drops it.

function fieldSchema(key, spec, units) {
  if (key === "unit" && Array.isArray(units) && units.length) {
    return { type: ["string", "null"], enum: [...units, "All", null] };
  }
  switch (spec.type) {
    case "string": return { type: ["string", "null"], maxLength: spec.max };
    case "enum": return { type: ["string", "null"], enum: [...spec.values, null] };
    case "boolean": return { type: ["boolean", "null"] };
    case "number": return { type: ["number", "null"] };
    case "integer": return { type: ["integer", "null"], minimum: spec.min, maximum: spec.max };
    case "intArray": return { type: ["array", "null"], items: { type: "integer" }, maxItems: spec.maxItems };
    default: return { type: ["string", "null"] };
  }
}

export function planResponseSchema({ units } = {}) {
  const properties = {};
  for (const [key, spec] of Object.entries(PLAN_FIELDS)) {
    properties[key] = { ...fieldSchema(key, spec, units), description: spec.describe };
  }
  return {
    type: "object",
    additionalProperties: false,
    required: ["language", "intent", "message", "plan"],
    properties: {
      language: {
        type: "string",
        description: "The language the question was asked in, as an English name.",
      },
      intent: { type: "string", enum: INTENTS },
      message: {
        type: ["string", "null"],
        description: "For definition, help, clarify, refuse and off_topic: the answer itself, in the question's language. Null for search and report.",
      },
      plan: {
        type: "object",
        additionalProperties: false,
        required: Object.keys(PLAN_FIELDS),
        properties,
      },
    },
  };
}

// Strips the nulls that strict mode forces the model to send, leaving a plan
// object shaped the way validatePlan() expects.
export function compactPlan(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !value.trim()) continue;
    if (Array.isArray(value) && !value.length) continue;
    if (value === false) continue;
    out[key] = value;
  }
  return out;
}
