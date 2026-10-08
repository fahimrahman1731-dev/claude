import { IRREGULAR, isFunctionWord } from './morphology';
import type { Explanation } from './spelling';
import { words } from './text';
import type { VocabWord } from './types';

const DETERMINERS = new Set(['a', 'an', 'the', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'its', 'our', 'their', 'some', 'many', 'several', 'every', 'each']);
const MODALS = new Set(['can', 'could', 'will', 'would', 'should', 'may', 'might', 'must', "don't", 'did', 'does', 'do']);
const BE = new Set(['is', 'are', 'was', 'were', 'be', 'been', 'being', 'am']);
const HAVE = new Set(['has', 'have', 'had']);
const DEGREE = new Set(['very', 'so', 'too', 'quite', 'extremely', 'really', 'more', 'most', 'less', 'rather']);

/**
 * Explains which clues in the sentence point to the answer: the grammar of the
 * neighboring words (as taught in the guide), the ending the word needs, and
 * partner words recorded in the study materials.
 */
export function contextClues(w: VocabWord, before: string, after: string): Explanation[] {
  const out: Explanation[] = [];
  const prev = words(before).slice(-1)[0];
  const next = words(after)[0];
  const ans = w.word;
  const pos = w.pos;

  if (w.isSmallWord) {
    out.push({
      en: 'Small grammar word: fill these first. In the guide’s count, words like this made up about 4 in 10 Read and Complete gaps.',
      bn: 'ছোট ব্যাকরণগত শব্দ: এগুলো আগে পূরণ করুন। গাইডের হিসাবে Read and Complete-এর প্রায় ১০টির মধ্যে ৪টি ঘর এমন শব্দ।',
    });
  }
  if (prev === 'to' && pos.includes('v') && !/(ed|ing)$/.test(ans)) {
    out.push({ en: 'After “to”, use the base form of a verb.', bn: '“to”-এর পরে ক্রিয়ার মূল রূপ বসে।' });
  } else if (prev && HAVE.has(prev) && pos.includes('v')) {
    out.push({ en: `After “${prev}”, use the past participle (often -ed).`, bn: `“${prev}”-এর পরে past participle বসে (প্রায়ই -ed)।` });
  } else if (prev && BE.has(prev) && /ing$/.test(ans)) {
    out.push({ en: `After “${prev}”, an -ing form shows an action in progress.`, bn: `“${prev}”-এর পরে -ing রূপ চলমান কাজ বোঝায়।` });
  } else if (prev && BE.has(prev) && /ed$/.test(ans)) {
    out.push({ en: `After “${prev}”, an -ed form often shows the passive (something was done).`, bn: `“${prev}”-এর পরে -ed রূপ প্রায়ই কর্মবাচ্য বোঝায়।` });
  } else if (prev && MODALS.has(prev) && pos.includes('v')) {
    out.push({ en: `After “${prev}”, use the base form of a verb.`, bn: `“${prev}”-এর পরে ক্রিয়ার মূল রূপ বসে।` });
  } else if (prev && DETERMINERS.has(prev) && (pos.includes('n') || pos.includes('adj'))) {
    out.push({
      en: `After “${prev}”, expect a noun${pos.includes('adj') ? ' or an adjective before a noun' : ''}.`,
      bn: `“${prev}”-এর পরে বিশেষ্য${pos.includes('adj') ? ' বা বিশেষ্যের আগে বিশেষণ' : ''} বসে।`,
    });
  } else if (prev && DEGREE.has(prev) && (pos.includes('adj') || pos.includes('adv'))) {
    out.push({ en: `“${prev}” comes before an adjective or adverb.`, bn: `“${prev}”-এর পরে বিশেষণ বা ক্রিয়াবিশেষণ বসে।` });
  }

  if (pos.includes('adv') && ans.endsWith('ly')) {
    out.push({ en: 'An adverb describes how something happens; most end in -ly.', bn: 'ক্রিয়াবিশেষণ বলে কাজটা কীভাবে ঘটে; বেশিরভাগের শেষে -ly।' });
  }
  if (pos.includes('n') && /[^s]s$/.test(ans) && !w.isSmallWord && w.base) {
    out.push({ en: 'Plural noun: keep the -s. One wrong ending scores zero.', bn: 'বহুবচন বিশেষ্য: শেষের -s রাখুন। শেষাংশ ভুল হলে নম্বর শূন্য।' });
  }
  if (pos.includes('v') && (/ed$/.test(ans) || IRREGULAR[ans]) && !BE.has(prev ?? '') && !HAVE.has(prev ?? '')) {
    out.push({ en: 'Past tense: the sentence describes something already finished.', bn: 'অতীত কাল: বাক্যটি শেষ হয়ে যাওয়া কাজের কথা বলছে।' });
  }
  if (pos.includes('adj') && !pos.includes('n') && next && !isFunctionWord(next) && prev && (DETERMINERS.has(prev) || DEGREE.has(prev))) {
    out.push({ en: `It describes “${next}”.`, bn: `এটি “${next}”-কে বর্ণনা করছে।` });
  }
  for (const c of w.collocations.slice(0, 2)) {
    out.push({ en: `Partner words from your study materials: ${c}.`, bn: `আপনার পড়ার উপকরণ থেকে সঙ্গী শব্দ: ${c}।` });
  }
  return out;
}
