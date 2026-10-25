# Bundled ASL model attribution

`asl_alphabet_int8.tflite` and `asl_alphabet_labels.txt` are from the [Tiny ASL Alphabet CNN (int8)](https://huggingface.co/satvik4577/asl-alphabet-tinycnn-int8) by **satvik4577**, model commit `06d6824fb6b886400e4fc9ded63443158882aa00`. The model repository declares the MIT License.

The model card reports training on the Kaggle [`grassknoted/asl-alphabet`](https://www.kaggle.com/datasets/grassknoted/asl-alphabet) dataset. It reports a 95.78% held-out image accuracy and notes the dataset uses a single signer and a single background. SignBridge has not independently verified that figure or validated accuracy on mobile camera footage.

## MIT License

Copyright (c) 2026 satvik4577

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Isolated ASL word model (250 signs)

`asl_words_250.tflite` and `asl_word_labels.json` come from [sign/kaggle-asl-signs-1st-place](https://huggingface.co/sign/kaggle-asl-signs-1st-place/tree/d831c2f58cefbc5110dfbb91cc8e6eb516b4ccfc), which mirrors [hoyso48's first-place ISLR solution](https://github.com/hoyso48/Google---Isolated-Sign-Language-Recognition-1st-place-solution). License: MIT; see `ASL_WORD_MODEL_LICENSE.txt` (Copyright 2023 hoyso48).

Original model SHA-256: `f55a2bb1ebe6d1e912a98e31c6ef3f995c9ae261f408fe115f2008099d3f0bb7`.
Bundled model SHA-256: `fe09669ee26a4f59a11bae3a7114885279c6706ac603101c8f8de5672d67d2d3`.

The sole binary modification sets the input tensor's default temporal dimension from 1 to 32; weights and dynamic shape signature are unchanged. The app resamples each isolated sign to 32 frames of 543 XYZ landmarks (468 face, 21 left hand, 33 pose, 21 right hand), marking missing landmarks as NaN. Normalization is inside the model; outputs are logits, converted with softmax before filtering. The iris landmarks beyond face index 467 are omitted. No images are sent to this model or uploaded.

This is a closed-vocabulary isolated-sign classifier, not continuous ASL or grammar translation. Unknown gestures can resemble a trained class. SignBridge has not measured signer-independent mobile recognition accuracy. Automatic transcript entries remain editable and undoable.

## Experimental 1,000-sign model

`asl_words_1000.tflite` is converted from [sharonn18/tgcn-wlasl](https://huggingface.co/sharonn18/tgcn-wlasl/tree/dacb4568719caa03c44764034f599a9f8a0f63f4), `checkpoints/asl1000/pytorch_model.bin`. The model repository declares MIT licensing. Architecture/reference: `tgcn_model.py` from that same revision. The mathematical implementation is reproduced in TensorFlow, with float32 weights unchanged; no quantization is applied. `scripts/convert-asl1000-model.py` checks strict reference weight loading and numerical parity across PyTorch, TensorFlow and TensorFlow Lite.

Source checkpoint SHA-256: `0d21ad86bc479416267ee1ae3a4c0da7dc6c0b0c7c6113533cceec086db3bc67`.
Bundled TFLite SHA-256: `89a5abb3a74a71836b2382dcd2f7a9c8b10d8b3a33536367d90a752751fdb380`.

`asl_1000_labels.json` uses the first 1,000 entries from the original [WLASL class list](https://github.com/dxli94/WLASL/blob/master/code/I3D/preprocess/wlasl_class_list.txt), sorted lexicographically to reproduce the `LabelEncoder` order in the original [TGCN training dataset code](https://github.com/dxli94/WLASL/blob/master/code/TGCN/sign_dataset.py). The mirror provides no separate label file, so this follows the original training implementation; signer footage must be used to validate mapping and accuracy before making recognition claims.

Input is `[1,55,100]`: 13 upper-body points, 21 left-hand points, 21 right-hand points, with 50 sequential XY pairs per joint. Coordinates are scaled to [-1,1]; missing OpenPose coordinates become -1. The adapter maps MediaPipe points to the original OpenPose upper-body topology, including shoulder/pelvis midpoints. This cross-extractor adaptation is experimental and has not been evaluated for live accuracy. Numeric model-conversion parity does not validate this adaptation or camera accuracy. The original 250-sign model remains selectable.

WLASL data has separate research/non-commercial terms; the mirror's MIT model declaration does not grant additional rights to the dataset. Review upstream terms before distributing derived products commercially. This app has not downloaded or bundled WLASL training videos.

## Additional offline word models (review-only)

`asl_words_citizen.tflite` is converted from the official [Microsoft ASL Citizen ST-GCN weights](https://github.com/microsoft/ASL-citizen-code/releases/tag/checkpoints_v1), asset `ASL_citizen_stgcn_weights.zip`. The extracted checkpoint SHA-256 is `b08d84afb5a0fdf4c723fd7be2db897b2490a921ccf538cff1b345f905934d68`. The reference repository revision is `17f0148b00ef87a5957ec103da8d10bd8eb1fa23`; the repository code is MIT licensed (see `ASL_CITIZEN_CODE_LICENSE.txt`). Conversion is a float32 TensorFlow implementation of the reviewed PyTorch graph, checked against strict-loaded float64 reference weights. `asl_citizen_manifest.json` records the binary hash, size, tensor shape and conversion errors.

`asl_citizen_labels.json` reproduces the sorted unique gloss ordering in the current upstream dataset implementation, using the official original `train.csv` (SHA-256 `87a105649b98ea577182ebfce49d59fe9ca834a2489384f6fe7bc03f14966329`). The archived release tag contains older dataset code with a different dictionary-construction path; no independent checkpoint class map is provided. Current ordering was spot-checked with twelve held-out extracted-pose examples, but full validation remains necessary. Participant rows, videos and pose recordings are not redistributed with the app. The [ASL Citizen dataset terms](https://www.microsoft.com/en-us/research/project/asl-citizen/dataset-license/) permit non-commercial research and restrict redistribution; the repository's MIT code license does not replace those data terms or establish commercial rights for dataset-derived materials. Review the applicable terms before distribution.

`asl_words_2000.tflite` is converted from the same pinned [sharonn18/tgcn-wlasl revision](https://huggingface.co/sharonn18/tgcn-wlasl/tree/dacb4568719caa03c44764034f599a9f8a0f63f4) as the 1,000-class model, using `checkpoints/asl2000/pytorch_model.bin`. Source SHA-256: `23a994294be6156bcebb4d333a891dc8594a83f461b58b84068472729f5ba929`. `asl_2000_labels.json` uses all 2,000 original WLASL class-list entries in the upstream LabelEncoder's lexicographic order. Its original class-list SHA-256 is `2c131fb7f052340aa7ae8579c8cae9746028740b8e62efeb957a7790dbefcf4a`. The existing MIT model-code and separate WLASL research-data caveats also apply here. `asl_2000_manifest.json` records the converted identity and numerical checks.

Reproduction: `scripts/convert-citizen-model.py` and `scripts/convert-asl2000-model.py` each have a PyTorch `reference` stage and a TensorFlow `convert` stage; the stages can run in separate developer environments. `scripts/prepare-expanded-vocabulary.py` rejects unreviewed metadata hashes. `scripts/fetch-citizen-metadata.py` downloads only CSV/license metadata using HTTP ranges and refuses a whole-archive response. `tests/recognition/citizen-preprocessing-fixture.json` is synthetic and generated by the upstream dataset code; it contains no participant data.

The deduplicated union is 2,917 lexical entries, including phrases. Variants such as `ABOUT1` and `ABOUT2` count once. All expanded predictions require manual review. Improved capture preserves body lead-in/end frames; a separate 48-example replay improved Citizen top-1 from 19 to 33 correct, but it does not establish live-phone accuracy. Portrait coordinates map into a centered 4:3 canvas to preserve physical XY proportions; this adaptation has synthetic geometry tests and still requires real-camera validation. No model weights were changed for these capture improvements. See `docs/evaluation/word-capture-accuracy.md`.

## Frequency-guided 500-word Dictionary

`asl_common_500_labels.json` is an output allowlist, not a new trained class map. It derives from the existing WLASL1000 glosses and [ASL-LEX 2.0 frequency ratings](https://asl-lex.org/download.html), using the pinned source, SHA-256, matched EntryIDs and selection policy in `asl_common_500_manifest.json`. The transformation selects the first 500 strictly by subjective mean frequency, with alphabetical tie-breaking and no exceptions. Reference videos are not included. The current ASL-LEX download page licenses the database under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); the historical GitHub README still states CC BY-NC 4.0. Preserve this provenance and review the applicable terms for distribution.

Required ASL-LEX citations:

- Sevcikova Sehyr, Z., Caselli, N., Cohen-Goldberg, A. M., & Emmorey, K. (2021). The ASL-LEX 2.0 Project: A database of lexical and phonological properties for 2,723 signs in American Sign Language. *Journal of Deaf Studies and Deaf Education*. https://doi.org/10.1093/deafed/enaa038
- Caselli, N., Sevcikova Sehyr, Z., Cohen-Goldberg, A. M., & Emmorey, K. (2017). ASL-LEX: A lexical database of American Sign Language. *Behavior Research Methods*, 49(2), 784–801. https://doi.org/10.3758/s13428-016-0742-0

No ASL-LEX training videos or image assets were downloaded or bundled. Frequency selection and personal template learning do not establish recognition accuracy or alter the pretrained model licenses above.

## Offline sentence translation

The sentence encoder/decoder are derived from [FatimahEmadEldin/ytasl-t5-v1_1-base](https://huggingface.co/FatimahEmadEldin/ytasl-t5-v1_1-base/tree/cc6330e8a992975b80bf95b098cdf27f8379febe), by **FatimahEmadEldin**, declared **CC BY 4.0** ([license](https://creativecommons.org/licenses/by/4.0/)). The base is Google's `t5-v1_1-base` (Apache 2.0). Original weights and tokenizer are attributed to those authors. Changes: reimplemented inference graph, fixed mobile shapes, separated pose encoder and autoregressive decoder, float16 weight storage, bounded greedy English generation instead of the author's beam/sampling settings. `asl_sentence_manifest.json` records hashes, shapes, revision and limitations.

The original checkpoint is approximately 991 MB. Bundled encoder and decoder total approximately 496 MB. Both consume float32 tensors and run on CPU through the existing TFLite runtime. `asl_sentence_tokens.json` contains the checkpoint's SentencePiece decoder vocabulary; no user content is part of these artifacts.

The 104-point layout and sign-space normalization are adapted from the [T5_for_SLT reference preprocessing](https://github.com/zeleznyt/T5_for_SLT/tree/ablation/utils): 25 pose, 21 right hand, 21 left hand, 37 selected face points. **The checkpoint author does not document the exact training normalization. This adapter and the newer independent MediaPipe Tasks extractors have not been validated on labeled live ASL sentences.** Numeric conversion parity is not translation accuracy. Output is an experimental draft requiring human review.

Reproduction: download the pinned `model.safetensors` and Google's T5 v1.1 base `config.json` into a source folder; run `scripts/convert-sentence-model.py encoder --source ... --output ...`, then `decoder`, and `scripts/verify-sentence-model.py --source ... --models ...`. Developer dependencies: NumPy, TensorFlow, safetensors, PyTorch and transformers 4.44.2. No remote Python code is executed by the mobile app or required for loading the converted models.

