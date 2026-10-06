// How the assistant behaves: which intent a question gets, what a refusal says,
// and what the voice model is told.
//
// Nothing here knows how a query is built. The intent taxonomy, the refusal
// messages, the follow-up rules and the voice contract are the same whether a
// question becomes a structured plan or a SQL statement, so they sit on the
// active path while the thing that turns a question into a query is replaced
// around them.

import { GLOSSARY } from "./assistant-schema.js";

export { GLOSSARY };

// Intents, following the Ask the Tracker pilot so its UI needs no translation.
// Only "search" and "report" reach the database; the rest are answered from the
// message alone.
export const INTENTS = ["search", "report", "definition", "help", "clarify", "refuse", "off_topic", "unsupported"];

// Which intent a question gets. Architecture-independent: every one of these
// rules exists because the wrong intent produces a confident wrong answer
// rather than an error, and that is true of any query engine behind it.
export const INTENT_RULES = `
Choosing an intent:
- If the question asks to create, change, delete or approve anything, use intent
  "refuse": this assistant only reads.
- If the question is not about construction projects, budgets, schedules, risk,
  photos or activity updates, use intent "off_topic". A question naming a project
  and asking for one of its figures is never off_topic: asking for one project,
  or one number, is still a search.
- If a question names a project, venue or CAPP number, search for it. Several
  matching records are an answer, not an ambiguity: list them and let the reader
  choose. Reserve "clarify" for a question you cannot turn into any sensible
  query at all.
- If it asks what a column or term means, use intent "definition".
- If it asks what you can do, what you know, or how to use this, use intent
  "help". That is a question about this tracker, never off_topic.
- No conditions at all is valid and means every project the reader can see.
  "List every project", "show me everything", "what is in the portfolio" are
  ordinary searches with nothing set - never "unsupported", which is for a
  condition that cannot be expressed, not for the absence of one.
- If a question asks for something this assistant cannot express, use intent
  "unsupported" and say so. Never answer with the nearest thing you can express:
  returning a condition the question did not ask for, with no sign that it
  happened, is worse than saying you cannot do it.
- Never invent a figure, a project name or a business unit. If a question names a
  business unit you were not given, use intent "clarify" and say so.
- Reply in the same language the question was asked in. The language of the
  question decides this, not any other setting.`;

// How a question relates to the one before it. Also architecture-independent:
// the ids of the previous answer are supplied by the worker either way, and the
// mistakes these rules prevent are mistakes about the conversation, not about
// the query language.
export const FOLLOW_UP_RULES = `
Following on from the previous answer:
- When the question refers back to it - "these", "those", "them", "their", "of
  these", "and now", "narrow that" - you are given the ids the previous answer
  returned. Say this is a follow-up and add the new condition. Do not re-search
  the whole portfolio: that answers a different question from the one asked,
  while looking like an answer to this one.
- A question that names a new business unit, or says "all projects", "everything"
  or "start again", drops the previous result instead of narrowing it.
- A question that names a project, venue or any new subject is a new search, not
  a follow-up. "Show Central City's latest update" after a question about
  delayed projects is about Central City, and searching inside the previous
  eleven answers neither question.
- Only carry the previous answer when the question has no subject of its own and
  depends on that answer to mean anything.
- "What about X?" asks the previous question again about X. Keep the conditions
  the last question established and change only what X names. After "which
  projects slipped more than 30 days?", "what about Patina?" means Patina
  projects that slipped more than 30 days. Never answer it with clarify when X
  names a unit or project you were given: it has already said which one it means.
- A question beginning "I meant", "no,", "actually" or "sorry" corrects the last
  question: answer the corrected question rather than narrowing the answer it
  got wrong.`;

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
