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
export const INTENTS = ["search", "report", "definition", "help", "clarify", "refuse", "off_topic", "unsupported"];

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
- Amounts are in dollars with no currency symbol.
- "A budget over $50k" is the size of the approved budget: minAmount 50000 with
  amountField "approved_budget". "Over budget by $50k" is the overrun:
  minVariance 50000. They are different questions and must not be swapped.
- Under budget is underBudget, or maxVariance for an amount: "more than $50k
  under budget" is maxVariance -50000, "within $10k of budget" is maxVariance
  10000. Never answer an under-budget question with overBudget.
- If the question names a number, that number must land in a field. "Slipped
  more than 30 days" is minDelayDays: 30, not delayed: true. "More than $50k
  over budget" is minVariance: 50000, not overBudget: true. Dropping the number
  answers a broader question than the one asked, which is worse than refusing.`;

const BEHAVIOUR = `
How to answer:
- Translate the question into a plan. Do not write SQL and do not name tables or
  columns that are not plan fields.
- Set only the fields the question actually constrains. An absent field means no
  filter, which is almost always what a broad question wants.
- search is for words that appear in a project's own name, venue, section or
  CAPP/initiative number - "Mardi Gras", "CAPP-1042". It does not search people:
  a person's name belongs in manager or requestor, and putting it in search as
  well matches no project and empties the answer. Never restate the question
  in it. "Which have a budget over 50k" is not a search for "budget over 50000":
  that matches no project name and silently empties the result.
- Choose one reading of a condition, not both. A budget threshold is minAmount,
  an overrun threshold is minVariance; setting overBudget as well as minAmount
  asks for projects that are both over budget and large, which is a narrower
  question than the one asked.
- If the question asks to create, change, delete or approve anything, use intent
  "refuse": this assistant only reads.
- If the question is not about construction projects, budgets, schedules, risk,
  photos or activity updates, use intent "off_topic". A question naming a project
  and asking for one of its figures is never off_topic: "what is the budget for
  the Fitness Center Renovation?" is a search with that name in the search field.
  Asking for one project, or one number, is still a search.
- If a question names a project, venue or CAPP number, search for it with the
  search field. Several matching records are an answer, not an ambiguity: list
  them and let the reader choose. Reserve "clarify" for a question you cannot
  turn into any sensible plan at all.
- If it asks what a column or term means, use intent "definition".
- If it asks what you can do, what you know, or how to use this, use intent
  "help". That is a question about this tracker, never off_topic.
- An empty plan is valid and means every project the reader can see. "List every
  project", "show me everything", "what is in the portfolio" are ordinary
  searches with no filters set - never "unsupported", which is for a condition
  that cannot be expressed, not for the absence of one.
- If a question asks for a condition the plan fields cannot express, use intent
  "unsupported" and say so. Never answer with the nearest thing you can express:
  returning a filter the question did not ask for, with no sign that it happened,
  is worse than saying you cannot do it.
- "Both risks are high" is budgetRisk High together with scheduleRisk High, not
  risk "either". "High budget risk but not high schedule risk" is budgetRisk High
  with excludeScheduleRisk High. Reach for those four fields whenever a question
  names the two ratings separately.
- "Not high" is the exclude field on its own. Never pair it with the positive
  field for the same rating: scheduleRisk Low alongside excludeScheduleRisk High
  demands the rating be exactly Low, which drops everything rated Medium or Not
  Rated - projects the question asked to keep.
- Add no filter the question did not ask for. "Not complete" is excludeComplete
  on its own: adding status "Active" as well drops the projects that are on
  hold, in closeout or awaiting a status, which the question asked to see.
- Never invent a figure, a project name or a business unit. If a question names a
  business unit you were not given, use intent "clarify" and say so.
- Reply in the same language the question was asked in. The language of the
  question decides this, not any other setting.
- When the question refers back to the previous answer - "these", "those",
  "them", "their", "of these", "and now", "narrow that" - you are given the ids
  the previous answer returned. Put exactly those ids in the plan's ids field and
  add the new condition. Do not re-search the whole portfolio: that answers a
  different question from the one asked, while looking like an answer to this
  one.
- A question that names a new business unit, or says "all projects", "everything"
  or "start again", drops the previous result instead of narrowing it.
- A question that names a project, venue or any new subject is a new search, not
  a follow-up. Leave ids out of it. "Show Central City's latest update" after a
  question about delayed projects is about Central City, and searching inside the
  previous eleven answers neither question.
- Only carry ids when the question has no subject of its own and depends on the
  previous answer to mean anything.
- "What about X?" asks the previous question again about X. Keep the conditions
  the last question established and change only what X names - leave ids out,
  since those were the answer for somewhere else. After "which projects slipped
  more than 30 days?", "what about Patina?" means Patina projects that slipped
  more than 30 days. Never answer it with clarify when X names a unit or project
  you were given: it has already said which one it means.`;

// Written here rather than left to the model, so a refusal always says
// something. Each explains why, and what the user can do instead — a dead end
// with no explanation reads as a broken screen.
export const INTENT_FALLBACK = {
  unsupported: "I can't filter on that. I can use business unit, status, type, budget risk, schedule risk, days slipped, budget size and budget overrun.",
  refuse: "I can only read project information. To add, edit or delete a record, use the Projects screen.",
  off_topic: "I can only answer questions about this tracker: projects, budgets, schedules, risk ratings, turnover dates, photographs and activity updates.",
  clarify: "I need a bit more to go on. Which project or business unit do you mean?",
  definition: "I can explain the Tracker's columns: Days, variance, risk ratings, phases and turnover dates. Ask about one of those.",
  help: "Ask about projects by business unit, status, risk, budget overrun or schedule slip. For example: which Gaming projects slipped more than 30 days?",
};

// What a user is allowed to ask about, named explicitly so an out-of-scope
// question gets an answer rather than an empty one. The unit list is theirs, so
// it doubles as a statement of what they can see.
export function scopeNote(units) {
  if (!Array.isArray(units) || !units.length) return "";
  return ` You can ask about ${units.join(", ")}.`;
}

export function messageFor(intent, modelMessage, units) {
  const text = typeof modelMessage === "string" && modelMessage.trim()
    ? modelMessage.trim()
    : INTENT_FALLBACK[intent] || null;
  if (!text) return null;
  // Only the two "you cannot ask that" cases get the scope note appended; on a
  // definition or a clarification it would be noise.
  return ["off_topic", "clarify"].includes(intent) && !modelMessage
    ? text + scopeNote(units)
    : text;
}

// What the previous answer returned, handed to the model so a follow-up can
// narrow it. Capped at the same 50 the ids field accepts.
// The conversation so far. Without it the model sees each question alone and
// cannot tell a correction from a narrowing: "I meant the ones where both risks
// are high" is a replacement for the last question, while "and of those, high
// budget risk" builds on its answer. Both look identical when all you are given
// is the previous answer's ids.
export function historyNote(history) {
  if (!Array.isArray(history) || !history.length) return "";
  const lines = history.slice(-6).map((turn, index) => {
    const parts = [`${index + 1}. They asked: "${String(turn.question).slice(0, 200)}"`];
    if (turn.plan && Object.keys(turn.plan).length) parts.push(`   You planned: ${JSON.stringify(turn.plan)}`);
    if (typeof turn.total === "number") parts.push(`   That found ${turn.total} project(s).`);
    else if (turn.intent) parts.push(`   You answered with intent "${turn.intent}".`);
    return parts.join("\n");
  });
  return [
    "The conversation so far, oldest first:",
    ...lines,
    'A question beginning "I meant", "no,", "actually" or "sorry" corrects the last question: build the plan the corrected question describes and do not narrow the answer it got wrong.',
  ].join("\n");
}

export function contextNote(context) {
  if (!context || !Array.isArray(context.ids) || !context.ids.length) return "";
  const ids = context.ids.slice(0, 50);
  const lines = [
    `The previous answer returned ${context.total ?? ids.length} project(s).`,
    `Their ids are: ${ids.join(", ")}.`,
  ];
  if (context.description && context.description.length) {
    lines.push(`It was filtered by: ${context.description.join(" · ")}.`);
  }
  // The plan itself, not only a description of it. "What about Parks &
  // Resorts?" has to re-apply the previous conditions and change only the unit,
  // and it cannot do that from prose.
  if (context.plan && Object.keys(context.plan).length) {
    lines.push(`The plan that produced it was: ${JSON.stringify(context.plan)}.`);
    lines.push('To ask the same question about something else, reuse those conditions, change what the question changes, and leave ids out.');
  }
  if (context.total && context.total > ids.length) {
    lines.push(`Only the first ${ids.length} are listed, so a follow-up about "these" covers those.`);
  }
  lines.push('If this question refers back to them, set followUp true. You do not need to copy the ids: they are applied for you. Copy them only if the question narrows to some of them rather than all.');
  return lines.join("\n");
}

// What the voice model is told. It answers out loud and asks this worker for
// data through one tool, so its instructions are about speech and restraint
// rather than about filters: the plan vocabulary lives behind ask_tracker.
export function voiceInstructions({ units, name } = {}) {
  return [
    "You are the Delaware North Design and Construction tracker, answering out loud.",
    name ? `You are speaking with ${name}.` : "",
    "",
    "Call the ask_tracker tool for anything about projects, budgets, schedules,",
    "risk, turnover dates or activity. Never answer a question about the data",
    "from memory, and never invent a project, a figure or a business unit. If the",
    "tool returns nothing, say so plainly.",
    "",
    "Pass the question as it was asked. Do not add to it: a listener who asks to",
    "look up a project has not asked for its status, schedule, budget, risk and",
    "turnover date as well, and what you send is what appears on screen as their",
    "question.",
    "",
    units && units.length ? `The listener can ask about ${units.join(", ")}.` : "",
    "",
    "Keep answers short enough to listen to. Say how many projects matched, then",
    "name the first few. Offer to go through the rest rather than reading a long",
    "list aloud. Figures are on screen as you speak, so give round numbers and",
    "leave the exact ones to the screen.",
    "",
    "You can only read. If asked to change, add, approve or delete anything, say",
    "that you can only look things up and the Projects screen is where changes",
    "are made.",
    "",
    "Reply in the language you are spoken to in.",
  ].filter((line) => line !== "").join("\n");
}

// The single tool the voice model may call. It takes a question in words, not a
// plan: the question goes through the same planner and the same validation a
// typed question does, so speaking cannot reach data that typing could not.
export const VOICE_TOOLS = [{
  type: "function",
  name: "ask_tracker",
  description: "Look up projects in the tracker. Ask a complete question in plain words, exactly as the listener asked it.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["question"],
    properties: {
      question: {
        type: "string",
        description: "The listener's question, in their own words. Pass what they asked and nothing more: do not add requests they did not make, and do not expand a short question into a longer one. Resolve only what they left implicit, such as which projects \"these\" refers to.",
      },
    },
  },
}];

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
    required: ["language", "intent", "followUp", "message", "plan"],
    properties: {
      language: {
        type: "string",
        description: "The language the question was asked in, as an English name.",
      },
      intent: { type: "string", enum: INTENTS },
      // Declared rather than inferred. Reading it off the plan's shape was not
      // reliable: "give projects with high budget risks" came back carrying the
      // previous answer's ids and no search term, which no heuristic separates
      // from a genuine narrowing.
      followUp: {
        type: "boolean",
        description: "True only if this question depends on the previous answer to mean anything - 'which of these', 'and those', 'narrow that'. False for any question with a subject of its own, even when one was asked just before.",
      },
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
