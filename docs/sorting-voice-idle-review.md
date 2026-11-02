# Sorted results, voice etiquette and inactivity

Review date: October 31, 2026 (America/Denver). Applies to the private Enhanced Tracker and its protected AI service.

## Results

Ordinary browsing retains business-unit headings and venue subheadings. Any requested sorting or ranking displays one flat list in query order. The screen, PDF and Excel share the same presentation adapter. Project name and requested fields are retained; CAPP ID is no longer inserted into every sorted list. Requested identity details remain available, with compact column labels such as BU, PM and AFC. Project names are not shortened or invented. Missing numbers remain missing and sort after recorded values. Aggregated reports and grand totals keep their existing semantics.

The October 31 transcript exposed a display defect: a correctly sorted query was regrouped by venue, breaking global order. That renderer defect is fixed. Spoken excerpts default to three rows, while the table and downloads retain the full delivered result. Voice receives metadata from the same presentation adapter. Retrieval dates are not described as backup dates.

## Voice

The greeting uses the signed-in name and browser-local morning, afternoon or evening. Microphone access still requires Start conversation and browser permission. Transcripts identified as coughs, throat-clearing, non-speech or filler are discarded before a response can be created. An explicitly recognized sneeze gets a brief tool-free courtesy. Uncertain sounds should receive no reply. Real audio classification is not guaranteed; a transcript can misidentify a sound. Device testing remains necessary.

Automatic audio interruption is disabled at the provider; meaningful transcribed speech cancels playback instead. This prevents coughs from cutting off answers, but interruption may wait until the utterance is transcribed. The Stop speaking control remains immediate.

Twenty minutes after the last meaningful user utterance, voice asks whether more help is needed. Five more minutes without a reply stop microphone input, say goodbye and close audio/connection. A fallback closes the connection if goodbye playback fails. Noise and assistant speech do not reset the deadline. A meaningful reply resets it. The provider's separate session ceiling is 60 minutes; the user may restart voice to continue the saved conversation.

## Tracker inactivity

The server policy is 40 minutes idle, with a warning during the last 10 minutes. At 30 minutes the dialog dims the background by 30% and blurs it, shows a countdown, and offers Continue working and Log out now. There is no loud spoken warning. Input inside Ask the Tracker, including accepted voice input, counts as activity. Background reads, history persistence and voice teardown do not.

Local account sessions and ChatGPT preview sessions are checked on the server. Each preview browser receives a Secure, HttpOnly, SameSite=Strict cookie backed by an opaque hashed record; an expired cookie cannot silently recreate a session. The preview's platform sign-out route is used when reauthentication is required. Existing role and record scope checks still apply. Separate browsers have separate idle deadlines; tabs sharing a cookie share the deadline.

Timer delivery can be delayed by a sleeping device or suspended browser tab. Deadlines use wall-clock time; server access checks still enforce expiry, and the page resynchronizes on visibility/focus. The warning is not an autosave guarantee; save work before leaving.

## Verification

- Main integration checks: existing project/role protections, current cost data, archive exclusions, no secret in page content.
- Result adapter checks: alternating-venue rows retain global order in screen representation and Excel; null/zero values, requested identity columns, aggregation and PDF generation remain valid.
- Voice tests: 20/25-minute deadlines, meaningful-reply reset, noise filtering, sneeze courtesy without query, microphone cleanup, failed goodbye fallback, pending permissions and query ordering.
- Idle checks: warning and Continue Working UI, 30/40-minute server boundaries, expiry cannot be extended, background history does not renew, separate browser sessions and revocation.
- Browser review: signed-in greeting, sorted Yellowstone table, dimmed/blurred idle dialog and Continue working. The shortened idle policy is a local-only QA process setting, not a deployment setting.

Not verified acoustically: actual cough/sneeze detection and spoken goodbye on TJ's microphone/browser. This is ready for that acceptance test, not a guarantee of perfect sound recognition.
