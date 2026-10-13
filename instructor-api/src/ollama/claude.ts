import Anthropic from '@anthropic-ai/sdk';

// Claude through Anthropic's API, for when OCR_MODEL / MARKING_MODEL name a
// Claude model ("claude-opus-5-5"). Needs ANTHROPIC_API_KEY. The scripts and
// schemes are sent to Anthropic, so the college must have agreed to that.

export const isClaudeModel = (model: string) => model.startsWith('claude-');

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

const mediaType = (base64: string): Anthropic.Beta.BetaBase64ImageSource['media_type'] => (base64.startsWith('iVBOR') ? 'image/png' : 'image/jpeg');

/**
 * One request, answered with the text of the reply. Reading a page is plain
 * transcription, so it runs at low effort; marking and drafting at medium.
 */
export async function claudeGenerate(params: { model: string; prompt: string; images?: string[]; signal?: AbortSignal }): Promise<string> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...(params.images ?? []).map((data) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType(data), data } })),
    { type: 'text', text: params.prompt },
  ];
  const message = await anthropic()
    .beta.messages.stream(
      {
        model: params.model,
        max_tokens: 16000,
        output_config: { effort: params.images?.length ? 'low' : 'medium' },
        // If a safety check declines the request, the API retries it on a suitable model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        messages: [{ role: 'user', content }],
      },
      { signal: params.signal },
    )
    .finalMessage();
  if (message.stop_reason === 'refusal') {
    throw new Error(`Claude declined the request${message.stop_details?.category ? ` (${message.stop_details.category})` : ''}`);
  }
  if (message.stop_reason === 'max_tokens') throw new Error('Claude’s reply was cut off at the length limit');
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}
