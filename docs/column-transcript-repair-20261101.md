# Column and transcript repair — November 1, 2026

The supplied conversation exposed a presentation regression: the renderer
prepended Project and CAPP ID to grouped tables, and Project to sorted tables,
regardless of the validated query's requested column order. The renderer now
preserves explicit query columns exactly, including PM first and removal of
both identifiers. Group headings remain available; sorted lists retain global
query order. PDF and Excel use the same corrected renderer. The first visible
column is frozen when scrolling, even when Project is moved elsewhere.

The private query service now treats a long generated display title as a
bounded label instead of rejecting the whole valid query as too complex.
Planning instructions explicitly preserve the selection, column order and
removed columns on presentation-only follow-ups. Voice instructions describe
these supported presentation controls and require checking the returned table.

The Catawba source was inspected read-only. The paginator uses its #ffbf00
thumb/left track, #d5d5d5 right track, and white thumb border. Position updates
on input and after record navigation. The previously requested 75% desktop
width remains.

Conversation start and per-turn local date/time are in the transcript itself,
so text export includes them. Restored entries use their stored created_at
values; unknown legacy timestamps remain unknown. Voice transcript saves keep
the first timestamp. The first-question box was the saved-conversation title;
its selector now lives behind a compact History disclosure. Opening the
assistant starts a new conversation; users explicitly choose History to
resume earlier filters, selections and turns.

The farewell recognizer now handles the reported wording, "All right, thank
you for trying. Goodbye", as well as polite thanks-and-good-night phrases.
It retains anchored matching so questions or negations containing goodbye
are not shutdown requests. Microphone stop and connection cleanup are tested.

Validation: real renderer checks for grouped/flat column order, both-ID
removal, PDF/Excel consistency; query correction and long-title tests;
Realtime voice tests; existing preview workflows and timezone checks.
Browser checks verified the changing yellow/grey slider, compact History,
and timestamps on the greeting, user question and returned table. No live
microphone/speaker acoustic test was performed. A browser transcript-download
check timed out; export content is composed directly from the timestamped
conversation log.

No live LagosPM records, Catawba files, access policies or API credentials
were changed.

Live service acceptance check passed in an isolated QA conversation with the
copied 72-project dataset. All four turns retained the same eight Chynna
Barron projects. Turn two moved PM first; turn three removed both CAPP ID and
Project ID and added AFC/variance; turn four sorted AFC descending in a flat
list without changing column order or the project set. The real client
renderer was used to verify the visible columns after each service response.
