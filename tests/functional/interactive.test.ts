import { describe, expect, it } from 'vitest';
import { applyResult, newProgress } from '../../src/engine/progress';
import { PracticeService } from '../../src/services/practice';
import type { InteractiveAnswers, InteractiveQuestion } from '../../src/engine/types';
import { makeEnv } from './env';

function perfect(q: InteractiveQuestion, highlights: { start: number; end: number }[]): InteractiveAnswers {
  return { step: 5, blanks: q.blanks.map((b) => b.answer), missing: q.missing.answer, highlights, idea: q.idea.answer, title: q.titles.answer };
}

describe('Interactive Reading in a practice session', () => {
  it('serves a passage with one shared DET timer, saves each part, and scores all six questions', async () => {
    const env = makeEnv();
    const { service, store, db } = env;
    let s = await service.startSession({ mode: 'interactive-reading' });
    expect(s.current?.question.kind).toBe('interactive');
    const q = s.current!.question as InteractiveQuestion;
    const set = store.interactive.find((x) => x.id === q.setId)!;
    // Timed mode: 7 or 8 minutes for the whole passage.
    expect([420_000, 480_000]).toContain(s.current!.limitMs);
    expect(s.current!.interactive?.step).toBe(0);

    // The student answers part 1 and moves on; a refresh (new service on the same database) resumes at part 2.
    const step1: InteractiveAnswers = { ...s.current!.interactive!, step: 1, blanks: q.blanks.map((b) => b.answer) };
    await service.saveInteractiveStep(s.id, q.id, step1);
    const again = new PracticeService({ db, store, now: () => env.clock.t });
    const resumed = await again.activeSession();
    expect(resumed?.current?.interactive?.step).toBe(1);
    expect(resumed?.current?.interactive?.blanks).toEqual(step1.blanks);

    env.clock.t += 300_000;
    const r = await service.submit(s.id, { questionId: q.id, answers: [], kind: 'submit', interactive: perfect(q, set.highlights.map((h) => ({ start: h.start, end: h.end }))) });
    s = r.session;
    expect(r.outcome.parts?.map((p) => p.part)).toEqual(['complete-passage', 'highlight', 'highlight', 'main-idea', 'title']);
    expect(r.outcome.parts?.every((p) => p.correct && p.score === 1)).toBe(true);
    expect(r.outcome.gaps.every((g) => g.result === 'correct')).toBe(true);
    // One row per missing word (including words that are not in the word list) and one per other question.
    const rows = await db.irResults.where('sessionId').equals(s.id).toArray();
    expect(rows).toHaveLength(q.blanks.length + 5);
    expect(rows.filter((x) => x.part === 'complete-sentences')).toHaveLength(q.blanks.length);

    // Choosing the right word from options never masters a word: a new word stays new.
    for (const g of r.outcome.gaps.filter((x) => x.wordId)) {
      const p = await db.progress.get(g.wordId);
      expect(p?.status).toBe('new');
      expect(p?.correct).toBeGreaterThan(0);
      expect(g.becameMastered).toBe(false);
      expect(g.schedule).toMatch(/does not master/);
    }
    // A repeated submit is ignored.
    const dup = await service.submit(s.id, { questionId: q.id, answers: [], kind: 'submit', interactive: perfect(q, []) });
    expect(dup.duplicate).toBe(true);
  });

  it('records wrong and unanswered parts, sends missed words to the Mistake Bank, and handles a time-out', async () => {
    const env = makeEnv();
    const { service, db } = env;
    const s = await service.startSession({ mode: 'interactive-reading' });
    const q = s.current!.question as InteractiveQuestion;
    const wrongFirst = (q.blanks[0].answer + 1) % q.blanks[0].options.length;
    const answers: InteractiveAnswers = { step: 2, blanks: q.blanks.map((_, i) => (i === 0 ? wrongFirst : null)), missing: (q.missing.answer + 1) % q.missing.options.length, highlights: [null, null], idea: null, title: null };
    env.clock.t += 480_000;
    const r = await service.submit(s.id, { questionId: q.id, answers: [], kind: 'timeout', interactive: answers });
    expect(r.outcome.timedOut).toBe(true);
    expect(r.outcome.gaps[0].result).toBe('incorrect');
    expect(r.outcome.gaps.slice(1).every((g) => g.result === 'timeout')).toBe(true);
    expect(r.outcome.parts?.find((p) => p.part === 'complete-passage')?.correct).toBe(false);
    expect(r.outcome.parts?.filter((p) => p.part === 'highlight').every((p) => p.score === 0)).toBe(true);
    expect(r.session.tally.correct).toBe(0);
    const missedWord = r.outcome.gaps[0].wordId;
    if (missedWord) {
      const m = await db.mistakes.where('wordId').equals(missedWord).toArray();
      expect(m[0]?.mode).toBe('interactive-reading');
      // The Mistake Bank knows exactly which occurrence was missed.
      const at = m[0].answerStart!;
      expect(m[0].sentence.slice(at, at + r.outcome.gaps[0].correctAnswer.length)).toBe(r.outcome.gaps[0].correctAnswer);
    }
    // Every missed or timed-out library word is in the Mistake Bank, with nothing scheduled.
    for (const g of r.outcome.gaps.filter((x) => x.wordId)) {
      const p = (await db.progress.get(g.wordId))!;
      expect(p.status).toBe('learning');
      expect(p.dueSeq).toBeUndefined();
      expect(p.nextReviewAt).toBeUndefined();
      expect(g.schedule).toMatch(/Mistake Bank/);
    }
  });

  it('a wrong choice on a mastered word takes it out of the Completed Checklist and into the Mistake Bank', async () => {
    const env = makeEnv();
    const { service, store, db } = env;
    // Find a passage whose first blank is a library word.
    let s = await service.startSession({ mode: 'interactive-reading' });
    let q = s.current!.question as InteractiveQuestion;
    for (let i = 0; i < 40 && !store.interactive.find((x) => x.id === q.setId)!.blanks[0].wordId; i++) {
      s = await service.startSession({ mode: 'interactive-reading' });
      q = s.current!.question as InteractiveQuestion;
    }
    const wordId = store.interactive.find((x) => x.id === q.setId)!.blanks[0].wordId!;
    expect(wordId).toBeTruthy();
    // The student had mastered it by typing it correctly.
    const typed = applyResult(newProgress(wordId), { result: 'correct', contextId: store.byId.get(wordId)!.contexts[0].id, responseMs: 1000, at: env.clock.t - 1000, seq: 1, sessionId: 'earlier' });
    expect(typed.progress.status).toBe('mastered');
    await db.progress.put(typed.progress);

    const answers: InteractiveAnswers = { ...perfect(q, []), blanks: q.blanks.map((b, i) => (i === 0 ? (b.answer + 1) % b.options.length : b.answer)) };
    const r = await service.submit(s.id, { questionId: q.id, answers: [], kind: 'submit', interactive: answers });
    const g = r.outcome.gaps.find((x) => x.wordId === wordId)!;
    expect(g.result).toBe('incorrect');
    expect(g.lostMastery).toBe(true);
    expect(g.schedule).toMatch(/Mistake Bank/);
    const p = (await db.progress.get(wordId))!;
    expect(p.status).toBe('learning');
    expect(p.masteredAt).toBeUndefined();
    expect(p.history.map((h) => h.event)).toEqual(['mastered', 'lost-mastery']);
    // It is fixed in Practice My Mistakes, typed in its own sentence.
    const fix = await service.startSession({ mode: 'interactive-reading', focus: 'mistakes' });
    const fq = fix.current!.question;
    expect(fq.kind).toBe('sentence');
    expect(fq.kind === 'sentence' && fq.wordId).toBe(wordId);
  });

  it('lets the student move on when the open passage was removed or changed by an update', async () => {
    const env = makeEnv();
    const { service, store, db } = env;
    const s = await service.startSession({ mode: 'interactive-reading' });
    const q = s.current!.question as InteractiveQuestion;
    // Simulate an update that removed the passage.
    const i = store.interactive.findIndex((x) => x.id === q.setId);
    const [removed] = store.interactive.splice(i, 1);
    try {
      const r = await service.submit(s.id, { questionId: q.id, answers: [], kind: 'skip' });
      expect(r.outcome.skipped).toBe(true);
      expect(r.outcome.gaps).toEqual([]);
      expect(r.session.index).toBe(s.index + 1);
      expect(await db.attempts.where('sessionId').equals(s.id).count()).toBe(0);
      expect(await db.irResults.where('sessionId').equals(s.id).count()).toBe(0);
    } finally {
      store.interactive.splice(i, 0, removed);
    }
  });
});
