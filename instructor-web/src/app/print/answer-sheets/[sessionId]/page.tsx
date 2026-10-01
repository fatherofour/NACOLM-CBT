'use client';
import { use, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { api, qs, type AnswerSheetData, type Paper } from '@/lib/api';

// Printed outside the portal shell so nothing but the sheets reaches paper.
// Every page carries a QR code naming the paper, candidate, question and page
// number; bulk upload files scans by it, so nobody types names in afterwards.

const LINES_FIRST_PAGE = 22;
const LINES_LATER_PAGE = 30;

const css = `
.sheets-toolbar { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; padding: 12px 16px; background: #0f3b22; color: #fff; font: 14px/1.4 var(--font-archivo), system-ui, sans-serif; }
.sheets-toolbar select, .sheets-toolbar button { font: inherit; padding: 6px 10px; border-radius: 4px; border: 1px solid #ffffff55; }
.sheets-toolbar button { background: #fff; color: #0f3b22; font-weight: 700; cursor: pointer; }
.sheets-toolbar .grow { flex: 1; }
.sheets { background: #d9ddd3; padding: 24px 0; display: flex; flex-direction: column; align-items: center; gap: 24px; }
.sheet { width: 210mm; height: 297mm; background: #fff; color: #111; box-sizing: border-box; padding: 12mm 14mm 10mm; display: flex; flex-direction: column; gap: 4mm; font-family: var(--font-archivo), Arial, sans-serif; box-shadow: 0 1px 4px #0003; overflow: hidden; }
.sheet header { display: flex; gap: 5mm; align-items: flex-start; }
.sheet header img.crest { width: 15mm; height: 15mm; object-fit: contain; }
.sheet header .title { flex: 1; display: flex; flex-direction: column; gap: 1mm; }
.sheet header .title b { font-size: 13pt; letter-spacing: .02em; }
.sheet header .title span { font-size: 9pt; color: #333; }
.sheet .qr { width: 30mm; display: flex; flex-direction: column; align-items: center; gap: 1mm; }
.sheet .qr svg { width: 30mm; height: 30mm; display: block; }
.sheet .qr small { font-size: 6.5pt; text-align: center; color: #333; line-height: 1.2; }
.sheet .who { display: grid; grid-template-columns: 1.1fr 1.6fr .9fr .7fr; border: .35mm solid #111; }
.sheet .who div { padding: 1.6mm 2.4mm; border-left: .35mm solid #111; display: flex; flex-direction: column; gap: .6mm; }
.sheet .who div:first-child { border-left: 0; }
.sheet .who dt { font-size: 7pt; text-transform: uppercase; letter-spacing: .06em; color: #444; }
.sheet .who dd { margin: 0; font-size: 11pt; font-weight: 700; }
.sheet .question { border-left: 1.2mm solid #1b5a33; padding: 1mm 0 1mm 3mm; font-size: 10.5pt; line-height: 1.4; }
.sheet .question b { display: block; font-size: 8pt; text-transform: uppercase; letter-spacing: .06em; color: #1b5a33; margin-bottom: .6mm; }
.sheet .rules { font-size: 8pt; color: #333; }
.sheet .lines { flex: 1; display: flex; flex-direction: column; }
.sheet .lines div { flex: 1; border-bottom: .25mm solid #9aa39a; }
.sheet footer { display: flex; justify-content: space-between; font-size: 7pt; color: #555; }
.sheets-empty { padding: 48px 16px; text-align: center; font: 16px var(--font-archivo), sans-serif; }
@page { size: A4; margin: 0; }
@media print {
  .sheets-toolbar { display: none; }
  .sheets { background: none; padding: 0; gap: 0; display: block; }
  .sheet { box-shadow: none; break-after: page; page-break-after: always; }
  body { background: #fff !important; }
}
`;

export default function AnswerSheetsPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const [pages, setPages] = useState(2);
  const [data, setData] = useState<AnswerSheetData>();
  const [error, setError] = useState('');
  const [svgs, setSvgs] = useState<Record<string, string>>({});
  const [onlyQuestion, setOnlyQuestion] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const papers = await api.get<Paper[]>(`/papers${qs({ sessionId })}`);
        const version = papers.flatMap((p) => p.versions).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0];
        if (!version) throw new Error('This session has no published paper yet.');
        const d = await api.get<AnswerSheetData>(`/theory-scripts/answer-sheets${qs({ paperVersionId: version.id, pages: String(pages) })}`);
        const codes = d.candidates.flatMap((c) => Object.values(c.codes).flat());
        const out: Record<string, string> = {};
        for (const code of codes) out[code] = await QRCode.toString(code, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
        if (!cancelled) {
          setData(d);
          setSvgs(out);
          setError('');
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Couldn’t load the answer sheets.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, pages]);

  const questions = useMemo(() => (data?.questions ?? []).filter((q) => !onlyQuestion || q.id === onlyQuestion), [data, onlyQuestion]);
  const total = (data?.candidates.length ?? 0) * questions.length * pages;
  const examDate = data ? new Date(data.examDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

  return (
    <>
      <style>{css}</style>
      <div className="sheets-toolbar">
        <b>Theory answer sheets</b>
        <span>{data ? `${data.paperTitle} (version ${data.versionNumber})` : 'Loading…'}</span>
        <span className="grow" />
        <label>
          Pages per answer{' '}
          <select value={pages} onChange={(e) => setPages(Number(e.target.value))}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        {data && data.questions.length > 1 ? (
          <label>
            Question{' '}
            <select value={onlyQuestion} onChange={(e) => setOnlyQuestion(e.target.value)}>
              <option value="">All</option>
              {data.questions.map((q) => (
                <option key={q.id} value={q.id}>Question {q.number}</option>
              ))}
            </select>
          </label>
        ) : null}
        <span>{total} page{total === 1 ? '' : 's'}</span>
        <button type="button" disabled={!data} onClick={() => window.print()}>
          Print
        </button>
      </div>

      {error ? <p className="sheets-empty">{error}</p> : null}
      {data && !data.questions.length ? <p className="sheets-empty">There are no theory questions on this paper.</p> : null}
      {data && !data.candidates.length ? <p className="sheets-empty">There are no active candidates in this session.</p> : null}

      <div className="sheets">
        {data?.candidates.flatMap((c) =>
          questions.flatMap((q) =>
            (c.codes[q.id] ?? []).map((code, i) => (
              <article className="sheet" key={code}>
                <header>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="crest" src="/brand/nacolm-crest.png" alt="" />
                  <div className="title">
                    <b>NACOLM CBT · Theory answer sheet</b>
                    <span>Nigerian Army College of Logistics and Management</span>
                    <span>{data.paperTitle} · {examDate}</span>
                  </div>
                  <div className="qr">
                    <span dangerouslySetInnerHTML={{ __html: svgs[code] ?? '' }} />
                    <small>Do not write on, fold or cover this code</small>
                  </div>
                </header>
                <dl className="who">
                  <div><dt>Service number</dt><dd>{c.armyNumber}</dd></div>
                  <div><dt>Rank and name</dt><dd>{c.rank} {c.fullName}</dd></div>
                  <div><dt>Question</dt><dd>{q.number}{q.marks != null ? ` (${q.marks} marks)` : ''}</dd></div>
                  <div><dt>Page</dt><dd>{i + 1} of {pages}</dd></div>
                </dl>
                {i === 0 ? (
                  <p className="question"><b>{q.topic}</b>{q.body}</p>
                ) : (
                  <p className="question"><b>Continued</b>Continue your answer to question {q.number}.</p>
                )}
                <p className="rules">Answer question {q.number} only, on the lines below, in black or blue ink. Write clearly; your answer is read from a scan.</p>
                <div className="lines" aria-hidden="true">
                  {Array.from({ length: i === 0 ? LINES_FIRST_PAGE : LINES_LATER_PAGE }, (_, n) => <div key={n} />)}
                </div>
                <footer>
                  <span>{c.armyNumber} · Q{q.number} · page {i + 1}/{pages}</span>
                  <span>Hand in every page, even if blank.</span>
                </footer>
              </article>
            )),
          ),
        )}
      </div>
    </>
  );
}
