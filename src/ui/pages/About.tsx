import { MASTERY, SCHEDULER } from '../../engine/config';
import { Link } from '../router';

export function AboutPage() {
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <h1>About this app</h1>
      <div className="card stack">
        <h2>What it is</h2>
        <p>
          A practice engine for the vocabulary, spelling and word endings tested in the Duolingo English Test (DET) reading tasks. Every imported word comes from your
          own study materials (see the <Link to="/report">import report</Link>).
        </p>
        <p>
          <strong>These are practice questions, not official DET questions.</strong> Sentences and paragraphs were written for this app using the vocabulary and task
          patterns in your materials. No word or question is guaranteed to appear on the live test. Priorities use the evidence in your materials — for example, the
          guide’s count that about 42% of 1,368 sampled Read and Complete gaps were small grammar words — as a guide to what to practice first, not as a prediction.
        </p>
      </div>
      <div className="card stack">
        <h2>How mastery works</h2>
        <ul>
          <li>
            A word is mastered after {MASTERY.requiredDistinctContexts} correct answers in {MASTERY.requiredDistinctContexts} different sentences, with no mistake in
            between. The same sentence twice does not count.
          </li>
          <li>Skipping or viewing a word never counts. A wrong, empty or timed-out answer resets the run (your history is kept).</li>
          <li>
            After a mistake the word returns after about {SCHEDULER.mistakeGaps[0].join('–')} other questions; after a 2nd mistake in a row, {SCHEDULER.mistakeGaps[1].join('–')}; after
            a 3rd, {SCHEDULER.mistakeGaps[2][0]}. It comes back in a different sentence.
          </li>
          <li>Mastered words get retention checks after {SCHEDULER.retentionDays.join(', ')} days. Missing one sends the word back to active practice.</li>
        </ul>
      </div>
      <div className="card stack">
        <h2>Where your progress is stored</h2>
        <p>
          In this browser’s IndexedDB database, on this device only. There are no accounts and nothing is sent to a server. Progress survives refreshes and browser
          restarts, but clearing site data, using a private window, or switching device or browser starts fresh. Use <Link to="/settings">Settings → Download backup</Link>{' '}
          to keep a copy or move it to another device.
        </p>
      </div>
    </div>
  );
}
