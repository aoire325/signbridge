# Architecture

## Live camera and word transcription

```text
Start camera → OS permission → native preview (independent of model setup)
  → MediaPipe hand / pose / face landmarks at up to 12.5 samples/second
  → WordSegmenter buffers one isolated sign
  → hands out for 550 ms, or Finish sign
  → pack selected input: 50 × 55 × 2 (TGCN) or 32 × 543 × 3 (ISLR)
  → bundled pretrained ISLR TensorFlow Lite model, async on CPU
  → softmax confidence + margin filter
  → append accepted word directly to editable transcript (with undo)
```

`useCameraSession` owns permissions, facing and camera lifecycle. Android uses CameraX; iOS uses AVFoundation. Native buffers stay on-device and only landmarks cross into JavaScript. Native model instances share a serialized worker, and remain cached for 30 seconds after the final camera view releases them. Native preview startup does not wait for model initialization. Pose and face inference are skipped on idle frames with no hands.

`asl-word-recognition.ts` packs the original model landmark order and segments bounded clips without requiring body anchors. The original model requires face landmarks; the expanded model requires visible shoulders and signing hands. Switching models invalidates queued results and clears the current clip. `useAslWordRecognizer` loads the pretrained word model separately from the preview and serializes async inference. A lifecycle generation invalidates results after pause, stop, switch, unmount or text editing. `useTranscript` owns automatic word insertion, manual editing, clipboard operations and undo. A confirmed word is a single undo step. Intentional repeated words are allowed across separate sign boundaries.

## Models

`assets/models/asl_words_1000.tflite` is the experimental 25.5 MB, 1,000-class TGCN model. It uses a MediaPipe-to-OpenPose joint adapter, joint-major 50-frame sampling, and missing-coordinate sentinels. The original 250-sign model remains selectable.

`assets/models/asl_words_250.tflite` is an 11.2 MB pretrained isolated-sign model with 250 output logits. Its default input dimension is set to 32 frames without changing weights. The app interpolates time to 32 frames and leaves spatial normalization to the model. No backend is involved. See `assets/models/ATTRIBUTION.md` for pinned sources, binary hashes and license.

The word model is distinct from the MediaPipe landmark models. The retained alphabet-classifier and personal-example matcher files are not the active home-screen recognition path. Word mode preserves sign order; sentence mode uses the separate experimental path below for continuous signing.

## Mobile build

The app uses Expo Continuous Native Generation. Configure native integration in local modules and app config. A development or release build is required for the native camera tracker and TensorFlow Lite runtime; Expo Go is unsupported. Metro packages the model as an asset, and release builds bundle it for offline inference.

The tracker module exports consumer ProGuard rules preserving MediaPipe JNI types, protobuf reflection and Flogger stack inspection. Renaming protobuf fields or inlining the logger's caller detection breaks tracker startup in optimized release builds. Native initialization errors are reported explicitly rather than leaving the camera in a preparing state.

## Offline sentence path

`useSentenceTranslator` owns a separate recording lifecycle, model references, cancellation generation and editable draft. `SentenceCapture` samples an entire utterance rather than splitting at hands-out pauses. A monotonic-time sampler targets 8 fps and bounds recordings to 96 samples / 12 seconds. `packSentenceFrame` implements the 104-point reference adapter. Missing frames preserve their position in the captured sequence, while capture quality checks reject mostly absent context and stationary input.

`sentence-decoder.ts` invokes the local pose encoder, then feeds its hidden sequence and a causal text prefix into the trained English decoder until EOS. Tensor names, dtypes and shapes are checked rather than assuming flatbuffer input order. Each asynchronous step checks session validity; stale output cannot become a draft after pause, editing, camera switch, cancellation or unmount. Decoder token limits and invalid scores fail explicitly. A sentence draft reaches the transcript only through Add sentence, preserving one undo step.

`local-model.ts` resolves Expo assets into local file URIs. Release builds reject remote model fallback. The version-checked `patch-tflite-large-assets.mjs` patch avoids full-size transient asset copies: mapped files on Android and bounded FileHandle reads on iOS. Model weights and tokenizer are shipped with the app. Captured landmarks never leave the device and are reset after translation or cancellation. See the sentence manifest and limitations for exact model shapes and unvalidated preprocessing assumptions.

