import { useRef, useState } from 'react';
import { MODE_INFO, MODE_TIMERS, type Settings } from '../../engine/config';
import type { Mode } from '../../engine/types';
import { exportBackup, resetAll, restoreBackup } from '../../services/backup';
import { useApp, useSettings } from '../app-context';
import { Segmented } from '../components';
import { download } from '../format';
import { Link } from '../router';

function Num({ label, hint, value, min, max, onChange }: { label: string; hint?: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <label className="field">
      {label}
      <input type="number" min={min} max={max} value={value} onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))} />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function SettingsPage() {
  const { service, db, notify, persisted, reloadStore } = useApp();
  const s = useSettings();
  const fileRef = useRef<HTMLInputElement>(null);
  const [aiUrl, setAiUrl] = useState(s.aiEndpoint);
  const set = (patch: Partial<Settings>) =>
    service.saveSettings(patch).catch((e) => notify(`Settings could not be saved: ${e instanceof Error ? e.message : String(e)}`, 'error'));

  const backup = async () => {
    try {
      const b = await exportBackup(db);
      download(`det-vocab-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(b), 'application/json');
    } catch (e) {
      notify(`Backup failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  };
  const restore = async (f: File) => {
    if (!window.confirm('Restoring replaces ALL current progress with the backup. Continue?')) return;
    try {
      const data = JSON.parse(await f.text());
      const r = await restoreBackup(db, data);
      await reloadStore();
      notify(`Backup restored (${r.counts.progress ?? 0} words, ${r.counts.attempts ?? 0} answers).`, 'success');
    } catch (e) {
      notify(`Restore failed, nothing was changed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  };
  const reset = async () => {
    if (!window.confirm('Delete ALL progress, mistakes, sessions, settings and your own words? This cannot be undone. Make a backup first if unsure.')) return;
    try {
      await resetAll(db);
      await reloadStore();
      notify('All progress was reset.', 'success');
    } catch (e) {
      notify(`Reset failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">Changes save immediately. The defaults suit a student who finds DET reading and spelling hard.</p>
        </div>
        <button
          className="btn"
          onClick={() => {
            if (window.confirm('Restore the default settings? Your progress is not affected.')) void db.kv.delete('settings');
          }}
        >
          Restore defaults
        </button>
      </div>

      <div className="card stack">
        <h2>Difficulty</h2>
        <label className="check">
          <input type="checkbox" checked={s.adaptive} onChange={(e) => set({ adaptive: e.target.checked })} />
          <span>
            <strong>Adaptive difficulty</strong>
            <br />
            <span className="small muted">Moves up after about 85% correct over 8 answers, down at 50% or less. Practice My Mistakes always serves every missed word.</span>
          </span>
        </label>
        <div className="stack" style={{ gap: 6 }}>
          <span className="small" style={{ fontWeight: 600 }}>
            {s.adaptive ? 'Starting level (resets the adaptive level)' : 'Fixed level'}
          </span>
          <Segmented
            label="Difficulty level"
            value={s.difficulty}
            onChange={(v) => set({ difficulty: v })}
            options={[
              { value: 'easy', label: 'Easy' },
              { value: 'intermediate', label: 'Intermediate' },
              { value: 'advanced', label: 'Advanced' },
            ]}
          />
        </div>
      </div>

      <div className="card stack">
        <h2>Timer</h2>
        <Segmented
          label="Timer mode"
          value={s.timerMode}
          onChange={(v) => set({ timerMode: v })}
          options={[
            { value: 'timed', label: 'Timed (presets)' },
            { value: 'untimed', label: 'Untimed' },
            { value: 'custom', label: 'Custom timer' },
          ]}
        />
        <p className="small muted" style={{ margin: 0 }}>
          Timed presets: Fill in the Blanks and spelling 20 s (30 s for advanced words), small words 10 s, Read and Complete 3 min per text, Interactive Reading 8 min per
          passage with its 6 questions.
        </p>
        {s.timerMode === 'timed' && (
          <label className="check">
            <input type="checkbox" checked={s.longerTimerForAdvanced} onChange={(e) => set({ longerTimerForAdvanced: e.target.checked })} />
            Give advanced words the 30-second “difficult vocabulary” timer
          </label>
        )}
        {s.timerMode === 'custom' && (
          <div className="grid grid-3">
            {(Object.keys(MODE_INFO) as Mode[]).map((m) => (
              <Num
                key={m}
                label={`${MODE_INFO[m].title} (seconds)`}
                hint={`Preset: ${MODE_TIMERS[m]} s`}
                value={s.customTimers[m]}
                min={3}
                max={1800}
                onChange={(n) => set({ customTimers: { ...s.customTimers, [m]: n } })}
              />
            ))}
          </div>
        )}
      </div>

      <div className="card stack">
        <h2>Letters given as the clue</h2>
        <Segmented
          label="Letters given"
          value={s.clueRule}
          onChange={(v) => set({ clueRule: v })}
          options={[
            { value: 'max3', label: '1 to 3 letters' },
            { value: 'half', label: 'Half the word (DET Read and Complete rule)' },
          ]}
        />
        <p className="small muted" style={{ margin: 0 }}>
          1 to 3 letters (default): short words show 1 or 2 letters and long words at most 3, e.g. <code>con_____</code> for “confusing”. Half the word: the official Read and
          Complete rule, e.g. <code>conf_____</code>. Word Endings always shows the stem, because the ending is what it practises.
        </p>
      </div>

      <div className="card stack">
        <h2>Sessions</h2>
        <div className="grid grid-3">
          <Num label="Questions per session" value={s.questionsPerSession} min={1} max={200} onChange={(n) => set({ questionsPerSession: n })} />
          <Num label="Texts per Read and Complete session" value={s.paragraphsPerSession} min={1} max={50} onChange={(n) => set({ paragraphsPerSession: n })} />
          <Num label="Passages per Interactive Reading session" value={s.interactivePerSession} min={1} max={20} onChange={(n) => set({ interactivePerSession: n })} />
          <Num label="Daily goal (questions)" value={s.dailyGoal} min={1} max={1000} onChange={(n) => set({ dailyGoal: n })} />
        </div>
        <div className="alert small">
          <strong>How words are learned.</strong> Each word has one sentence. One correct answer masters it. A missed word waits in your{' '}
          <Link to="/mistakes">Mistake Bank</Link> and never comes back by itself: fix it in Practice My Mistakes. There are no scheduled reviews, so there is nothing to set here.
        </div>
        <label className="check">
          <input type="checkbox" checked={s.showSkip} onChange={(e) => set({ showSkip: e.target.checked })} />
          Show the Skip button (a skip is not counted: the word stays new and can come back in a later session)
        </label>
      </div>

      <div className="card stack">
        <h2>Language, sound and theme</h2>
        <Segmented
          label="Language"
          value={s.language}
          onChange={(v) => set({ language: v })}
          options={[
            { value: 'en', label: 'English only' },
            { value: 'en-bn', label: 'English + বাংলা support' },
          ]}
        />
        {s.language === 'en-bn' && (
          <label className="check">
            <input type="checkbox" checked={s.bengaliBeforeAnswer} onChange={(e) => set({ bengaliBeforeAnswer: e.target.checked })} />
            <span>
              Show the Bengali meaning before I answer
              <br />
              <span className="small muted">Off = exam-like: Bengali appears only in the feedback after you answer.</span>
            </span>
          </label>
        )}
        <p className="tiny muted" style={{ margin: 0 }}>
          Your study materials contain no Bengali. The Bengali meanings were written for this app and are labeled that way; please report any you find wrong.
        </p>
        <label className="check">
          <input type="checkbox" checked={s.sound} onChange={(e) => set({ sound: e.target.checked })} />
          Sound effects for correct and wrong answers
        </label>
        <Segmented
          label="Theme"
          value={s.theme}
          onChange={(v) => set({ theme: v })}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </div>

      <div className="card stack">
        <h2>AI sentence generation (optional)</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Every word already has a validated sentence, so this is not needed. If you run the included server (<code>npm run ai-proxy</code>, which keeps the API key on
          the server), paste its URL here to generate a sentence for one of your own words that has none. Generated sentences are validated before they are saved.
        </p>
        <div className="row">
          <input type="text" value={aiUrl} onChange={(e) => setAiUrl(e.target.value)} placeholder="http://localhost:8787/api/contexts" style={{ flex: '1 1 300px' }} aria-label="AI server URL" />
          <button className="btn" onClick={() => void set({ aiEndpoint: aiUrl.trim() })}>
            Save URL
          </button>
        </div>
      </div>

      <div className="card stack">
        <h2>Your data</h2>
        <p className="small" style={{ margin: 0 }}>
          Progress is saved in this browser’s database (IndexedDB) on this device. It survives refreshes and restarts, but it does not sync to other devices, and
          clearing site data deletes it. Download a backup now and then.
          {persisted === true && ' This browser has granted persistent storage.'}
          {persisted === false && ' This browser has not granted persistent storage, so it may clear data when space is low — keep backups.'}
        </p>
        <div className="row">
          <button className="btn" onClick={() => void backup()}>
            ⇩ Download backup
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            ⇧ Restore from backup
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && void restore(e.target.files[0])} />
          <Link to="/report" className="btn ghost">
            Import report
          </Link>
          <button className="btn danger" onClick={() => void reset()}>
            Reset all progress
          </button>
        </div>
      </div>
    </div>
  );
}
