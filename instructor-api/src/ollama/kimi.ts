import { Agent } from 'undici';

// Kimi through Moonshot's OpenAI-compatible API, for when OCR_MODEL /
// MARKING_MODEL name a Kimi model ("kimi-k3"). Needs KIMI_API_KEY. The
// scripts and schemes are sent to Moonshot, so the college must have agreed.

export const isKimiModel = (model: string) => model.startsWith('kimi-');

const KIMI_BASE_URL = process.env.KIMI_BASE_URL ?? 'https://api.moonshot.ai/v1';

// K3 always reasons before it answers, which can take minutes on a long answer.
const noTimeouts = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

const mediaType = (base64: string) => (base64.startsWith('iVBOR') ? 'image/png' : 'image/jpeg');

/** One request, answered with the text of the reply (its reasoning is not returned). */
export async function kimiGenerate(params: { model: string; prompt: string; images?: string[]; signal?: AbortSignal }): Promise<string> {
  const key = process.env.KIMI_API_KEY;
  if (!key) throw new Error('KIMI_API_KEY is not set on the server');
  const content = [
    ...(params.images ?? []).map((data) => ({ type: 'image_url', image_url: { url: `data:${mediaType(data)};base64,${data}` } })),
    { type: 'text', text: params.prompt },
  ];
  // K3's sampling is fixed: temperature, top_p and seed are not sent.
  const res = await fetch(`${KIMI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: params.model, messages: [{ role: 'user', content }], max_tokens: 16000 }),
    dispatcher: noTimeouts,
    signal: params.signal,
  } as RequestInit);
  if (!res.ok) throw new Error(`Kimi API failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string | null }; finish_reason?: string }[] };
  const choice = body.choices?.[0];
  if (choice?.finish_reason === 'length') throw new Error('Kimi’s reply was cut off at the length limit');
  const text = choice?.message?.content?.trim();
  if (!text) throw new Error(`Kimi returned no answer: ${JSON.stringify(body).slice(0, 300)}`);
  return text;
}
