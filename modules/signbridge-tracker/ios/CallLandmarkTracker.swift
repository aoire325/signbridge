import ExpoModulesCore
import MediaPipeTasksVision
import UIKit

final class CallLandmarkTracker {
  private let lock = NSLock()
  private var token: Int?
  private var latestToken = -1
  private var busy = false
  private var lastTimestamp = -1
  // Accessed only on TrackerModels.worker, shared with the translator camera.
  private var models: TrackerModels.Models?
  private var lease = false

  func start(token: Int, emit: @escaping ([String: Any]) -> Void, fail: @escaping ([String: Any]) -> Void) throws {
    // Expo's AsyncFunction runs off the main thread; serialize all model access.
    try TrackerModels.worker.sync {
      lock.lock()
      guard token >= latestToken else { lock.unlock(); return }
      latestToken = token
      lock.unlock()
      if !lease { models = try TrackerModels.acquire(); lease = true }
      lock.lock(); self.token = token; lastTimestamp = -1; lock.unlock()
      SBCallFrameProcessor.install { [weak self] buffer, rotation in
        self?.accept(buffer, rotation: rotation, token: token, emit: emit, fail: fail)
      }
    }
  }

  func stop(token expected: Int? = nil) {
    lock.lock()
    if let expected, token != expected { lock.unlock(); return }
    token = nil
    SBCallFrameProcessor.uninstall()
    lock.unlock()
    TrackerModels.worker.async { [self] in
      lock.lock(); let stopped = token == nil; lock.unlock()
      if stopped && lease { lease = false; models = nil; TrackerModels.release() }
    }
  }

  private func accept(_ buffer: CVPixelBuffer, rotation: Int, token expected: Int,
                      emit: @escaping ([String: Any]) -> Void, fail: @escaping ([String: Any]) -> Void) {
    let timestamp = Int(ProcessInfo.processInfo.systemUptime * 1000)
    lock.lock()
    guard token == expected, !busy, timestamp - lastTimestamp >= 80 else { lock.unlock(); return }
    busy = true; lastTimestamp = timestamp
    lock.unlock()
    // Capturing the pixel buffer retains it until inference completes. At most
    // one frame is retained; video transmission continues independently.
    TrackerModels.worker.async { [self] in
      defer { lock.lock(); busy = false; lock.unlock() }
      lock.lock(); let current = token == expected; lock.unlock()
      guard current, let models else { return }
      do {
        let orientation: UIImage.Orientation
        switch rotation { case 90: orientation = .right; case 180: orientation = .down; case 270: orientation = .left; default: orientation = .up }
        let image = try MPImage(pixelBuffer: buffer, orientation: orientation)
        let hands = try models.hands.detect(videoFrame: image, timestampInMilliseconds: timestamp)
        let pose = try models.pose.detect(videoFrame: image, timestampInMilliseconds: timestamp)
        let face = try models.face.detect(videoFrame: image, timestampInMilliseconds: timestamp)
        func points(_ values: [NormalizedLandmark]) -> [[String: Float]] {
          values.map { ["x": $0.x, "y": $0.y, "z": $0.z, "visibility": $0.visibility?.floatValue ?? 1] }
        }
        let handData: [[String: Any]] = hands.landmarks.enumerated().map { index, landmarks in
          let category = hands.handedness[index].first
          return ["side": category?.categoryName ?? "Unknown", "score": category?.score ?? 0, "landmarks": points(landmarks)]
        }
        var expressions: [String: Float] = [:]
        for category in face.faceBlendshapes.first?.categories ?? [] {
          if let name = category.categoryName { expressions[name] = category.score }
        }
        let width = CVPixelBufferGetWidth(buffer); let height = CVPixelBufferGetHeight(buffer)
        let rotated = rotation == 90 || rotation == 270
        let payload: [String: Any] = ["token": expected, "timestampMs": timestamp,
          "width": rotated ? height : width, "height": rotated ? width : height,
          "hands": handData, "pose": points(pose.landmarks.first ?? []), "face": points(face.faceLandmarks.first ?? []),
          "blendshapes": expressions, "inferenceMs": Int(ProcessInfo.processInfo.systemUptime * 1000) - timestamp]
        lock.lock(); let valid = token == expected; lock.unlock()
        if valid { emit(payload) }
      } catch {
        lock.lock(); let valid = token == expected; lock.unlock()
        if valid { fail(["token": expected, "message": error.localizedDescription]); stop(token: expected) }
      }
    }
  }
}
