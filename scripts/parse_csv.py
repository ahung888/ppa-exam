#!/usr/bin/env python3
"""Parse all raw CSVs into data/questions.js (window.QUESTIONS)."""

import csv
import json
import os
import re

RAW_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'raw')
OUT_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'questions.js')


def parse_topic_type(filename):
    base = os.path.splitext(filename)[0]
    if ' - ' in base:
        base = base.split(' - ', 1)[1]
    if base.endswith('-是非題'):
        return base[:-4], 'tf'
    if base.endswith('-選擇題'):
        return base[:-4], 'mc'
    return base, 'unknown'


def parse_mc_options(text):
    """Split 'stem (1)opt1 (2)opt2 ...' into (stem, [opt1, opt2, ...])."""
    match = re.search(r'\s*\(1\)', text)
    if not match:
        return text.strip(), None
    stem = text[:match.start()].strip()
    options_text = text[match.start():]
    parts = re.split(r'\s*\(\d+\)\s*', options_text)
    options = [p.strip() for p in parts if p.strip()]
    return stem, options if len(options) >= 2 else None


def infer_type(answer):
    """Infer question type from the answer value."""
    if answer in ('O', 'X'):
        return 'tf'
    if answer.isdigit():
        return 'mc'
    return None


def parse_csv_file(filepath, default_type, topic):
    """Parse a CSV that may contain multiple sections (e.g. MC then TF)."""
    results = []
    current_type = default_type
    headers = None

    with open(filepath, newline='', encoding='utf-8-sig') as f:
        reader = csv.reader(f)
        for row in reader:
            if not row or all(c.strip() == '' for c in row):
                continue

            first = row[0].strip()

            # Section separator rows like "是非題,," or "選擇題,,"
            if '是非題' in first and all(c.strip() == '' for c in row[1:]):
                current_type = 'tf'
                headers = None
                continue
            if '選擇題' in first and all(c.strip() == '' for c in row[1:]):
                current_type = 'mc'
                headers = None
                continue

            # Header row
            if first == '編號':
                headers = [c.strip() for c in row]
                continue

            if not headers:
                continue

            data = {headers[i]: (row[i].strip() if i < len(row) else '') for i in range(len(headers))}
            num = data.get('編號', '')
            answer = data.get('答案', '')
            raw_text = data.get('試題', '')
            law_ref = (data.get('依據法源', '') or '').strip() or None

            if not raw_text or not answer:
                continue

            # Infer type from answer if in a mixed section
            qtype = infer_type(answer) or current_type

            if qtype == 'mc':
                stem, options = parse_mc_options(raw_text)
            else:
                stem, options = raw_text, None

            results.append({
                'id': f'{topic}_{qtype}_{num}',
                'topic': topic,
                'type': qtype,
                'question': stem,
                'options': options,
                'answer': answer,
                'law_ref': law_ref,
            })

    return results


questions = []
file_count = 0

for filename in sorted(os.listdir(RAW_DIR)):
    if not filename.endswith('.csv'):
        continue
    topic, default_type = parse_topic_type(filename)
    filepath = os.path.join(RAW_DIR, filename)
    file_count += 1
    questions.extend(parse_csv_file(filepath, default_type, topic))

# Deduplicate by ID, keeping first occurrence
seen_ids = set()
unique = []
for q in questions:
    if q['id'] not in seen_ids:
        seen_ids.add(q['id'])
        unique.append(q)
dedup_count = len(questions) - len(unique)
questions = unique

with open(OUT_FILE, 'w', encoding='utf-8') as f:
    f.write('window.QUESTIONS = ')
    json.dump(questions, f, ensure_ascii=False, indent=2)
    f.write(';\n')

# Summary
by_type = {'tf': 0, 'mc': 0}
for q in questions:
    by_type[q['type']] = by_type.get(q['type'], 0) + 1
mc_no_opts = sum(1 for q in questions if q['type'] == 'mc' and not q.get('options'))
print(f'Parsed {file_count} files → {len(questions)} questions → data/questions.js')
print(f'  TF: {by_type.get("tf", 0)}  MC: {by_type.get("mc", 0)}')
if dedup_count:
    print(f'  Removed {dedup_count} duplicate questions')
if mc_no_opts:
    print(f'  WARNING: {mc_no_opts} MC questions have no options parsed')
