package expo.modules.signbridgetracker

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.SystemClock
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.components.containers.NormalizedLandmark
import com.oney.WebRTCModule.videoEffects.ProcessorProvider
import com.oney.WebRTCModule.videoEffects.VideoFrameProcessor
import com.oney.WebRTCModule.videoEffects.VideoFrameProcessorFactoryInterface
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoFrame
import java.util.concurrent.atomic.AtomicBoolean

/** Observe the call's existing video track. Never acquire a competing camera. */
internal class CallLandmarkTracker {
  @Volatile private var token: Int? = null
  private var latestToken = -1
  private val busy = AtomicBoolean(false)
  private var lastTimestamp = -1L
  private var models: TrackerModels.Models? = null
  private var lease = false

  fun start(context: Context, nextToken: Int, emit: (Map<String, Any>) -> Unit, fail: (Map<String, Any>) -> Unit) {
    TrackerModels.worker.submit {
      if (nextToken < latestToken) return@submit
      latestToken = nextToken
      if (!lease) { models = TrackerModels.acquire(context); lease = true }
      synchronized(this) { token = nextToken; lastTimestamp = -1L }
      ProcessorProvider.addProcessor("signbridge-captions", VideoFrameProcessorFactoryInterface {
      object : VideoFrameProcessor {
        override fun process(frame: VideoFrame, helper: SurfaceTextureHelper): VideoFrame {
          observe(frame, nextToken, emit, fail)
          // WebRTC's effect chain releases its input and owns the returned ref.
          frame.retain()
          return frame
        }
      }
      })
    }.get()
  }

  @Synchronized fun stop(expected: Int? = null) {
    if (expected != null && token != expected) return
    token = null
    TrackerModels.worker.execute {
      if (token == null && lease) { lease = false; models = null; TrackerModels.release() }
    }
  }

  private fun observe(frame: VideoFrame, expected: Int, emit: (Map<String, Any>) -> Unit, fail: (Map<String, Any>) -> Unit) {
    val timestamp = SystemClock.uptimeMillis()
    if (token != expected || timestamp - lastTimestamp < 80 || !busy.compareAndSet(false, true)) return
    lastTimestamp = timestamp
    // Texture-backed buffers must be read on the capture thread. Copy one I420
    // buffer, then release it on the worker; all later frames pass through.
    val buffer = try { frame.buffer.toI420() } catch (error: Exception) {
      busy.set(false); fail(mapOf("token" to expected, "message" to "Could not read the call camera frame.")); return
    }
    if (buffer == null) { busy.set(false); return }
    val rotation = frame.rotation
    TrackerModels.worker.execute {
      var bitmap: Bitmap? = null
      var upright: Bitmap? = null
      try {
        val current = models
        if (token != expected || current == null) return@execute
        bitmap = toBitmap(buffer)
        upright = if (rotation == 0) bitmap else Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height,
          Matrix().apply { postRotate(rotation.toFloat()) }, true)
        val image = BitmapImageBuilder(upright).build()
        try {
          val hands = current.hands.detectForVideo(image, timestamp)
          val pose = current.pose.detectForVideo(image, timestamp)
          val face = current.face.detectForVideo(image, timestamp)
          val payload = mapOf<String, Any>("token" to expected, "timestampMs" to timestamp.toDouble(),
            "width" to upright.width, "height" to upright.height,
            "hands" to hands.landmarks().mapIndexed { index, landmarks ->
              val category = hands.handedness()[index].first()
              mapOf("side" to category.categoryName(), "score" to category.score(), "landmarks" to points(landmarks))
            }, "pose" to points(pose.landmarks().firstOrNull() ?: emptyList()),
            "face" to points(face.faceLandmarks().firstOrNull() ?: emptyList()),
            "blendshapes" to (face.faceBlendshapes().orElse(emptyList()).firstOrNull()?.associate { it.categoryName() to it.score() } ?: emptyMap<String, Float>()),
            "inferenceMs" to (SystemClock.uptimeMillis() - timestamp).toDouble())
          if (token == expected) emit(payload)
        } finally { image.close() }
      } catch (error: Exception) {
        if (token == expected) { fail(mapOf("token" to expected, "message" to (error.message ?: "Call tracking failed."))); stop(expected) }
      } finally {
        if (upright !== bitmap) upright?.recycle()
        bitmap?.recycle(); buffer.release(); busy.set(false)
      }
    }
  }

  private fun points(values: List<NormalizedLandmark>) = values.map {
    mapOf("x" to it.x(), "y" to it.y(), "z" to it.z(), "visibility" to it.visibility().orElse(1f))
  }

  /** Convert at most 640x480 sampled pixels in memory, without JPEG or disk IO. */
  private fun toBitmap(buffer: VideoFrame.I420Buffer): Bitmap {
    val width = buffer.width; val height = buffer.height
    val pixels = IntArray(width * height)
    val y = buffer.dataY; val u = buffer.dataU; val v = buffer.dataV
    for (row in 0 until height) for (column in 0 until width) {
      val yy = (y.get(row * buffer.strideY + column).toInt() and 255) - 16
      val uu = (u.get(row / 2 * buffer.strideU + column / 2).toInt() and 255) - 128
      val vv = (v.get(row / 2 * buffer.strideV + column / 2).toInt() and 255) - 128
      val base = 298 * yy.coerceAtLeast(0)
      val red = ((base + 409 * vv + 128) shr 8).coerceIn(0, 255)
      val green = ((base - 100 * uu - 208 * vv + 128) shr 8).coerceIn(0, 255)
      val blue = ((base + 516 * uu + 128) shr 8).coerceIn(0, 255)
      pixels[row * width + column] = (255 shl 24) or (red shl 16) or (green shl 8) or blue
    }
    return Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888)
  }
}
