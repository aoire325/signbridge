"""Derive the 500-word app allowlist without changing any trained class index.

Usage: python3 scripts/prepare-common-vocabulary.py /path/to/signdata-11-5-20.csv
Pinned source and license are recorded in the output manifest. No network I/O.
"""
import csv
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'https://raw.githubusercontent.com/ASL-LEX/asl-lex/2d74fb6cb4a4209702ef5c18b211e937144ad1fb/data-analysis/scripts/data/signdata-11-5-20.csv'
SOURCE_SHA256 = 'fce376594919f6b25ddb1275c721cee77aae31a8b016e02e2fd82172a33f9443'


def key(word):
    return re.sub(r'[^a-z0-9]', '', re.sub(r'_\d+$', '', word.lower()))


def main():
    source = Path(sys.argv[1])
    if hashlib.sha256(source.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise ValueError('Source hash differs from the reviewed ASL-LEX snapshot.')
    original = json.loads((ROOT / 'assets/models/asl_1000_labels.json').read_text())
    ratings = {}
    with source.open(encoding='utf-8-sig', newline='') as stream:
        for row in csv.DictReader(stream):
            try:
                score = float(row['SignFrequency(M)'])
                raters = int(row['SignFrequency(N)'])
            except (ValueError, KeyError):
                continue
            if not 1 <= score <= 7 or raters <= 0:
                continue
            normalized = key(row['EntryID'])
            candidate = {'entry': row['EntryID'], 'meanFrequency': score, 'raters': raters}
            if normalized not in ratings or score > ratings[normalized]['meanFrequency']:
                ratings[normalized] = candidate
    ranked = sorted((word for word in original if key(word) in ratings), key=lambda w: (-ratings[key(w)]['meanFrequency'], w))
    assert len(ranked) >= 500
    selected = sorted(ranked[:500])
    assert len(selected) == 500
    labels = ROOT / 'assets/models/asl_common_500_labels.json'
    labels.write_text(json.dumps(selected, indent=2) + '\n')
    manifest = {
        'source': SOURCE, 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'sourcePage': 'https://asl-lex.org/download.html', 'sourceLicense': 'CC BY 4.0 per the current ASL-LEX download page; historical repository README says CC BY-NC 4.0.',
        'policy': 'Match existing WLASL1000 glosses to ASL-LEX EntryID (ignore punctuation and trailing _variant number). Rank by highest mean subjective sign-frequency rating across matched variants, descending; break ties alphabetically. Select the first 500 strictly by rank, with no exceptions. Alphabetize display only.',
        'limitations': 'Subjective ratings and English gloss matching, not corpus counts or a universal ASL frequency ranking. A matched variant may differ from the model training variant. No claim about recognition accuracy follows from frequency.',
        'matchedOriginalEntries': len(ranked), 'retainedUserWords': [],
        'entries': [{'word': word, **ratings[key(word)]} for word in selected],
    }
    (ROOT / 'assets/models/asl_common_500_manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Wrote {len(selected)} words from {len(ranked)} matched entries.')


if __name__ == '__main__':
    main()
