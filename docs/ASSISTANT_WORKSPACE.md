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
│ CONVERSATION  372px  │ WORKSPACE                            fluid    │
│                      │  [ All business units ]         [ 📌 Saved 2 ]│
│  ◦ DNC Tracker    +  │                                               │
│                      │   ┌─ newest result ─────────────────────────┐ │
│  question            │   │  one workspace component            📌  │ │
│  answer              │   └─────────────────────────────────────────┘ │
│  question            │     which of those are over budget?           │
│  answer              │   ╷ ‹ earlier result                          │
│  · checking budget   │   ╷ ‹ earlier result                          │
│                      │     ‹ earlier result                          │
│  ───────────────     │                                               │
│  ask…       ◎  ↑     │                                               │
└──────────────────────┴───────────────────────────────────────────────┘
```

Conversation left and narrow, workspace right and wide — the arrangement people
already read correctly without being taught. The conversation column is
visually light: no bubbles, no avatars, no cards. Question in medium weight,
answer under it, a hairline between turns.

**The workspace accumulates.** The newest result is expanded at the top;
everything before it stays below, collapsed to a line, in the order it was
asked. Clicking a line expands it in place — it does not displace the newest.
A result that narrowed the one before it is indented under it with a hairline
connector, so the column reads as one investigation rather than a pile of
searches.

Nothing is ever destroyed by asking another question. The only things that
clear the stack are a new conversation and a change of business-unit scope,
because results from one scope cannot honestly be read under another.

An empty result does not join the stack. The sentence in the conversation is
the whole answer, and what is already on screen is usually what the next
question is about.

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

A call has one visual: an orb in the conversation column, drawn by a fragment
shader, alive only while the call is.

It is built on the approach the open-source ElevenLabs orb uses — a shader
whose uniforms are *targets* that each state sets, eased toward rather than
snapped to, with the measured audio level feeding some of them. Nothing of
theirs is loaded or called. The shader, the easing and the state mapping are
this product's own, written locally so the thing stays free of any dependency,
which matters in a codebase with none.

**It has no state of its own.** `voice.state` is the state machine and
`setVoiceState()` is its only writer; the orb reads it there. There is no
second machine to drift out of step with the first.

| `voice.state` | How it reads | Follows |
|---|---|---|
| `connecting` | dim, emerging, slow | — |
| `listening` | calm, breathing | the microphone |
| `thinking` | a slow lobe orbiting inside it, no audio reaction at all | — |
| `speaking` | brightest, rim lit, rippling | the model's audio |
| `off` | fades out, band closes, loop stops | — |

The levels are real. The microphone stream from `getUserMedia` and the model's
stream from `pc.ontrack` each get an `AnalyserNode`; the orb reads their RMS.
Muted reads zero, because it is actually silent. Nothing is on a timer
pretending to be a voice.

Thinking is the one state that ignores audio entirely — there is none to react
to, and a presence that goes still during the wait reads as a dropped call.
That is why it has a motion of its own.

**No words.** "Listening", "Thinking" and "Speaking" are gone from the screen:
the orb says them. They survive in an `sr-only` live region for anyone who
cannot see it. A *failure* is still written down, because a failure is not a
status.

**One identity, not six colours.** The tracker's navy through its teal to its
cyan, lit from inside with limb darkening and a rim light — three stops of one
ramp.

**It is never the slow part.** The audio graph is built after the connection,
never on it. The loop runs only during a call and stops when the orb has faded.
The canvas is 172 px with the device ratio capped at 2. A measured frame costs
0 ms median, 0.1 ms worst — on software rendering. If WebGL is missing or the
context is lost, a CSS orb takes over and still moves to the same measured
level.

The right-hand workspace is untouched by any of this.

## Visual direction

Calm, light, and almost borderless. Structure comes from space and alignment;
a hairline appears only where two things genuinely must be told apart. One card
per result, never a card inside a card. Numbers are tabular.

Colour is near-monochrome — slate and navy — with exactly three semantic marks:

| Mark | Means | Colour |
|---|---|---|
| amber | schedule pressure | `#b8791a` |
| rose | over budget | `#b3485c` |
| slate ring | high risk | `#4a6274` |

Teal appears in one place only: the voice presence.

Explicitly not present: dark data plates, grids of project cells, serif display
type, pills as decoration, nested cards, dashboards, SQL panels, and any
animation that exists to look intelligent.

### Rules the screen is held to

- **A figure says itself.** "74 projects", not a card headed *Figure* with the
  subtitle *A single figure* over a column named `COUNT(*)`. An aggregate
  column name is made readable before it is shown, and a bare count carries no
  label at all — the unit beside the number says what was counted.
- **A figure that covers the whole portfolio carries its shape.** A count of
  every project the reader can see is shown with the breakdown by business
  unit beneath it. Only then: a count with any condition on it would sit above
  a breakdown that totals something else.
- **Icons where an icon is faster than the word.** Pin, microphone, send, new,
  download, chevron, close. All one stroke weight, all with a tooltip and an
  accessible name. Nothing drawn for decoration.
- **Two states on the pin.** Outline while a result is passing through, solid
  and accented once it is kept, with the tooltip saying which action the next
  click performs.
- **No empty fields.** A detail panel renders only the fields that have
  something in them. A grid of em-dashes is a database row, not a product.
- **No dead controls.** The saved control does not appear until there is
  something that could have been saved.
- **Nothing says the same thing twice.** The starting questions sit beside the
  box they would be typed into, because they are inputs; the workspace says
  what it is for, once.

## Saved, and getting it out

The word *briefing* is gone. What the reader has is **Saved**: results they
pinned, which they can later download. One control in the workspace header
opens one panel:

1. **Include** — the saved results, newest first, all unticked.
2. **Detail** — Summary, or Full records.
3. **Format** — PDF, or CSV.
4. **Download** — the only primary action, disabled until something is ticked.

Nothing technical is exposed. PDF is the browser's own print-to-PDF over a page
built for it, rather than a second renderer that could disagree with the first
about a figure.

## On a phone

Not two stacked columns. The screen shows one thing at a time — **Chat** or
**Results** — with a tab bar at the top carrying the result count, and the
composer fixed to the bottom of the viewport on both. A question is always one
tap away. Asking something switches to Results, because that is what was asked
for. Within a row the proportional bar is dropped: at that width the project's
name is what matters, and the bar is a second reading of a number already
there.

## Checks that need a real browser

Two things cannot be tested in the DOM harness, because it has no viewport, no
scroll position, no WebGL and no audio. Both have broken in ways the unit
suites could not see, so both are measured in real Chrome against the real
running app:

| Command | What it holds shut |
|---|---|
| `npm run check:layout` | the panel scrolls, not the page; the composer is always on screen; no wasted window; no sideways scroll — at eight window sizes |
| `npm run check:voice` | the shader compiles; each state looks unlike the others; the orb moves to real microphone and real model audio; muted is silent; ending a call costs nothing |

## What does not change

`assistant-sql.js` and its seventeen rejection rules. `assistant-context.js`
and the sealed turn tokens. `scopePredicate`, `scopedViews`, `availableUnits`.
Every permission check in `index.js`. The audit row. The read-only guarantee.

The typed path keeps model-written SQL, because open questions need it. The
voice path gets parameterised tools, because spoken questions are faster and
safer that way. Both end at the same scoped views.
