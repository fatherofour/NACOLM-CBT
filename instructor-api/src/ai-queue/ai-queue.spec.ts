import { AiQueue, type AiJob } from './ai-queue.js';

const OCR = 'vision';
const MARK = 'marker';
const DEEP = 'deep';

function harness(batchMax = 25) {
  const ran: string[] = [];
  const unloaded: string[] = [];
  let release: (() => void) | null = null;
  const queue = new AiQueue(
    async (job) => {
      ran.push(`${job.stage}:${job.id}`);
      await new Promise<void>((r) => (release = r));
    },
    async (model) => {
      unloaded.push(model);
    },
    () => undefined,
    batchMax,
  );
  const step = async () => {
    await new Promise((r) => setTimeout(r, 0));
    const r = release as (() => void) | null;
    release = null;
    r?.();
    await new Promise((r2) => setTimeout(r2, 0));
  };
  return { queue, ran, unloaded, step };
}

const ocr = (id: string): AiJob => ({ id, stage: 'ocr', model: OCR });
const mark = (id: string, model = MARK): AiJob => ({ id, stage: 'mark', model });

describe('AiQueue', () => {
  it('reads every waiting script before marking any, so each model loads once', async () => {
    const { queue, ran, unloaded, step } = harness();
    queue.add(ocr('a'));
    queue.add(ocr('b'));
    await step(); // a read; its marking would be queued by the service
    queue.add(mark('a'));
    await step(); // b read
    queue.add(mark('b'));
    await step();
    await step();
    expect(ran).toEqual(['ocr:a', 'ocr:b', 'mark:a', 'mark:b']);
    expect(unloaded).toEqual([OCR]);
  });

  it('gives the other stage a turn after batchMax jobs in a row', async () => {
    const { queue, ran, step } = harness(2);
    queue.add(ocr('a'));
    queue.add(ocr('b'));
    queue.add(ocr('c'));
    queue.add(mark('x'));
    for (let i = 0; i < 4; i++) await step();
    expect(ran).toEqual(['ocr:a', 'ocr:b', 'mark:x', 'ocr:c']);
  });

  it('groups jobs that use the loaded model before switching to another', async () => {
    const { queue, ran, unloaded, step } = harness();
    queue.add(mark('a'));
    queue.add(mark('b', DEEP));
    queue.add(mark('c'));
    for (let i = 0; i < 3; i++) await step();
    expect(ran).toEqual(['mark:a', 'mark:c', 'mark:b']);
    expect(unloaded).toEqual([MARK]);
  });

  it('replaces a waiting job for the same script instead of running it twice', async () => {
    const { queue, ran, step } = harness();
    queue.add(ocr('busy'));
    queue.add(mark('a'));
    queue.add(ocr('a'));
    expect(queue.size()).toBe(2);
    for (let i = 0; i < 3; i++) await step();
    expect(ran).toEqual(['ocr:busy', 'ocr:a']);
  });

  it('estimates time left from what is waiting', () => {
    const { queue } = harness();
    queue.add(ocr('a'));
    queue.add(ocr('b'));
    queue.add(mark('c'));
    const s = queue.status();
    expect(s.running?.id).toBe('a');
    expect(s.waiting).toEqual({ ocr: 1, mark: 1 });
    expect(s.etaSeconds).toBeGreaterThan(0);
  });
});
