"""Compare held-out pose samples with the unmodified upstream dataset/model."""
import argparse
import csv
import importlib.util
import json
from pathlib import Path
import sys
import tempfile

import numpy as np
import torch

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path, required=True)
parser.add_argument('--data', type=Path, required=True)
args = parser.parse_args()
sys.path.insert(0, str(args.source))
from architecture.st_gcn import STGCN
from architecture.fc import FC
from architecture.network import Network
conversion_spec = importlib.util.spec_from_file_location('citizen_conversion', Path(__file__).with_name('convert-citizen-model.py'))
conversion = importlib.util.module_from_spec(conversion_spec); conversion_spec.loader.exec_module(conversion)
EDGES, REFERENCE_SHA, SOURCE_SHA, verify = conversion.EDGES, conversion.REFERENCE_SHA, conversion.SOURCE_SHA, conversion.verify

for name, digest in REFERENCE_SHA.items():
    verify(args.source / name, digest)
verify(args.source / 'ASL_citizen_stgcn_weights.pt', SOURCE_SHA)
model = Network(STGCN(2, {'num_nodes': 27, 'center': 0, 'inward_edges': EDGES}, True), FC(256, 2731, 0.05)).double().eval()
model.load_state_dict(torch.load(args.source / 'ASL_citizen_stgcn_weights.pt', map_location='cpu', weights_only=True), strict=True)
spec = importlib.util.spec_from_file_location('upstream_dataset', args.source / 'dataset.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
labels = json.loads((Path(__file__).resolve().parents[1] / 'assets/models/asl_citizen_labels.json').read_text())
heldout = json.loads((args.data / 'heldout.json').read_text())
results = []
for record in heldout['records']:
    raw = np.zeros((len(record['frames']), 543, 2), np.float64)
    for i, frame in enumerate(record['frames']):
        for j, point in enumerate(frame['pose']): raw[i, j] = [point['x'], point['y']]
        for hand in frame['hands']:
            start = 33 if hand['side'] == 'Right' else 54
            for j, point in enumerate(hand['landmarks']): raw[i, start + j] = [point['x'], point['y']]
    row = {'expected': record['gloss']}
    for swapped in [False, True]:
        data = raw.copy()
        if swapped: data[:, 33:54], data[:, 54:75] = raw[:, 54:75], raw[:, 33:54]
        with tempfile.TemporaryDirectory(prefix='citizen-reference-') as folder:
            folder = Path(folder); np.save(folder / 'fixture.npy', data)
            (folder / 'mapping.csv').write_text('fixture.mp4,fixture.npy\n')
            (folder / 'split.csv').write_text('Participant ID,Video file,Gloss\nTEST,fixture.mp4,TEST\n')
            dataset = module.ASLCitizen(str(folder) + '/', str(folder / 'split.csv'), gloss_dict={'TEST': 0}, pose_map_file=str(folder / 'mapping.csv'))
            inputs = dataset[0][0]
        with torch.no_grad(): scores = model(inputs[None]).numpy()[0]
        row['swapped' if swapped else 'original'] = labels[int(scores.argmax())]
    results.append(row); print(row, flush=True)
(args.data / 'reference-report.json').write_text(json.dumps(results, indent=2) + '\n') 

