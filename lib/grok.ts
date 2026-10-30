import OpenAI from "openai";

const BASE_URL = "https://api.x.ai/v1";
const TIMEOUT_MS = 15_000;

export async function grokJSON(system: string, user: string): Promise<unknown> {
  const apiKey = process.env.XAI_API_KEY;
  const model = process.env.XAI_MODEL;
  if (!apiKey || !model) throw new Error("Grok is not configured");

  const client = new OpenAI({
    apiKey,
    baseURL: BASE_URL,
    timeout: TIMEOUT_MS,
    maxRetries: 0,
  });

  const response = await client.chat.completions.create(
    {
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    },
    { timeout: TIMEOUT_MS, maxRetries: 0, signal: AbortSignal.timeout(TIMEOUT_MS) },
  );

  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error("Grok returned an empty response");
  return parseJSON(text);
}

function parseJSON(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return JSON.parse(fenced[1]);
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("Grok returned non-JSON");
  }
}
