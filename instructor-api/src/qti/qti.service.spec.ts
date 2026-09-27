import { describe, expect, it } from 'vitest';
import { QtiService } from './qti.service.js';

function fakePrisma(items: unknown[]) {
  return {
    paperVersion: {
      findUnique: async () => ({
        id: 'pv_1',
        versionNumber: 2,
        paper: { title: 'LOG301 First Term 2026' },
        items,
      }),
    },
  } as never;
}

const mcq = {
  question: { id: 'q_mcq', type: 'OBJECTIVE', body: 'What is 1 + 1?', options: ['1', '2', '3'], correctIndex: 1 },
};
const theory = {
  question: { id: 'q_theory', type: 'THEORY', body: 'Describe a movement order.', options: null, correctIndex: null },
};

describe('QtiService.exportPaperVersion', () => {
  it('produces a QTI 2.1 content package with a manifest, a test, and one item per question', async () => {
    const service = new QtiService(fakePrisma([mcq, theory]));
    const { filename, data } = await service.exportPaperVersion('pv_1');

    expect(filename).toBe('log301-first-term-2026-v2-qti.zip');
    // ZIP local file header magic number.
    expect(data.readUInt32LE(0)).toBe(0x04034b50);

    const names = listZipEntryNames(data);
    expect(names).toEqual(expect.arrayContaining(['imsmanifest.xml', 'test.xml', 'items/ITEM-q_mcq.xml', 'items/ITEM-q_theory.xml']));

    const mcqXml = readZipEntry(data, 'items/ITEM-q_mcq.xml');
    expect(mcqXml).toContain('<choiceInteraction');
    expect(mcqXml).toContain('What is 1 + 1?');
    expect(mcqXml).toContain('<correctResponse><value>ChoiceB</value></correctResponse>'); // index 1 -> B

    const theoryXml = readZipEntry(data, 'items/ITEM-q_theory.xml');
    expect(theoryXml).toContain('<extendedTextInteraction');
    expect(theoryXml).not.toContain('correctResponse'); // manually marked, no automated key

    const manifest = readZipEntry(data, 'imsmanifest.xml');
    expect(manifest).toContain('imsqti_test_xmlv2p1');
    expect(manifest).toContain('imsqti_item_xmlv2p1');
  });

  it('escapes XML-significant characters in question text', async () => {
    const service = new QtiService(
      fakePrisma([{ question: { id: 'q_x', type: 'OBJECTIVE', body: 'A & B < C', options: ['x & y'], correctIndex: 0 } }]),
    );
    const { data } = await service.exportPaperVersion('pv_1');
    const xml = readZipEntry(data, 'items/ITEM-q_x.xml');
    expect(xml).toContain('A &amp; B &lt; C');
    expect(xml).not.toContain('A & B < C');
  });

  it('rejects a paper version with no questions', async () => {
    const service = new QtiService(fakePrisma([]));
    await expect(service.exportPaperVersion('pv_1')).rejects.toThrow(/no questions/);
  });
});

// --- minimal STORED-zip reader, just enough to verify what qti-zip.ts wrote ---

function listZipEntryNames(zip: Buffer): string[] {
  const names: string[] = [];
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const nameLen = zip.readUInt16LE(offset + 26);
    const extraLen = zip.readUInt16LE(offset + 28);
    const compSize = zip.readUInt32LE(offset + 18);
    names.push(zip.subarray(offset + 30, offset + 30 + nameLen).toString('utf8'));
    offset += 30 + nameLen + extraLen + compSize;
  }
  return names;
}

function readZipEntry(zip: Buffer, name: string): string {
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const nameLen = zip.readUInt16LE(offset + 26);
    const extraLen = zip.readUInt16LE(offset + 28);
    const compSize = zip.readUInt32LE(offset + 18);
    const entryName = zip.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
    const dataStart = offset + 30 + nameLen + extraLen;
    if (entryName === name) return zip.subarray(dataStart, dataStart + compSize).toString('utf8');
    offset = dataStart + compSize;
  }
  throw new Error(`entry not found: ${name}`);
}
