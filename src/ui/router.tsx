import { useEffect, useState, type AnchorHTMLAttributes, type ReactNode } from 'react';

/** Hash routing (#/library/w:word) works on any static host, including GitHub Pages sub-paths. */
export function currentPath(): string {
  const h = window.location.hash.replace(/^#/, '');
  return h.startsWith('/') ? h : '/';
}

export function useRoute(): string {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const on = () => setPath(currentPath());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return path;
}

export function navigate(path: string): void {
  if (currentPath() !== path) window.location.hash = path;
}

export function Link({ to, children, ...rest }: { to: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={`#${to}`} {...rest}>
      {children}
    </a>
  );
}

export function wordPath(wordId: string): string {
  return `/library/${encodeURIComponent(wordId)}`;
}
