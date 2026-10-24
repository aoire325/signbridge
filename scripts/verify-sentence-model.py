import sys,json,numpy as np
import torch
from transformers import T5Config,T5ForConditionalGeneration
from safetensors.torch import load_file
from pathlib import Path
import argparse
a=argparse.ArgumentParser();a.add_argument('--source',type=Path,required=True);a.add_argument('--models',type=Path,required=True);args=a.parse_args();p=args.source
config=T5Config(**json.load(open(p/'config.json')))
model=T5ForConditionalGeneration(config).eval()
s=load_file(str(p/'model.safetensors'))
state={k.removeprefix('model.'):v for k,v in s.items() if k.startswith('model.')}
# safetensors omits shared aliases, but these point to the same embedding table.
state['encoder.embed_tokens.weight']=state['shared.weight'];state['decoder.embed_tokens.weight']=state['shared.weight']
model.load_state_dict(state,strict=True)
f=np.load(args.models/'encoder_parity.npz')
with torch.no_grad():
 features=torch.from_numpy(f['features']);mask=torch.from_numpy(f['mask'])
 projected=torch.nn.functional.gelu(torch.nn.functional.linear(features,s['custom_linear.0.weight'],s['custom_linear.0.bias']))
 out=model.encoder(inputs_embeds=projected,attention_mask=mask).last_hidden_state.numpy()
np.testing.assert_allclose(out,f['output'],rtol=1e-3,atol=1e-3)
print('Encoder TF vs trained PyTorch: max error',np.max(np.abs(out-f['output'])),flush=True)
dec=args.models/'decoder_parity.npz'
if dec.exists():
 f=np.load(dec)
 with torch.no_grad():
  y=model.decoder(input_ids=torch.from_numpy(f['tokens']),encoder_hidden_states=torch.from_numpy(f['hidden']),encoder_attention_mask=torch.from_numpy(f['mask']),use_cache=False).last_hidden_state
  out=model.lm_head(y[:,int(f['position'][0]),:]).numpy()
 np.testing.assert_allclose(out,f['output'],rtol=1e-3,atol=1e-3)
 print('Decoder TF vs trained PyTorch: max error',np.max(np.abs(out-f['output'])),flush=True) 

