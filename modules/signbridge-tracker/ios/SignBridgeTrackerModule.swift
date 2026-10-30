import ExpoModulesCore

public final class SignBridgeTrackerModule: Module {
  private let callTracker = CallLandmarkTracker()
  public func definition() -> ModuleDefinition {
    Name("SignBridgeTracker")
    Events("onCallLandmarks", "onCallTrackingError")
    Function("startCallAudio") { SBCallFrameProcessor.prepareCallAudio() }
    Function("stopCallAudio") { SBCallFrameProcessor.restoreCallAudio() }
    AsyncFunction("startCallTracking") { (token: Int) in
      try self.callTracker.start(token: token,
        emit: { [weak self] payload in self?.sendEvent("onCallLandmarks", payload) },
        fail: { [weak self] payload in self?.sendEvent("onCallTrackingError", payload) })
    }
    Function("stopCallTracking") { (token: Int) in self.callTracker.stop(token: token) }
    OnDestroy { self.callTracker.stop(); SBCallFrameProcessor.restoreCallAudio() }
    View(SignBridgeTrackerView.self) {
      Events("onLandmarks", "onReady", "onPreviewReady", "onError")
      Prop("facing") { (view: SignBridgeTrackerView, facing: String) in
        view.facing = facing
      }
    }
  }
} 

