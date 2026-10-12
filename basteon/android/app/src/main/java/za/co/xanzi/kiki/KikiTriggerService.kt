package za.co.xanzi.kiki

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.LocationManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.media.app.NotificationCompat.MediaStyle
import android.view.KeyEvent
import android.content.Intent.EXTRA_KEY_EVENT
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

class KikiTriggerService : Service() {
    companion object {
        const val GAP_MS = 650L
        const val SETTLE_MS = 900L
        private const val HEARTBEAT_MS = 5 * 60 * 1000L
        private const val NOTIFICATION_ID = 401
        const val COUNTDOWN_NOTIFICATION_ID = 402
        private const val COUNTDOWN_CHANNEL = "kiki_trigger_countdown"
        const val ACTION_CANCEL_PENDING = "za.co.xanzi.kiki.CANCEL_PENDING_TRIGGER"
        private const val PRACTICE_WINDOW_MS = 60_000L
        private const val TAG = "KikiTrigger"

        @Volatile var running = false
        @Volatile var practice = false
        @Volatile var instance: KikiTriggerService? = null
        @Volatile var listener: ((JSONObject) -> Unit)? = null

        private val logBuffer = ArrayDeque<String>()

        fun log(message: String) {
            synchronized(logBuffer) {
                logBuffer.addLast(message)
                while (logBuffer.size > 100) logBuffer.removeFirst()
            }
            Log.d(TAG, message)
        }

        fun logLines(): List<String> = synchronized(logBuffer) { logBuffer.toList() }

        fun sendHealthSync() {
            instance?.let { service ->
                Thread({ service.sendHeartbeat() }, "kiki-trigger-health").apply { isDaemon = true }.start()
            }
        }
    }

    private lateinit var mediaSession: MediaSessionCompat
    private var audioTrack: AudioTrack? = null
    @Volatile private var audioRunning = false
    private val main = Handler(Looper.getMainLooper())
    private val recognizer = PressPatternRecognizer(GAP_MS)
    private val sequenceKeys = ArrayList<Int>()
    private var lastOrigin = "media_button"
    private var practiceExpiresAt = 0L

    private val settle = Runnable { evaluateSequence() }
    private val practiceExpiry = Runnable {
        if (!practice) return@Runnable
        val prefs = Store.prefs(this)
        prefs.edit()
            .putBoolean("practiceMode", false)
            .putBoolean("wantArmed", false)
            .remove("practiceExpiresAt")
            .apply()
        practice = false
        log("practice window expired; trigger disarmed")
        stopSelf()
    }
    private val heartbeat = object : Runnable {
        override fun run() {
            if (Store.prefs(this@KikiTriggerService).getBoolean("wantArmed", false) && !practice) {
                Thread { sendHeartbeat() }.start()
            }
            main.postDelayed(this, HEARTBEAT_MS)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val prefs = Store.prefs(this)
        if (!running && !practice &&
            (!prefs.getBoolean("wantArmed", false) || prefs.getString("token", null) == null)
        ) {
            stopSelf(startId)
            return START_NOT_STICKY
        }
        if (intent?.action == ACTION_CANCEL_PENDING) {
            cancelTrigger()
            return START_STICKY
        }
        return START_STICKY
    }

    override fun onCreate() {
        super.onCreate()
        val prefs = Store.prefs(this)
        practiceExpiresAt = prefs.getLong("practiceExpiresAt", 0L)
        practice = prefs.getBoolean("practiceMode", false) && practiceExpiresAt > System.currentTimeMillis()
        if (prefs.getBoolean("practiceMode", false) && !practice) {
            prefs.edit()
                .putBoolean("practiceMode", false)
                .putBoolean("wantArmed", false)
                .remove("practiceExpiresAt")
                .apply()
        }
        if (!practice && (!prefs.getBoolean("wantArmed", false) || prefs.getString("token", null) == null)) {
            stopSelf()
            return
        }
        if (practice) schedulePracticeExpiry(practiceExpiresAt)

        mediaSession = MediaSessionCompat(this, "Kiki Bluetooth trigger").apply {
            setFlags(
                MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or
                    MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
            )
            setCallback(mediaCallback())
            setMetadata(
                MediaMetadataCompat.Builder()
                    .putString(MediaMetadataCompat.METADATA_KEY_TITLE, "Kiki trigger")
                    .build()
            )
            setPlaybackState(
                PlaybackStateCompat.Builder()
                    .setActions(
                        PlaybackStateCompat.ACTION_PLAY_PAUSE or
                            PlaybackStateCompat.ACTION_PLAY or
                            PlaybackStateCompat.ACTION_PAUSE or
                            PlaybackStateCompat.ACTION_STOP or
                            PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                            PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                    )
                    .setState(PlaybackStateCompat.STATE_PLAYING, 0, 1f)
                    .build()
            )
            isActive = true
        }

        val channel = "kiki_trigger_armed"
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(channel, "Kiki trigger", NotificationManager.IMPORTANCE_LOW)
        )
        manager.createNotificationChannel(
            NotificationChannel(COUNTDOWN_CHANNEL, "Kiki alert countdown", NotificationManager.IMPORTANCE_HIGH)
        )
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = launch?.let {
            PendingIntent.getActivity(
                this,
                0,
                it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }
        val notification: Notification = NotificationCompat.Builder(this, channel)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(if (prefs.getBoolean("test", true)) "Kiki trigger · test mode" else "Kiki trigger is armed")
            .setContentText("Bluetooth button patterns are being monitored")
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .setStyle(MediaStyle().setMediaSession(mediaSession.sessionToken))
            .build()
        updateForeground(notification)

        startSilentMediaSessionOutput()
        running = true
        instance = this
        DeviceTracker.start(this)
        main.removeCallbacks(heartbeat)
        main.postDelayed(heartbeat, HEARTBEAT_MS)
        if (!practice) sendHealthSync()
        log("foreground trigger started")
    }

    override fun onDestroy() {
        running = false
        instance = null
        practice = false
        audioRunning = false
        main.removeCallbacks(settle)
        main.removeCallbacks(heartbeat)
        main.removeCallbacks(practiceExpiry)
        audioTrack?.runCatching { pause(); flush(); release() }
        audioTrack = null
        if (::mediaSession.isInitialized) {
            mediaSession.isActive = false
            mediaSession.release()
        }
        log("foreground trigger stopped")
        super.onDestroy()
    }

    private fun mediaCallback() = object : MediaSessionCompat.Callback() {
        @Suppress("DEPRECATION")
        override fun onMediaButtonEvent(intent: Intent): Boolean {
            val event = if (Build.VERSION.SDK_INT >= 33) {
                intent.getParcelableExtra(EXTRA_KEY_EVENT, KeyEvent::class.java)
            } else {
                intent.getParcelableExtra(EXTRA_KEY_EVENT)
            }
            if (event != null && event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0 && isTriggerKey(event.keyCode)) {
                onPress("media_button", event.keyCode)
            }
            return true
        }

        override fun onPlay() = onPress("media_session", KeyEvent.KEYCODE_MEDIA_PLAY)
        override fun onPause() = onPress("media_session", KeyEvent.KEYCODE_MEDIA_PAUSE)
        override fun onStop() = onPress("media_session", KeyEvent.KEYCODE_MEDIA_STOP)
        override fun onSkipToNext() = onPress("media_session", KeyEvent.KEYCODE_MEDIA_NEXT)
        override fun onSkipToPrevious() = onPress("media_session", KeyEvent.KEYCODE_MEDIA_PREVIOUS)
    }

    private fun isTriggerKey(code: Int) = code in setOf(
        KeyEvent.KEYCODE_HEADSETHOOK,
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
        KeyEvent.KEYCODE_MEDIA_PLAY,
        KeyEvent.KEYCODE_MEDIA_PAUSE,
        KeyEvent.KEYCODE_MEDIA_NEXT,
        KeyEvent.KEYCODE_MEDIA_PREVIOUS
    )

    private fun startSilentMediaSessionOutput() {
        val sampleRate = 8_000
        val bufferSize = AudioTrack.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        if (bufferSize <= 0) {
            log("media session output unavailable")
            return
        }
        val track = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setSampleRate(sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .build()
            )
            .setBufferSizeInBytes(bufferSize)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
        track.setVolume(0f)
        audioTrack = track
        track.play()
        audioRunning = true
        Thread({
            val silentFrame = ByteArray(bufferSize)
            while (audioRunning) {
                val written = try {
                    track.write(silentFrame, 0, silentFrame.size)
                } catch (_: IllegalStateException) {
                    break
                }
                if (written < 0) break
            }
        }, "kiki-silent-media-session").apply { isDaemon = true }.start()
    }

    private fun onPress(origin: String, keyCode: Int) {
        main.post {
            if (!running && !practice) return@post
            val eventCount = recognizer.press(SystemClock.elapsedRealtime())
            lastOrigin = origin
            sequenceKeys.add(keyCode)
            if (sequenceKeys.size > 20) sequenceKeys.removeAt(0)
            listener?.invoke(
                JSONObject()
                    .put("type", "press")
                    .put("n", eventCount)
                    .put("origin", origin)
            )
            main.removeCallbacks(settle)
            main.postDelayed(settle, SETTLE_MS)
        }
    }

    fun schedulePracticeExpiry(expiresAt: Long) {
        practiceExpiresAt = expiresAt
        main.removeCallbacks(practiceExpiry)
        if (expiresAt > System.currentTimeMillis()) {
            main.postDelayed(practiceExpiry, expiresAt - System.currentTimeMillis())
        }
    }

    private fun evaluateSequence() {
        val result = recognizer.finish() ?: return
        val sequence = result.sequence
        val keys = JSONArray(sequenceKeys)
        val origin = lastOrigin
        sequenceKeys.clear()

        val pattern = result.pattern
        listener?.invoke(
            JSONObject()
                .put("type", "sequence")
                .put("sequence", sequence)
                .put("pattern", pattern ?: JSONObject.NULL)
                .put("origin", origin)
        )
        log("button sequence recognized (${pattern ?: "practice"})")
        if (practice) return

        val testMode = Store.prefs(this).getBoolean("test", true)
        when (pattern) {
            "sos" -> fire("sos", false, testMode, sequence)
            "medical" -> fire("medical", false, testMode, sequence)
            "duress" -> fire("sos", true, testMode, sequence)
            "cancel" -> cancelTrigger()
        }
    }

    private fun fire(type: String, duress: Boolean, testMode: Boolean, pattern: String) {
        vibrate(if (duress) longArrayOf(0, 350, 180, 350) else longArrayOf(0, 80, 100, 80))
        val location = lastKnownLocation()
        Thread({
            val payload = JSONObject()
                .put("type", type)
                .put("duress", duress)
                .put("test", testMode)
                .put("src", "bt_media")
                .put("pattern", pattern.take(20))
            if (location != null) {
                payload.put("lat", location.latitude)
                    .put("lng", location.longitude)
                    .put("accuracy_m", location.accuracy.toDouble())
                    .put("loc_at", iso(location.time))
            }
            var result = TriggerHttpResult(-1, null)
            for (attempt in 1..3) {
                result = post("/api/trigger/fire", payload)
                if (result.status in 200..499) break
                Thread.sleep(2_000L * attempt)
            }
            log("trigger request completed (HTTP ${result.status})")
            if (result.status !in 200..299) {
                vibrate(longArrayOf(0, 800))
            } else {
                val pendingId = result.body?.optString("pending_id").orEmpty()
                if (result.body?.optBoolean("test", false) != true && pendingId.isNotBlank()) {
                    showCancelNotification(result.body?.optInt("countdown_s", 10) ?: 10)
                }
                if (!duress) vibrate(longArrayOf(0, 70, 80, 70, 80, 70))
            }
        }, "kiki-trigger-fire").apply { isDaemon = true }.start()
    }

    private fun cancelTrigger() {
        Thread({
            val result = post("/api/trigger/cancel", JSONObject())
            log("trigger cancel completed (HTTP ${result.status})")
            if (result.status in 200..299) {
                (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).cancel(COUNTDOWN_NOTIFICATION_ID)
                main.post { showArmedNotification("Pending alert cancelled.") }
                vibrate(longArrayOf(0, 350, 150, 350))
            } else {
                vibrate(longArrayOf(0, 60))
            }
        }, "kiki-trigger-cancel").apply { isDaemon = true }.start()
    }

    private fun sendHeartbeat() {
        if (!running || practice) return
        val prefs = Store.prefs(this)
        val powerManager = getSystemService(POWER_SERVICE) as PowerManager
        val version = runCatching {
            packageManager.getPackageInfo(packageName, 0).versionName ?: ""
        }.getOrDefault("")
        val payload = JSONObject()
            .put("armed", running && !practice)
            .put("test", prefs.getBoolean("test", true))
            .put("app_version", version.take(20))
            .put("sdk", Build.VERSION.SDK_INT)
            .put("model", Build.MODEL.take(40))
            .put("battery_unrestricted", powerManager.isIgnoringBatteryOptimizations(packageName))
            .put("devices", DeviceTracker.syncPayload(this))
        val result = post("/api/trigger/heartbeat", payload)
        log("trigger health sync completed (HTTP ${result.status})")
    }

    private data class TriggerHttpResult(val status: Int, val body: JSONObject?)

    private fun post(path: String, body: JSONObject): TriggerHttpResult {
        val prefs = Store.prefs(this)
        val base = prefs.getString("base", null) ?: return TriggerHttpResult(-2, null)
        val token = prefs.getString("token", null) ?: return TriggerHttpResult(-2, null)
        return try {
            val connection = URL(base.trimEnd('/') + path).openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.connectTimeout = 8_000
            connection.readTimeout = 8_000
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { stream -> stream.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            val responseStream = if (status in 200..299) connection.inputStream else connection.errorStream
            val responseBody = responseStream?.bufferedReader(Charsets.UTF_8)?.use { reader ->
                JSONObject(reader.readText())
            }
            connection.disconnect()
            TriggerHttpResult(status, responseBody)
        } catch (_: Exception) {
            TriggerHttpResult(-1, null)
        }
    }

    private fun showCancelNotification(countdownSeconds: Int) {
        val cancelIntent = Intent(this, TriggerCancelReceiver::class.java).setAction(ACTION_CANCEL_PENDING)
        val cancelPendingIntent = PendingIntent.getBroadcast(
            this,
            2,
            cancelIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(this, COUNTDOWN_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("Kiki alert countdown")
            .setContentText("Alert starts in $countdownSeconds seconds. Cancel if this was accidental.")
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setWhen(System.currentTimeMillis() + countdownSeconds * 1_000L)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Cancel alert", cancelPendingIntent)
            .build()
        main.post {
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
                .notify(COUNTDOWN_NOTIFICATION_ID, notification)
        }
    }

    private fun showArmedNotification(message: String) {
        if (!running) return
        val prefs = Store.prefs(this)
        val notification = NotificationCompat.Builder(this, "kiki_trigger_armed")
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(if (prefs.getBoolean("test", true)) "Kiki trigger · test mode" else "Kiki trigger is armed")
            .setContentText(message)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setStyle(MediaStyle().setMediaSession(mediaSession.sessionToken))
            .build()
        updateForeground(notification)
    }

    private fun updateForeground(notification: Notification) {
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun lastKnownLocation(): android.location.Location? {
        val fine = ContextCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!fine && !coarse) return null
        return try {
            val manager = getSystemService(LOCATION_SERVICE) as LocationManager
            listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
                .mapNotNull { provider -> runCatching { manager.getLastKnownLocation(provider) }.getOrNull() }
                .maxByOrNull { it.time }
        } catch (_: SecurityException) {
            null
        }
    }

    private fun vibrate(pattern: LongArray) {
        val vibrator = if (Build.VERSION.SDK_INT >= 31) {
            (getSystemService(VIBRATOR_MANAGER_SERVICE) as android.os.VibratorManager).defaultVibrator
        } else {
            getSystemService(VIBRATOR_SERVICE) as Vibrator
        }
        if (Build.VERSION.SDK_INT >= 26) {
            vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(pattern, -1)
        }
    }

    private fun iso(timestamp: Long): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
            .apply { timeZone = TimeZone.getTimeZone("UTC") }
            .format(Date(timestamp))

}
