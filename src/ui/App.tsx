import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { AppProvider, useApp, useSettings } from './app-context';
import { Toasts } from './components';
import { Link, useRoute } from './router';
import { AboutPage } from './pages/About';
import { ActiveListPage } from './pages/ActiveList';
import { CompletedPage } from './pages/Completed';
import { DashboardPage } from './pages/Dashboard';
import { LibraryPage } from './pages/Library';
import { MistakesPage } from './pages/Mistakes';
import { ReportPage } from './pages/Report';
import { SessionPage } from './pages/Session';
import { SettingsPage } from './pages/Settings';
import { StartPracticePage } from './pages/StartPractice';
import { StatsPage } from './pages/Stats';
import { WordDetailPage } from './pages/WordDetail';

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

const NAV = [
  { to: '/', label: 'Dashboard', icon: '◧' },
  { to: '/practice', label: 'Start Practice', icon: '▶' },
  { to: '/active', label: 'Active Practice List', icon: '☰' },
  { to: '/completed', label: 'Completed Checklist', icon: '✓' },
  { to: '/mistakes', label: 'Mistake Bank', icon: '✕' },
  { to: '/library', label: 'Vocabulary Library', icon: '⌕' },
  { to: '/stats', label: 'Statistics', icon: '▥' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

function Shell() {
  const path = useRoute();
  const settings = useSettings();
  const { db, store } = useApp();
  const [open, setOpen] = useState(false);
  const mastered = useLiveQuery(() => db.progress.where('status').equals('mastered').count(), [db]) ?? 0;
  const mistakeWords = useLiveQuery(async () => new Set((await db.mistakes.toArray()).map((m) => m.wordId)).size, [db]) ?? 0;

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);

  if (path.startsWith('/practice/session')) {
    return (
      <>
        <SessionPage />
        <Toasts />
      </>
    );
  }

  const counts: Record<string, number> = { '/active': store.words.length - mastered, '/completed': mastered, '/mistakes': mistakeWords };
  const isActive = (to: string) => (to === '/' ? path === '/' : path === to || path.startsWith(to + '/'));
  return (
    <div className="shell">
      <header className="topbar">
        <button className="btn small" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open}>
          ☰ Menu
        </button>
        <strong>DET Vocab Trainer</strong>
      </header>
      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden />}
      <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Main navigation">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden>
            ab_
          </span>
          <span>
            DET Vocab Trainer
            <small>Reading · spelling · endings</small>
          </span>
        </Link>
        <nav className="nav">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} aria-current={isActive(n.to) ? 'page' : undefined}>
              <span aria-hidden style={{ width: 18, textAlign: 'center' }}>
                {n.icon}
              </span>
              {n.label}
              {counts[n.to] !== undefined && <span className="count">{counts[n.to]}</span>}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <Link to="/report">Import report</Link> · <Link to="/about">About</Link>
          <p style={{ marginTop: 8 }}>Practice questions built from your study materials. Not official DET questions.</p>
        </div>
      </aside>
      <main className="main" id="main">
        <Route path={path} />
      </main>
      <Toasts />
    </div>
  );
}

function Route({ path }: { path: string }) {
  if (path === '/') return <DashboardPage />;
  if (path === '/practice') return <StartPracticePage />;
  if (path === '/active') return <ActiveListPage />;
  if (path === '/completed') return <CompletedPage />;
  if (path === '/mistakes') return <MistakesPage />;
  if (path === '/library') return <LibraryPage />;
  if (path.startsWith('/library/')) return <WordDetailPage id={decodeURIComponent(path.slice('/library/'.length))} />;
  if (path === '/stats') return <StatsPage />;
  if (path === '/settings') return <SettingsPage />;
  if (path === '/report') return <ReportPage />;
  if (path === '/about') return <AboutPage />;
  return (
    <div className="card">
      <h1>Page not found</h1>
      <p>
        <Link to="/">Go to the dashboard</Link>
      </p>
    </div>
  );
}
