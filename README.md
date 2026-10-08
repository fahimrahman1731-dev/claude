# DET Vocab Trainer

A practice app for the reading part of the Duolingo English Test (DET): vocabulary, spelling, small grammar words and word endings. Every practice word comes from the student's two study documents in `data/sources/`. The app tracks each word until it is mastered, brings mistakes back on a short schedule, and keeps all progress in the browser.

This is an independent study tool. It is **not** made by or connected to Duolingo. Questions are written in the style of DET tasks, but they are not official questions, and no word or question is promised to appear on the real test.

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

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Rebuilds the data (`predev`), then starts the dev server |
| `npm run build` | Data pipeline, `tsc -b` and `vite build` into `dist/` |
| `npm run build:data` | Extracts words from the sources, merges the authored data, validates everything, writes `public/data/vocab.json` and the import reports |
| `npm run build:data -- --strict` | Same, but fails if any source, section, definition or sentence is missing or invalid |
| `npm run extract` | Extraction only. Writes `data/generated/extracted.json` for inspection |
| `npm test` | Unit, pipeline and functional tests (Vitest, with an in-memory IndexedDB) |
| `npm run test:e2e` | Browser tests (Playwright on Chromium). These build and serve the app themselves |
| `npm run typecheck` | TypeScript check only |
| `npm run ai-proxy` | Optional sentence-generation server (see [Optional AI sentences](#optional-ai-sentences)) |

## What was imported

The import is checked on every build. The full report is in [`data/generated/import-report.md`](data/generated/import-report.md), and students can see it in the app under **Import report**.

| Measure | Count |
| --- | --- |
| Sources read | 2 of 2, every section OK |
| Word entries found (with repeats) | 4,086 |
| Accepted | 4,052 |
| Rejected, each with a reason | 34 |
| Unique words to practice | 2,601 (1,451 repeats merged; every source kept on the word) |
| Practice-ready words (2+ different valid sentences) | 2,601 |
| Sentence contexts | 5,202 |
| Read and Complete paragraphs | 45, with 900 gaps |
| Small grammar words | 173 |

Rejected entries are not words a DET gap can hold, for example:

- word endings shown as examples (`-tion`, `-ed`);
- single letters;
- contractions and possessives (`it's`, `today's`);
- hyphenated words;
- trap misspellings (`miniscule` is rejected and `minuscule` imported);
- British spellings, which are kept as accepted variants of the American word instead of as separate targets.

What the sources do not contain, and how the app handles it:

- **Bank 1 mentions 37 more small words without listing them.** They cannot be imported, and the report says so.
- **The Harvest document could not access DET Practice Questions Volume 5.** Nothing from it is included.
- **The sources define only 349 of the words.** Every other definition is written for this app and labeled "app-written" on the word page.
- **The sources contain no Bengali.** All 2,601 Bengali meanings are written for this app and labeled the same way. Please report any that are wrong.
- **Almost all practice sentences and all 45 paragraphs are written for this app.** They are original text in DET style; no official test text is reproduced.

## How practice works

### Modes

Each mode can be chosen on its own from **Practice**:

| Mode | Task | Word pool |
| --- | --- | --- |
| A. Read and Complete | A paragraph with 8–20 half-written words. Type the missing letters; small grammar words and content words are scored separately. The first and last sentences stay whole, and gaps are never side by side. | 45 paragraphs |
| B. Fill in the Blanks | One sentence with the first half of a noun, verb, adjective or adverb shown. Never *the*, *of* and other grammar words. British spellings are accepted here. | 2,426 words |
| C. Word Spelling | Spell the whole word from its first half and the sentence. American spelling only. | 2,428 words |
| D. Small Grammar Words | *the, of, which, although…* in context | 173 words |
| E. Word Endings | The stem is shown and you type the ending (*-tion, -ness, -ed, -ing*), including spelling changes and irregular forms | 1,116 words |

There is one question at a time. **Enter** submits, and Enter again moves on. Focus moves to the next box automatically, and a double press is only counted once. A missed word shows a fixed explanation:

- the correct spelling, with the letters you got wrong marked;
- the kind of mistake (missing letter, double letter, swapped letters, wrong ending…);
- the spelling rule that applies;
- the context clue;
- the meaning, the part of speech and related forms;
- with Bengali turned on, the Bengali meaning and an explanation in Bengali.

### Timers

| Timer mode | How it works |
| --- | --- |
| **Timed** (default) | Small words get 10 s. Other sentence questions get 20 s, or 30 s for advanced words. A paragraph gets 3 minutes. |
| **Untimed** | No countdown. |
| **Custom** | You set the seconds for each mode in **Settings**. |

When time runs out, the question is recorded as a timeout and the answer is shown. The countdown never goes below zero.

### Mastery

A word is **mastered** when it is answered correctly in **two different sentences in a row**. "In a row" means there was no mistake, timeout or unanswered attempt in between. Skipping or only viewing a word never counts.

A mastered word moves from the **Active Practice List** to the **Completed Checklist**. Retention reviews come back after 1, 3, 7, 16, 35 and 75 days. The "intensive" review setting multiplies these gaps by 0.6 and "relaxed" by 1.5. A mistake on a retention review sends the word back to active practice; its history is kept. You can also reopen a word yourself.

### Review schedule

The schedule is the same for every student. All the numbers are in `src/engine/config.ts`.

| Event | When the word comes back |
| --- | --- |
| First mistake in a row | after 3–5 other questions, in a different sentence |
| Second mistake in a row | after 1–2 other questions |
| Third or later mistake in a row | after 1 other question |
| First correct answer | after 6–10 other questions, in a new sentence (the second one needed for mastery) |
| Skip | after 4–8 other questions |
| Word still being learned when a session ends | stays due, so the next session (for example the next day) reviews it first |

After every answer, the screen says which rule was applied.

### Priority

Each word gets an evidence score from the study materials. Points come from:

- being an answer in official DET practice material;
- how many times the word was blanked;
- being a small grammar word;
- appearing in several sources;
- being a known spelling trap;
- weaker third-party evidence.

The student's own record then raises the score: consecutive mistakes add the most, and steady correct answers lower it again. Practice picks **high** (score 5 or more) before **medium** (3 or more) before **lower**. The guide's figures are used as evidence only. For example, it reports that about 42% of 1,368 sampled Read and Complete gaps were small grammar words, and that *the, and, to, of, in* filled 19%. These are not predictions about any test.

**Adaptive difficulty** starts easy. It moves up a level after 85% correct over the last 8 answers and down after less than 50%.

### Pages

| Page | What it shows |
| --- | --- |
| **Dashboard** | Today's goal, words mastered, words due, accuracy, practice streak, the daily chart, and the most missed and most improved words |
| **Practice** | Choose a mode, the difficulty and the timer |
| **Active Practice List** | Every word not yet mastered, with filters: high priority, frequently missed, small grammar words, academic, difficult, due for review, never attempted |
| **Completed Checklist** | Mastered words. Search, filter, see each word's history, review, reopen, or export as CSV |
| **Mistake Bank** | Every mistake with the sentence, what you typed and the error type, plus **Practice My Mistakes** |
| **Vocabulary Library** | Search by English, Bengali, prefix or suffix. Word families, custom words and CSV/JSON/TXT word-list import, each with its own report |
| **Statistics** | Results; accuracy by mode, by difficulty and by study-material priority; response time by mode; kinds of spelling mistakes; the daily chart (with a table view); recent sessions |
| **Settings** | Language (English only / English + Bengali), timers, session size, daily goal, theme, backups, reset |

Accuracy counts correct answers out of correct + incorrect + timeouts + unanswered. Skips are left out.

## Saved data and its limits

There are no accounts. Everything is saved in the browser's IndexedDB on the device: progress, attempts, mistakes, the open session, settings and custom words. Each answer is saved in one transaction before feedback is shown, so a refresh, a closed tab or a restart loses nothing. An unfinished session resumes where it stopped.

Limits of a single-user, local store:

- Data stays on the device and in the browser where it was created. It does not sync to a phone or another browser.
- Clearing site data, or private browsing, deletes it. The app asks the browser for persistent storage and shows in **Settings** whether it was granted.
- One person per browser profile.

**Settings → Your data** can download a full JSON backup and restore it, including on another device. A restore is checked before it replaces anything. If the database cannot be opened or a save fails, the app says so instead of failing silently, and the answer is not counted.

For several students on one server, the data layer (`src/db/db.ts` and `src/services/practice.ts`) is the part to replace with an authenticated API.

## Deployment

The build is a static site with a hash router and relative paths, so `dist/` can be served from any static host or subfolder. No server is needed.

- **Any static host** (Netlify, Vercel, Cloudflare Pages, S3, nginx): build command `npm run build`, output directory `dist`.
- **GitHub Pages:** run the **Deploy to GitHub Pages** workflow from the Actions tab. It is in `.github/workflows/pages.yml` and runs only when started by hand. Before the first run, set **Settings → Pages → Source** to *GitHub Actions*.
- **Locally:** `npm run build && npm run preview`.

CI (`.github/workflows/ci.yml`) runs on every push and pull request: the strict data build, the type check, the unit and functional tests, the production build and the browser tests.

## Optional AI sentences

Every word already has at least two checked sentences, so this feature is optional. It adds more sentences for a word, or for a custom word that has fewer than two.

```bash
ANTHROPIC_API_KEY=your-key npm run ai-proxy   # listens on http://127.0.0.1:8787
```

Then, in the app, go to **Settings → AI sentence generation**, enter `http://localhost:8787/api/contexts`, and use **✨ Generate 2 more (AI)** on a word's page.

- **The API key stays on the server.** The browser only sends the word, its part of speech, its meaning and the existing sentences. The key is never sent to the browser or stored in the app.
- **The server calls Claude** (`claude-opus-5-5`) through the official `@anthropic-ai/sdk` and asks for structured JSON output. It turns on Anthropic's server-side fallback (`fallbacks: "default"`), so a request declined by a safety classifier is retried on Anthropic's recommended fallback model instead of failing.
- **Every generated sentence goes through the same validation as the imported data** before it is saved. It must contain the exact word once, have enough words, not give the answer away, and differ from the existing sentences. Rejected sentences are listed with their reasons.
- **If the server is not running, the key is wrong, or the service is busy or declines,** the app shows a short message and practice carries on with the existing sentences.
- **Defaults:** the server accepts browsers on `localhost` only and allows 20 requests per minute per address. You can change this with `HOST`, `PORT`, `ALLOWED_ORIGINS`, `RATE_LIMIT_PER_MIN`, `AI_MODEL` and `AI_EFFORT`, which are documented at the top of `server/ai-proxy.mjs`.
- **Cost:** API use is billed to whoever owns the key.
- **Exposing it publicly:** put it behind your own authentication first. Otherwise anyone who finds the URL can spend the key.

## Tests

`npm test` runs 56 tests. The 12 required functional tests are in `tests/functional/required.test.ts`. They run the real practice service against an in-memory IndexedDB with a controllable clock and the real imported vocabulary:

1. A wrong answer is saved and the correct spelling is shown. The word comes back 3–5 questions later.
2. Repeated misses shorten the gap (3–5, then 1–2, then 1 question) and raise the word's priority.
3. Correct answers in two different sentences master the word, and a mistake in between resets the count.
4. The same sentence answered twice does not count as two contexts.
5. A mastered word moves from the Active Practice List to the Completed Checklist, with its history kept.
6. Progress, mistakes, mastery and the open question survive reopening the database, and a repeated submit is ignored.
7. When the countdown expires, a timeout is recorded, the answer is shown and a review is scheduled. Letters typed before the end are still checked.
8. Untimed mode has no countdown and accepts an answer after any delay.
9. Practice My Mistakes asks only previously missed words, most-missed first.
10. Library search finds a word by English, Bengali, prefix or suffix, and its history is available.
11. Mastering every imported word reports 100%, counted over exactly the imported words.
12. A missing source file, an unreadable section and an unreadable uploaded list are each reported as failed. Nothing is skipped silently.

`npm run test:e2e` repeats tests 5, 6, 7, 8 and 10 in a real browser. It also checks a Read and Complete paragraph, all page navigation, and the phone layout.

Other tests cover:

- the extraction (section counts match the sizes the documents state);
- the gap rules for paragraphs;
- word-list import;
- backup and restore;
- answer checking and error analysis;
- the AI server, using a stand-in for the AI service so no key is needed.

## Project layout

```
data/sources/          the two study documents + manifest.json (which parser reads each)
data/authored/words/   definitions, Bengali meanings and example sentences for every word
data/authored/paragraphs/  the 45 Read and Complete paragraphs
data/generated/        import report (Markdown) and raw extraction
scripts/               data pipeline: extract → merge → validate → public/data/vocab.json
src/engine/            practice rules: answer checking, spelling analysis, scheduling,
                       mastery, priority, question selection, statistics (no UI, fully tested)
src/db/                IndexedDB schema (Dexie)
src/services/          practice sessions (transactional submit), backups, word import, AI client
src/ui/                React pages and components
server/ai-proxy.mjs    optional sentence server (keeps the API key off the browser)
tests/, e2e/           Vitest and Playwright tests
```

### Adding words or sources

- **One word or a list:** in the app, open **Vocabulary Library → Add your own word** or **Import a word list** (CSV, JSON, TXT or Markdown). Custom words are saved in the browser and are included in backups.
- **Authored data:** each line in `data/authored/words/*.txt` has the format

  ```
  word|pos|E/I/A|definition|bengali|sentence 1|sentence 2[|more sentences]
  ```

  For example:

  ```
  harbor|n|E|a sheltered place where ships stay|পোতাশ্রয়|Fishing boats waited in the harbor.|…
  ```

  `E/I/A` means easy, intermediate or advanced. If the word appears more than once in a sentence, put the occurrence to practice in `[brackets]`. Run `npm run build:data -- --strict` afterwards; it reports every invalid line.
- **A new study document:** put the Markdown file in `data/sources/` and add an entry to `manifest.json`. Then either reuse a parser or add one in `scripts/lib/sources/`, because each document's tables and lists need their own reader. A section that fails or yields nothing is reported as failed. It is never skipped silently. Words that are new also need authored lines before they can be practiced, and the report lists any that are missing.
