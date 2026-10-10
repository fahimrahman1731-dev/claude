# DET Vocab Trainer

A practice app for the **reading section of the Duolingo English Test (DET)**. It covers the three DET reading tasks in the test's own format:
- **Fill in the Blanks**
- **Read and Complete**
- **Interactive Reading**

It also has vocabulary drills (spelling, small grammar words, word endings). The learning rule is simple:
- every word has **one** practice sentence;
- one correct typed answer **masters** the word;
- a missed word goes to the **Mistake Bank** and stays there until you fix it in **Practice My Mistakes**. It never comes back by itself;
- there are no scheduled reviews.

All progress is kept in the browser.

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
3. **Highlight the Answer**, asked twice. "Highlight text in the passage to answer the question below." Drag across the words, or on a phone tap the first word and then the last (scrolling never changes the highlight). Scored from 0 to 1 by how close the highlight is to the answer. In the tallies, a highlight counts as right when each end is at most one word off and at least half of the answer is highlighted.
4. **Identify the Idea.** "Select the idea that is expressed in the passage."
5. **Title the Passage.** "Select the best title for the passage."

One timer covers all six questions. You cannot go back, and CONTINUE stays disabled until the question is answered. After the passage, every part is explained. A session alternates narrative and expository passages, like the DET.

**Letter boxes.**
- Each missing letter has its own box.
- Typing fills a box and moves on, to the next word after the last box.
- Backspace clears and moves back, and from the first box goes to the previous word, where the next Backspace removes its last letter.
- ← → move between boxes and words, and clicking a box (or the given letters) selects it.
- Holding Enter down submits once; it never skips the feedback.
- It works with phone keyboards and paste.
- There are no hints on the question screen.

**Letters given.**
- **1 to 3 letters (the default, as requested).** The default gives half the word, but never more than 3 letters. Short words show 1 or 2 letters, so *confusing* shows `con` and *is* shows `i`.
- **Half the word.** Settings can switch to the DET's own rule, the first half rounded down (`conf`). Both rules give the same result for words of up to 7 letters.

**Vocabulary drills** (second tab): Word Spelling, Small Grammar Words, Word Endings and Practice My Mistakes. They are extra practice, not DET question types. See [How practice works](#how-practice-works) for which words each one gives you.

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
- **Sentences:** one sentence of 8–22 words, stand-alone (no "This…", "However…"), plain English letters, no quotes, brackets, lists or acronyms. Headings and list items are never joined to a sentence, and textbook sentences that point to a missing figure, table or formula ("shown in ___") are left out.
- **Read and Complete texts:** 50–100 words of plain prose with no British spellings.
- **Topics:** anything the DET's fairness review avoids is left out: violence, war, crime, weapons, drugs and alcohol, sex and the body, death and serious illness, religion, race and politics.

Each sentence and text keeps its source and licence, and the app shows them.

Because some sources are NonCommercial or ShareAlike, **the app and its data must stay free and be shared under the same terms.**

## What the build produced

The full report is in [`data/generated/import-report.md`](data/generated/import-report.md), and in the app under **Import report**.

| Measure | Count |
| --- | --- |
| Words from the two study documents (2 of 2 sources, every section OK) | 2,590 |
| Words deleted as unrealistic DET words, each with its reason | 11 |
| Words added from trusted lists (NGSL, NAWL, CEFR-J A1–B2, Octanove C1) that have real sentences | 3,246 |
| Practice words in total | 5,836 |
| Practice sentences, exactly one per word | 5,836 |
| Of these: real / WordNet / written for the app | 5,666 / 18 / 152 |
| Size of `public/data/vocab.json` | about 6.4 MB |
| Read and Complete texts (CLEAR 161, OneStopEnglish 106, OpenStax 53) | 320, with 8–16 gaps each |
| Interactive Reading passages (CLEAR, OneStopEnglish, OpenStax and the official research sample). The 92 written for this app were each solved blind by a second reviewer, and every answer they could argue with was fixed | 93 |

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

### One sentence, one correct answer

- Every word has **one** practice sentence, chosen by the build (a real one for 5,666 of the 5,836 words). Custom words keep only their first valid sentence.
- Fill in the Blanks, Word Spelling, Small Grammar Words and Word Endings give you **only new words** (words you have never answered). Each word is asked at most once per session.
- **One correct typed answer masters a word** at once. It moves to the Completed Checklist.
- A wrong, timed-out or empty answer puts the word in the **Mistake Bank** (shown as "In Mistake Bank" or "to fix"). It **never comes back by itself** in normal practice.
- A skip is not counted. The word stays new and can come back in a later session.

### Mistake Bank

- **Practice My Mistakes** gives you only the words in the Mistake Bank, most-missed first. Each word is asked at most once per session, in its one sentence.
- One correct answer there masters the word, and it leaves the Mistake Bank.
- A wrong answer keeps it in the Mistake Bank.

### Read and Complete and Interactive Reading

- Read and Complete gaps are typed. A correct gap masters the word; a wrong one sends it to the Mistake Bank.
- In Interactive Reading, choosing the right word from options never masters it. A wrong choice is a mistake: the word goes to the Mistake Bank, even if it was mastered. Its history then shows "lost mastery".

### No scheduled reviews

There are none:
- no review dates or checks after some days;
- no Review frequency setting;
- no quota of new words or review questions per session.

A mastered word comes back only when you choose:
- **Review mastered words** (Completed Checklist page) starts an optional practice. A miss there sends the word to the Mistake Bank.
- **Reopen** makes a mastered word new again. Its history is kept.
- You can also practise words you pick yourself from the Active Practice List or a word page.

A mastered word can still appear in a Read and Complete text or an Interactive Reading passage.

### Progress from the previous version

Progress saved by the previous version is converted automatically, once, when the app opens (database version 3):
- a word whose latest typed answer was correct becomes mastered;
- a word with an unfixed mistake stays in the Mistake Bank;
- a mastered word stays mastered, and anything else is new.

Backups made before version 3 are converted the same way when they are restored.

### Priority

New words that are answers in official DET material come first. Then come the guide's lists and recurring words, then trusted-list words. In Practice My Mistakes, the most-missed words come first. **Adaptive difficulty** starts easy, moves up after 85% correct over the last 8 answers, and moves down below 50%.

The learning rule is in `src/engine/progress.ts` and word choice is in `src/engine/selection.ts`. Timers, priority weights and adaptive difficulty are in `src/engine/config.ts`.

## Saved data and its limits

There are no accounts. Everything is saved in the browser's IndexedDB on the device:
- progress, attempts and mistakes;
- Interactive Reading results;
- the open session, including how far into an Interactive Reading passage you are;
- settings and custom words.

Each answer is saved in one transaction before the feedback appears, and Interactive Reading choices are saved as you make them, so a refresh, a closed tab or a restart loses nothing.

Limits:
- Data stays on that device and browser.
- Clearing site data or private browsing deletes it.
- It holds one person per browser profile.

**Settings → Your data** downloads a full JSON backup (format version 3) and restores it. Older backups still restore, and their progress is converted to the current rule (see [Progress from the previous version](#progress-from-the-previous-version)).

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

This is not needed: every word already has its one sentence, and almost all of them are real. `ANTHROPIC_API_KEY=… npm run ai-proxy` starts a small server that can write a sentence for a custom word.
- The key stays on the server.
- Every sentence is validated before it is saved.
- Server-side fallback is turned on.
- It accepts `localhost` only by default.

See the comments at the top of `server/ai-proxy.mjs`.

## Tests

`npm test` runs the unit, pipeline and functional tests. `npm run test:e2e` runs the browser tests.

**Functional tests** (`tests/functional/`), run on the real practice service and data. The required tests check that:
- one correct typed answer masters a word and moves it to the Completed Checklist;
- a wrong, timed-out or empty answer puts the word in the Mistake Bank, and it never comes back by itself in normal practice;
- Practice My Mistakes serves only missed words, most-missed first, in the same sentence; one correct answer there masters the word, and a miss keeps it in the Mistake Bank;
- every word has exactly one sentence, and each word is asked at most once per session;
- progress saved by the previous version, and old backups, are converted: latest typed answer correct means mastered, an unfixed mistake stays in the Mistake Bank;
- progress survives a reload, timeouts and untimed mode work, the library search finds words, 100% completion covers exactly the imported words, and a failed source is reported.

A full Interactive Reading set is also tested: shared timer, saving after each part, resuming after a refresh, scoring all six questions, partial highlight credit, the time-out case, the Mistake Bank (with the exact missed word), "choosing never masters", and skipping a passage that an update removed.

**Unit tests** cover:
- the learning rule: one-answer mastery, the Mistake Bank, skips, "choosing never masters", reopening, and converting old progress;
- word choice: only new words in normal practice, only Mistake Bank words in Practice My Mistakes, each word once per session;
- the clue rule (1–3 letters, or half the word);
- the DET C-test alternation;
- the official Interactive Reading order and wording, and its scoring;
- the set validator;
- the real-text filters (topics, one sentence, headings, accented names), the sentence splitter and the deletion rules;
- the Read and Complete gap rule around abbreviations and prices;
- British-spelling detection;
- one sentence per word, and how many sentences are real;
- answer checking, backups and word-list import.

**Browser tests** check:
- the DET-style screens: one box per letter, at most 3 letters given, no hints;
- typing, auto-advance and Backspace across words, including retyping from a clicked box;
- holding Enter submits only once;
- a complete Interactive Reading passage, with choices kept through a refresh;
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
src/engine/               practice rules: answers, clues, word choice, mastery and the Mistake Bank, Interactive Reading scoring
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
