# The conversational project-analysis workspace

What replaces "Ask the Tracker". This document defines the architecture and the
component hierarchy; the implementation follows it exactly.

## The premise

This is not a chatbot. Conversation is the *input method*. The workspace is the
*product*. The conversation never carries a table, a project list, a budget
breakdown or a figure anyone needs to read twice — it carries one or two
sentences of human answer, and the workspace renders the structured truth.

The feeling to optimise for, in order:

1. I can ask anything about my projects.
2. The useful information is immediately in front of me.
3. It remembers what I am looking at.

Everything below serves those three. Nothing below exists to show what the AI
can do.

## The surfaces

```
┌──────────────────────┬───────────────────────────────────────────────┐
│ CONVERSATION  380px  │ WORKSPACE                            fluid    │
│                      │                                               │
│  voice presence      │   ┌─ FOCUS ─────────────────────────────────┐ │
│  turn                │   │  one workspace component                │ │
│  turn                │   │  (the current result, always primary)   │ │
│  · checking budget   │   └─────────────────────────────────────────┘ │
│  turn                │                                               │
│                      │   ─ earlier in this thread ──────── 3 ▾       │
│  ───────────────     │                                               │
│  composer   ◎ mic    │   ─ briefing ──────────────────── 4 pinned ▾  │
└──────────────────────┴───────────────────────────────────────────────┘
```

Conversation left and narrow, workspace right and wide — the Claude Artifacts
arrangement, because it is the one people already read correctly without being
taught. The conversation column is visually light: no bubbles, no avatars, no
cards. Question in medium weight, answer in regular, a hairline between turns.

## The View

One answer produces one **View**. A View is the only thing the workspace
renders and the only contract between worker and client.

```js
View = {
  kind,                  // one of the component kinds below
  title,                 // "Central City projects"
  subtitle,              // "12 projects · Gaming"  (nullable)
  count,                 // nullable
  data,                  // kind-specific, defined per component
  subject: { ids, label }  // what this View is "about", for the next question
}
```

### Who chooses the kind

The model proposes, the worker decides. The SQL generator returns a `view`
hint alongside its query; the worker checks the hint against the actual shape
of the result and overrides it when they disagree. A model that asks for
`project_comparison` on a single aggregate row gets `figure` instead. The
model knows the *intent*; only the worker knows the *shape*, and the shape wins.

## Component hierarchy

Three tiers. A component in a lower tier is only ever composed into a higher
one; it is never rendered on its own.

### Tier 3 — primitives (never a View on their own)

| Primitive | Renders |
|---|---|
| `Metric` | one labelled number, with its format and an optional "of N recorded" note |
| `ProjectRow` | one project as a single line: name, venue, unit, and up to two state marks |
| `StateMark` | schedule pressure / over budget / high risk — the only three colours in the product |
| `DeltaPair` | previous value → current value, with the signed change |
| `Field` | a labelled value inside a detail panel |
| `Sparkbar` | a single proportional bar, used in summaries. No axes, no legend |

### Tier 2 — the eleven workspace components

Each is a View kind. Each is one card. None of them nests another card.

| Kind | Chosen when | `data` |
|---|---|---|
| `project_list` | rows are projects, more than one | `{ rows }` |
| `project_detail` | exactly one project, or a row was opened | `{ project, updates }` |
| `budget_summary` | aggregate over budget columns | `{ metrics, rows }` |
| `budget_variance` | rows carrying `forecast_variance` | `{ rows, totals }` |
| `risk_summary` | grouped by a risk column | `{ buckets, rows }` |
| `risk_list` | rows filtered by risk | `{ rows }` |
| `schedule` | rows carrying turnover dates or `duration_change_days` | `{ rows, span }` |
| `change_comparison` | current vs previous reporting period | `{ subject, pairs, narrative }` |
| `project_comparison` | two to four named projects | `{ projects, fields }` |
| `timeline` | dated events for one project | `{ events }` |
| `briefing` | the pinned set | `{ items }` — client-owned |

Two more exist for shapes that are not one of the eleven but do occur:
`figure` (a single number) and `group` (a `GROUP BY` result). Without them the
worker would be forced to misrepresent a result as a list.

### Tier 1 — the workspace shell

`Focus` (the current View) · `Thread` (collapsed earlier Views) · `Briefing`
(the pinned object).

## Progressive disclosure

The workspace keeps a **subject**: the thing the user is currently looking at.

```js
subject = { ids: [int], label: "Central City projects", token: <sealed> }
```

The worker already returns `followUp` on every answer. That one boolean drives
the whole model:

- `followUp === true` — the new View **refines** the subject. The previous View
  collapses to a strip directly above the focus, within the same thread. The
  subject's ids narrow; its label grows: *"Central City projects · over budget"*.
- `followUp === false` — a new subject. The whole previous thread collapses
  into one "Earlier" group. Nothing is destroyed; nothing stays in the way.

So the worked example in the brief behaves like this:

| Said | followUp | Focus becomes | Subject |
|---|---|---|---|
| "Show me the Central City projects" | — | `project_list` | 12 ids, *Central City* |
| "Which ones are over budget?" | true | `budget_variance` | 4 ids, *…· over budget* |
| "What's the variance on the largest one?" | true | `project_detail` | 1 id, *…· Sportsbook* |
| "Compare that with the previous period" | true | `change_comparison` | 1 id, unchanged |

Four questions, one thread, three collapsed strips, nothing re-searched.

## Voice

### One session, real tools

The current design is an agent handoff: the realtime model calls one
`ask_tracker(question)` tool, and the worker then makes **two more** model calls
(SQL generation, then answer writing) before the realtime model can speak. Three
serial model calls per spoken question.

The replacement is one realtime session (`gpt-realtime-2.1`) holding seven
typed data tools that it calls directly:

| Tool | Returns a View of kind |
|---|---|
| `find_projects` | `project_list`, or `risk_list` / `budget_variance` / `schedule` when the filters say so |
| `project_detail` | `project_detail` |
| `budget_analysis` | `budget_summary` |
| `schedule_analysis` | `schedule` |
| `risk_analysis` | `risk_summary` |
| `compare_periods` | `change_comparison` |
| `compare_projects` | `project_comparison` |

These take **structured filters, not SQL**. The worker builds the query from a
closed set of parameters. There is no model-written SQL on the voice path at
all, so there is nothing for the validator to catch — and the queries still run
through `scopedViews(scope)`, so the business-unit boundary is enforced exactly
as it is for a typed question. The database and the permission layer remain
authoritative. The realtime model cannot reach a row the reader could not open.

### Why this is faster, and why the screen beats the voice

The client executes the tool. So the client holds the full result — including
its View — *before* the model has said a word. It renders immediately and sends
the model only a short `speak` line plus counts. The information is on screen
while the sentence is still being spoken.

A multi-part question becomes several tool calls inside one turn:

> "Show me the projects at Central City, tell me which are over budget, take the
> one with the largest variance, compare it with the previous reporting period,
> and tell me whether the schedule changed."

`find_projects` → `find_projects(ids, over_budget)` → `project_detail` →
`compare_periods`. Four calls, one spoken answer, four Views, three of them
collapsing behind the fourth. The user sees a quiet activity line —
*checking budget · comparing previous period* — and never sees a handoff.

### Turn detection

`semantic_vad` with `eagerness: "low"`. The model waits for the *sense* of the
sentence to finish rather than for silence, which is what a long multi-part
business question needs. `interrupt_response: true`, because the brief asks for
natural interruption — note this reverses an earlier deliberate choice, where
interruption was off so a figure being read aloud could not be cut in half.

### Voice presence

One dot. Radius and opacity carry the three states — listening, processing,
speaking — and nothing else moves. No orb, no bars, no waveform. The animation
is CSS only, never blocks a render, and is never on the critical path of an
answer appearing.

## Visual direction

Calm, light, and almost borderless. Structure comes from space and alignment;
a hairline appears only where two things genuinely must be told apart. One card
per View, never a card inside a card. Numbers are tabular and right-aligned
wherever they form a column.

Colour is near-monochrome — slate and navy — with exactly three semantic marks:

| Mark | Means | Colour |
|---|---|---|
| amber | schedule pressure | `#b8791a` |
| rose | over budget | `#b3485c` |
| slate | everything else | `#5c7180` |

Teal appears in one place only: the voice presence dot.

Explicitly not present: dark data plates, grids of project cells, serif
display type, pills as decoration, nested cards, dashboards, SQL panels, and
any animation that exists to look intelligent.

## What does not change

`assistant-sql.js` and its seventeen rejection rules. `assistant-context.js`
and the sealed turn tokens. `scopePredicate`, `scopedViews`, `availableUnits`.
Every permission check in `index.js`. The audit row. The read-only guarantee.

The typed path keeps model-written SQL, because open questions need it. The
voice path gets parameterised tools, because spoken questions are faster and
safer that way. Both end at the same scoped views.
