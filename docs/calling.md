# SignBridge conversations

The app now has two entry points: **Start or join a call** and **Open translator**.
Calls are foreground, one-to-one WebRTC video calls joined with a private 12-character
invitation. No account, contact upload, push ringing, or call recording is implemented.

## Caller experience

1. Enter a display name. Choose AI sign captions and whether to start with audio.
   The microphone defaults off and requires permission only if enabled.
2. Start a call and privately share its code. The other person enters that code.
   The invitation admits one guest and expires after 15 minutes of waiting.
3. Each video tile has a caption strip immediately below it. Only the sender's
   own caption appears below that sender's video on both phones.
4. AI captions start processing your camera as soon as it is available, including
   while you are alone waiting for a guest. A private **AI PREVIEW · ONLY YOU**
   appears beneath your video, along with hand/shoulder tracking feedback and
   recognition progress. A missing frame feed shows an error and a restart action.
   Start with your hands lowered, sign one word, then lower both hands and pause,
   or tap **Finish sign**. Once your guest connects, choose a suggestion to share it.
   Practice guesses are cleared when the connection changes and are not queued
   for automatic sending. The separate
   **Share guesses automatically** switch sends the first suggestion and labels
   it **AI GUESS · UNREVIEWED** on both devices. This option defaults off.
5. **Short sentence** records up to 12 seconds using the existing local sentence
   model. A draft must be reviewed and shared explicitly. Typed captions can
   replace an incorrect caption at any time. Clear removes your caption remotely.
6. End call releases tracks, the peer connection, signaling, and caption state.
   Leaving the screen or backgrounding the app also ends this first-version call.

### Focus call view

Enable **Focus call view** before starting/joining, or tap **Focus call** during
a call. This view keeps the videos and their captions on a dark background.
The fixed bottom bar uses symbols for microphone, camera, flip camera, AI sign
captions, and end call. Controls retain full accessibility labels and 48-point
touch targets. The top layout symbol cycles through both videos, an enlarged
guest video, and your enlarged video. The exit-focus symbol returns to the full
page without ending the call or resetting AI recognition.

The hand symbol toggles AI sign captions. With captions enabled, the compact AI
bar offers **Finish sign** and an options symbol. Open options to choose isolated
words or short sentences, review a draft, or explicitly enable automatic sharing
of unreviewed guesses. Private previews work while waiting for a guest. Changing
the page layout does not change the sharing preference. Large text and smaller
screens can scroll the video area while the call controls stay available.

The existing models remain experimental. The word path uses the fixed 500-word
dictionary plus enabled personal templates. Continuous native ASL interpretation
and broad live accuracy are not established by adding calls. Sentence translation
retains its existing research limitations. See `model-limitations.md`.

## Connect two phones during development

Install dependencies with `npm install`, then run `npm run calls:server` in a terminal.
For local development, both phones automatically use the call service on port
8787 of the computer serving their Expo project when no explicit service is set.
Open the same Mac's LAN development server on both phones and reload both apps
after updating the code. `npm start` exposes Metro to your Wi-Fi network; a
localhost-only server cannot serve the second phone over Wi-Fi.

To explicitly choose a shared service, create `.env.local` containing:

```dotenv
EXPO_PUBLIC_CALL_SIGNAL_URL=ws://YOUR_COMPUTER_LAN_IP:8787/calls
```

Both phones must be able to reach that computer. Use its LAN IP, not localhost.
An explicit service address takes priority over automatic development discovery.
Discovery is limited to local development hosts; Expo tunnels do not expose port
8787. Production builds still require a configured WSS endpoint.
Restart Metro after editing the environment file. Build and install the updated
native app on each phone with `npm run ios -- --device` or `npm run android`.
Adding WebRTC and native frame processors requires a rebuild; an older installed
development build cannot gain calling through a JavaScript refresh alone.

The development server supplies STUN. Calls across restrictive networks may need
a TURN relay even in development. Pass TURN_URLS and TURN_SECRET to the server
to enable temporary relay credentials. Local development signaling is unencrypted;
use secure signaling outside your development network.

## Production deployment

The signaling service is `server/calls.mjs`, with a standalone package and Dockerfile:

```bash
docker build -t signbridge-calls ./server
docker run --env-file server/.env -p 8787:8787 signbridge-calls
```

Provide real values for the variables documented in `server/.env.example`.
Configure a TURN service using the same shared-secret authentication key. The
server creates expiring TURN credentials; the secret never belongs in the mobile
bundle. Production startup refuses a missing TURN configuration.

Put the service behind TLS and expose `wss://YOUR_DOMAIN/calls`. The reverse proxy
must support WebSocket upgrades and long-lived connections. Rate-limit upgrades
by the actual client IP at the proxy. The built-in limit uses socket addresses
and deliberately does not trust client-supplied forwarding headers. Behind a
single proxy this limit applies to the proxy address (30 concurrent connections).
Adjust the limit deliberately for a larger deployment. `/health` is a health check.

Build the app with `EXPO_PUBLIC_CALL_SIGNAL_URL` set to this WSS endpoint. Packaged
builds reject WS, embedded credentials, and query-string credentials. No signaling
service, public domain, or relay is provisioned automatically by this repository.

Rooms are memory-only and must stay on one server instance. For multiple instances,
add shared room routing before scaling. Restarting the server ends active rooms.
Active rooms expire after two hours. Codes are random bearer invitations: anyone
given a valid code can take the guest slot. Display names are self-selected, not
verified identities. Do not publish invitation codes.

## Implementation

- `src/calls/call-session.ts` owns media, SDP negotiation, buffered ICE candidates,
  the data channel, timeouts, and teardown. Generation checks reject late results.
- `server/calls.mjs` pairs two clients and relays connection metadata. It does not
  accept captions, store media, or log SDP and room codes.
- `src/calls/protocol.ts` validates bounded caption messages and their source labels.
- `CallCaptionComposer` reuses the existing local word, sentence, and personal
  recognizers. It is mounted only when the caller enables captions.
- The custom native module registers a WebRTC video effect named
  `signbridge-captions`. It observes the **same captured video track** being sent
  to the guest, returns that track unchanged, and sends only landmarks to JS.
- Native inference retains at most one sampled frame. Late samples are dropped;
  it never queues all call frames or opens a second camera. Inference is limited
  to at most 12.5 samples/second; actual device throughput can be lower.
- iOS reads CVPixelBuffer camera frames and their rotation. Android copies I420
  pixels into an upright bitmap in memory. No intermediate image files are written.
- The WebRTC video-effects API is version-specific. Recheck native frame ownership
  and rotation before upgrading `react-native-webrtc`.

## Validation

Run `npm run test`, `npm run test:calls-server`, `npm run lint`, and
`npm run typecheck`. Server integration tests connect real local WebSocket clients.
Client tests cover late permissions, ICE ordering, channel readiness, caption
provenance, stale messages, duplicate starts, timeouts, and resource cleanup.

Verified during implementation on October 30, 2026: lint and TypeScript passed;
199 app tests and 4 real-WebSocket server tests passed. The iOS simulator app
build and Android tracker/WebRTC compilation passed. The installed iOS simulator
app loaded the updated home screen and call lobby, with the invitation form and
microphone-off default checked. A two-phone media call and live sign recognition
have not yet been verified.

Before release, test two physical phones on different networks with TURN enabled:
both camera directions, camera/mic permission denial, mute/unmute, AI on/off,
reviewed and automatic captions, sentence cancellation, personal signs, typed
corrections, large text, network interruption, backgrounding, and hang-up.
Measure signer-diverse recognition accuracy and call latency separately. Unit
tests and a successful native build do not establish live recognition accuracy.
