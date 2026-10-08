let ctx: AudioContext | undefined;

/** Short, quiet tones for correct / incorrect answers (only when sound effects are on). */
export function playTone(kind: 'good' | 'bad'): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    const t = ctx.currentTime;
    if (kind === 'good') {
      o.frequency.setValueAtTime(660, t);
      o.frequency.setValueAtTime(880, t + 0.08);
    } else {
      o.frequency.setValueAtTime(260, t);
      o.frequency.setValueAtTime(200, t + 0.1);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.26);
  } catch {
    // Sound is optional; ignore audio errors.
  }
}
