# DET Vocab Trainer

A practice app for the **reading section of the Duolingo English Test (DET)**. It covers the three DET reading tasks in the test's own format:
- **Fill in the Blanks**
- **Read and Complete**
- **Interactive Reading**

It also has vocabulary drills (spelling, small grammar words, word endings). It tracks every word until it is mastered, brings mistakes back on a short schedule, and keeps all progress in the browser.

**Real content.** The practice sentences, Read and Complete texts and Interactive Reading passages are real, openly licensed texts copied unchanged, and each shows its source. The words come from:
- the student's two study documents in `data/sources/`, with official DET answer words first;
- trusted word lists at DET level.

This is an independent study tool. It is **not** made by or connected to Duolingo. No word, text or question is promised to appear on the real test (see [Real or repeated DET questions](#real-or-repeated-det-questions)).

## Quick start

You need Node.js 20 or newer (22 is tested).

```bash
npm ci
npm run dev        # rebuilds the vocabulary data, then serves http://localhost:5173
```

To build and serve the production version:

```bash
npm run build      # data pipeline + type check + bundle into dist/
npm run preview    # serves dist/ at http://localhost:4173
```

The collected real material is committed in `data/collected/`, so building needs no network access. Refreshing it is optional (see [Collected real material](#collected-real-material)).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Rebuilds the data (`predev`), then starts the dev server |
| `npm run build` | Data pipeline, `tsc -b` and `vite build` into `dist/` |
| `npm run build:data` | Builds `public/data/vocab.json` and the import reports from the study documents, `data/collected/` and the Interactive Reading sets. It extracts, deletes, adds and validates along the way |
| `npm run build:data -- --strict` | Same, but fails if any source, section, definition, sentence or Interactive Reading set is missing or invalid |
| `npm run extract` | Extraction from the study documents only. Writes `data/generated/extracted.json` |
| `python3 scripts/collect/collect.py` | Downloads the openly licensed texts, word lists and dictionaries and rewrites `data/collected/`. Needs `pip install -r scripts/collect/requirements.txt` |
| `npx tsx scripts/validate-interactive.ts <file>` | Checks Interactive Reading set files against the DET rules and their source texts |
| `npm test` | Unit, pipeline and functional tests (Vitest, with an in-memory IndexedDB) |
| `npm run test:e2e` | Browser tests (Playwright on Chromium). They build and serve the app themselves |
| `npm run typecheck` | TypeScript check only |
| `npm run ai-proxy` | Optional sentence-generation server (see [Optional AI sentences](#optional-ai-sentences)) |

## The three DET reading tasks

The format follows Duolingo's own documents:
- DET Technical Manual (2026);
- research reports DRR-22-02 (Interactive Reading) and DRR-24-01 (vocabulary);
- Attali et al. (2022).

| Task | What the student sees | Timer (Timed mode) |
| --- | --- | --- |
| **Fill in the Blanks** | "Complete the sentence with the correct word". One sentence with one unfinished noun, verb, adjective or adverb. The first letters are given, then one box per missing letter. | 0:20 for this question (0:30 for advanced words, optional) |
| **Read and Complete** | "Complete the text with the correct words". A titled text with a whole first and last sentence. In between, every other word loses its second half: the 2nd, 4th, 6th… word from the second sentence on. Names, numbers and one-letter words stay whole but still take their turn. American spelling only. | 3:00 for this question |
| **Interactive Reading** | One passage, six questions in the DET's order. See below. | 7:00 or 8:00 for all six (8:00 when there are 7 or more missing words) |

Interactive Reading questions, in order:
1. **Complete the Sentences.** "Select the best option for each missing word." Only the first half of the passage is shown, with 3–10 numbered blanks. Each blank has a dropdown of 5 options.
2. **Complete the Passage.** "Select the best sentence to complete the passage." The first half comes back with the correct words filled in, then a gap, then the rest of the text. There are 4 sentence options.
3. **Highlight the Answer**, asked twice. "Highlight text in the passage to answer the question below." Drag across the words, or on a phone tap the first word and then the last. Scored from 0 to 1 by how close the highlight is to the answer.
4. **Identify the Idea.** "Select the idea that is expressed in the passage."
5. **Title the Passage.** "Select the best title for the passage."

One timer covers all six questions. You cannot go back, and CONTINUE stays disabled until the question is answered. After the passage, every part is explained. A session alternates narrative and expository passages, like the DET.

**Letter boxes.**
- Each missing letter has its own box.
- Typing fills a box and moves on, to the next word after the last box.
- Backspace clears and moves back, and from the first box goes to the previous word.
- ← → move between boxes and words, and clicking a box selects it.
- It works with phone keyboards and paste.
- There are no hints on the question screen.

**Letters given.**
- **1 to 3 letters (the default, as requested).** The default gives half the word, but never more than 3 letters. Short words show 1 or 2 letters, so *confusing* shows `con` and *is* shows `i`.
- **Half the word.** Settings can switch to the DET's own rule, the first half rounded down (`conf`). Both rules give the same result for words of up to 7 letters.

**Vocabulary drills** (second tab): Word Spelling, Small Grammar Words, Word Endings and Practice My Mistakes. They are extra practice, not DET question types.

## Collected real material

`scripts/collect/collect.py` downloads everything from `raw.githubusercontent.com`. It writes three files to `data/collected/`: `texts.json`, `sentences.json` and `lexicon.json`. The build then uses them as follows.

| Source | Licence | Used for |
| --- | --- | --- |
| CommonLit **CLEAR** corpus (Crossley et al.). Only excerpts whose own licence is CC BY or CC BY-SA: Frontiers for Young Minds, Wikipedia and Simple Wikipedia, African Storybook… | corpus CC BY-NC-SA 4.0; excerpts CC BY / CC BY-SA | sentences, Read and Complete texts, Interactive Reading passages (expository and narrative) |
| **OneStopEnglish** corpus (Vajjala & Lučić, 2018). News for learners, elementary and advanced versions | CC BY-SA 4.0 | sentences, Read and Complete texts, passages |
| **OpenStax** textbooks (psychology, sociology, astronomy, biology, U.S. and world history, anthropology, lifespan development). Duolingo generated its Interactive Reading passages from open textbooks | CC BY-NC-SA 4.0 | sentences, Read and Complete texts, passages |
| **ASSET** simplified sentences; **CEFR-SP** learner sentences | CC BY-NC 4.0; CC BY-NC-SA 4.0 / CC BY-SA 3.0 | Fill in the Blanks sentences |
| Duolingo research appendix (Attali et al., 2022) | CC BY | the example Interactive Reading passage |
| Princeton **WordNet** 3.0 | WordNet licence | definitions for added words, some example sentences |
| **NGSL 1.2**, **NAWL 1.2**; **CEFR-J 1.5**; **Octanove C1/C2** | CC BY-SA 4.0; free with citation; CC BY-SA 4.0 | which words are realistic DET words, levels |
| **wordfreq** | data CC BY-SA 4.0 | word frequency (Zipf) |
| **Apertium** English–Bengali dictionary | GPL-2.0 | Bengali meanings for added words |

Filters keep the material DET-like:
- **Sentences:** 8–22 words, stand-alone (no "This…", "However…"), no quotes, brackets, lists or acronyms.
- **Read and Complete texts:** 50–100 words of plain prose with no British spellings.
- **Topics:** anything the DET's fairness review avoids is left out: violence, war, crime, drugs and alcohol, death, religion and politics.

Each sentence and text keeps its source and licence, and the app shows them.

Because some sources are NonCommercial or ShareAlike, **the app and its data must stay free and be shared under the same terms.**

## What the build produced

The full report is in [`data/generated/import-report.md`](data/generated/import-report.md), and in the app under **Import report**.

| Measure | Count |
| --- | --- |
| Words from the two study documents (2 of 2 sources, every section OK) | 2,590 |
| Words deleted as unrealistic DET words, each with its reason | 11 |
| Words added from trusted lists (NGSL, NAWL, CEFR-J A1–B2, Octanove C1) that have real sentences | 3,257 |
| Practice words in total | 5,847 |
| Practice sentences: real / WordNet / written for the app | 20,505 / 131 / 367 |
| Read and Complete texts (CLEAR 161, OneStopEnglish 106, OpenStax 53) | 320, with 8–16 gaps each |
| Interactive Reading passages | see the report |

**Why words were deleted.** Official DET answer words are always kept, however rare (*jots*, *solstices*), and so are spelling traps your guide teaches (*minuscule*). A word is deleted only if one of these applies:
- It is British-only: *kerb*, *pram*.
- It is a rare word that official material used only as a wrong option: *hullabaloo*, *miasma*, *hokum*… In the official sets the rare "impressive" option was never the answer.
- It is not an official word, and it is either very rare and in no trusted list, or only at C2 level.

**Where definitions and Bengali come from.**
- **Definitions:** from your study materials where given. Otherwise the app's own sense-specific definition for your words, and WordNet's for added words, each labelled. WordNet's definition is also shown on every word page.
- **Bengali:** your words keep their Bengali meanings, labelled as written for the app. Added words take the Apertium dictionary's meaning where it has one, labelled as from the dictionary. Every word page also shows the dictionary entry.

## Real or repeated DET questions

The app contains none, for these reasons, all from Duolingo's own documents:
- Each test is drawn from a very large, refreshed item bank: "any two test sessions are unlikely to share a single item" (Technical Manual, 2026).
- An item is seen in about 1 in 1,000 tests, and over-exposed items are retired.
- Interactive Reading passages and questions are themselves "automatically generated by GPT-3" and then reviewed by people (DRR-22-02).
- Test takers pledge not to share test content, and the terms forbid using it for preparation material.
- Duolingo's official practice books are copyrighted, so the app links to them rather than copying them.

What does repeat is the **format**, the **kinds of text** (stories, news, textbook passages) and **common vocabulary**, and that is what the app practises.

## How practice works

### Mastery

A word is **mastered** when it is spelled correctly in **two different sentences in a row**, with no mistake, timeout or unanswered attempt in between. These never count toward mastery:
- skipping or viewing a word;
- choosing a word from options in Interactive Reading. Choosing it wrong, though, counts as a mistake and brings the word back.

Retention reviews come back after 1, 3, 7, 16, 35 and 75 days. The "intensive" setting multiplies these by 0.6 and "relaxed" by 1.5. A mistake on a retention review sends the word back to active practice; its history is kept.

### Review schedule

All the numbers are in `src/engine/config.ts`.

| Event | When the word comes back |
| --- | --- |
| First mistake in a row | after 3–5 other questions, in a different sentence |
| Second mistake in a row | after 1–2 other questions |
| Third or later mistake in a row | after 1 other question |
| First correct answer | after 6–10 other questions, in a new sentence |
| Skip | after 4–8 other questions |
| Still being learned when a session ends | stays due, so the next session reviews it first |

### Priority

Words that are answers in official DET material come first. Then come the guide's lists and recurring words, then trusted-list words. The student's own mistakes raise a word's priority. **Adaptive difficulty** starts easy, moves up after 85% correct over the last 8 answers, and moves down below 50%.

## Saved data and its limits

There are no accounts. Everything is saved in the browser's IndexedDB on the device:
- progress, attempts and mistakes;
- Interactive Reading results;
- the open session, including how far into an Interactive Reading passage you are;
- settings and custom words.

Each answer is saved in one transaction before the feedback appears, so a refresh, a closed tab or a restart loses nothing.

Limits:
- Data stays on that device and browser.
- Clearing site data or private browsing deletes it.
- It holds one person per browser profile.

**Settings → Your data** downloads a full JSON backup and restores it. Backups from the previous version still restore.

## Deployment

The build is a static site with a hash router and relative paths, so `dist/` can be served from any static host or subfolder.

- **Any static host** (Netlify, Vercel, Cloudflare Pages, S3, nginx): build command `npm run build`, output directory `dist`.
- **GitHub Pages:** run the **Deploy to GitHub Pages** workflow (`.github/workflows/pages.yml`) from the Actions tab. First set **Settings → Pages → Source** to *GitHub Actions*.

CI (`.github/workflows/ci.yml`) runs on every push:
- the strict data build;
- the type check;
- the unit and functional tests;
- the production build;
- the browser tests.

## Optional AI sentences

This is not needed: almost every word already has real sentences. `ANTHROPIC_API_KEY=… npm run ai-proxy` starts a small server that can add sentences for custom words.
- The key stays on the server.
- Every sentence is validated before it is saved.
- Server-side fallback is turned on.
- It accepts `localhost` only by default.

See the comments at the top of `server/ai-proxy.mjs`.

## Tests

`npm test` runs the unit, pipeline and functional tests. `npm run test:e2e` runs the browser tests.

**Functional tests** (`tests/functional/`), run on the real practice service and data:
- the 12 required tests: mistakes and their schedule, mastery in two different sentences, persistence through a reload, timeouts, untimed mode, Practice My Mistakes, library search, 100% completion, and failed sources reported;
- a full Interactive Reading set: shared timer, saving after each part, resuming after a refresh, scoring all six questions, partial highlight credit, the time-out case, the Mistake Bank, and "choosing never masters".

**Unit tests** cover:
- the clue rule (1–3 letters, or half the word);
- the DET C-test alternation;
- the official Interactive Reading order and wording, and its scoring;
- the set validator;
- the real-text filters, the sentence splitter and the deletion rules;
- British-spelling detection;
- how many sentences are real;
- answer checking, backups and word-list import.

**Browser tests** check:
- the DET-style screens: one box per letter, at most 3 letters given, no hints;
- typing, auto-advance and Backspace across words;
- a complete Interactive Reading passage;
- persistence after a refresh;
- the countdown;
- the phone layout.

## Project layout

```
data/sources/             the two study documents + manifest.json
data/collected/           real texts, sentences and the lexicon (made by scripts/collect/collect.py)
data/authored/words/      the app's definitions, Bengali meanings and fallback sentences for the study words
data/authored/interactive/ Interactive Reading question sets on real passages (JSON)
data/authored/paragraphs/ older app-written paragraphs, used only if data/collected is missing
data/generated/           import report and raw extraction
scripts/                  data pipeline; scripts/collect/ downloads the real material
src/engine/               practice rules: answers, clues, scheduling, mastery, Interactive Reading scoring
src/db/                   IndexedDB schema (Dexie)
src/services/             practice sessions, backups, word import, AI client
src/ui/                   React pages; LetterBoxes.tsx and det.tsx are the DET-style input and card
tests/, e2e/              Vitest and Playwright tests
```

### Adding Interactive Reading sets

Add a JSON file to `data/authored/interactive/` (see `official-sample.json`). A set:
- uses a passage from `data/collected/texts.json`, copied unchanged, together with its `sourceId`;
- has 3–10 blanks with 4 wrong options each, all in the first part of the passage;
- removes one sentence of 8–30 words (not one of the first two or the last), with 3 wrong sentences taken from other passages on the same topic;
- has two wh-questions whose answers are exact spans of 3 or more words;
- has one idea with 3 wrong ideas;
- has the real title with 3–4 wrong titles.

Run `npx tsx scripts/validate-interactive.ts <file>`; the build leaves out any set that fails.
