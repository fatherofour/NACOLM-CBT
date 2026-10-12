'use client';
import { Suspense, createContext, use, useContext, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, type PrintItem, type PrintPaper as PrintData } from '@/lib/api';
import { answerBlocks, awardRule, splitScheme } from '@/lib/scheme-format';

// A published paper printed in the template of the past paper it follows:
// the classification at the top and bottom of every page, the college and
// department, the paper's details, then each section with its numbered
// questions and marks. The marking scheme copy adds a SOLUTION under each
// question (or each part of one) and the approved mark allocation. Printed
// outside the portal shell so only the paper reaches the printer.

const css = `
.pp-toolbar { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: flex-end; padding: 12px 16px; background: #0f3b22; color: #fff; font: 14px/1.4 system-ui, sans-serif; }
.pp-toolbar label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
.pp-toolbar input, .pp-toolbar select { font: 14px system-ui, sans-serif; padding: 5px 8px; border-radius: 4px; border: 1px solid #ffffff55; min-width: 0; }
.pp-toolbar .seg { display: flex; border: 1px solid #ffffff88; border-radius: 6px; overflow: hidden; }
.pp-toolbar .seg button { font: 600 14px system-ui, sans-serif; padding: 7px 12px; border: 0; background: transparent; color: #fff; cursor: pointer; }
.pp-toolbar .seg button[aria-pressed="true"] { background: #fff; color: #0f3b22; }
.pp-toolbar .print { font: 700 14px system-ui, sans-serif; padding: 8px 16px; border-radius: 6px; border: 0; background: #fff; color: #0f3b22; cursor: pointer; }
.pp-toolbar .grow { flex: 1; }
.pp-stage { background: #d9ddd3; padding: 24px 12px; min-height: 100vh; }
.pp-sheet { width: 210mm; max-width: 100%; margin: 0 auto; background: #fff; color: #000; box-sizing: border-box; padding: 14mm 18mm; box-shadow: 0 1px 4px #0003;
  font-family: Arial, "Liberation Sans", Helvetica, sans-serif; font-size: 12pt; line-height: 1.4; }
.pp-class { text-align: center; font-size: 11pt; margin: 0 0 8mm; }
.pp-class.bottom { margin: 10mm 0 0; }
.pp-inst { text-align: center; font-weight: 700; font-style: italic; text-decoration: underline; margin: 0; font-size: 12.5pt; }
.pp-sheet.subject-style { font-family: "Times New Roman", Times, "Liberation Serif", serif; }
.pp-sheet.subject-style .pp-inst { font-style: normal; text-decoration: none; }
.pp-subject-head { display: flex; flex-direction: column; gap: 1.5mm; margin: 4mm 0 0; padding-bottom: 2mm; border-bottom: 1mm double #000; }
.pp-subject-head p { margin: 0; }
.pp-subject-head b { margin-right: 1.5mm; }
.pp-subject-head b + span + b { margin-left: 5mm; }
.pp-details { display: grid; grid-template-columns: 1.5fr 1fr; gap: 1.5mm 6mm; margin: 5mm 0 2mm; }
.pp-rule { letter-spacing: .35em; margin: 1mm 0 4mm; overflow: hidden; white-space: nowrap; }
.pp-head { font-weight: 700; font-style: italic; text-decoration: underline; margin: 4mm 0 3mm; text-transform: uppercase; }
.pp-section-note { margin: -1mm 0 3mm; font-style: italic; }
.pp-q { display: grid; grid-template-columns: 11mm 1fr; margin: 0 0 3mm; text-align: justify; break-inside: avoid-page; }
.pp-q .num { font-weight: 400; }
.pp-part { display: grid; grid-template-columns: 7mm 1fr; margin: 0 0 2.5mm; }
.pp-opts { display: grid; grid-template-columns: 8mm 1fr; margin: 1mm 0 0; }
.pp-sol { margin: 1mm 0 4mm; }
.pp-sol > b { display: block; font-style: italic; text-decoration: underline; margin-bottom: 1.5mm; }
.pp-list { display: grid; grid-template-columns: 22mm 1fr; text-align: justify; }
.pp-list span:nth-child(odd) { text-align: right; padding-right: 6mm; }
.pp-para { margin: 0 0 1.5mm; text-align: justify; }
.pp-note { font-style: italic; margin: 1mm 0; }
.pp-alloc { width: 100%; border-collapse: collapse; font-size: 10pt; margin: 2mm 0 0; break-inside: avoid-page; }
.pp-alloc caption { text-align: left; font-weight: 700; font-size: 10pt; padding-bottom: 1mm; }
.pp-alloc td, .pp-alloc th { border: .3mm solid #555; padding: 1mm 2mm; vertical-align: top; text-align: left; }
.pp-alloc td.m, .pp-alloc th.m { text-align: right; width: 16mm; white-space: nowrap; }
.pp-foot { display: flex; justify-content: space-between; font-size: 8pt; color: #444; margin-top: 6mm; }
.pp-empty { padding: 48px 16px; text-align: center; font: 16px system-ui, sans-serif; }
@media print {
  .pp-toolbar { display: none; }
  .pp-stage { background: none; padding: 0; min-height: 0; }
  .pp-sheet { box-shadow: none; padding: 0; width: auto; }
  .pp-class, .pp-foot { display: none; }
  body { background: #fff !important; }
}
`;

// The approved mark allocation under each solution; instructors can leave it off for a copy like the original.
const ShowAllocation = createContext(true);

const plural = (n: number) => `${n} mark${n === 1 ? '' : 's'}`;
/** A model answer as the department writes it: lettered or roman lists, and paragraphs. */
function Answer({ text }: { text: string }) {
  return (
    <>
      {answerBlocks(text).map((b, i) =>
        b.label ? (
          <div className="pp-list" key={i}>
            <span>{b.label}</span>
            <span>
              {b.heading ? <b>{b.heading}</b> : null} {b.text}
            </span>
          </div>
        ) : (
          <p className="pp-para" key={i}>
            {b.heading ? <b>{b.heading} </b> : null}
            {b.text}
          </p>
        ),
      )}
    </>
  );
}

function Allocation({ points, total }: { points: PrintItem['points']; total: number }) {
  const show = useContext(ShowAllocation);
  if (!points.length || !show) return null;
  return (
    <table className="pp-alloc">
      <caption>Mark allocation (approved scheme)</caption>
      <thead>
        <tr>
          <th>Key point</th>
          <th className="m">Marks</th>
          <th>How to award</th>
        </tr>
      </thead>
      <tbody>
        {points.map((p, i) => (
          <tr key={i}>
            <td>
              {p.term}
              {p.synonyms.length ? (
                <>
                  <br />
                  <small>Accept: {p.synonyms.join('; ')}</small>
                </>
              ) : null}
            </td>
            <td className="m">{p.marks}</td>
            <td>{awardRule(p.notes)}</td>
          </tr>
        ))}
        <tr>
          <td>
            <b>Total</b>
          </td>
          <td className="m">
            <b>{total}</b>
          </td>
          <td />
        </tr>
      </tbody>
    </table>
  );
}

function Solution({ item, scheme }: { item: PrintItem; scheme: boolean }) {
  if (!scheme) return null;
  if (item.type === 'OBJECTIVE') {
    const answer = item.correctIndex != null && item.options ? item.options[item.correctIndex] : null;
    return (
      <div className="pp-sol">
        <b>SOLUTION</b>
        {answer ? (
          <p className="pp-para">
            {item.options!.length > 2 ? `${String.fromCharCode(97 + item.correctIndex!)}. ` : ''}
            {answer}
          </p>
        ) : (
          <p className="pp-para">Answer not set. Set it in review before marking.</p>
        )}
      </div>
    );
  }
  return (
    <div className="pp-sol">
      <b>SOLUTION</b>
      {item.modelAnswer ? <Answer text={item.modelAnswer} /> : null}
      {item.markingNotes ? <p className="pp-note">({item.markingNotes})</p> : null}
      <Allocation points={item.points} total={item.marks} />
    </div>
  );
}

function Question({ item, scheme }: { item: PrintItem; scheme: boolean }) {
  const split = item.type === 'THEORY' ? splitScheme({ ...item, points: item.points, totalMarks: item.marks }) : null;
  if (split && split.parts[0].label) {
    return (
      <>
        {split.parts.map((p, i) => (
          <div key={p.label!}>
            <div className="pp-q">
              <span className="num">{i === 0 ? `${item.number}.` : ''}</span>
              <div>
                {i === 0 && split.stem ? <p className="pp-para">{split.stem}</p> : null}
                <div className="pp-part">
                  <span>{p.label}.</span>
                  <span>
                    {p.question}
                    {p.marks != null ? ` (${plural(p.marks)})` : ''}
                  </span>
                </div>
              </div>
            </div>
            {scheme ? (
              <div className="pp-sol">
                <b>SOLUTION</b>
                {p.answer ? <Answer text={p.answer} /> : null}
                {p.note ? <p className="pp-note">({p.note})</p> : null}
                <Allocation points={p.points} total={p.points.reduce((a, b) => a + b.marks, 0)} />
              </div>
            ) : null}
          </div>
        ))}
      </>
    );
  }
  const trueFalse = item.type === 'OBJECTIVE' && item.options?.length === 2 && item.options.join('/') === 'True/False';
  return (
    <>
      <div className="pp-q">
        <span className="num">{item.number}.</span>
        <div>
          {item.body}
          {trueFalse ? ' (True or False).' : ''} ({plural(item.marks)})
          {item.type === 'OBJECTIVE' && !trueFalse && item.options?.length
            ? item.options.map((o, i) => (
                <div className="pp-opts" key={i}>
                  <span>{String.fromCharCode(97 + i)}.</span>
                  <span>{o}</span>
                </div>
              ))
            : null}
        </div>
      </div>
      <Solution item={item} scheme={scheme} />
    </>
  );
}

export default function PrintPaperPage({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = use(params);
  return (
    <Suspense fallback={<p className="pp-empty">Loading…</p>}>
      <PrintPaper versionId={versionId} />
    </Suspense>
  );
}

function PrintPaper({ versionId }: { versionId: string }) {
  const search = useSearchParams();
  const [copy, setCopy] = useState<'candidate' | 'scheme'>(search.get('copy') === 'scheme' ? 'scheme' : 'candidate');
  const [allocation, setAllocation] = useState(true);
  const [data, setData] = useState<PrintData>();
  const [error, setError] = useState('');
  // The heading comes from the past paper; a new sitting usually changes the test name or time.
  const [edits, setEdits] = useState<Partial<Record<'paperTitle' | 'course' | 'time' | 'totalMarks' | 'classification', string>>>({});

  useEffect(() => {
    api.get<PrintData>(`/papers/${versionId}/print`).then(setData, (e) => setError(e instanceof Error ? e.message : 'Couldn’t load the paper.'));
  }, [versionId]);

  const h = useMemo(
    () =>
      data
        ? {
            ...data.header,
            ...Object.fromEntries(Object.entries(edits).filter(([, v]) => v !== undefined)),
          }
        : null,
    [data, edits],
  );
  const scheme = copy === 'scheme';
  // Papers headed "Subject: … HPS: …" (the Logistics Planning layout) print that heading, in its serif type.
  const subjectStyle = data?.header.totalLabel === 'HPS';
  const field = (key: keyof typeof edits, label: string, width = 140) => (
    <label>
      {label}
      <input style={{ width }} value={edits[key] ?? (data?.header[key] as string | null) ?? ''} onChange={(e) => setEdits({ ...edits, [key]: e.target.value })} />
    </label>
  );
  // Chrome prints these in the page margins of every sheet, like the original.
  const pageCss = h
    ? `@page { size: A4; margin: 18mm 18mm 20mm;
        @top-center { content: ${JSON.stringify(h.classification ?? '')}; font: 11pt Arial, sans-serif; }
        @bottom-center { content: counter(page) "\\A" ${JSON.stringify(h.classification ?? '')}; white-space: pre; font: 11pt Arial, sans-serif; }
        @bottom-right { content: "v${data!.versionNumber} · ${data!.signature}"; font: 7pt Arial, sans-serif; color: #666; } }`
    : '';

  return (
    <>
      <style>{css + pageCss}</style>
      <div className="pp-toolbar">
        <div className="seg" role="group" aria-label="Which copy">
          <button type="button" aria-pressed={!scheme} onClick={() => setCopy('candidate')}>
            Candidates’ paper
          </button>
          <button type="button" aria-pressed={scheme} onClick={() => setCopy('scheme')}>
            Marking scheme
          </button>
        </div>
        {data ? (
          <>
            {field('paperTitle', 'Paper', 170)}
            {field('course', 'Course', 130)}
            {field('time', 'Time', 70)}
            {field('totalMarks', 'Total marks', 80)}
            {field('classification', 'Classification', 110)}
          </>
        ) : null}
        {scheme ? (
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={allocation} onChange={(e) => setAllocation(e.target.checked)} />
            Mark allocation tables
          </label>
        ) : null}
        <span className="grow" />
        <button type="button" className="print" disabled={!data} onClick={() => window.print()}>
          Print {scheme ? 'marking scheme' : 'paper'}
        </button>
      </div>

      {error ? <p className="pp-empty">{error}</p> : null}
      {!data && !error ? <p className="pp-empty">Loading…</p> : null}
      {data && h ? (
        <ShowAllocation.Provider value={allocation}>
          <div className="pp-stage">
            <article className={`pp-sheet ${subjectStyle ? 'subject-style' : ''}`}>
              <p className="pp-class">{h.classification}</p>
              <p className="pp-inst">{h.institution}</p>
              {h.department ? <p className="pp-inst">{h.department}</p> : null}
              {subjectStyle ? (
                // "Subject: … Course: …", "Instructions: …", "Time Allowed: … HPS: …" under a double rule, as on the paper.
                <div className="pp-subject-head">
                  <p>
                    <b>Subject:</b>
                    <span>
                      {(h.paperTitle ?? '').toUpperCase()}
                      {scheme ? ' MARKING SCHEME' : ''}
                    </span>
                    <b>Course:</b>
                    <span>{h.course}</span>
                  </p>
                  {h.instruction ? (
                    <p>
                      <b>Instructions:</b>
                      <span>{h.instruction}</span>
                    </p>
                  ) : null}
                  <p>
                    <b>Time Allowed:</b>
                    <span>{h.time}</span>
                    <b>{h.totalLabel}:</b>
                    <span>{h.totalMarks}</span>
                  </p>
                </div>
              ) : (
                <>
                  <div className="pp-details">
                    <span>
                      {h.paperTitle}
                      {scheme ? ' Marking Scheme' : ''}
                    </span>
                    <span>Course: {h.course}</span>
                    <span>{h.instruction ?? ''}</span>
                    <span />
                    <span>Time: {h.time}</span>
                    <span>
                      {h.totalLabel}: {h.totalMarks}
                    </span>
                  </div>
                  <div className="pp-rule" aria-hidden="true">
                    {'= '.repeat(30)}
                  </div>
                  {h.subject ? <p className="pp-head">{h.subject}</p> : null}
                </>
              )}
              {data.sections.map((s) => (
                <section key={s.letter ?? 'all'}>
                  {s.letter ? (
                    <p className="pp-head">
                      SECTION {s.letter}
                      {s.title ? ` - ${s.title}` : ''}
                    </p>
                  ) : null}
                  {s.letter && s.instructions ? <p className="pp-section-note">{s.instructions}</p> : null}
                  {s.items.map((item) => (
                    <Question key={item.number} item={item} scheme={scheme} />
                  ))}
                </section>
              ))}
              <p className="pp-class bottom">{h.classification}</p>
              <div className="pp-foot">
                <span>
                  Version {data.versionNumber} · {data.signature}
                </span>
                <span>{scheme ? 'For instructors only' : ''}</span>
              </div>
            </article>
          </div>
        </ShowAllocation.Provider>
      ) : null}
    </>
  );
}
