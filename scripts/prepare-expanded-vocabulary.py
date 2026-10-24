"""Create class maps from pinned upstream metadata; do not invent new labels."""
import argparse
import csv
import hashlib
import json
from pathlib import Path


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--citizen-csv', type=Path, required=True)
    parser.add_argument('--wlasl-classes', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    for path, expected in [
        (args.citizen_csv, '87a105649b98ea577182ebfce49d59fe9ca834a2489384f6fe7bc03f14966329'),
        (args.wlasl_classes, '2c131fb7f052340aa7ae8579c8cae9746028740b8e62efeb957a7790dbefcf4a'),
    ]:
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError(f'Unexpected label source: {path}')
    with args.citizen_csv.open() as handle:
        rows = list(csv.reader(handle))
    citizen = sorted({row[2].strip() for row in rows[1:]})
    wlasl = sorted(line.split('\t')[1] for line in args.wlasl_classes.read_text().splitlines() if line)
    if len(citizen) != 2731 or len(wlasl) != 2000 or len(set(wlasl)) != 2000:
        raise ValueError('Unexpected trained class count')
    args.output.mkdir(parents=True, exist_ok=True)
    for name, labels in [('asl_citizen_labels.json', citizen), ('asl_2000_labels.json', wlasl)]:
        (args.output / name).write_text(json.dumps(labels, indent=2) + '\n')
    print('Generated exact 2,731-class and 2,000-class label maps from upstream metadata.') 

