package expo.modules.signbridgetracker

import android.content.Context
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarker
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** All access, including inference, stays on worker. Cache weights, never camera frames. */
internal object TrackerModels {
  val worker = Executors.newSingleThreadScheduledExecutor()
  class Models(val hands: HandLandmarker, val pose: PoseLandmarker, val face: FaceLandmarker)
  private var cached: Models? = null
  private var users = 0
  private var generation = 0

  fun acquire(context: Context): Models {
    val models = cached ?: load(context).also { cached = it }
    users++
    generation++
    return models
  }

  fun release() {
    users--
    val idleGeneration = ++generation
    worker.schedule({
      if (users == 0 && generation == idleGeneration) {
        val models = cached
        cached = null
        models?.hands?.close()
        models?.pose?.close()
        models?.face?.close()
      }
    }, 30, TimeUnit.SECONDS)
  }

  private fun options(path: String) = BaseOptions.builder().setModelAssetPath(path).build()

  private fun load(context: Context): Models {
    var hands: HandLandmarker? = null
    var pose: PoseLandmarker? = null
    try {
      hands = HandLandmarker.createFromOptions(context, HandLandmarker.HandLandmarkerOptions.builder()
        .setBaseOptions(options("hand_landmarker.task")).setRunningMode(RunningMode.VIDEO)
        .setNumHands(2).setMinHandDetectionConfidence(0.6f).setMinTrackingConfidence(0.6f).build())
      pose = PoseLandmarker.createFromOptions(context, PoseLandmarker.PoseLandmarkerOptions.builder()
        .setBaseOptions(options("pose_landmarker_lite.task")).setRunningMode(RunningMode.VIDEO)
        .setNumPoses(1).build())
      val face = FaceLandmarker.createFromOptions(context, FaceLandmarker.FaceLandmarkerOptions.builder()
        .setBaseOptions(options("face_landmarker.task")).setRunningMode(RunningMode.VIDEO)
        .setNumFaces(1).setOutputFaceBlendshapes(true).build())
      return Models(hands, pose, face)
    } catch (error: Exception) {
      hands?.close()
      pose?.close()
      throw error
    }
  }
} 

