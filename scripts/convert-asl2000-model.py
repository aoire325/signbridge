"""Convert the pinned WLASL-2000 TGCN, retaining float32 precision.

Run `reference` using torch/numpy, then `convert` using tensorflow/numpy.
The separate stages permit reproducible developer environments without adding
training/conversion dependencies to the phone application.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

import numpy as np

CHECKPOINT_SHA = '23a994294be6156bcebb4d333a891dc8594a83f461b58b84068472729f5ba929'
CODE_SHA = 'f9aa5af3a96e125d283389ed7f57e0a7216d48a358f5a45256be5f5e16ce9eb5'


def main(args):
    args.output.mkdir(parents=True, exist_ok=True)
    if args.mode == 'reference':
        import torch
        if hashlib.sha256(args.checkpoint.read_bytes()).hexdigest() != CHECKPOINT_SHA:
            raise ValueError('Unexpected WLASL-2000 checkpoint')
        if hashlib.sha256(args.reference.read_bytes()).hexdigest() != CODE_SHA:
            raise ValueError('Unreviewed reference implementation')
        spec = importlib.util.spec_from_file_location('tgcn_reference', args.reference)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        state = torch.load(args.checkpoint, map_location='cpu', weights_only=True)
        model = module.GCN_muti_att(100, 256, 2000, 0.3, 24).eval()
        model.load_state_dict(state, strict=True)
        np.savez(args.output / 'weights.npz', **{k: v.numpy() for k, v in state.items()})
        rng = np.random.default_rng(2000)
        samples = [rng.uniform(-1, 1, (1, 55, 100)).astype(np.float32),
                   np.zeros((1, 55, 100), np.float32), np.full((1, 55, 100), -1, np.float32)]
        with torch.no_grad():
            outputs = [model(torch.from_numpy(x)).numpy() for x in samples]
        np.savez(args.output / 'parity.npz', **{f'input_{i}': x for i, x in enumerate(samples)},
                 **{f'output_{i}': x for i, x in enumerate(outputs)})
        print('Strict-loaded 2,000-class checkpoint; saved three reference fixtures.', flush=True)
        return

    import tensorflow as tf
    weights = dict(np.load(args.output / 'weights.npz'))

    class Converted(tf.Module):
        def __init__(self):
            self.w = {k: tf.constant(v) for k, v in weights.items() if not k.endswith('num_batches_tracked')}

        def graph(self, x, prefix):
            return tf.matmul(self.w[prefix + '.att'], tf.matmul(x, self.w[prefix + '.weight'])) + self.w[prefix + '.bias']

        def norm(self, x, prefix):
            x = tf.reshape(x, [1, 14080])
            x = (x - self.w[prefix + '.running_mean']) * tf.math.rsqrt(self.w[prefix + '.running_var'] + 1e-5)
            return tf.reshape(x * self.w[prefix + '.weight'] + self.w[prefix + '.bias'], [1, 55, 256])

        @tf.function(input_signature=[tf.TensorSpec([1, 55, 100], tf.float32, name='landmarks')])
        def __call__(self, x):
            y = tf.tanh(self.norm(self.graph(x, 'gc1'), 'bn1'))
            for i in range(24):
                prefix = f'gcbs.{i}'
                z = tf.tanh(self.norm(self.graph(y, prefix + '.gc1'), prefix + '.bn1'))
                z = tf.tanh(self.norm(self.graph(z, prefix + '.gc2'), prefix + '.bn2'))
                y += z
            return tf.matmul(tf.reduce_mean(y, axis=1), tf.transpose(self.w['fc_out.weight'])) + self.w['fc_out.bias']

    model = Converted()
    converter = tf.lite.TFLiteConverter.from_concrete_functions([model.__call__.get_concrete_function()], model)
    converter.optimizations = []
    binary = converter.convert()
    interpreter = tf.lite.Interpreter(model_content=binary, num_threads=2)
    interpreter.allocate_tensors()
    fixture = np.load(args.output / 'parity.npz')
    errors = []
    for i in range(3):
        x, expected = fixture[f'input_{i}'], fixture[f'output_{i}']
        np.testing.assert_allclose(model(x).numpy(), expected, rtol=1e-3, atol=1e-3)
        interpreter.set_tensor(interpreter.get_input_details()[0]['index'], x)
        interpreter.invoke()
        actual = interpreter.get_tensor(interpreter.get_output_details()[0]['index'])
        np.testing.assert_allclose(actual, expected, rtol=1e-3, atol=1e-3)
        if actual.shape != (1, 2000) or not np.isfinite(actual).all() or actual.argmax() != expected.argmax():
            raise ValueError('Model conversion changed the reference result')
        errors.append(float(np.max(np.abs(actual - expected))))
    (args.output / 'asl_words_2000.tflite').write_bytes(binary)
    report = {'sourceRevision': 'dacb4568719caa03c44764034f599a9f8a0f63f4',
              'checkpointSha256': CHECKPOINT_SHA, 'bytes': len(binary), 'sha256': hashlib.sha256(binary).hexdigest(),
              'classes': 2000, 'inputShape': [1, 55, 100], 'precision': 'float32', 'maxAbsoluteErrors': errors,
              'validation': 'Three synthetic conversion fixtures; not live ASL accuracy.'}
    (args.output / 'asl_2000_manifest.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['reference', 'convert'])
    parser.add_argument('--checkpoint', type=Path)
    parser.add_argument('--reference', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    main(parser.parse_args()) 

