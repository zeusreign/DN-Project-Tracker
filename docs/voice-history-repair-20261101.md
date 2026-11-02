# Voice and activity-history repair — November 1, 2026

## Cause and repair

The preceding timezone update accidentally put a function call inside the
destructured parameter list in `worker/ask/hosted-connection.js`. The resulting
syntax error stopped the entire connection script. AI follow-ups and voice
were unavailable, while the separate guided-search UI continued to run.

The parameter list is repaired; the user's timezone is still sent in the
request body. The existing reasoning engine, database queries, session
context, voice service, goodbye handling and inactivity controls are retained.
The build now parses every embedded Ask the Tracker JavaScript asset before
packaging, and a new connection regression check executes the real connection
and voice-control scripts together. An incomplete AI initialization now shows
a reconnect error instead of silently answering through guided search.

## Requested presentation changes

- Status headers and values are centered, including Excel exports.
- The navigation switch shows the destination: the Rolodex icon opens the
  Rolodex, and the paginator icon opens bottom pagination. This also applies
  in the photo module.
- Desktop pagination is 75% of its former container width, with an amber
  slider track and thumb. Small screens retain usable full width.
- Double-clicking Activity opens two recent biweekly source reports side by
  side, each with current and previous-week narratives: four update columns.
  Smaller screens stack columns for readability. Existing previous-week notes
  lack independent dates, so their source labels are preserved.
- Older saved reports remain available through Show more history and a
  chevron, inside a keyboard-accessible scrolling window capped at 340px.
  Existing editing deadlines, revision history and saving remain in place.

## Verification

The build, connection initialization, preview workflows, result layout,
timezone and inactivity tests passed. Existing Realtime voice tests also
passed, including farewell termination, silence timing and cleanup.

A live query against the existing private AI service returned the expected
20 copied projects with anticipated cost above $1 million. A subsequent
explicit follow-up retained those same 20 projects, sorted anticipated cost
descending, and returned exactly Project, Project manager, Anticipated cost,
and Cost variance. An ambiguous sorting request asked which field to use
while preserving the selection.

Browser checks verified the four-column activity layout, collapsed/expanded
older history and its 340px scrolling limit, opposite navigation controls,
and reduced amber pagination. Live microphone input and speaker playback
were not acoustically tested in this environment.

Only the private Enhanced preview is changed. No live LagosPM records,
audience permissions or API credentials are changed.
