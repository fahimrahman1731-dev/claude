import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

/** Kept in the hidden field so that Backspace on a phone keyboard always produces an input event. */
const SENTINEL = '​';

/**
 * DET-style word input: the given letters sit in the first boxes and every
 * missing letter has its own box.
 *
 * Keys, as on the DET: a letter fills the active box and moves to the next one
 * (after the last box, to the next word); Backspace clears and moves back one box
 * (from the first box, back to the previous word); ← → move between boxes and
 * words; clicking a box makes it active; Enter submits.
 *
 * One real, transparent text field sits on top of the boxes, so phone keyboards,
 * paste and screen readers work. It always holds a single invisible character;
 * every edit is read from it and applied to the boxes.
 *
 * `value` holds one character per box, with a space for an empty box.
 */
export function LetterBoxes({
  given,
  length,
  value,
  onChange,
  onFilled,
  onBackspaceEmpty,
  onEnter,
  inputRef,
  autoFocus,
  disabled,
  label,
}: {
  given: string;
  /** Number of missing letters (one box each). */
  length: number;
  value: string;
  onChange: (v: string) => void;
  /** Moving past the last box (used to go to the next word). */
  onFilled?: () => void;
  /** Moving back before the first box (used to go to the previous word). */
  onBackspaceEmpty?: () => void;
  onEnter?: () => void;
  inputRef?: (el: HTMLInputElement | null) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  label: string;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);
  const cells = Array.from({ length }, (_, i) => (value[i] && value[i] !== ' ' ? value[i] : ''));
  const firstEmpty = cells.findIndex((c) => !c);
  const [caret, setCaret] = useState(firstEmpty < 0 ? length - 1 : firstEmpty);
  useEffect(() => {
    if (autoFocus && !disabled) ref.current?.focus();
  }, [autoFocus, disabled]);

  const commit = (next: string[]) => onChange(next.map((c) => c || ' ').join('').replace(/ +$/, ''));
  const typeLetters = (letters: string) => {
    const next = [...cells];
    let i = caret;
    for (const ch of letters.toLowerCase()) {
      if (i >= length) break;
      next[i] = ch;
      i++;
    }
    commit(next);
    if (i >= length) {
      setCaret(length - 1);
      onFilled?.();
    } else setCaret(i);
  };
  const backspace = () => {
    const next = [...cells];
    if (next[caret] && (caret === length - 1 || !next[caret + 1])) {
      // Last typed letter under the cursor (e.g. after filling the final box): clear it in place.
      next[caret] = '';
      commit(next);
      return;
    }
    if (caret === 0) {
      if (next[0]) {
        next[0] = '';
        commit(next);
      } else onBackspaceEmpty?.();
      return;
    }
    next[caret - 1] = '';
    commit(next);
    setCaret(caret - 1);
  };
  const keyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        onEnter?.();
        return;
      case 'Backspace':
        e.preventDefault();
        backspace();
        return;
      case 'Delete': {
        e.preventDefault();
        const next = [...cells];
        next[caret] = '';
        commit(next);
        return;
      }
      case 'ArrowLeft':
        e.preventDefault();
        if (caret > 0) setCaret(caret - 1);
        else onBackspaceEmpty?.();
        return;
      case 'ArrowRight':
        e.preventDefault();
        if (caret < length - 1) setCaret(caret + 1);
        else onFilled?.();
        return;
      case 'Home':
        e.preventDefault();
        setCaret(0);
        return;
      case 'End':
        e.preventDefault();
        setCaret(Math.max(0, Math.min(length - 1, firstEmpty < 0 ? length - 1 : firstEmpty)));
        return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (/[A-Za-z]/.test(e.key)) typeLetters(e.key);
    }
  };
  // Phone keyboards (and paste) do not send usable key events, so read the field instead.
  const onInput = (raw: string) => {
    if (raw === SENTINEL) return;
    if (!raw.includes(SENTINEL) && raw.length === 0) backspace();
    else {
      const letters = raw.replace(new RegExp(SENTINEL, 'g'), '').replace(/[^A-Za-z]/g, '');
      if (letters) typeLetters(letters);
    }
  };
  const active = Math.max(0, Math.min(caret, length - 1));
  return (
    <span className={`lb${focused ? ' focused' : ''}${disabled ? ' disabled' : ''}`}>
      {[...given].map((ch, i) => (
        <span key={`g${i}`} className="lb-cell given" aria-hidden>
          {ch}
        </span>
      ))}
      {cells.map((ch, i) => (
        <span
          key={`h${i}`}
          className={`lb-cell${focused && i === active ? ' active' : ''}${ch ? ' typed' : ''}`}
          aria-hidden
          onMouseDown={(e) => {
            e.preventDefault();
            if (disabled) return;
            setCaret(i);
            ref.current?.focus();
          }}
        >
          {ch}
        </span>
      ))}
      <input
        ref={(el) => {
          ref.current = el;
          inputRef?.(el);
        }}
        className="lb-input"
        type="text"
        inputMode="text"
        value={SENTINEL}
        onChange={(e) => onInput(e.target.value)}
        onKeyDown={keyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="next"
        aria-label={`${label}. Typed so far: ${cells.map((c) => c || 'blank').join(' ')}`}
        disabled={disabled}
      />
    </span>
  );
}
