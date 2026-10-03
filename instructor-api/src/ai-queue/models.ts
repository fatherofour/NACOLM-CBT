// Which local models do what. OCR (reading the handwriting) needs a vision
// model; marking and scheme drafting are plain text. The default marker is a
// small non-reasoning model: on the 4-core server it marks in about 25s
// against about 150s for deepseek-r1. deepseek-r1 stays available as a slower
// second opinion.
export const OCR_MODEL = process.env.OCR_MODEL ?? 'qwen2.5vl:3b';
export const MARKING_MODEL = process.env.MARKING_MODEL ?? 'qwen3:4b';
export const DEEP_MARKING_MODEL = process.env.DEEP_MARKING_MODEL ?? 'deepseek-r1';

// Keep a model loaded between jobs of a batch; the queue unloads it explicitly
// when it switches model, since the server can't hold two at once.
export const KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE ?? '15m';

export const isReasoningModel = (model: string) => /deepseek-r1|qwq/.test(model);
// qwen3 thinks by default; switched off it answers in seconds. Other models
// either can't think (and reject the flag) or are reasoning models by design.
export const thinkFlag = (model: string) => (/qwen3/.test(model) ? false : undefined);
