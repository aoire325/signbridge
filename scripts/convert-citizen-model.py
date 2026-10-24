"""Reproduce the pinned ASL Citizen ST-GCN in float32 TFLite.

Two environments may be used: `reference` requires torch/numpy; `convert`
requires tensorflow/numpy. No source video is needed. The app stays offline.
"""
import argparse
import csv
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import time

import numpy as np

SOURCE_SHA = 'b08d84afb5a0fdf4c723fd7be2db897b2490a921ccf538cff1b345f905934d68'
CSV_SHA = '87a105649b98ea577182ebfce49d59fe9ca834a2489384f6fe7bc03f14966329'
REFERENCE_SHA = {
    'architecture/fc.py': '222a47d366c8c236974210efc295a3d0f5f447a35c45ec4a58f88b0fdd845f5d',
    'architecture/graph_utils.py': 'e0f878afe44604e3dbc2afab59a5c4791df91b86c42b8286309877d5bfe82ef9',
    'architecture/network.py': '4e4c348c6fd5fdc4caffb8fbf1351ef2b1e35a6d616b414fbbb5457e137cf518',
    'architecture/st_gcn.py': 'e568a54c5b45e62e1562b360a0d06d846cc16e21d8be6aa9da9c5dc023d519cd',
    'dataset.py': '03ea006aa2d13b2ba7a9e9b963b7ba807335995cbdeebd0e9ae711c1a05881bc',
}
EDGES = [[2, 0], [1, 0], [0, 3], [0, 4], [3, 5], [4, 6], [5, 7], [6, 17],
         [7, 8], [7, 9], [9, 10], [7, 11], [11, 12], [7, 13], [13, 14],
         [7, 15], [15, 16], [17, 18], [17, 19], [19, 20], [17, 21], [21, 22],
         [17, 23], [23, 24], [17, 25], [25, 26]]
POINTS = [0, 2, 5, 11, 12, 13, 14, 33, 37, 38, 41, 42, 45, 46, 49, 50, 53,
          54, 58, 59, 62, 63, 66, 67, 70, 71, 74]


def verify(path, expected):
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != expected:
        raise ValueError(f'Unreviewed source file: {path}')


def reference(args):
    import torch
    for name, digest in REFERENCE_SHA.items():
        verify(args.source / name, digest)
    verify(args.source / 'ASL_citizen_stgcn_weights.pt', SOURCE_SHA)
    verify(args.csv, CSV_SHA)
    sys.path.insert(0, str(args.source))
    from architecture.st_gcn import STGCN
    from architecture.network import Network
    from architecture.fc import FC
    model = Network(STGCN(2, {'num_nodes': 27, 'center': 0, 'inward_edges': EDGES}, True),
                    FC(256, 2731, 0.05)).double().eval()
    state = torch.load(args.source / 'ASL_citizen_stgcn_weights.pt', map_location='cpu', weights_only=True)
    model.load_state_dict(state, strict=True)
    np.savez(args.output / 'weights.npz', **{k: v.numpy() for k, v in state.items()})
    with args.csv.open() as handle:
        rows = list(csv.reader(handle))
    labels = sorted({row[2].strip() for row in rows[1:]})
    if len(labels) != 2731:
        raise ValueError('Class count does not match the trained head')
    (args.output / 'asl_citizen_labels.json').write_text(json.dumps(labels, indent=2) + '\n')

    # Obtain a golden mobile preprocessing fixture from the actual upstream
    # Dataset.__getitem__, including padding BEFORE shoulder normalization.
    spec = importlib.util.spec_from_file_location('citizen_dataset', args.source / 'dataset.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    raw = np.zeros((31, 543, 2), np.float64)
    for t in range(31):
        for joint in range(75):
            raw[t, joint] = [0.2 + (joint % 9) * 0.05 + t * 0.001,
                             0.3 + (joint % 7) * 0.04 + t * 0.002]
        raw[t, 11] = [0.35, 0.5]
        raw[t, 12] = [0.65, 0.5]
        if 10 <= t <= 12:
            raw[t, 54:75] = 0  # temporary missing left hand
    with tempfile.TemporaryDirectory(prefix='citizen-preprocessing-') as folder:
        folder = Path(folder)
        np.save(folder / 'fixture.npy', raw)
        (folder / 'mapping.csv').write_text('fixture.mp4,fixture.npy\n')
        (folder / 'split.csv').write_text('Participant ID,Video file,Gloss\nTEST,fixture.mp4,TEST\n')
        dataset = module.ASLCitizen(str(folder) + '/', str(folder / 'split.csv'),
                                   gloss_dict={'TEST': 0}, pose_map_file=str(folder / 'mapping.csv'))
        prepared = dataset[0][0].numpy().astype(np.float32)
    reordered = np.concatenate([raw[:, :33], raw[:, 54:75], raw[:, 33:54]], axis=1)[:, POINTS]
    fixture = {'source': 'Microsoft Dataset.__getitem__ at 17f0148',
               'samples': [{'timestampMs': t * 1000 / 30, 'landmarks': reordered[t].reshape(-1).tolist()}
                           for t in range(31)], 'expected': prepared.reshape(-1).tolist()}
    (args.output / 'citizen-preprocessing-fixture.json').write_text(json.dumps(fixture) + '\n')

    rng = np.random.default_rng(2731)
    fixtures = [prepared[None], rng.uniform(-1, 1, (1, 2, 128, 27)).astype(np.float32),
                np.zeros((1, 2, 128, 27), np.float32)]
    outputs = []
    with torch.no_grad():
        for x in fixtures:
            outputs.append(model(torch.from_numpy(x).double()).numpy().astype(np.float32))
    np.savez(args.output / 'parity.npz', **{f'input_{i}': x for i, x in enumerate(fixtures)},
             **{f'output_{i}': x for i, x in enumerate(outputs)})
    print('Strict-loaded 2,731-class reference and generated golden preprocessing/graph fixtures.', flush=True)


def convert(args):
    import tensorflow as tf
    weights = dict(np.load(args.output / 'weights.npz'))

    class Converted(tf.Module):
        def __init__(self):
            self.w = {k: tf.constant(v.astype(np.float32)) for k, v in weights.items()
                      if not k.endswith('num_batches_tracked')}

        def bn(self, x, prefix):
            return (x - self.w[prefix + '.running_mean']) * tf.math.rsqrt(
                self.w[prefix + '.running_var'] + 1e-5) * self.w[prefix + '.weight'] + self.w[prefix + '.bias']

        def conv(self, x, prefix, stride=1, padding=0):
            if padding:
                x = tf.pad(x, [[0, 0], [padding, padding], [0, 0], [0, 0]])
            kernel = tf.transpose(self.w[prefix + '.weight'], [2, 3, 1, 0])
            return tf.nn.conv2d(x, kernel, strides=[1, stride, 1, 1], padding='VALID') + self.w[prefix + '.bias']

        @tf.function(input_signature=[tf.TensorSpec([1, 2, 128, 27], tf.float32, name='landmarks')])
        def __call__(self, landmarks):
            x = tf.transpose(landmarks, [0, 2, 3, 1])
            x = tf.reshape(self.bn(tf.reshape(x, [1, 128, 54]), 'encoder.data_bn'), [1, 128, 27, 2])
            for i in range(10):
                prefix = f'encoder.st_gcn_networks.{i}'
                stride = 2 if i in (4, 7) else 1
                residual = 0 if i == 0 else self.bn(self.conv(x, prefix + '.residual.0', stride), prefix + '.residual.1') if stride == 2 else x
                g = self.conv(x, prefix + '.gcn.conv')
                t, channels = int(g.shape[1]), int(g.shape[3]) // 3
                g = tf.reshape(g, [1, t, 27, 3, channels])
                adjacency = self.w['encoder.A'] * self.w[f'encoder.edge_importance.{i}']
                branches = [tf.transpose(tf.matmul(tf.transpose(g[:, :, :, k, :], [0, 1, 3, 2]),
                                                  adjacency[k]), [0, 1, 3, 2]) for k in range(3)]
                x = tf.add_n(branches)
                x = tf.nn.relu(self.bn(x, prefix + '.tcn.0'))
                x = self.bn(self.conv(x, prefix + '.tcn.2', stride, 4), prefix + '.tcn.3')
                x = tf.nn.relu(x + residual)
            x = tf.reduce_mean(x, axis=[1, 2])
            return tf.matmul(x, tf.transpose(self.w['decoder.classifier.weight'])) + self.w['decoder.classifier.bias']

    network = Converted()
    fixtures = np.load(args.output / 'parity.npz')
    converter = tf.lite.TFLiteConverter.from_concrete_functions([network.__call__.get_concrete_function()], network)
    converter.optimizations = []  # preserve float32 weights, no accuracy-costing quantization
    binary = converter.convert()
    interpreter = tf.lite.Interpreter(model_content=binary, num_threads=2)
    interpreter.allocate_tensors()
    errors, timings = [], []
    for i in range(3):
        x, expected = fixtures[f'input_{i}'], fixtures[f'output_{i}']
        graph = network(x).numpy()
        np.testing.assert_allclose(graph, expected, rtol=5e-4, atol=5e-4)
        interpreter.set_tensor(interpreter.get_input_details()[0]['index'], x)
        start = time.perf_counter()
        interpreter.invoke()
        timings.append((time.perf_counter() - start) * 1000)
        actual = interpreter.get_tensor(interpreter.get_output_details()[0]['index'])
        np.testing.assert_allclose(actual, expected, rtol=5e-4, atol=5e-4)
        if actual.shape != (1, 2731) or not np.isfinite(actual).all() or actual.argmax() != expected.argmax():
            raise ValueError('Conversion changed the reference result')
        errors.append(float(np.max(np.abs(actual - expected))))
    (args.output / 'asl_words_citizen.tflite').write_bytes(binary)
    report = {'sourceRevision': '17f0148b00ef87a5957ec103da8d10bd8eb1fa23', 'checkpointSha256': SOURCE_SHA,
              'trainingCsvSha256': CSV_SHA, 'bytes': len(binary), 'sha256': hashlib.sha256(binary).hexdigest(),
              'inputShape': [1, 2, 128, 27], 'classes': 2731, 'precision': 'float32',
              'maxAbsoluteErrors': errors, 'developerCpuMs': timings,
              'validation': 'Three synthetic fixtures plus upstream preprocessing fixture; not live ASL accuracy.'}
    (args.output / 'asl_citizen_manifest.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['reference', 'convert'])
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--csv', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    (reference if args.mode == 'reference' else convert)(args) 

