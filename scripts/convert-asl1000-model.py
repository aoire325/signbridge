"""Convert the pinned WLASL TGCN weights and verify float32 PyTorch/TF/TFLite parity.

Developer-only dependencies: torch, numpy, tensorflow. The original reference
module is read separately and is not bundled into the mobile app.
See assets/models/ATTRIBUTION.md for source URLs, license and caveats.
"""
import sys
import torch
import numpy as np
import tensorflow as tf
import importlib.util,time
from pathlib import Path
import argparse, hashlib
p = argparse.ArgumentParser()
p.add_argument("checkpoint", type=Path)
p.add_argument("reference", type=Path, help="Published tgcn_model.py")
p.add_argument("output", type=Path)
args = p.parse_args()
EXPECTED_SOURCE_SHA = "0d21ad86bc479416267ee1ae3a4c0da7dc6c0b0c7c6113533cceec086db3bc67"
if hashlib.sha256(args.checkpoint.read_bytes()).hexdigest() != EXPECTED_SOURCE_SHA:
 raise SystemExit("Unexpected checkpoint; use the pinned source in ATTRIBUTION.md.")
state=torch.load(args.checkpoint,map_location='cpu',weights_only=True)
# Evaluate the reference graph with strict state loading before conversion.
spec=importlib.util.spec_from_file_location('reference',str(args.reference));ref=importlib.util.module_from_spec(spec);spec.loader.exec_module(ref)
reference=ref.GCN_muti_att(100,256,1000,0.3,24).eval();reference.load_state_dict(state,strict=True)
w={k:v.numpy() for k,v in state.items()}
class Converted(tf.Module):
 def __init__(self):
  super().__init__()
  self.w={k:tf.constant(v) for k,v in w.items() if not k.endswith('num_batches_tracked')}
 def graph(self,x,prefix):
  return tf.matmul(self.w[prefix+'.att'],tf.matmul(x,self.w[prefix+'.weight']))+self.w[prefix+'.bias']
 def norm(self,x,prefix):
  x=tf.reshape(x,[1,14080]);x=(x-self.w[prefix+'.running_mean'])*tf.math.rsqrt(self.w[prefix+'.running_var']+1e-5)
  return tf.reshape(x*self.w[prefix+'.weight']+self.w[prefix+'.bias'],[1,55,256])
 @tf.function(input_signature=[tf.TensorSpec([1,55,100],tf.float32,name='landmarks')])
 def __call__(self,x):
  y=tf.tanh(self.norm(self.graph(x,'gc1'),'bn1'))
  for i in range(24):
   p=f'gcbs.{i}'
   z=tf.tanh(self.norm(self.graph(y,p+'.gc1'),p+'.bn1'))
   z=tf.tanh(self.norm(self.graph(z,p+'.gc2'),p+'.bn2'))
   y=y+z
  return tf.matmul(tf.reduce_mean(y,axis=1),tf.transpose(self.w['fc_out.weight']))+self.w['fc_out.bias']
model=Converted();x=np.random.default_rng(18).uniform(-1,1,(1,55,100)).astype(np.float32)
with torch.no_grad(): expected=reference(torch.from_numpy(x)).numpy()
actual=model(x).numpy();np.testing.assert_allclose(actual,expected,rtol=1e-3,atol=1e-3)
converter=tf.lite.TFLiteConverter.from_concrete_functions([model.__call__.get_concrete_function()],model)
converter.optimizations=[tf.lite.Optimize.DEFAULT]
# Float32 throughout: exact model parity takes priority over untested quantization.
converter.optimizations=[]
result=converter.convert();open(args.output,'wb').write(result)
i=tf.lite.Interpreter(model_content=result);i.allocate_tensors();i.set_tensor(i.get_input_details()[0]['index'],x);start=time.perf_counter();i.invoke();out=i.get_tensor(i.get_output_details()[0]['index'])
np.testing.assert_allclose(out,expected,rtol=1e-3,atol=1e-3)
print('Verified',len(result),'bytes',out.shape,'max error',float(np.max(np.abs(out-expected))),'CPU ms',(time.perf_counter()-start)*1000) 

