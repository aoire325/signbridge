"""Convert the inspected pose-T5 checkpoint to fixed-shape mobile encoder/decoder."""
import sys,os,json,time,gc
import numpy as np
import tensorflow as tf
from safetensors.numpy import load_file
from pathlib import Path
import argparse,hashlib
parser=argparse.ArgumentParser()
parser.add_argument('part',choices=['encoder','decoder'])
parser.add_argument('--source',type=Path,required=True,help='Pinned checkpoint folder containing model.safetensors')
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args();mode=args.part
SOURCE=args.source;OUT=args.output;OUT.mkdir(parents=True,exist_ok=True)
if hashlib.sha256((SOURCE/'model.safetensors').read_bytes()).hexdigest() != '326219fbbb8b62352d6ff0be4dbaca96f51dd2251a634f4fe26ab1105d02e36f':
 raise SystemExit('Checkpoint hash differs from the verified sentence model.')
FRAMES=96;TOKENS=64;D=768;H=12;K=64
print('Loading checkpoint',flush=True)
weights=load_file(str(SOURCE/'model.safetensors'))
print('Keys',list(weights)[:10],len(weights),flush=True)
class Network(tf.Module):
 def __init__(self,mode):
  super().__init__();self.mode=mode
  prefixes=['custom_linear.','model.encoder.'] if mode=='encoder' else ['model.decoder.','model.shared.','model.lm_head.']
  self.w={k:tf.constant(v) for k,v in weights.items() if any(k.startswith(p) for p in prefixes)}
 def linear(self,x,p):
  y=tf.matmul(x,tf.transpose(self.w[p+'.weight']))
  return y+self.w[p+'.bias'] if p+'.bias' in self.w else y
 def norm(self,x,p):
  return x*tf.math.rsqrt(tf.reduce_mean(tf.square(x),axis=-1,keepdims=True)+1e-6)*self.w[p+'.weight']
 def bias(self,p,n,bidir):
  rel=np.arange(n)[None,:]-np.arange(n)[:,None]
  buckets=np.zeros_like(rel);num=32
  if bidir:
   num//=2;buckets+=(rel>0)*num;dist=np.abs(rel)
  else: dist=-np.minimum(rel,0)
  small=num//2
  large=small+(np.log(np.maximum(dist,small)/small)/np.log(128/small)*(num-small)).astype(np.int32)
  buckets+=np.where(dist<small,dist,np.minimum(large,num-1))
  bias=tf.gather(self.w[p+'.relative_attention_bias.weight'],tf.constant(buckets,dtype=tf.int32))
  return tf.transpose(bias,[2,0,1])[None,...]
 def attn(self,x,source,p,bias):
  n=int(x.shape[1]);m=int(source.shape[1])
  def heads(v,length): return tf.transpose(tf.reshape(v,[1,length,H,K]),[0,2,1,3])
  q=heads(self.linear(x,p+'.q'),n);k=heads(self.linear(source,p+'.k'),m);v=heads(self.linear(source,p+'.v'),m)
  scores=tf.matmul(q,k,transpose_b=True)+bias
  y=tf.matmul(tf.nn.softmax(scores,axis=-1),v)
  return self.linear(tf.reshape(tf.transpose(y,[0,2,1,3]),[1,n,D]),p+'.o')
 def ff(self,x,p):
  return self.linear(tf.nn.gelu(self.linear(x,p+'.wi_0'),approximate=True)*self.linear(x,p+'.wi_1'),p+'.wo')
 @tf.function(input_signature=[tf.TensorSpec([1,FRAMES,208],tf.float32,name='features'),tf.TensorSpec([1,FRAMES],tf.float32,name='mask')])
 def encode(self,features,mask):
  x=tf.nn.gelu(self.linear(features,'custom_linear.0'),approximate=False)
  bias=self.bias('model.encoder.block.0.layer.0.SelfAttention',FRAMES,True)+(1-mask[:,None,None,:])*(-1e9)
  for i in range(12):
   p=f'model.encoder.block.{i}'
   z=self.norm(x,p+'.layer.0.layer_norm');x=x+self.attn(z,z,p+'.layer.0.SelfAttention',bias)
   x=x+self.ff(self.norm(x,p+'.layer.1.layer_norm'),p+'.layer.1.DenseReluDense')
  return {'hidden':self.norm(x,'model.encoder.final_layer_norm')}
 @tf.function(input_signature=[tf.TensorSpec([1,FRAMES,D],tf.float32,name='hidden'),tf.TensorSpec([1,FRAMES],tf.float32,name='mask'),tf.TensorSpec([1,TOKENS],tf.int32,name='tokens'),tf.TensorSpec([1],tf.int32,name='position')])
 def decode(self,hidden,mask,tokens,position):
  shared=self.w.get('model.shared.weight',self.w.get('model.decoder.embed_tokens.weight'))
  x=tf.gather(shared,tokens)
  causal=tf.constant(np.triu(np.ones((TOKENS,TOKENS),np.float32),1)*-1e9)[None,None,:,:]
  bias=self.bias('model.decoder.block.0.layer.0.SelfAttention',TOKENS,False)+causal
  cross=(1-mask[:,None,None,:])*(-1e9)
  for i in range(12):
   p=f'model.decoder.block.{i}'
   z=self.norm(x,p+'.layer.0.layer_norm');x=x+self.attn(z,z,p+'.layer.0.SelfAttention',bias)
   x=x+self.attn(self.norm(x,p+'.layer.1.layer_norm'),hidden,p+'.layer.1.EncDecAttention',cross)
   x=x+self.ff(self.norm(x,p+'.layer.2.layer_norm'),p+'.layer.2.DenseReluDense')
  x=self.norm(x,'model.decoder.final_layer_norm')
  last=tf.gather(x,position,axis=1)[:,0,:]
  return {'logits':self.linear(last,'model.lm_head')}

net=Network(mode)
# Store reference fixtures for independent PyTorch parity tests.
rng=np.random.default_rng(2026)
features=rng.uniform(-1,1,[1,FRAMES,208]).astype(np.float32)
mask=np.zeros([1,FRAMES],np.float32);mask[:,:48]=1
hidden=rng.normal(size=[1,FRAMES,D]).astype(np.float32) if mode=='encoder' else np.load(OUT/'encoder_parity.npz')['output'].astype(np.float32)
tokens=np.zeros([1,TOKENS],np.int32);tokens[0,:5]=[0,37,19,3,9]
position=np.array([4],np.int32)
fn=net.encode if mode=='encoder' else net.decode
inputs=[features,mask] if mode=='encoder' else [hidden,mask,tokens,position]
expected=next(iter(fn(*inputs).values())).numpy()
np.savez(OUT/f'{mode}_parity.npz',features=features,mask=mask,hidden=hidden,tokens=tokens,position=position,output=expected)
print('Float graph tested',mode,expected.shape,flush=True)
converter=tf.lite.TFLiteConverter.from_concrete_functions([fn.get_concrete_function()],net)
# Store weights as float16; activations and inputs remain float32.
converter.optimizations=[tf.lite.Optimize.DEFAULT]
converter.target_spec.supported_types=[tf.float16]
b=converter.convert();(OUT/f'asl_sentence_{mode}.tflite').write_bytes(b)
print('Converted',mode,len(b),flush=True)
i=tf.lite.Interpreter(model_content=b,num_threads=4);i.allocate_tensors()
# Signature runner avoids relying on flatbuffer tensor order.
kwargs={'features':features,'mask':mask} if mode=='encoder' else {'hidden':hidden,'mask':mask,'tokens':tokens,'position':position}
for detail in i.get_input_details():
 name=detail['name'].split(':')[0].split('/')[-1]
 i.set_tensor(detail['index'],kwargs[name])
start=time.perf_counter();i.invoke();actual=i.get_tensor(i.get_output_details()[0]['index']);elapsed=time.perf_counter()-start
print('Quantized parity',mode,'max-error',np.max(np.abs(actual-expected)),'mean-error',np.mean(np.abs(actual-expected)),'seconds',elapsed,flush=True)
if mode=='decoder': print('Top tokens',np.argmax(expected),np.argmax(actual),flush=True)
assert np.isfinite(actual).all()
assert np.max(np.abs(actual-expected)) < 0.02
if mode=='decoder': assert np.argmax(actual)==np.argmax(expected)
(OUT/f'{mode}_quantized_output.npy').write_bytes(b'') if False else None 

