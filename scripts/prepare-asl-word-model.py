"""Adapt the pinned model's default frame count without changing weights.

Requires TensorFlow in the developer Python environment. Usage:
  python scripts/prepare-asl-word-model.py /path/to/original/model.tflite
Original source and MIT license: assets/models/ATTRIBUTION.md.
"""
import hashlib
from pathlib import Path
import sys

import numpy as np
import tensorflow as tf
from tensorflow.lite.python import schema_py_generated as schema

ROOT = Path(__file__).resolve().parents[1]
# Source commit d831c2f58cefbc5110dfbb91cc8e6eb516b4ccfc.
SOURCE_SHA256 = "f55a2bb1ebe6d1e912a98e31c6ef3f995c9ae261f408fe115f2008099d3f0bb7"
source = Path(sys.argv[1]).read_bytes()
if hashlib.sha256(source).hexdigest() != SOURCE_SHA256:
    raise SystemExit("Unexpected source model; use the pinned original in ATTRIBUTION.md.")
data = bytearray(source)
model = schema.Model.GetRootAsModel(data, 0)
graph = model.Subgraphs(0)
shape = graph.Tensors(graph.Inputs(0)).ShapeAsNumpy()
if list(shape) != [1, 543, 3]:
    raise SystemExit("Unexpected source input shape.")
shape[0] = 32
output = ROOT / "assets/models/asl_words_250.tflite"
output.write_bytes(data)

# Verify the patched default is identical to resizing the original interpreter.
original = tf.lite.Interpreter(model_content=source)
original.resize_tensor_input(original.get_input_details()[0]["index"], [32, 543, 3])
patched = tf.lite.Interpreter(model_path=str(output))
x = np.random.default_rng(2026).random((32, 543, 3), dtype=np.float32)
x[:, 522:, :] = np.nan  # A missing hand is represented with NaN.
outputs = []
for interpreter in [original, patched]:
    interpreter.allocate_tensors()
    interpreter.set_tensor(interpreter.get_input_details()[0]["index"], x)
    interpreter.invoke()
    logits = interpreter.get_tensor(interpreter.get_output_details()[0]["index"])
    if logits.shape != (250,) or not np.isfinite(logits).all():
        raise SystemExit("Invalid word-model logits.")
    outputs.append(logits)
np.testing.assert_allclose(outputs[0], outputs[1], rtol=1e-5, atol=1e-5)
print("Verified 32×543×3 input, 250 finite logits, unchanged resized-model predictions.")
print("SHA-256:", hashlib.sha256(data).hexdigest()) 

