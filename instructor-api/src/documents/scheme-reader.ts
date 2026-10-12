// Picks the reader for an uploaded marking scheme: questions each followed by
// a SOLUTION block (the Management layout), or answers written straight after
// their questions (the Logistics Planning layout). Null when the text is
// neither, e.g. a blank question paper.
import { looksLikeMarkingScheme, parseMarkingScheme, schemeLayout, type SchemeLayout, type SchemeQuestion } from './marking-scheme-parser.js';
import { looksLikeInlineScheme, parseInlineScheme } from './inline-scheme-parser.js';

export function readScheme(text: string): { questions: SchemeQuestion[]; layout: SchemeLayout } | null {
  if (looksLikeMarkingScheme(text)) return { questions: parseMarkingScheme(text), layout: schemeLayout(text) };
  if (looksLikeInlineScheme(text)) return parseInlineScheme(text);
  return null;
}
