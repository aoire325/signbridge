"""Developer-only TFLite execution for evaluate-expanded-words.cjs (TensorFlow)."""
import argparse
import json
from pathlib import Path
import time

import numpy as np
import tensorflow as tf

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, required=True)
parser.add_argument('--data', type=Path, required=True)
args = parser.parse_args()
models = {}
for key, filename in [('citizen', 'asl_words_citizen.tflite'), ('wlasl', 'asl_words_2000.tflite'), ('standard', 'asl_words_1000.tflite')]:
    interpreter = tf.lite.Interpreter(model_path=str(args.root / 'assets/models' / filename), num_threads=2)
    interpreter.allocate_tensors()
    models[key] = interpreter
models['citizenMirrored'] = models['citizen']
records = json.loads((args.data / 'index.json').read_text())
for record in records:
    if not record['captured']:
        continue
    for key, interpreter in models.items():
        tensor = interpreter.get_input_details()[0]
        input_key = 'wlasl' if key == 'standard' else key
        data = np.fromfile(args.data / f'{record["index"]}.{input_key}.input.f32', dtype=np.float32).reshape(tensor['shape'])
        interpreter.set_tensor(tensor['index'], data)
        start = time.perf_counter()
        interpreter.invoke()
        scores = interpreter.get_tensor(interpreter.get_output_details()[0]['index'])
        if not np.isfinite(scores).all():
            raise ValueError('Non-finite model output')
        scores.tofile(args.data / f'{record["index"]}.{key}.output.f32')
        print(record['gloss'], key, round((time.perf_counter() - start) * 1000), 'ms', flush=True) 

