"""Prepare a small deterministic held-out pose spot check, locally only.

Requires requests, numpy, pose-format==0.13.0. Uses original test CSV membership;
does not download recordings or put participant data in the application.
"""
import argparse
import csv
import hashlib
import json
from pathlib import Path
from urllib.parse import quote

import numpy as np
from pose_format import Pose
import requests

REVISION = '06068a7ce431c3d1482aea838e8d918ba1eb5853'
COMMON = {'HELLO', 'WATER', 'PLEASE', 'THANKYOU', 'HELP', 'WANT', 'FOOD', 'HOME', 'WORK',
          'MOTHER', 'FATHER', 'FRIEND', 'YES', 'NO', 'SORRY', 'GOOD', 'HAPPY', 'SCHOOL', 'APPLE', 'DRINK'}


def main(args):
    expected = 'b1dee8f81204895ca1760f6bd582eec84cf390b9c97c4387e49b9cc6b906b21e'
    if hashlib.sha256(args.test_csv.read_bytes()).hexdigest() != expected:
        raise ValueError('Unexpected test split')
    with args.test_csv.open() as handle:
        rows = list(csv.reader(handle))[1:]
    split = {row[1].split('-')[0].replace('.', ''): row[2].strip() for row in rows}
    response = requests.get(f'https://huggingface.co/api/datasets/SorensenAI/asl-citizen-poses/tree/{REVISION}/poses_batches/batch_001?limit=1000', timeout=30)
    response.raise_for_status()
    available = [(item['path'], split[Path(item['path']).name.split('-')[0]]) for item in response.json()
                 if Path(item['path']).name.split('-')[0] in split]
    available.sort(key=lambda pair: (pair[1] not in COMMON, pair[0]))
    selected, seen = [], set()
    for path, gloss in available:
        if gloss in seen:
            continue
        selected.append((path, gloss)); seen.add(gloss)
        if len(selected) == args.count + args.offset:
            break
    selected = selected[args.offset:args.offset + args.count]
    if len(selected) != args.count:
        raise ValueError('Not enough distinct held-out glosses in this batch')
    args.output.mkdir(parents=True, exist_ok=True)
    records = []
    for path, gloss in selected:
        url = f'https://huggingface.co/datasets/SorensenAI/asl-citizen-poses/resolve/{REVISION}/{quote(path)}'
        response = requests.get(url, timeout=60)
        response.raise_for_status()
        pose = Pose.read(response.content)
        points = pose.body.data.filled(0)[:, 0]
        confidence = pose.body.confidence[:, 0]
        width, height = pose.header.dimensions.width, pose.header.dimensions.height
        components, cursor = {}, 0
        for component in pose.header.components:
            components[component.name] = slice(cursor, cursor + len(component.points))
            cursor += len(component.points)

        def landmarks(t, name):
            selection = components[name]
            return [{'x': float(x / width), 'y': float(y / height), 'z': float(z),
                     'visibility': float(confidence[t, selection][i])}
                    for i, (x, y, z) in enumerate(points[t, selection])]

        frames = []
        for t in range(len(points)):
            hands = []
            for side in ['Left', 'Right']:
                name = f'{side.upper()}_HAND_LANDMARKS'
                if np.any(points[t, components[name], :2]):
                    hands.append({'side': side, 'score': 1, 'landmarks': landmarks(t, name)})
            frames.append({'timestampMs': t * 1000 / pose.body.fps, 'width': width, 'height': height,
                           'pose': landmarks(t, 'POSE_LANDMARKS'), 'hands': hands, 'face': [],
                           'blendshapes': {}, 'inferenceMs': 0})
        records.append({'gloss': gloss, 'sourceSha256': hashlib.sha256(response.content).hexdigest(), 'frames': frames})
        print(gloss, len(frames), flush=True)
    (args.output / 'heldout.json').write_text(json.dumps({'datasetRevision': REVISION,
        'selection': {'count': args.count, 'offset': args.offset, 'commonLabelsPreferred': True}, 'records': records}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--test-csv', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--count', type=int, default=12)
    parser.add_argument('--offset', type=int, default=0, help='Skip earlier glosses for a disjoint check')
    args = parser.parse_args()
    if not 1 <= args.count <= 100 or args.offset < 0:
        parser.error('Use 1–100 examples and a nonnegative offset')
    main(args) 

