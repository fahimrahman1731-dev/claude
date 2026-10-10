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
    ['Entries with missing definitions', t.missingDefinitions],
    ['Entries needing a practice sentence', t.needingSentences, 'Words without a valid sentence cannot be practiced yet.'],
    ['Practice-ready words', t.practiceReady, 'Each has one validated practice sentence.'],
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
            ? `All sources were read. ${t.needingSentences} words still need a sentence and ${t.missingDefinitions} need definitions.`
            : `All ${report.sources.length} sources were read and every imported word has a definition and one validated practice sentence.`}
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
      {report.collected && <CollectedSection c={report.collected} />}
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
            {report.needingSentences.length > 0 && <p>Needing a sentence: {report.needingSentences.join(', ')}</p>}
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

const CORPUS_NAME: Record<string, string> = { clear: 'CommonLit CLEAR corpus', ose: 'OneStopEnglish corpus', ostx: 'OpenStax textbooks', authored: 'written for this app' };

function CollectedSection({ c }: { c: NonNullable<ReturnType<typeof useApp>['report']>['collected'] & object }) {
  const o = c.contextOrigins;
  const total = o.collected + o.dictionary + o.authored;
  const d = c.definitionOrigins;
  const b = c.bengaliOrigins;
  return (
    <div className="card stack">
      <h2>Real collected material</h2>
      <p className="small" style={{ margin: 0 }}>
        Sentences, Read and Complete texts and Interactive Reading passages come from real, openly licensed texts. Nothing is copied from live DET tests (their
        questions are confidential and change constantly).
      </p>
      <div className="table-wrap">
        <table>
          <tbody>
            <tr>
              <td>Practice sentences: real (collected) / WordNet examples / written for the app</td>
              <td className="num" style={{ fontWeight: 700 }}>
                {o.collected.toLocaleString()} / {o.dictionary.toLocaleString()} / {o.authored.toLocaleString()}
              </td>
            </tr>
            <tr>
              <td>Share of sentences that are real</td>
              <td className="num" style={{ fontWeight: 700 }}>
                {total ? Math.round(((o.collected + o.dictionary) / total) * 100) : 0}%
              </td>
            </tr>
            <tr>
              <td>Words added from trusted word lists (NGSL, NAWL, CEFR-J, Octanove C1)</td>
              <td className="num" style={{ fontWeight: 700 }}>
                {c.added.count.toLocaleString()}
              </td>
            </tr>
            <tr>
              <td>Words deleted as unrealistic DET words</td>
              <td className="num" style={{ fontWeight: 700 }}>
                {c.deleted.length}
              </td>
            </tr>
            <tr>
              <td>Read and Complete texts</td>
              <td className="num" style={{ fontWeight: 700 }}>
                {Object.entries(c.paragraphsByCorpus)
                  .map(([k, v]) => `${v} ${CORPUS_NAME[k] ?? k}`)
                  .join(' · ')}
              </td>
            </tr>
            <tr>
              <td>Interactive Reading sets</td>
              <td className="num" style={{ fontWeight: 700 }}>
                {c.interactiveSets}
              </td>
            </tr>
            <tr>
              <td>Definitions: study materials / WordNet / written for the app</td>
              <td className="num" style={{ fontWeight: 700 }}>
                {d.source ?? 0} / {d.dictionary ?? 0} / {d.app ?? 0}
              </td>
            </tr>
            <tr>
              <td>Bengali: written for the app / Apertium dictionary / none yet</td>
              <td className="num" style={{ fontWeight: 700 }}>
                {b.app ?? 0} / {b.dictionary ?? 0} / {b.none ?? 0}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <details>
        <summary>
          <strong>Deleted words and why ({c.deleted.length})</strong>
        </summary>
        <ul className="small">
          {c.deleted.map((x) => (
            <li key={x.word}>
              <strong>{x.word}</strong>: {x.reason}
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary>
          <strong>Licences of the texts used ({c.texts} texts)</strong>
        </summary>
        <ul className="small">
          {Object.entries(c.licences).map(([k, v]) => (
            <li key={k}>
              {k}: {v}
            </li>
          ))}
        </ul>
        <p className="tiny muted">Every sentence and passage shows its own source and licence in the app. See About for the full credits.</p>
      </details>
      {c.interactiveIssues.length > 0 && (
        <div className="alert warn small">
          {c.interactiveIssues.length} Interactive Reading set(s) failed validation and were left out:
          <ul>
            {c.interactiveIssues.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
