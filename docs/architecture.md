# Architecture

## Video calls

The home screen links to the translator workspace and the `/call` route. Calls
use react-native-webrtc and a standalone WebSocket signaling service to connect
two participants with a random private invitation. Each caller has video,
optional microphone audio, and a reliable data channel for caption/media state.
`CallSession` owns tracks and transport teardown, queues ICE until a remote
description exists, and invalidates asynchronous work when a session ends.

The native SignBridgeTracker module can observe a WebRTC video track through its
video-effects interface. It returns video unchanged and passes a bounded sample
of hand/body/face landmarks into the existing recognizers. Only one camera is
opened. Call captions can be reviewed word suggestions, explicitly enabled live
AI guesses, reviewed sentence drafts, or typed text. They appear below the
sender's video on both phones. See [calling.md](calling.md) for deployment,
privacy, and device verification requirements.

## Live camera and word transcription

```text
Start camera → OS permission → native preview (independent of model setup)
  → MediaPipe hand / pose / face landmarks
  → ContextWordSegmenter buffers one isolated sign and brief surrounding context
  → lowered/absent hands settle for 550 ms, or Finish sign
  → original and mirrored Citizen input + WLASL input
  → bundled TensorFlow Lite models, async on CPU
  → rank within the fixed 500-word vocabulary; optionally refine with personal templates
  → show three alternatives; user selection appends a word to the transcript
```

`useCameraSession` owns translator permissions, facing and camera lifecycle. Android uses CameraX; iOS uses AVFoundation. Only landmarks cross into JavaScript. Native model instances share a serialized worker, and remain cached for 30 seconds after the final camera consumer releases them. Native preview startup does not wait for model initialization. Hand, pose and face detection observe the same processed frame, including hands-out pauses. Video calls use the separate shared-capture path described above.

`useAslWordRecognizer` loads the two pretrained word models separately from the preview and serializes inference. Current capture requires visible shoulders and signing hands. The original 250-sign preprocessing remains in `asl-word-recognition.ts` for research and shared types. A lifecycle generation invalidates results after pause, stop, switch, unmount or text editing. `useTranscript` owns confirmed word insertion, manual editing and undo; the screen handles clipboard operations. A confirmed word is a single undo step. Intentional repeated words are allowed across separate sign boundaries. Translator model loading is disabled while its screen is inactive so calls do not retain a second set of word model instances.

## Models

The active word engine uses `asl_words_citizen.tflite` (2,731 classes) in original/mirrored passes and `asl_words_2000.tflite` (2,000 classes) for secondary proposals. Output is restricted to `asl_common_500_labels.json`; model weights and class order are unchanged. Enabled personal templates may add user-defined labels. The legacy 1,000-class and 250-sign models are retained but are not selectable modes.

`assets/models/asl_words_250.tflite` is an 11.2 MB pretrained isolated-sign model with 250 output logits. Its default input dimension is set to 32 frames without changing weights. The app interpolates time to 32 frames and leaves spatial normalization to the model. No backend is involved. See `assets/models/ATTRIBUTION.md` for pinned sources, binary hashes and license.

The word model is distinct from the MediaPipe landmark models. The retained alphabet-classifier and personal-example matcher files are not the active home-screen recognition path. Word mode preserves sign order; sentence mode uses the separate experimental path below for continuous signing.

## Mobile build

The app uses Expo Continuous Native Generation. Configure native integration in local modules and app config. A development or release build is required for the native camera tracker and TensorFlow Lite runtime; Expo Go is unsupported. Metro packages the model as an asset, and release builds bundle it for offline inference.

The tracker module exports consumer ProGuard rules preserving MediaPipe JNI types, protobuf reflection and Flogger stack inspection. Renaming protobuf fields or inlining the logger's caller detection breaks tracker startup in optimized release builds. Native initialization errors are reported explicitly rather than leaving the camera in a preparing state.

## Offline sentence path

`useSentenceTranslator` owns a separate recording lifecycle, model references, cancellation generation and editable draft. `SentenceCapture` samples an entire utterance rather than splitting at hands-out pauses. A monotonic-time sampler targets 8 fps and bounds recordings to 96 samples / 12 seconds. `packSentenceFrame` implements the 104-point reference adapter. Missing frames preserve their position in the captured sequence, while capture quality checks reject mostly absent context and stationary input.

`sentence-decoder.ts` invokes the local pose encoder, then feeds its hidden sequence and a causal text prefix into the trained English decoder until EOS. Tensor names, dtypes and shapes are checked rather than assuming flatbuffer input order. Each asynchronous step checks session validity; stale output cannot become a draft after pause, editing, camera switch, cancellation or unmount. Decoder token limits and invalid scores fail explicitly. A sentence draft reaches the transcript only through Add sentence, preserving one undo step.

`local-model.ts` resolves Expo assets into local file URIs. Release builds reject remote model fallback. The version-checked `patch-tflite-large-assets.mjs` patch avoids full-size transient asset copies: mapped files on Android and bounded FileHandle reads on iOS. Model weights and tokenizer are shipped with the app. Captured landmarks never leave the device and are reset after translation or cancellation. See the sentence manifest and limitations for exact model shapes and unvalidated preprocessing assumptions.

