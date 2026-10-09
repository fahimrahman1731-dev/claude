import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateInteractive, type AuthoredInteractive } from '../../scripts/lib/interactive-build';
import { chooseInteractive, highlightScore, interactiveQuestion, interactiveSeconds, IR_STEPS, scoreInteractive, serveChoice } from '../../src/engine/interactive';
import type { InteractiveAnswers, InteractiveSet } from '../../src/engine/types';
import { root, vocab } from '../functional/env';
import { seqRng } from '../helpers';

const sample: AuthoredInteractive = JSON.parse(readFileSync(join(root, 'data/authored/interactive/official-sample.json'), 'utf8'))[0];

describe('Interactive Reading format', () => {
  it('asks the six DET questions in the official order with the official wording', () => {
    expect(IR_STEPS.map((s) => s.part)).toEqual(['complete-sentences', 'complete-passage', 'highlight', 'highlight', 'main-idea', 'title']);
    expect(IR_STEPS[0].instruction).toBe('Select the best option for each missing word');
    expect(IR_STEPS[1].instruction).toBe('Select the best sentence to complete the passage');
    expect(IR_STEPS[2].instruction).toBe('Highlight text in the passage to answer the question below');
    expect(IR_STEPS[4].instruction).toBe('Select the idea that is expressed in the passage');
    expect(IR_STEPS[5].instruction).toBe('Select the best title for the passage');
  });
  it('gives 8 minutes to passages with more missing words and 7 to the others', () => {
    expect(interactiveSeconds({ blanks: new Array(8) })).toBe(480);
    expect(interactiveSeconds({ blanks: new Array(5) })).toBe(420);
  });
  it('shuffles options but always keeps the right one', () => {
    for (let k = 0; k < 20; k++) {
      const c = serveChoice('right', ['a', 'b', 'c', 'd'], seqRng([k / 20, 0.3, 0.9, 0.1]));
      expect(c.options).toHaveLength(5);
      expect(c.options[c.answer]).toBe('right');
    }
  });
});

describe('Interactive Reading sets', () => {
  it('the official research sample is a valid set', () => {
    const r = validateInteractive(sample, undefined);
    expect(r.problems).toEqual([]);
    const set = r.set!;
    expect(set.blanks).toHaveLength(7);
    expect(set.text.slice(set.missing.start, set.missing.end)).toBe(sample.missingSentence);
    for (const b of set.blanks) expect(set.text.slice(b.start, b.end)).toBe(b.answer);
    expect(set.blanks.every((b) => b.end <= set.sentencesPartEnd)).toBe(true);
  });
  it('rejects sets that break the DET rules', () => {
    const broken: AuthoredInteractive = {
      ...sample,
      blanks: [{ answer: 'organized', distractors: ['decorated', 'invited'] }],
      missingSentence: sample.passage.split('. ')[0] + '.',
      highlights: [{ question: 'What do plants use', answer: 'sunlight' }],
      titleDistractors: ['Producers in an Ecosystem'],
    };
    const problems = validateInteractive(broken, undefined).problems.join(' | ');
    expect(problems).toMatch(/1 blanks \(expected 3–10\)/);
    expect(problems).toMatch(/2 wrong options \(expected 4\)/);
    expect(problems).toMatch(/first two sentences/);
    expect(problems).toMatch(/must end with “\?”/);
    expect(problems).toMatch(/shorter than 3 words/);
    expect(problems).toMatch(/1 highlight questions/);
  });
  it('requires the passage to be copied unchanged from its source', () => {
    const r = validateInteractive(sample, 'A completely different source text. It has other sentences.');
    expect(r.problems.some((p) => p.startsWith('sentence not found unchanged in the source'))).toBe(true);
  });
  it('every set shipped with the app passes validation', () => {
    expect(vocab.interactive.length).toBeGreaterThanOrEqual(1);
    for (const s of vocab.interactive) {
      expect(s.blanks.length).toBeGreaterThanOrEqual(3);
      expect(s.highlights).toHaveLength(2);
      expect(s.source.license).toBeTruthy();
      for (const b of s.blanks) expect(s.text.slice(b.start, b.end)).toBe(b.answer);
      for (const h of s.highlights) expect(s.text.slice(h.start, h.end).split(/\s+/).length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('Interactive Reading scoring', () => {
  const set = validateInteractive(sample, undefined).set!;
  const q = interactiveQuestion(set, seqRng([0.2, 0.7, 0.4]));
  const key = (): InteractiveAnswers => ({
    step: 5,
    blanks: q.blanks.map((b) => b.answer),
    missing: q.missing.answer,
    highlights: set.highlights.map((h) => ({ start: h.start, end: h.end })),
    idea: q.idea.answer,
    title: q.titles.answer,
  });
  it('scores a perfect set as all correct', () => {
    const s = scoreInteractive(set, q, key());
    expect(s.correct).toBe(s.total);
    expect(s.total).toBe(set.blanks.length + 5);
  });
  it('gives partial credit for a highlight that is a little off, none for a wrong place', () => {
    const h = set.highlights[0];
    expect(highlightScore(set.text, { start: h.start, end: h.end }, h)).toBe(1);
    const oneWordLess = set.text.indexOf(' ', h.start) + 1;
    const partial = highlightScore(set.text, { start: oneWordLess, end: h.end }, h);
    expect(partial).toBeGreaterThan(0.8);
    expect(partial).toBeLessThan(1);
    expect(highlightScore(set.text, { start: 0, end: 20 }, h)).toBe(0);
    expect(highlightScore(set.text, null, h)).toBe(0);
  });
  it('counts unanswered parts as not correct', () => {
    const a = { ...key(), blanks: q.blanks.map(() => null), title: null };
    const s = scoreInteractive(set, q, a);
    expect(s.blanks.every((b) => !b)).toBe(true);
    expect(s.parts.find((p) => p.part === 'title')).toMatchObject({ correct: false, answered: false });
  });
  it('alternates narrative and expository passages within a session', () => {
    const mk = (id: string, genre: 'narrative' | 'expository'): InteractiveSet => ({ ...set, id, genre });
    const sets = [mk('a', 'expository'), mk('b', 'expository'), mk('c', 'narrative')];
    const next = chooseInteractive(sets, {}, 'easy', () => 0, ['a']);
    expect(next?.genre).toBe('narrative');
    expect(chooseInteractive(sets, {}, 'easy', () => 0, ['a', 'b', 'c'])).toBeUndefined();
  });
});
