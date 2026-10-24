# Privacy

- Camera permission is requested only after the user taps the start action.
- Native camera buffers are analyzed on-device. Only landmarks cross into JavaScript; up to 64 landmark samples are held briefly for isolated-word recognition, or up to 96 samples / 12 seconds for sentence translation. Sentence landmark buffers are cleared after translation, cancellation, interruption or leaving the mode. No photos or video files are created by this flow. Native model weights may stay cached for 30 seconds after stopping; no app-owned camera frames are retained in that cache.
- Camera frames are not uploaded to a server, and video is not recorded. The app does not log image data.
- The app does not request microphone access.
- The transcript exists only in memory during the current app session. It is not stored as history and is cleared when the app process ends.
- Copying text explicitly places the selected transcript on the system clipboard.
- Camera use pauses when the app backgrounds or the user leaves the camera screen. The user must resume the session.

There is no backend or external language model. The sentence encoder and English decoder are bundled local models; sentence translation does not upload video, landmarks, or text. Release builds do not fall back to a model-download server. Model inference runs locally with TensorFlow Lite. Any future remote inference or language-processing feature must explain what data leaves the device before it is enabled.

