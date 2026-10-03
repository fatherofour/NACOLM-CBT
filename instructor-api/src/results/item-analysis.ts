// Classical item analysis for objective questions, from the venue results:
// how hard each question was (proportion correct) and how well it separated
// strong from weak candidates (discrimination: proportion correct in the top
// 27% minus the bottom 27%, ranked by objective score).

export interface ItemStat {
  questionId: string;
  answeredBy: number;
  difficulty: number; // proportion correct, 0..1
  discrimination: number | null; // null with too few candidates
  flags: string[];
}

export interface CandidateItems {
  objectiveCorrect: number;
  items: { questionId: string; type: string; correct: boolean }[];
}

export const MIN_FOR_DISCRIMINATION = 10;

export function itemAnalysis(candidates: CandidateItems[]): ItemStat[] {
  const ranked = [...candidates].sort((a, b) => b.objectiveCorrect - a.objectiveCorrect);
  const k = Math.max(1, Math.round(ranked.length * 0.27));
  const upper = ranked.slice(0, k);
  const lower = ranked.slice(-k);
  const ids = [...new Set(candidates.flatMap((c) => c.items.filter((i) => i.type === 'mcq').map((i) => i.questionId)))];

  const share = (group: CandidateItems[], id: string) => {
    const seen = group.map((c) => c.items.find((i) => i.questionId === id)).filter((i) => i);
    return seen.length ? seen.filter((i) => i!.correct).length / seen.length : 0;
  };

  return ids.map((id) => {
    const answeredBy = candidates.filter((c) => c.items.some((i) => i.questionId === id)).length;
    const difficulty = share(candidates, id);
    const discrimination = candidates.length >= MIN_FOR_DISCRIMINATION ? share(upper, id) - share(lower, id) : null;
    const flags: string[] = [];
    if (difficulty < 0.2) flags.push('very hard');
    if (difficulty > 0.9) flags.push('very easy');
    if (discrimination != null && discrimination < 0) flags.push('weaker candidates did better: check the key');
    else if (discrimination != null && discrimination < 0.2) flags.push('poor discrimination');
    const round = (n: number) => Math.round(n * 100) / 100;
    return { questionId: id, answeredBy, difficulty: round(difficulty), discrimination: discrimination == null ? null : round(discrimination), flags };
  });
}
