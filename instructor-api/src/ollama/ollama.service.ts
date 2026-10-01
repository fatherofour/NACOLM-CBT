import { Injectable } from '@nestjs/common';
import { Agent } from 'undici';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';

// Ollama sends no response headers until it has digested the prompt (and any
// image), which can exceed fetch's default 5-minute limit on CPU-only hardware.
const noTimeouts = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

/**
 * Thin wrapper over Ollama's local HTTP API
 * (https://github.com/ollama/ollama/blob/main/docs/api.md). Everything here
 * runs on this machine against a model already pulled with `ollama pull`,
 * not a paid API — see theory-scripts.service.ts for why that's the point
 * during this testing phase.
 */
@Injectable()
export class OllamaService {
  /** One-shot, non-streaming generation. `images` are base64 (no `data:` prefix). */
  async generate(params: {
    model: string;
    prompt: string;
    images?: string[];
    json?: boolean;
    think?: boolean;
    keepAlive?: string;
  }): Promise<string> {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: params.model,
        prompt: params.prompt,
        images: params.images,
        format: params.json ? 'json' : undefined,
        think: params.think,
        keep_alive: params.keepAlive,
        // Streamed so response headers arrive immediately; a non-streaming
        // call on CPU-only hardware can exceed fetch's 5-minute headers timeout.
        stream: true,
      }),
      dispatcher: noTimeouts,
    } as RequestInit);
    if (!res.ok || !res.body) {
      throw new Error(`ollama /api/generate failed (${res.status}): ${await res.text()}`);
    }

    let text = '';
    let buffered = '';
    const decoder = new TextDecoder();
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffered += decoder.decode(chunk, { stream: true });
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const part = JSON.parse(line) as { response?: string; error?: string };
        if (part.error) throw new Error(`ollama error: ${part.error}`);
        text += part.response ?? '';
      }
    }
    // Reasoning models (deepseek-r1, qwq) may inline their chain of thought.
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  }

  /** Frees the model's memory now instead of after its keep-alive expires. */
  async unload(model: string): Promise<void> {
    await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, keep_alive: 0 }),
      dispatcher: noTimeouts,
    } as RequestInit);
  }
}
