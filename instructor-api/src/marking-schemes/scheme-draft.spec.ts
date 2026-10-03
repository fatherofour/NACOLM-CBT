import { draftPrompt, parseDraft } from './scheme-draft.js';

describe('scheme draft', () => {
  it('grounds the prompt in the model answer and the total', () => {
    const p = draftPrompt('List the 4Ds.', 8, 'Destination, duration, demand, distance.');
    expect(p).toContain('Destination, duration, demand, distance.');
    expect(p).toContain('add up to exactly 8');
    expect(p).toContain('"off-topic"');
  });

  it('tidies variations, rounds marks to halves and keeps the samples', () => {
    const d = parseDraft(
      'Here you go: ' +
        JSON.stringify({
          points: [
            { name: ' Destination ', marks: 2.3, required: true, partial: 'half if only named', variations: ['destination', 'Where to', 'where to', 'Dest', ''] },
            { name: '', marks: 2 },
            { name: 'Duration', marks: 'x', variations: 'not a list' },
          ],
          partialCredit: 'Named only: half.',
          zeroCredit: 'Padding.',
          samples: [{ label: 'Full', text: 'Destination, duration...' }, { label: 'weak', text: '' }],
        }),
    );
    expect(d.points).toHaveLength(2);
    expect(d.points[0]).toEqual({ canonicalTerm: 'Destination', marks: 2.5, required: true, synonyms: ['Where to', 'Dest'], notes: 'half if only named' });
    expect(d.points[1]).toMatchObject({ canonicalTerm: 'Duration', marks: 1, required: false, synonyms: [] });
    expect(d.samples).toEqual([{ label: 'full', text: 'Destination, duration...' }]);
    expect(d.partialCreditNotes).toBe('Named only: half.');
  });

  it('rejects a draft with no key points', () => {
    expect(() => parseDraft('{"points": []}')).toThrow();
    expect(() => parseDraft('not json')).toThrow();
  });
});
