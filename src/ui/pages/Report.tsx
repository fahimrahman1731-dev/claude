import { useLiveQuery } from 'dexie-react-hooks';
import type { ImportReport } from '../../services/words';
import { useApp } from '../app-context';
import { dateTime } from '../format';
import { ImportReportView } from './Library';

export function ReportPage() {
  const { report, reportError, store, db } = useApp();
  const runtime = useLiveQuery(() => db.imports.orderBy('at').reverse().toArray(), [db]);
  if (!report) {
    return (
      <div className="stack">
        <h1>Import report</h1>
        <div className="alert error" role="alert">
          {reportError ?? 'The import report is not available.'} The vocabulary itself loaded ({store.importedCount} words), but the app cannot confirm that every
          source was imported.
        </div>
      </div>
    );
  }
  const t = report.totals;
  const rows: [string, number, string?][] = [
    ['Source entries detected (counting repeats across lists)', t.sourceEntriesDetected],
    ['Entries accepted', t.sourceEntriesAccepted],
    ['Entries rejected', t.rejectedEntries, 'Each one is listed below with its reason.'],
    ['Unique spelling targets imported', t.uniqueSpellingTargets],
    ['Duplicate entries merged', t.duplicatesMerged, 'Same spelling listed in more than one place. Different forms (develop, developed) stay separate.'],
    ['Definitions from your study materials', t.definitionsFromSources],
    ['Definitions written for the app', t.definitionsWrittenForApp, 'Your materials give meanings for only some words.'],
    ['Entries with missing definitions', t.missingDefinitions],
    ['Bengali meanings (written for the app)', t.bengaliGlosses, 'Your materials contain no Bengali.'],
    ['Entries needing example sentences', t.needingSentences, 'Words with fewer than two valid, different sentences cannot be mastered yet.'],
    ['Practice-ready words', t.practiceReady],
    ['Sentence contexts', t.sentenceContexts],
    ['Read and Complete paragraphs / gaps', t.paragraphs, `${t.paragraphGaps} gaps`],
    ['Total practice contexts', t.totalPracticeContexts],
    ['Failed sources / sections', t.failedSources + t.failedSections],
  ];
  const problems = t.failedSources + t.failedSections > 0;
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Import and validation report</h1>
          <p className="muted">
            Data version {report.version}, built {dateTime(Date.parse(report.generatedAt))}. This report is produced by the import script; nothing is claimed that was not
            processed.
          </p>
        </div>
      </div>
      <div className={`alert ${problems ? 'error' : t.needingSentences || t.missingDefinitions ? 'warn' : 'success'}`}>
        {problems
          ? `Some sources or sections failed to import. Words from them are missing.`
          : t.needingSentences || t.missingDefinitions
            ? `All sources were read. ${t.needingSentences} words still need sentences and ${t.missingDefinitions} need definitions.`
            : `All ${report.sources.length} sources were read and every imported word has a definition and at least two validated sentences.`}
      </div>
      <div className="table-wrap">
        <table>
          <tbody>
            {rows.map(([k, v, note]) => (
              <tr key={k}>
                <td>
                  {k}
                  {note && <div className="tiny muted">{note}</div>}
                </td>
                <td className="num" style={{ fontWeight: 700 }}>
                  {v.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        Priority from the materials: high {report.byPriority.high}, medium {report.byPriority.medium}, lower {report.byPriority.low}. Difficulty: easy {report.byDifficulty.easy}, intermediate{' '}
        {report.byDifficulty.intermediate}, advanced {report.byDifficulty.advanced}. Small grammar words: {report.smallWords}.
      </p>
      {report.sources.map((s) => (
        <div key={s.id} className="card">
          <div className="card-head">
            <h2>{s.title}</h2>
            <span className={`badge ${s.status === 'ok' ? 'mastered' : 'advanced'}`}>{s.status === 'ok' ? 'Imported' : s.status === 'partial' ? 'Partly imported' : 'Failed'}</span>
          </div>
          {s.error && <div className="alert error small">{s.error}</div>}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Section</th>
                  <th>Status</th>
                  <th className="num">Accepted</th>
                  <th className="num">Rejected</th>
                </tr>
              </thead>
              <tbody>
                {s.sections.map((sec) => (
                  <tr key={sec.id}>
                    <td className="small">{sec.label}</td>
                    <td className="small">
                      {sec.status === 'ok' ? '✓ read' : `✕ failed${sec.error ? `: ${sec.error}` : ''}`}
                    </td>
                    <td className="num">{sec.accepted}</td>
                    <td className="num">{sec.rejected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {s.notes.map((n) => (
            <p key={n} className="small" style={{ marginTop: 8 }}>
              ⚠ {n}
            </p>
          ))}
        </div>
      ))}
      <details className="card">
        <summary>
          <strong>Rejected entries ({report.rejected.length})</strong>
        </summary>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table>
            <thead>
              <tr>
                <th>Entry</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {report.rejected.map((r, i) => (
                <tr key={i}>
                  <td className="small">{r.raw}</td>
                  <td className="small">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {(report.missingDefinitions.length > 0 || report.needingSentences.length > 0 || report.invalidSentences.length > 0) && (
        <details className="card">
          <summary>
            <strong>Incomplete entries</strong>
          </summary>
          <div className="stack small" style={{ marginTop: 10 }}>
            {report.missingDefinitions.length > 0 && <p>Missing definitions: {report.missingDefinitions.join(', ')}</p>}
            {report.needingSentences.length > 0 && <p>Needing sentences: {report.needingSentences.join(', ')}</p>}
            {report.invalidSentences.length > 0 && (
              <ul>
                {report.invalidSentences.map((x, i) => (
                  <li key={i}>
                    <strong>{x.word}</strong>: {x.problem}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      )}
      <div className="card">
        <h2>Your own imports</h2>
        {!runtime?.length ? (
          <p className="muted small">You have not imported any word lists in the app.</p>
        ) : (
          <div className="stack">
            {runtime.map((r) => (
              <div key={r.id}>
                <div className="tiny muted">{dateTime(r.at)}</div>
                <ImportReportView r={r.report as ImportReport} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
