import AVFoundation
import ExpoModulesCore
import MediaPipeTasksVision

final class SignBridgeTrackerView: ExpoView, AVCaptureVideoDataOutputSampleBufferDelegate {
  let onLandmarks = EventDispatcher()
  let onReady = EventDispatcher()
  let onPreviewReady = EventDispatcher()
  let onError = EventDispatcher()
  var facing = "front"
  private let session = AVCaptureSession()
  // One queue owns setup, inference and teardown, so buffers cannot outlive their models.
  private let worker = TrackerModels.worker
  private lazy var preview = AVCaptureVideoPreviewLayer(session: session)
  private var hands: HandLandmarker?
  private var pose: PoseLandmarker?
  private var face: FaceLandmarker?
  private var started = false
  private var running = false
  private var ready = false
  private var modelLease = false
  private var lastTimestamp = -100

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    preview.videoGravity = .resizeAspect
    layer.addSublayer(preview)
    NotificationCenter.default.addObserver(self, selector: #selector(interrupted),
      name: UIApplication.willResignActiveNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(captureInterrupted),
      name: AVCaptureSession.wasInterruptedNotification, object: session)
    NotificationCenter.default.addObserver(self, selector: #selector(captureInterrupted),
      name: AVCaptureSession.runtimeErrorNotification, object: session)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    preview.frame = bounds
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil && !started {
      started = true
      let useFront = facing == "front"
      worker.async { [weak self] in self?.start(useFront: useFront) }
    } else if window == nil {
      interrupted()
    }
  }

  @objc private func interrupted() {
    worker.async { self.stop() }
  }

  @objc private func captureInterrupted() {
    fail("Camera interrupted. Start a new session when the camera is available.")
    interrupted()
  }

  private func start(useFront: Bool) {
    do {
      guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video,
        position: useFront ? .front : .back) else {
        throw NSError(domain: "SignBridge", code: 2,
          userInfo: [NSLocalizedDescriptionKey: "This device has no camera for the selected direction."])
      }
      let input = try AVCaptureDeviceInput(device: device)
      let output = AVCaptureVideoDataOutput()
      output.alwaysDiscardsLateVideoFrames = true
      output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
      output.setSampleBufferDelegate(self, queue: worker)
      session.beginConfiguration()
      session.sessionPreset = .vga640x480
      guard session.canAddInput(input), session.canAddOutput(output) else {
        session.commitConfiguration()
        throw NSError(domain: "SignBridge", code: 3,
          userInfo: [NSLocalizedDescriptionKey: "Live camera output is unavailable."])
      }
      session.addInput(input)
      session.addOutput(output)
      // Portrait pixel buffers, unmirrored on both platforms. Mirror only the front preview.
      if let connection = output.connection(with: .video) {
        connection.videoOrientation = .portrait
        connection.automaticallyAdjustsVideoMirroring = false
        if connection.isVideoMirroringSupported { connection.isVideoMirrored = false }
      }
      session.commitConfiguration()
      DispatchQueue.main.async { [weak self] in
        guard let self, let connection = self.preview.connection else { return }
        connection.videoOrientation = .portrait
        connection.automaticallyAdjustsVideoMirroring = false
        if connection.isVideoMirroringSupported { connection.isVideoMirrored = useFront }
      }
      running = true
      session.startRunning()
      DispatchQueue.main.async { [weak self] in
        guard let self, self.window != nil, UIApplication.shared.applicationState == .active else { return }
        self.onPreviewReady([:])
      }
      // The preview is already running while models initialize on the worker.
      let models = try TrackerModels.acquire()
      modelLease = true
      hands = models.hands
      pose = models.pose
      face = models.face
    } catch {
      fail(error.localizedDescription)
      stop()
    }
  }

  private func points(_ landmarks: [NormalizedLandmark]) -> [[String: Float]] {
    landmarks.map { ["x": $0.x, "y": $0.y, "z": $0.z, "visibility": $0.visibility?.floatValue ?? 1] }
  }

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer,
                     from connection: AVCaptureConnection) {
    let timestamp = Int(ProcessInfo.processInfo.systemUptime * 1000)
    // Keep motion detail when the device can process it. The serial worker and
    // alwaysDiscardsLateVideoFrames still prevent a backlog on slower phones.
    guard running, timestamp - lastTimestamp >= 33, let hands, let pose, let face,
          let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    lastTimestamp = timestamp
    do {
      let image = try MPImage(sampleBuffer: sampleBuffer, orientation: .up)
      let h = try hands.detect(videoFrame: image, timestampInMilliseconds: timestamp)
      // All three detectors observe the SAME frame, including hands-out pauses.
      // Face/upper-body movement can carry information between manual signs.
      let p = try pose.detect(videoFrame: image, timestampInMilliseconds: timestamp)
      let f = try face.detect(videoFrame: image, timestampInMilliseconds: timestamp)
      let handData: [[String: Any]] = h.landmarks.enumerated().map { index, landmarks in
        let category = h.handedness[index].first
        return ["side": category?.categoryName ?? "Unknown", "score": category?.score ?? 0,
                "landmarks": points(landmarks)]
      }
      var blendshapes: [String: Float] = [:]
      for category in f.faceBlendshapes.first?.categories ?? [] {
        if let name = category.categoryName { blendshapes[name] = category.score }
      }
      let payload: [String: Any] = [
        "timestampMs": timestamp, "width": CVPixelBufferGetWidth(pixels), "height": CVPixelBufferGetHeight(pixels),
        "hands": handData, "pose": points(p.landmarks.first ?? []),
        "face": points(f.faceLandmarks.first ?? []), "blendshapes": blendshapes,
        "inferenceMs": Int(ProcessInfo.processInfo.systemUptime * 1000) - timestamp
      ]
      DispatchQueue.main.async { [weak self] in
        guard let self, self.window != nil, UIApplication.shared.applicationState == .active else { return }
        if !self.ready { self.ready = true; self.onReady([:]) }
        self.onLandmarks(payload)
      }
    } catch {
      fail(error.localizedDescription)
      stop()
    }
  }

  private func fail(_ message: String) {
    DispatchQueue.main.async { [weak self] in
      guard let self, self.window != nil else { return }
      self.onError(["message": message])
    }
  }

  private func stop() {
    running = false
    if session.isRunning { session.stopRunning() }
    hands = nil
    pose = nil
    face = nil
    if modelLease { modelLease = false; TrackerModels.release() }
  }

  deinit { NotificationCenter.default.removeObserver(self) }
}

// One queue owns model creation, inference, reuse and destruction.
enum TrackerModels {
  static let worker = DispatchQueue(label: "signbridge.landmarks", qos: .userInitiated)
  struct Models {
    let hands: HandLandmarker
    let pose: PoseLandmarker
    let face: FaceLandmarker
  }
  private static var cached: Models?
  private static var users = 0
  private static var generation = 0

  static func acquire() throws -> Models {
    let models: Models
    if let existing = cached { models = existing }
    else { models = try load(); cached = models }
    users += 1
    generation += 1
    return models
  }

  static func release() {
    users -= 1
    generation += 1
    let idleGeneration = generation
    worker.asyncAfter(deadline: .now() + 30) {
      if users == 0 && generation == idleGeneration { cached = nil }
    }
  }

  private static func modelPath(_ name: String) throws -> String {
    let host = Bundle(for: SignBridgeTrackerView.self)
    guard let url = host.url(forResource: "SignBridgeModels", withExtension: "bundle"),
          let bundle = Bundle(url: url),
          let path = bundle.path(forResource: name, ofType: "task") else {
      throw NSError(domain: "SignBridge", code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Missing landmark model. Rebuild the development app."])
    }
    return path
  }

  private static func load() throws -> Models {
    let handOptions = HandLandmarkerOptions()
    handOptions.baseOptions.modelAssetPath = try modelPath("hand_landmarker")
    handOptions.runningMode = .video
    handOptions.numHands = 2
    handOptions.minHandDetectionConfidence = 0.6
    handOptions.minTrackingConfidence = 0.6
    let hands = try HandLandmarker(options: handOptions)
    let poseOptions = PoseLandmarkerOptions()
    poseOptions.baseOptions.modelAssetPath = try modelPath("pose_landmarker_lite")
    poseOptions.runningMode = .video
    poseOptions.numPoses = 1
    let pose = try PoseLandmarker(options: poseOptions)
    let faceOptions = FaceLandmarkerOptions()
    faceOptions.baseOptions.modelAssetPath = try modelPath("face_landmarker")
    faceOptions.runningMode = .video
    faceOptions.numFaces = 1
    faceOptions.outputFaceBlendshapes = true
    let face = try FaceLandmarker(options: faceOptions)

    return Models(hands: hands, pose: pose, face: face)
  }
} 

