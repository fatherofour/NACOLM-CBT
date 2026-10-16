import { Agent } from 'undici';

// Hosted models reached through an OpenAI-compatible Chat Completions API, for
// when OCR_MODEL / MARKING_MODEL name one: Kimi ("kimi-k3", Moonshot), Gemini
// ("gemini-3.8-flash", Google) or a model hosted on Groq, named with a "groq/"
// prefix ("groq/qwen/qwen3.8-27b"). Each needs its key on the server. The scripts
// and schemes are sent to that provider, so the college must have agreed.

// `strip`: the prefix only picks the provider and is not part of its model ID.
const PROVIDERS = [
  { name: 'Kimi', prefix: 'kimi-', strip: false, baseUrl: process.env.KIMI_BASE_URL ?? 'https://api.moonshot.ai/v1', keyVar: 'KIMI_API_KEY' },
  { name: 'Gemini', prefix: 'gemini-', strip: false, baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyVar: 'GEMINI_API_KEY' },
  { name: 'Groq', prefix: 'groq/', strip: true, baseUrl: 'https://api.groq.com/openai/v1', keyVar: 'GROQ_API_KEY' },
];

const providerOf = (model: string) => PROVIDERS.find((p) => model.startsWith(p.prefix));
export const isHostedModel = (model: string) => !!providerOf(model);

// Reasoning models can take minutes before the first byte of a long answer.
const noTimeouts = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

// Free tiers turn requests away when busy (429, 503); wait and try again.
const RETRY_DELAYS_MS = [10_000, 30_000, 60_000, 120_000];

const mediaType = (base64: string) => (base64.startsWith('iVBOR') ? 'image/png' : 'image/jpeg');

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });
}

/** One request, answered with the text of the reply (any reasoning is not returned). */
export async function hostedGenerate(params: { model: string; prompt: string; images?: string[]; signal?: AbortSignal }): Promise<string> {
  const provider = providerOf(params.model)!;
  const key = process.env[provider.keyVar];
  if (!key) throw new Error(`${provider.keyVar} is not set on the server`);
  const content = [
    ...(params.images ?? []).map((data) => ({ type: 'image_url', image_url: { url: `data:${mediaType(data)};base64,${data}` } })),
    { type: 'text', text: params.prompt },
  ];
  // No temperature, top_p or seed: Kimi K3's sampling is fixed, and the defaults suit the rest.
  const model = provider.strip ? params.model.slice(provider.prefix.length) : params.model;
  const body = JSON.stringify({ model, messages: [{ role: 'user', content }], max_tokens: 16000 });

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body,
      dispatcher: noTimeouts,
      signal: params.signal,
    } as RequestInit);
    if ((res.status === 429 || res.status === 503) && attempt < RETRY_DELAYS_MS.length) {
      await res.body?.cancel();
      await sleep(RETRY_DELAYS_MS[attempt], params.signal);
      continue;
    }
    if (!res.ok) throw new Error(`${provider.name} API failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
    const reply = (await res.json()) as { choices?: { message?: { content?: string | null }; finish_reason?: string }[] };
    const choice = reply.choices?.[0];
    if (choice?.finish_reason === 'length') throw new Error(`${provider.name}’s reply was cut off at the length limit`);
    const text = choice?.message?.content?.trim();
    if (!text) throw new Error(`${provider.name} returned no answer: ${JSON.stringify(reply).slice(0, 300)}`);
    return text;
  }
}
