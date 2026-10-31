/**
 * Thin Anthropic API wrapper. Every AI feature must work without a key , 
 * callers get `null` back and fall through to their deterministic path.
 */

const API_URL = "https://api.anthropic.com/v1/messages";

export function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function modelVersion() {
  return process.env.AI_MODEL || "claude-sonnet-5";
}

type Message = { role: "user" | "assistant"; content: string };

/**
 * A real one-token call, so admin settings show whether the AI actually
 * answers. A key alone is not proof: a wrong model name, a revoked key or an
 * empty credit balance all fail silently into the fallbacks.
 */
export async function checkAI(): Promise<{ ok: boolean; detail: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, detail: "No ANTHROPIC_API_KEY set" };
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: modelVersion(), max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
      cache: "no-store",
    });
    if (res.ok) return { ok: true, detail: `Answering · ${modelVersion()}` };
    let msg = "";
    try {
      msg = (await res.json())?.error?.message || "";
    } catch {}
    return { ok: false, detail: `Error ${res.status} from Anthropic${msg ? `: ${msg.slice(0, 160)}` : ""} (model: ${modelVersion()})` };
  } catch (err) {
    return { ok: false, detail: `Could not reach Anthropic: ${(err as Error).message}` };
  }
}

async function callAnthropic(body: Record<string, unknown>) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Anthropic API error ${res.status}: ${text.slice(0, 500)}`);
    return null;
  }
  return res.json();
}

function extractJSON<T>(res: any, maxTokens: number): T | null {
  if (!res) return null;
  if (res.stop_reason === "max_tokens") {
    console.error(
      `AI response hit the ${maxTokens}-token ceiling and was truncated. Raise maxTokens for this call because falling back for now.`
    );
    return null;
  }
  const text: string =
    res.content?.map((b: any) => (b.type === "text" ? b.text : "")).join("") ??
    "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    console.error("AI returned no JSON object:", text.slice(0, 300));
    return null;
  }
  try {
    return JSON.parse(match[0]) as T;
  } catch (parseErr) {
    console.error("AI returned malformed JSON:", (parseErr as Error).message);
    return null;
  }
}

export async function completeJSON<T>(
  system: string,
  messages: Message[],
  maxTokens = 4096
): Promise<T | null> {
  try {
    const res = await callAnthropic({
      model: modelVersion(),
      max_tokens: maxTokens,
      system,
      messages,
    });
    return extractJSON<T>(res, maxTokens);
  } catch (err) {
    console.error("completeJSON failed:", err);
    return null;
  }
}

/** Sends a PDF as a document block so the model reads it directly. */
export async function completeJSONFromPdf<T>(
  system: string,
  prompt: string,
  pdfBase64: string,
  maxTokens = 4096
): Promise<T | null> {
  try {
    const res = await callAnthropic({
      model: modelVersion(),
      max_tokens: maxTokens,
      system,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: pdfBase64,
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    });
    return extractJSON<T>(res, maxTokens);
  } catch (err) {
    console.error("completeJSONFromPdf failed:", err);
    return null;
  }
}
