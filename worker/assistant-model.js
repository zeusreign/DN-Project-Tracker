// The OpenAI calls, behind one-method interfaces.
//
// What stays here is what any query architecture needs: the error mapping, and
// the realtime voice session. The adapter that turns a question into a
// structured plan moved to ./legacy/assistant-plan-model.js with the planner it
// serves; the one that will generate SQL has not been written yet.
//
// Everything above this file works without a model: the adapter is resolved
// from env, so a test or a preview can supply a stub and exercise every path -
// refusals, clarification, scope, audit - with no network and no API key. That
// is deliberate: the parts of this feature that can be wrong in costly ways are
// the permission and correctness paths, and they should not need a paid call to
// test.

// Voice and query generation are different models and must not be conflated:
// this one speaks.
export const DEFAULT_VOICE_MODEL = "gpt-realtime-2.1";
export const RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
// Ephemeral credentials for the browser. The real key never leaves the worker;
// what the browser receives expires about a minute after it is issued, which is
// why this is called at connect time and not when the page loads.
const CLIENT_SECRETS = "https://api.openai.com/v1/realtime/client_secrets";

export class PlannerError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "PlannerError";
    this.status = status;
  }
}

// One mapping for every OpenAI failure, so a rejected key reads the same
// whichever call hit it. The upstream body can carry the key's organisation and
// quota details, so only the status travels any further than the log line.
export function openAiFailure(status, detail, what) {
  console.log(`assistant ${what} failed: ${status} ${String(detail || "").slice(0, 300)}`);
  return new PlannerError(
    status === 401 ? "The assistant's API key was rejected."
      : status === 429 ? "The assistant is rate limited. Try again shortly."
      : what === "voice session" ? "A voice session could not be started."
      : "The assistant could not be reached.",
    status === 401 ? 503 : 502,
  );
}

// Mints the short-lived credential the browser uses to open its own realtime
// connection. The browser talks to OpenAI directly for audio - that is what
// WebRTC is for - but it never holds the account key, and every tool call the
// model makes comes back through this worker, where the session cookie and the
// business-unit scope still decide what it can see.
export async function mintVoiceSession(env, { instructions, tools, model, fetchImpl } = {}) {
  if (!env.OPENAI_API_KEY) throw new PlannerError("The assistant is not configured on this environment.", 503);
  const call = fetchImpl || fetch;
  const chosen = model || env.ASSISTANT_VOICE_MODEL || DEFAULT_VOICE_MODEL;

  const payload = (withTranscription) => ({
    session: {
      type: "realtime",
      model: chosen,
      instructions,
      audio: {
        input: {
          // Noise reduction, before anything else sees the audio. near_field is
          // for a microphone close to the speaker - a headset or a laptop - and
          // it is what suppresses the colleague at the next desk. Without it
          // their sentence arrives as speech, is transcribed as a language
          // nobody is speaking, and becomes a question the listener never
          // asked. far_field is for a room microphone, where the opposite is
          // true and quiet speech must survive.
          noise_reduction: { type: env.ASSISTANT_AUDIO_FIELD === "far" ? "far_field" : "near_field" },

          // Transcribing what the listener said is what lets the transcript
          // show their words rather than the model's rewriting of them.
          //
          // The language hint matters more than it looks. Left to itself the
          // transcriber will guess at a half-heard noise, and a cough across a
          // room comes back as Chinese or Urdu - which then drags the whole
          // conversation, and the speaking voice with it, into that language.
          // Set ASSISTANT_VOICE_LANGUAGE to the language of the room and the
          // guessing stops. Leave it unset to stay open to any language, which
          // is the right default for a portfolio spread across countries.
          ...(withTranscription
            ? {
              transcription: {
                model: env.ASSISTANT_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe",
                ...(env.ASSISTANT_VOICE_LANGUAGE ? { language: env.ASSISTANT_VOICE_LANGUAGE } : {}),
              },
            }
            : {}),

          // Turn detection: semantic rather than acoustic.
          //
          // A silence timer cannot tell "show me the Central City projects..."
          // mid-thought from the end of a question, so it cut people off at
          // every comma. Semantic detection waits for the SENSE of the
          // sentence to be complete, which is what a long multi-part business
          // question needs - and those are the questions this is for.
          //
          // eagerness "low" means it waits longest before deciding the turn is
          // over. That is the right end of the dial here: the cost of waiting
          // half a second too long is nothing, and the cost of answering half
          // a question is a wrong answer delivered confidently.
          //
          // interrupt_response is on, so a reply can be spoken over and stops.
          // This reverses the earlier choice, where it was off to stop a figure
          // being cut in half - natural interruption was asked for, and with
          // answers now one sentence long there is much less to cut into.
          turn_detection: {
            type: env.ASSISTANT_VAD_TYPE || "semantic_vad",
            eagerness: env.ASSISTANT_VAD_EAGERNESS || "low",
            create_response: true,
            interrupt_response: true,
          },
        },
        output: { voice: env.ASSISTANT_VOICE_NAME || "alloy" },
      },
      // Declared here rather than by the browser sending session.update after
      // the channel opens. The session accepts them at mint time, and that
      // round trip was a failure the user saw as "the voice session ended
      // unexpectedly" with nothing to act on.
      ...(tools && tools.length ? { tools, tool_choice: "auto" } : {}),
    },
  });

  const post = (body) => call(CLIENT_SECRETS, {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  let response = await post(payload(true));
  // A rejected transcription block must not cost the whole call. If the service
  // will not take it, mint again without it: the transcript then falls back to
  // the question the model asked for, which is worse but still works.
  if (response.status === 400) {
    const retry = await post(payload(false));
    if (retry.ok) response = retry;
  }
  if (!response.ok) {
    throw openAiFailure(response.status, await response.text().catch(() => ""), "voice session");
  }
  const body = await response.json();
  const secret = body.value || body.client_secret?.value;
  if (!secret) throw new PlannerError("A voice session could not be started.");
  return {
    clientSecret: secret,
    expiresAt: body.expires_at || body.client_secret?.expires_at || null,
    model: body.session?.model || model || env.ASSISTANT_VOICE_MODEL || DEFAULT_VOICE_MODEL,
  };
}

// =============================================================================
// The SQL engine's model calls
// =============================================================================
// Phase 3. Two adapters, built the way the planner's was: temperature 0 because
// the same question should produce the same query, a strict json_schema so the
// shape cannot drift, and the shared error mapping above. Both are resolved
// from env, so a test or a preview can supply a stub and exercise the whole
// path - validation, scope, limits, audit - with no network and no key.

import {
  sqlSystemPrompt, sqlResponseSchema, sqlHistoryNote, sqlContextNote, ANSWER_RULES, INTENTS,
} from "./assistant-prompt.js";

export const DEFAULT_SQL_MODEL = "gpt-4o-mini";
export const DEFAULT_ANSWER_MODEL = "gpt-4o-mini";

function readSqlOutput(parsed) {
  if (!parsed || typeof parsed !== "object") throw new PlannerError("The assistant returned nothing.");
  const intent = INTENTS.includes(parsed.intent) ? parsed.intent : null;
  if (!intent) throw new PlannerError(`The assistant returned an unknown intent "${parsed.intent}".`);
  return {
    intent,
    followUp: parsed.followUp === true,
    view: typeof parsed.view === "string" && parsed.view.trim() ? parsed.view.trim() : null,
    language: typeof parsed.language === "string" ? parsed.language.slice(0, 40) : "English",
    message: typeof parsed.message === "string" && parsed.message.trim() ? parsed.message.trim() : null,
    sql: typeof parsed.sql === "string" && parsed.sql.trim() ? parsed.sql.trim() : null,
  };
}

async function callModel(apiKey, call, body, what) {
  const response = await call(RESPONSES_ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw openAiFailure(response.status, await response.text().catch(() => ""), what);
  }
  const payload = await response.json();
  const text = typeof payload.output_text === "string" && payload.output_text
    ? payload.output_text
    : (payload.output || [])
      .flatMap((item) => item.content || [])
      .map((part) => part.text)
      .filter(Boolean)
      .join("");
  return { text, usage: payload.usage || null };
}

// Question in, one SELECT out. The query is not run here and is not trusted
// here: assistant-sql.js checks it before anything reaches D1.
export function openAiSqlGenerator({ apiKey, model = DEFAULT_SQL_MODEL, fetchImpl }) {
  if (!apiKey) throw new PlannerError("No OpenAI API key is configured.", 503);
  const call = fetchImpl || fetch;
  return {
    model,
    async generate(question, { units, today, role, context, history, retryReason } = {}) {
      const notes = [sqlHistoryNote(history), sqlContextNote(context)].filter(Boolean);
      // A rejected query is handed back with the reason, once. The model wrote
      // something the worker would not run, and the reason is usually enough
      // for it to write the same question a way that is allowed.
      if (retryReason) {
        notes.push(`Your previous query was refused by the worker: ${retryReason}\n`
          + "Write the query again without whatever caused that. If the question cannot be"
          + ' answered within the schema you were given, use intent "unsupported" and say so.');
      }
      const { text, usage } = await callModel(apiKey, call, {
        model,
        temperature: 0,
        max_output_tokens: 900,
        input: [
          { role: "system", content: sqlSystemPrompt({ units, today, role }) },
          ...notes.map((content) => ({ role: "system", content })),
          { role: "user", content: question },
        ],
        text: {
          format: { type: "json_schema", name: "tracker_sql", strict: true, schema: sqlResponseSchema() },
        },
      }, "sql generator");
      let parsed;
      try { parsed = JSON.parse(text); } catch {
        throw new PlannerError("The assistant's reply was not valid JSON.");
      }
      return {
        ...readSqlOutput(parsed),
        usage: { model, inputTokens: usage?.input_tokens ?? null, outputTokens: usage?.output_tokens ?? null },
      };
    },
  };
}

// Result in, sentence out. The rows are already capped and already scoped, so
// this call sees exactly what the reader is allowed to see and nothing more.
export function openAiAnswerer({ apiKey, model = DEFAULT_ANSWER_MODEL, fetchImpl }) {
  if (!apiKey) throw new PlannerError("No OpenAI API key is configured.", 503);
  const call = fetchImpl || fetch;
  return {
    model,
    async answer(question, result, { language, today } = {}) {
      const payload = {
        question,
        language: language || "English",
        today,
        // What one row is. Without this the model reads a row count as a
        // project count, and 40 activity updates across 30 projects becomes
        // "40 projects".
        each_row_is: result.entityLabel || "records",
        matched_rows: result.total,
        returned_rows: result.returned,
        truncated: result.truncated,
        is_single_figure: !!result.aggregate,
        more_than_one_row_per_project: !!result.fannedOut,
        ...(result.projectsInScope !== null && result.projectsInScope !== undefined
          ? { projects_in_scope: result.projectsInScope }
          : {}),
        ...(result.projects && result.projects.matched !== null
          ? {
            distinct_projects_matched: result.projects.matched,
            distinct_projects_returned: result.projects.returned,
          }
          : {}),
        result: result.rows,
      };
      const { text, usage } = await callModel(apiKey, call, {
        model,
        temperature: 0,
        max_output_tokens: 400,
        input: [
          { role: "system", content: ANSWER_RULES },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }, "answer");
      return {
        text: String(text || "").trim(),
        usage: { model, inputTokens: usage?.input_tokens ?? null, outputTokens: usage?.output_tokens ?? null },
      };
    },
  };
}

// Resolution order, as for the planner: an injected adapter first so tests and
// previews need no key, then a real one built from the secret.
export function sqlGeneratorFor(env) {
  if (env.ASSISTANT_SQL && typeof env.ASSISTANT_SQL.generate === "function") return env.ASSISTANT_SQL;
  if (!env.OPENAI_API_KEY) return null;
  return openAiSqlGenerator({ apiKey: env.OPENAI_API_KEY, model: env.ASSISTANT_SQL_MODEL || DEFAULT_SQL_MODEL });
}

export function answererFor(env) {
  if (env.ASSISTANT_ANSWERER && typeof env.ASSISTANT_ANSWERER.answer === "function") return env.ASSISTANT_ANSWERER;
  if (!env.OPENAI_API_KEY) return null;
  return openAiAnswerer({ apiKey: env.OPENAI_API_KEY, model: env.ASSISTANT_ANSWER_MODEL || DEFAULT_ANSWER_MODEL });
}

export { readSqlOutput };
