#!/usr/bin/env python3
"""
Collects the real, openly licensed material the app is built from and writes
compact, attributed files to data/collected/ (these files are committed, so the
normal build never needs the network).

  pip install -r scripts/collect/requirements.txt
  python3 scripts/collect/collect.py

Sources (all downloaded from raw.githubusercontent.com):
  * CommonLit CLEAR corpus (Crossley et al., 2021/2022): reading excerpts with
    their original licences. Only excerpts whose own licence is CC BY or
    CC BY-SA are used (Frontiers for Young Minds, Wikipedia / Simple Wikipedia,
    African Storybook, ...). The corpus itself is CC BY-NC-SA 4.0.
  * OneStopEnglish corpus (Vajjala & Lucic, 2018), CC BY-SA 4.0: news texts
    rewritten for learners. Elementary and advanced versions only (the
    intermediate files and the sentence-aligned files lost their apostrophes).
  * Princeton WordNet 3.0 (via the NLTK data repository): definitions,
    parts of speech and example sentences. WordNet licence (free use).
  * New General Service List 1.2 and New Academic Word List 1.2
    (Browne, Culligan & Phillips), CC BY-SA 4.0.
  * CEFR-J Vocabulary Profile 1.5 (Tono, TUFS; free with citation) and
    Octanove Vocabulary Profile C1/C2 1.0 (CC BY-SA 4.0).
  * wordfreq (Speer, 2022) word frequencies on the Zipf scale (data CC BY-SA 4.0).
  * Apertium English-Bengali bilingual dictionary (apertium-bn-en), GPL-2.0:
    Bengali meanings, matched by part of speech.
  * OpenStax textbooks (Rice University), CC BY-NC-SA 4.0: sections of
    Psychology 2e, Introduction to Sociology 3e, Astronomy 2e, Concepts of
    Biology, U.S. History, World History, Introduction to Anthropology and
    Lifespan Development. Duolingo built its Interactive Reading passages from
    open-access textbooks (Park et al., 2022).
  * ASSET (Alva-Manchego et al., 2020), CC BY-NC 4.0: human simplifications of
    Wikipedia sentences.
  * CEFR-SP (Arase et al., 2022): sentences labelled with CEFR levels; SCoRE
    part (sentences written by native speakers for learners) CC BY-NC-SA 4.0,
    Wiki-Auto part CC BY-SA 3.0.

The ShareAlike / NonCommercial licences mean the collected data (and the app's
vocab.json built from it) may only be shared under those terms, for free.
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'data' / 'external'
OUT = ROOT / 'data' / 'collected'
RAW = 'https://raw.githubusercontent.com'

CLEAR_URL = f'{RAW}/scrosseye/CLEAR-Corpus/main/CLEAR_corpus_final.xlsx'
OSE_BASE = f'{RAW}/nishkalavallabhi/OneStopEnglishCorpus/master/Texts-SeparatedByReadingLevel'
WORDNET_URL = f'{RAW}/nltk/nltk_data/gh-pages/packages/corpora/wordnet.zip'
APERTIUM_URL = f'{RAW}/apertium/apertium-bn-en/master/apertium-bn-en.bn-en.dix'
LISTS = {
    'ngsl': f'{RAW}/agsb/minute/main/lists/ngsl-1.2/NGSL_1.2_stats.csv',
    'nawl': f'{RAW}/agsb/minute/main/lists/ngsl-1.2/NAWL_1.2_stats.csv',
    'cefrj': f'{RAW}/openlanguageprofiles/olp-en-cefrj/master/cefrj-vocabulary-profile-1.5.csv',
    'octanove': f'{RAW}/openlanguageprofiles/olp-en-cefrj/master/octanove-vocabulary-profile-c1c2-1.0.csv',
}

# OneStopEnglish texts whose file names could be listed (100 of the 189). Topics the
# DET's fairness review would avoid (crime, violence, drugs, war, politics, religion,
# disasters, celebrity gossip) are left out.
_UNUSED_OSE_TITLES = [
    'Amazon', 'Amsterdam', 'Anita', 'Arctic mapping', 'Banksy', 'Billionaires', 'Blackberry', 'Bolivia', 'Bonus pay', 'Brazil',
    'Coal to challenge oil', 'Copyright', 'Crowdfunding', 'Denmark', 'Everest', 'Exercise', 'Facebook deserted by millions of users',
    'False memory', 'Fitness', 'Food shortages', 'Gorillas and oil', 'Insects', 'Japan menu', 'Japan', 'Kenya', 'Lie detector',
    'Life expectancy', 'Life on Mars', 'Malala', 'Meteorite', 'Midlife crisis', 'Nepal', 'Norwegian sun', 'Old age', 'Organs',
    'Rats', 'Richard III', 'Skydiver', 'Spain', 'Starbucks', 'Superbugs', 'Swedish prisons', 'Teff', 'WNL 101 year old bottle message',
    'WNL A good night sleep', 'WNL Apple', 'WNL Arctic Ramadan', 'WNL Are MOOCs the future', 'WNL Bangladesh factory owners',
    'WNL Bangladeshi organization', 'WNL Basic phone logs', 'WNL Billionaires', 'WNL Black Friday', 'WNL Bogus Allergy',
    'WNL Bright Future', 'WNL Brown bears', 'WNL Calais Migrants', 'WNL Can the US', 'WNL Canadian Pair', 'WNL Castaway',
    'WNL Changing India', 'WNL Coloring Books', 'WNL Cuba', 'WNL David Bowie', 'WNL David Mitchell', 'WNL Drowning in rubbish',
    'WNL EU Pollution', 'WNL Experience', 'WNL Extinction', 'WNL Extreme heat', 'WNL Fifth of young adults', 'WNL First female coach',
    'WNL First high resolution images', 'WNL Five jobs', 'WNL Four new elements', 'WNL Glastonbury',
]
OSE_SKIP = {'Swedish prisons', 'Malala', 'Richard III', 'WNL Calais Migrants', 'WNL Cuba', 'WNL Arctic Ramadan', 'WNL Bangladesh factory owners'}

OSE_INDEX = f'{RAW}/nishkalavallabhi/OneStopEnglishCorpus/master/allfeatures-ose-final.csv'
OPENSTAX = [
    ('osbooks-psychology', 'psychology-2e', 'Psychology 2e', 'psychology'),
    ('osbooks-introduction-sociology', 'introduction-sociology-3e', 'Introduction to Sociology 3e', 'sociology'),
    ('osbooks-astronomy', 'astronomy-2e', 'Astronomy 2e', 'astronomy'),
    ('osbooks-biology-bundle', 'concepts-biology', 'Concepts of Biology', 'biology'),
    ('osbooks-us-history', 'us-history', 'U.S. History', 'history'),
    ('osbooks-world-history', 'world-history-volume-1', 'World History, Volume 1', 'history'),
    ('osbooks-introduction-anthropology', 'introduction-anthropology', 'Introduction to Anthropology', 'anthropology'),
    ('osbooks-lifespan-development', 'lifespan-development', 'Lifespan Development', 'psychology'),
]
OPENSTAX_MODULES_PER_BOOK = 70
ASSET_FILES = [f'{RAW}/facebookresearch/asset/main/dataset/asset.{part}.simp.{i}' for part in ('valid', 'test') for i in range(10)]
CEFRSP = {
    'cefrsp-score': (f'{RAW}/yukiar/CEFR-SP/main/CEFR-SP/SCoRE/CEFR-SP_SCoRE_{{}}.txt', 'CC BY-NC-SA 4.0'),
    'cefrsp-wiki': (f'{RAW}/yukiar/CEFR-SP/main/CEFR-SP/Wiki-Auto/CEFR-SP_Wikiauto_{{}}.txt', 'CC BY-SA 3.0'),
}

OPEN_LICENCE = re.compile(r'^CC[- ]?BY(?:[- ]SA)?(?:[- ]\d\.\d)?(?: and GFDL)?$', re.I)


def fetch(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    print(f'  downloading {url}', file=sys.stderr)
    with urllib.request.urlopen(url, timeout=120) as r:
        data = r.read()
    dest.write_bytes(data)
    return dest


def clean(text: str) -> str:
    text = unicodedata.normalize('NFC', text).replace('﻿', '').replace('\r', '')
    text = text.replace(' ', ' ').replace(' ', ' ').replace('​', '')
    text = re.sub(r'\[\d+\]', '', text)  # Wikipedia footnote marks
    text = re.sub(r'[ \t]+', ' ', text)
    paras = [p.strip() for p in text.split('\n') if p.strip()]
    return '\n\n'.join(paras)


def difficulty_from_easiness(bt: float) -> str:
    # CLEAR BT_easiness: higher = easier. Roughly thirds of the openly licensed texts.
    if bt >= -0.6:
        return 'easy'
    if bt >= -1.4:
        return 'intermediate'
    return 'advanced'


def collect_clear() -> list[dict]:
    import openpyxl

    path = fetch(CLEAR_URL, CACHE / 'CLEAR_corpus_final.xlsx')
    wb = openpyxl.load_workbook(path, read_only=True)
    rows = wb.active.iter_rows(values_only=True)
    hdr = next(rows)
    out = []
    for r in rows:
        d = dict(zip(hdr, r))
        lic = (d.get('License') or '').strip()
        if not OPEN_LICENCE.match(lic):
            continue
        text = clean(str(d.get('Excerpt') or ''))
        if not text:
            continue
        url = (d.get('URL') or '').strip()
        try:
            bt = float(d.get('BT_easiness'))
        except (TypeError, ValueError):
            bt = -1.0
        title = re.sub(r'\s+', ' ', str(d.get('Title') or '').replace('_', ' ')).strip()
        author = re.sub(r'\s+', ' ', str(d.get('Author') or '')).strip()
        host = re.sub(r'^https?://(www\.)?([^/]+).*$', r'\2', url) if url else ''
        sub = (d.get('Sub Cat') or '').strip()
        out.append({
            'id': f'clear-{d.get("ID")}',
            'corpus': 'clear',
            'title': title,
            'author': author if author and author.lower() not in ('none', 'unknown') else None,
            'url': url or None,
            'license': lic.replace('CC-BY-SA', 'CC BY-SA'),
            'credit': f'“{title}”' + (f', {author}' if author and author.lower() not in ('none', 'unknown') else '') + (f' ({host})' if host else '') + f', {lic}; via the CommonLit CLEAR corpus',
            'genre': 'narrative' if d.get('Categ') == 'Lit' else 'expository',
            'topic': sub.lower() if sub else ('story' if d.get('Categ') == 'Lit' else 'general'),
            'difficulty': difficulty_from_easiness(bt),
            'text': text,
        })
    return out


def ose_titles() -> list[str]:
    """All OneStopEnglish text names, from the corpus's own feature index (it writes spaces as hyphens)."""
    path = fetch(OSE_INDEX, CACHE / 'ose' / 'allfeatures-ose-final.csv')
    names = set()
    for line in path.read_text(encoding='utf-8', errors='replace').splitlines()[1:]:
        name = line.split(',')[0]
        m = re.match(r'^(.*)-(ele|int|adv)\.txt$', name)
        if m:
            names.add(m.group(1))
    return sorted(names)


OSE_BLOCK = re.compile(r'gang|violence|drug|murder|nsa|syria|kashmir|ferguson|hillsborough|thatcher|obama|pope|prince|royal|kate|liberia|ebola|cigarette|e-cig|lotter|shutdown|criminal|fifa|prison|malala|richard|migrant|cuba|ramadan|factory|isis|terror|war|gun|police|election|putin|trump', re.I)


def collect_ose() -> list[dict]:
    out = []
    for stem in ose_titles():
        if OSE_BLOCK.search(stem):
            continue
        for level, folder, diff in (('ele', 'Ele-Txt', 'easy'), ('adv', 'Adv-Txt', 'advanced')):
            path = None
            for candidate in dict.fromkeys([stem.replace('-', ' '), stem]):
                name = urllib.parse.quote(f'{candidate}-{level}.txt')
                try:
                    path = fetch(f'{OSE_BASE}/{folder}/{name}', CACHE / 'ose' / folder / f'{candidate}-{level}.txt')
                    break
                except Exception:
                    continue
            if path is None:
                print(f'  skipped {stem}-{level}: not found', file=sys.stderr)
                continue
            raw = path.read_text(encoding='utf-8', errors='replace')
            lines = [l for l in raw.split('\n') if l.strip() and l.strip().lower() not in ('elementary', 'intermediate', 'advanced')]
            text = clean('\n'.join(lines))
            nice = re.sub(r'^WNL\s+', '', stem.replace('-', ' '))
            out.append({
                'id': f'ose-{re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-")}-{level}',
                'corpus': 'ose',
                'title': nice[:1].upper() + nice[1:],
                'author': None,
                'url': 'https://github.com/nishkalavallabhi/OneStopEnglishCorpus',
                'license': 'CC BY-SA 4.0',
                'credit': f'“{nice}” ({"elementary" if level == "ele" else "advanced"} version), OneStopEnglish corpus (Vajjala & Lučić, 2018), CC BY-SA 4.0',
                'genre': 'expository',
                'topic': 'news',
                'difficulty': diff,
                'text': text,
            })
    return out


CNX = '{http://cnx.rice.edu/cnxml}'
MD = '{http://cnx.rice.edu/mdml}'
SKIP_TAGS = {'note', 'exercise', 'figure', 'table', 'list', 'example', 'glossary', 'equation', 'media', 'footnote', 'quote', 'code', 'preformat'}


def cnx_text(el) -> str:
    parts = [el.text or '']
    for child in el:
        tag = child.tag.replace(CNX, '')
        if tag in ('footnote', 'media', 'math') or child.tag.endswith('math'):
            pass
        elif tag == 'link' and not (child.text or len(child)):
            pass
        else:
            parts.append(cnx_text(child))
        parts.append(child.tail or '')
    return ''.join(parts)


def tidy_para(t: str) -> str:
    t = re.sub(r'\s+', ' ', t).strip()
    t = re.sub(r'\s*\((?:[^()]*\d{4}[^()]*|see [^()]*|[^()]{0,3})\)', '', t)  # citations, "(see …)", empty figure links
    t = re.sub(r'\s+([,.;:])', r'\1', t)
    return t.strip()


def collect_openstax() -> list[dict]:
    import xml.etree.ElementTree as ET
    from concurrent.futures import ThreadPoolExecutor

    out = []
    for repo, slug, book, topic in OPENSTAX:
        coll = fetch(f'{RAW}/openstax/{repo}/main/collections/{slug}.collection.xml', CACHE / 'openstax' / repo / f'{slug}.collection.xml')
        ids = re.findall(r'document="(m\d+)"', coll.read_text(encoding='utf-8'))
        # skip the preface and chapter introductions (first module of each chapter is usually "Introduction")
        ids = ids[1:OPENSTAX_MODULES_PER_BOOK + 1]

        def get(mid: str):
            try:
                return mid, fetch(f'{RAW}/openstax/{repo}/main/modules/{mid}/index.cnxml', CACHE / 'openstax' / repo / f'{mid}.cnxml')
            except Exception:
                return mid, None

        with ThreadPoolExecutor(max_workers=8) as pool:
            files = list(pool.map(get, ids))
        for mid, path in files:
            if path is None:
                continue
            try:
                root = ET.parse(path).getroot()
            except ET.ParseError:
                continue
            mtitle = (root.findtext(f'{CNX}title') or '').strip()
            if not mtitle or mtitle.lower().startswith(('introduction', 'key terms', 'summary', 'review', 'critical thinking', 'personal application')):
                continue
            content = root.find(f'{CNX}content')
            if content is None:
                continue
            # one text per section (or the module's own leading paragraphs)
            groups: list[tuple[str, list[str]]] = [(mtitle, [])]

            def walk(el, title):
                for child in el:
                    tag = child.tag.replace(CNX, '')
                    if tag in SKIP_TAGS:
                        continue
                    if tag == 'section':
                        st = (child.findtext(f'{CNX}title') or title).strip()
                        groups.append((st, []))
                        walk(child, st)
                    elif tag == 'para':
                        t = tidy_para(cnx_text(child))
                        if len(t.split()) >= 25:
                            groups[-1][1].append(t)

            walk(content, mtitle)
            generic = re.compile(r'^(learning objectives|thinking ahead|link to learning|introduction|summary|key terms|review questions|everyday connection|dig deeper|career connection|the big picture)$', re.I)
            for k, (title, paras) in enumerate(groups):
                if not paras:
                    continue
                if generic.match(title.strip()):
                    title = mtitle
                out.append({
                    'id': f'ostx-{slug}-{mid}-{k}',
                    'corpus': 'openstax',
                    'title': title,
                    'author': None,
                    'url': f'https://openstax.org/details/books/{slug}',
                    'license': 'CC BY-NC-SA 4.0',
                    'credit': f'“{title}”, {book}, OpenStax (Rice University), CC BY-NC-SA 4.0',
                    'genre': 'expository',
                    'topic': topic,
                    'difficulty': 'advanced',
                    'text': '\n\n'.join(paras),
                })
    return out


def detok(s: str) -> str:
    s = re.sub(r'\s+([.,!?;:%)\]])', r'\1', s)
    s = re.sub(r'([(\[$])\s+', r'\1', s)
    s = re.sub(r"\s+(n't|'s|'re|'ve|'ll|'d|'m)\b", r'\1', s)
    s = re.sub(r'\s+(-)\s+', r'\1', s)
    s = s.replace('`` ', '"').replace(" ''", '"')
    return s.strip()


def collect_sentences() -> list[dict]:
    """Single sentences (no surrounding text): ASSET simplifications and CEFR-SP."""
    out = []
    seen = set()
    for url in ASSET_FILES:
        try:
            path = fetch(url, CACHE / 'asset' / url.rsplit('/', 1)[1])
        except Exception as e:
            print(f'  skipped {url}: {e}', file=sys.stderr)
            continue
        for line in path.read_text(encoding='utf-8', errors='replace').splitlines():
            t = re.sub(r'\s+', ' ', line).strip()
            if t and t not in seen:
                seen.add(t)
                out.append({'s': t, 'src': 'asset'})
    level = {'1': 'A1', '2': 'A2', '3': 'B1', '4': 'B2', '5': 'C1', '6': 'C2'}
    for src, (pattern, _lic) in CEFRSP.items():
        for part in ('train', 'dev', 'test'):
            url = pattern.format(part)
            try:
                path = fetch(url, CACHE / 'cefrsp' / f'{src}-{part}.txt')
            except Exception as e:
                print(f'  skipped {url}: {e}', file=sys.stderr)
                continue
            for line in path.read_text(encoding='utf-8', errors='replace').splitlines():
                cols = line.split('\t')
                if len(cols) < 2:
                    continue
                t = detok(cols[0])
                if t and t not in seen:
                    seen.add(t)
                    out.append({'s': t, 'src': src, 'cefr': level.get(cols[1].strip(), '')})
    return out


SENTENCE_SOURCES = [
    {'id': 'asset', 'corpus': 'asset', 'title': 'ASSET simplified sentences', 'author': 'Alva-Manchego et al. (2020)', 'url': 'https://github.com/facebookresearch/asset', 'license': 'CC BY-NC 4.0',
     'credit': 'ASSET corpus of human-simplified Wikipedia sentences (Alva-Manchego et al., 2020), CC BY-NC 4.0', 'genre': 'expository', 'topic': 'general', 'difficulty': 'intermediate', 'text': ''},
    {'id': 'cefrsp-score', 'corpus': 'cefrsp', 'title': 'CEFR-SP (SCoRE) learner sentences', 'author': 'Arase, Uchida & Kajiwara (2022)', 'url': 'https://github.com/yukiar/CEFR-SP', 'license': 'CC BY-NC-SA 4.0',
     'credit': 'CEFR-SP corpus, SCoRE sentences written by native speakers for learners (Arase et al., 2022), CC BY-NC-SA 4.0', 'genre': 'expository', 'topic': 'general', 'difficulty': 'easy', 'text': ''},
    {'id': 'cefrsp-wiki', 'corpus': 'cefrsp', 'title': 'CEFR-SP (Wiki-Auto) sentences', 'author': 'Arase, Uchida & Kajiwara (2022)', 'url': 'https://github.com/yukiar/CEFR-SP', 'license': 'CC BY-SA 3.0',
     'credit': 'CEFR-SP corpus, Wikipedia sentences (Arase et al., 2022), CC BY-SA 3.0', 'genre': 'expository', 'topic': 'general', 'difficulty': 'intermediate', 'text': ''},
]


def load_lists() -> dict:
    lists: dict[str, dict[str, str]] = {}
    for key, url in LISTS.items():
        path = fetch(url, CACHE / 'lists' / f'{key}.csv')
        text = path.read_text(encoding='utf-8-sig', errors='replace')
        rows = list(csv.reader(io.StringIO(text)))
        hdr = [h.strip().lstrip('.').lower() for h in rows[0]]
        entries: dict[str, str] = {}
        for r in rows[1:]:
            if not r or not r[0].strip():
                continue
            d = dict(zip(hdr, r))
            head = (d.get('lemma') or d.get('word') or d.get('headword') or '').strip()
            if key in ('cefrj', 'octanove'):
                for h in head.split('/'):
                    h = h.strip().lower()
                    if re.fullmatch(r'[a-z]+', h):
                        level = d.get('cefr', '').strip()
                        prev = entries.get(h)
                        if not prev or level < prev:
                            entries[h] = level + ':' + d.get('pos', '').strip()
            else:
                h = head.lower()
                if re.fullmatch(r'[a-z]+', h):
                    entries[h] = (d.get('sfi rank') or d.get('rank') or '').strip()
        lists[key] = entries
    return lists


def wordnet():
    import nltk

    zpath = fetch(WORDNET_URL, CACHE / 'nltk_data' / 'corpora' / 'wordnet.zip')
    target = CACHE / 'nltk_data' / 'corpora' / 'wordnet'
    if not target.exists():
        with zipfile.ZipFile(zpath) as z:
            z.extractall(target.parent)
    nltk.data.path.insert(0, str(CACHE / 'nltk_data'))
    from nltk.corpus import wordnet as wn

    wn.ensure_loaded()
    return wn


WN_POS = {'n': 'n', 'v': 'v', 'a': 'adj', 's': 'adj', 'r': 'adv'}
APERTIUM_POS = {'n': 'n', 'vblex': 'v', 'adj': 'adj', 'adv': 'adv'}


def apertium() -> dict[str, dict[str, list[str]]]:
    """English lemma -> part of speech -> Bengali equivalents (in dictionary order)."""
    import xml.etree.ElementTree as ET

    path = fetch(APERTIUM_URL, CACHE / 'apertium-bn-en.bn-en.dix')
    root = ET.parse(path).getroot()
    out: dict[str, dict[str, list[str]]] = {}

    def text_of(el) -> str:
        parts = [el.text or '']
        for child in el:
            if child.tag == 'b':
                parts.append(' ')
            parts.append(child.tail or '')
        return ''.join(parts).strip()

    for e in root.iter('e'):
        if e.get('r') == 'RL':  # only usable from English to Bengali in the other direction
            pass
        p = e.find('p')
        if p is None:
            continue
        l, r = p.find('l'), p.find('r')
        if l is None or r is None:
            continue
        tags = [x.get('n') for x in r.findall('s')]
        if not tags or tags[0] not in APERTIUM_POS or 'np' in tags:
            continue
        en = text_of(r).lower()
        bn = text_of(l)
        if not re.fullmatch(r'[a-z]+', en) or not bn or re.search(r'[A-Za-z]', bn):
            continue
        lst = out.setdefault(en, {}).setdefault(APERTIUM_POS[tags[0]], [])
        if bn not in lst:
            lst.append(bn)
    return out


def clean_gloss(g: str) -> str:
    g = g.split(';')[0].strip()
    g = re.sub(r'\s*\(\s*\)', '', g)
    return g


STOP = set('a an the of to in on at for and or but with by from as is are was were be been being it its this that these those which who whom whose what when where why how not no can could may might must shall should will would do does did has have had he she they we you i his her their our your my me him them us so than then there here such some any all each every one two more most other into about over after before under up down out off very just also only same both few many much own'.split())


def senses_of(w: str, wn) -> list:
    """Up to 4 senses per part of speech, with signature words for choosing the sense that fits the practice sentences."""
    out = []
    per: dict[str, int] = {}
    for syn in wn.synsets(w):
        p = WN_POS[syn.pos()]
        base = wn.morphy(w, syn.pos()) or w
        if not any(l.name().lower() in (w, base) for l in syn.lemmas()):
            continue
        if per.get(p, 0) >= 4:
            continue
        per[p] = per.get(p, 0) + 1
        bag = ' '.join([syn.definition(), *syn.examples(), *[l.name() for l in syn.lemmas()], *[l.name() for h in syn.hypernyms() for l in h.lemmas()]])
        sig = sorted({t for t in re.findall(r'[a-z]+', bag.lower().replace('_', ' ')) if len(t) > 2 and t not in STOP and t != w and t != base})
        out.append({'p': p, 'g': clean_gloss(syn.definition()), 'sig': sig[:40]})
    return out


def lexicon(words: set[str], wn) -> dict:
    """Frequency, parts of speech, the most common WordNet sense per part of speech, and examples."""
    from wordfreq import zipf_frequency

    out = {}
    for w in sorted(words):
        entry: dict = {'z': round(zipf_frequency(w, 'en'), 2)}
        pos: list[str] = []
        best: dict[str, tuple[int, int, str]] = {}
        examples: list[str] = []
        for order, syn in enumerate(wn.synsets(w)):
            p = WN_POS[syn.pos()]
            base = wn.morphy(w, syn.pos()) or w
            match = [l for l in syn.lemmas() if l.name().lower() in (w, base)]
            if not match:
                continue
            if p not in pos:
                pos.append(p)
            # WordNet orders senses by frequency, but the tagged-corpus count of the
            # lemma in each sense is a better guide to the everyday meaning.
            count = max(l.count() for l in match)
            cand = (count, -order, clean_gloss(syn.definition()))
            if p not in best or cand[:2] > best[p][:2]:
                best[p] = cand
            for ex in syn.examples():
                if re.search(rf'\b{re.escape(w)}\b', ex, re.I) and ex not in examples:
                    examples.append(ex)
        lemmas = sorted({b for p in ('n', 'v', 'a', 'r') for b in [wn.morphy(w, p)] if b and b != w})
        if lemmas:
            entry['lemmas'] = lemmas
        if pos:
            entry['pos'] = pos
            entry['def'] = {p: v[2] for p, v in best.items()}
            entry['senses'] = senses_of(w, wn)
        if examples:
            entry['ex'] = examples[:6]
        out[w] = entry
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    print('CLEAR corpus …', file=sys.stderr)
    texts = collect_clear()
    print(f'  {len(texts)} openly licensed excerpts', file=sys.stderr)
    print('OneStopEnglish corpus …', file=sys.stderr)
    ose = collect_ose()
    print(f'  {len(ose)} texts', file=sys.stderr)
    texts += ose
    print('OpenStax textbooks …', file=sys.stderr)
    ostx = collect_openstax()
    print(f'  {len(ostx)} sections', file=sys.stderr)
    texts += ostx
    texts += SENTENCE_SOURCES
    (OUT / 'texts.json').write_text(json.dumps(texts, ensure_ascii=False, indent=0), encoding='utf-8')
    print('Single sentences (ASSET, CEFR-SP) …', file=sys.stderr)
    sents = collect_sentences()
    print(f'  {len(sents)} sentences', file=sys.stderr)
    (OUT / 'sentences.json').write_text(json.dumps(sents, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

    print('Word lists …', file=sys.stderr)
    lists = load_lists()
    for k, v in lists.items():
        print(f'  {k}: {len(v)}', file=sys.stderr)

    extracted = json.loads((ROOT / 'data' / 'generated' / 'extracted.json').read_text(encoding='utf-8'))
    words = {w['word'] for w in extracted['words']}
    for v in lists.values():
        words |= set(v)
    print('WordNet and frequencies …', file=sys.stderr)
    wn = wordnet()
    lex = lexicon(words, wn)
    for key, entries in lists.items():
        for w, val in entries.items():
            lex.setdefault(w, {})
            if key in ('cefrj', 'octanove'):
                level, _, pos = val.partition(':')
                lex[w]['cefr'] = level
                lex[w].setdefault('cefrPos', pos)
            else:
                lex[w].setdefault('lists', []).append(key)
    bn = apertium()
    print(f'  Apertium bn-en: {len(bn)} English lemmas', file=sys.stderr)
    for w, entry in lex.items():
        hit = bn.get(w)
        if not hit:
            for lemma in entry.get('lemmas', []):
                if lemma in bn:
                    hit = bn[lemma]
                    entry['bnVia'] = lemma
                    break
        if hit:
            entry['bn'] = hit
    (OUT / 'lexicon.json').write_text(json.dumps(lex, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'Wrote {len(texts)} texts and {len(lex)} lexicon entries to {OUT}', file=sys.stderr)


if __name__ == '__main__':
    main()
