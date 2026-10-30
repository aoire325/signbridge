package expo.modules.signbridgetracker

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import android.content.Context
import android.media.AudioManager

class SignBridgeTrackerModule : Module() {
  private val callTracker = CallLandmarkTracker()
  private var audio: AudioManager? = null
  private var previousMode = AudioManager.MODE_NORMAL
  private var previousSpeaker = false
  private fun stopAudio() {
    audio?.let { it.isSpeakerphoneOn = previousSpeaker; it.mode = previousMode }
    audio = null
  }
  override fun definition() = ModuleDefinition {
    Name("SignBridgeTracker")
    Events("onCallLandmarks", "onCallTrackingError")
    Function("startCallAudio") {
      if (audio == null) {
        val manager = appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        if (manager != null) {
          previousMode = manager.mode; previousSpeaker = manager.isSpeakerphoneOn
          audio = manager; manager.mode = AudioManager.MODE_IN_COMMUNICATION
          // Wired/Bluetooth routing remains handled by Android; use the loud
          // speaker as the built-in output for a hands-free signing call.
          manager.isSpeakerphoneOn = true
        }
      }
    }
    Function("stopCallAudio") { stopAudio() }
    AsyncFunction("startCallTracking") { token: Int ->
      val context = appContext.reactContext ?: throw IllegalStateException("The app is not ready for call tracking.")
      callTracker.start(context.applicationContext, token,
        { payload -> sendEvent("onCallLandmarks", payload) },
        { payload -> sendEvent("onCallTrackingError", payload) })
    }
    Function("stopCallTracking") { token: Int -> callTracker.stop(token) }
    OnDestroy { callTracker.stop(); stopAudio() }
    View(SignBridgeTrackerView::class) {
      Events("onLandmarks", "onReady", "onPreviewReady", "onError")
      Prop("facing") { view: SignBridgeTrackerView, facing: String ->
        view.facing = facing
      }
    }
  }
} 

