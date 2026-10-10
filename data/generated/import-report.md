# Vocabulary import and validation report

Data version `2265c35ee956`, generated 2026-10-10T06:02:38.199Z.

## Totals

| Measure | Count |
| --- | --- |
| Source entries detected (with repeats) | 4086 |
| Entries accepted | 4052 |
| Entries rejected (with reasons below) | 34 |
| Unique spelling targets imported | 5836 |
| Duplicate entries merged | 1451 |
| Definitions taken from the study materials | 347 |
| Entries with missing definitions | 0 |
| Words with a Bengali meaning | 4073 |
| Entries needing an example sentence (none valid) | 0 |
| Practice-ready words (one valid practice sentence each) | 5836 |
| Sentence contexts | 5836 |
| Read and Complete paragraphs | 320 |
| Paragraph gaps | 3878 |
| Total practice contexts | 9714 |
| Failed sources | 0 |
| Failed sections | 0 |

Priority: high 349, medium 1196, low 4291. Difficulty: easy 1940, intermediate 1732, advanced 2164. Small grammar words: 173.

## Sources and sections

### DET Reading: Strategy Guide and Vocabulary Bank — OK

| Section | Status | Accepted | Rejected |
| --- | --- | --- | --- |
| Bank 6: American spelling for Read and Complete | ok | 37 | 0 |
| Strategy sections: example words in the text | ok | 110 | 26 |
| Bank 1: small words ranked by gap count | ok | 65 | 0 |
| Bank 1: look-up table (what you see → likely words) | ok | 186 | 0 |
| Bank 2: word endings | ok | 210 | 0 |
| Bank 2: five spelling rules for endings (examples) | ok | 28 | 0 |
| Bank 2: irregular past forms | ok | 43 | 0 |
| Bank 3: Level 1: everyday words | ok | 339 | 0 |
| Bank 3: Level 2: mid-level words | ok | 207 | 0 |
| Bank 3: Level 3: harder words | ok | 114 | 0 |
| Bank 4: topic vocabulary | ok | 724 | 0 |
| Bank 5: easy official Fill in the Blanks answers | ok | 55 | 0 |
| Bank 5: harder official Fill in the Blanks answers | ok | 48 | 0 |
| Bank 5: 120 more words at the same level | ok | 120 | 0 |
| Bank 6: words people misspell | ok | 168 | 0 |
| Bank 6: pairs that get swapped | ok | 29 | 1 |

### DET Reading Vocabulary Harvest, Part 2 (2026) — OK

| Section | Status | Accepted | Rejected |
| --- | --- | --- | --- |
| Key Findings: example words | ok | 34 | 3 |
| Vol 4 Fill in the Blanks: all 45 answers | ok | 45 | 0 |
| Vol 4 Read and Complete: content-word answers by passage | ok | 577 | 0 |
| Vol 4 Interactive Reading: answers and trap options | ok | 286 | 2 |
| Section 2: words recurring across sources | ok | 55 | 0 |
| Section 3: third-party answer words by topic | ok | 159 | 2 |
| Best-estimate topic list (not harvested from any DET item) | ok | 350 | 0 |
| Section 4: Fill in the Blanks meanings and collocates | ok | 27 | 0 |
| Section 5: other Complete the Sentences examples | ok | 11 | 0 |
| Additional Strategy Points: example words | ok | 12 | 0 |
| Recommendations: US spelling card | ok | 13 | 0 |

## Notes

- Bank 1 says 37 more small words filled one gap each, but does not list them. They cannot be imported.

## Real collected material

Sentences, Read and Complete texts and Interactive Reading passages come from real, openly licensed texts (see data/collected and scripts/collect/collect.py). Nothing is copied from live DET tests.

| Measure | Count |
| --- | --- |
| Sentences: real (collected) | 5666 |
| Sentences: WordNet examples | 18 |
| Sentences: written for the app (only where too few real ones exist) | 152 |
| Words practised only with real sentences | 5684 |
| Words added from trusted lists (NGSL, NAWL, CEFR-J, Octanove C1) | 3246 |
| Words deleted as unrealistic DET words | 11 |
| Read and Complete texts | clear 161, ose 106, ostx 53 (from 3462 candidates) |
| Interactive Reading sets | 93 |
| Definitions: study materials / WordNet / app | 347 / 3246 / 2243 |
| Bengali: app / Apertium dictionary / none | 2590 / 1483 / 1763 |
| Source texts used | 1841 |

Words added by level: A1 461, A2 528, B1 927, B2 794, C1 239, C2 29, list only 268.

### Deleted words

| Word | Reason |
| --- | --- |
| corroborates | Rare word (frequency 2.4) that appeared in official material only as a wrong option. In the official sets the rare “impressive” option was never the answer. |
| exacerbation | Not an official DET word, in no trusted word list, and very rare (frequency 2.3). |
| exemplifies | Rare word (frequency 2.9) that appeared in official material only as a wrong option. In the official sets the rare “impressive” option was never the answer. |
| fluctuate | Not an official DET word and only in the C2 list (frequency 3.0): too rare for the DET’s mostly B1–B2 vocabulary. |
| hokum | Rare word (frequency 2.0) that appeared in official material only as a wrong option. In the official sets the rare “impressive” option was never the answer. |
| hullabaloo | Rare word (frequency 2.3) that appeared in official material only as a wrong option. In the official sets the rare “impressive” option was never the answer. |
| kerb | British-only word (US: curb). The DET asks for American spelling wherever you type. |
| miasma | Rare word (frequency 2.3) that appeared in official material only as a wrong option. In the official sets the rare “impressive” option was never the answer. |
| pram | British-only word (US: stroller (baby carriage)). The DET asks for American spelling wherever you type. |
| profuse | Rare word (frequency 2.3) that appeared in official material only as a wrong option. In the official sets the rare “impressive” option was never the answer. |
| wavered | Rare word (frequency 2.7) that appeared in official material only as a wrong option. In the official sets the rare “impressive” option was never the answer. |

### Licences of the texts used

- CC BY-SA 3.0 and GFDL: 126 texts
- CC BY-SA 3.0: 110 texts
- CC BY 4.0: 305 texts
- CC BY-SA: 1 texts
- CC BY 3.0: 6 texts
- CC BY-SA 4.0: 207 texts
- CC BY-NC-SA 4.0: 1085 texts
- CC BY-NC 4.0: 1 texts

## Rejected entries

| Entry | Section | Reason |
| --- | --- | --- |
| -ed | guide.strategy | word ending, not a word |
| -ing | guide.strategy | word ending, not a word |
| -ed | guide.strategy | word ending, not a word |
| a | guide.strategy | single-letter word (never a DET gap) |
| -s | guide.strategy | word ending, not a word |
| -ed | guide.strategy | word ending, not a word |
| -ing | guide.strategy | word ending, not a word |
| centre | guide.strategy | British spelling of "center"; kept as an accepted variant for Fill in the Blanks, not as a separate target |
| theatre | guide.strategy | British spelling of "theater"; kept as an accepted variant for Fill in the Blanks, not as a separate target |
| organise | guide.strategy | British spelling of "organize"; kept as an accepted variant for Fill in the Blanks, not as a separate target |
| a | guide.strategy | single-letter word (never a DET gap) |
| -tion | guide.strategy | word ending, not a word |
| -ment | guide.strategy | word ending, not a word |
| -ness | guide.strategy | word ending, not a word |
| -ity | guide.strategy | word ending, not a word |
| -able | guide.strategy | word ending, not a word |
| -ive | guide.strategy | word ending, not a word |
| -ous | guide.strategy | word ending, not a word |
| -ally | guide.strategy | word ending, not a word |
| summarise | guide.strategy | British spelling of "summarize"; kept as an accepted variant for Fill in the Blanks, not as a separate target |
| -s | guide.strategy | word ending, not a word |
| -ed | guide.strategy | word ending, not a word |
| -ing | guide.strategy | word ending, not a word |
| -ly | guide.strategy | word ending, not a word |
| hots | guide.strategy | shown in the guide as a wrong form (trap) |
| a | guide.strategy | single-letter word (never a DET gap) |
| it's (a gap is never a contraction, so type *its*) | guide.bank6.pairs | contraction or possessive (never a DET gap) |
| miniscule | harvest.keyfindings | misspelling shown as a trap; the correct spelling "minuscule" is imported instead |
| grey | harvest.keyfindings | British spelling of "gray"; kept as an accepted variant for Fill in the Blanks, not as a separate target |
| organising | harvest.keyfindings | British spelling of "organizing"; kept as an accepted variant for Fill in the Blanks, not as a separate target |
| miniscule | harvest.1c | misspelling shown as a trap; the correct spelling "minuscule" is imported instead |
| evidences | harvest.1c | non-standard plural shown as a trap ("evidence" is uncountable) |
| zero-gravity (hyphenated, so it would never be a real Read and Complete gap) | harvest.section3 | hyphenated word (never a DET gap) |
| today's | harvest.section3 | contraction or possessive (never a DET gap) |

## Missing definitions (0)

None.

## Needing example sentences (0)

None.

## Authored lines for words not in any source (not imported) (0)

None.

## Invalid sentences (0)

