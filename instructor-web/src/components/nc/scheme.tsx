'use client';
import { Glyph } from './glyph';
import { Switch, TagInput } from './basics';
import type { ConceptGroup } from '@/lib/api';

export function ConceptGroupEditor({ group, onChange, onRemove, index }: { group: ConceptGroup; onChange: (g: ConceptGroup) => void; onRemove: () => void; index: number }) {
  const set = <K extends keyof ConceptGroup>(k: K) => (v: ConceptGroup[K]) => onChange({ ...group, [k]: v });
  return (
    <fieldset className="nc-cg">
      <legend className="nc-sr">Concept group {index + 1}</legend>
      <label className="nc-field nc-cg-term">
        <span className="label">Canonical term</span>
        <input value={group.canonicalTerm} onChange={(e) => set('canonicalTerm')(e.target.value)} required />
      </label>
      <div className="nc-field nc-cg-syn">
        <span className="label">Synonyms</span>
        <TagInput value={group.synonyms} onChange={set('synonyms')} label={`Synonyms for ${group.canonicalTerm || `group ${index + 1}`}`} />
      </div>
      <label className="nc-field nc-cg-marks">
        <span className="label">Marks</span>
        <input type="number" min={0} value={group.marks} onChange={(e) => set('marks')(Math.max(0, parseInt(e.target.value || '0', 10)))} />
      </label>
      <div className="nc-cg-req" title="If missing, the question's score is capped even if other groups match.">
        <Switch checked={group.required} onChange={set('required')} label="Required" />
      </div>
      <button type="button" className="nc-cg-remove" aria-label={`Remove group ${group.canonicalTerm || index + 1}`} onClick={onRemove}>
        <Glyph name="cross" />
      </button>
    </fieldset>
  );
}
