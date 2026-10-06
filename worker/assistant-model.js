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
export const DEFAULT_VOICE_MODEL = "gpt-realtime-2.1-mini";
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
        // Transcribing what the listener said is what lets the transcript show
        // their words rather than the model's rewriting of them.
        input: {
          ...(withTranscription
            ? { transcription: { model: env.ASSISTANT_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe" } }
            : {}),
          // The assistant finishes what it is saying. Speech from the listener
          // no longer cancels a reply in progress - a figure read out half way
          // is worse than waiting - so stopping it is a deliberate act, served
          // by the Stop button rather than by a cough.
          turn_detection: { type: "server_vad", create_response: true, interrupt_response: false },
        },
        output: { voice: "alloy" },
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
