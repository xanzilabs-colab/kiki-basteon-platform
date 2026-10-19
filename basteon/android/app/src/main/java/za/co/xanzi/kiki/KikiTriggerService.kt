package za.co.xanzi.kiki

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.LocationManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
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
import android.view.InputDevice
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
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
import java.util.concurrent.ConcurrentHashMap
import za.co.xanzi.kiki.gesture.Gesture
import za.co.xanzi.kiki.gesture.GestureProfiles
import za.co.xanzi.kiki.gesture.KeyCodes
import za.co.xanzi.kiki.gesture.MatchResult
import za.co.xanzi.kiki.gesture.PressMerger
import za.co.xanzi.kiki.gesture.Profile
import za.co.xanzi.kiki.gesture.RawInput
import za.co.xanzi.kiki.gesture.Sequencer
import za.co.xanzi.kiki.gesture.Src
import za.co.xanzi.kiki.gesture.Tok
import za.co.xanzi.kiki.gesture.gapMsFor
import za.co.xanzi.kiki.gesture.matchGesture
import za.co.xanzi.kiki.gesture.settleMsFor
import za.co.xanzi.kiki.gesture.tokenForKeyCode

class KikiTriggerService : Service() {
    companion object {
        const val GAP_MS = 650L
        const val SETTLE_MS = 900L
        private const val HEARTBEAT_MS = 5 * 60 * 1000L
        private const val NOTIFICATION_ID = 401
        const val COUNTDOWN_NOTIFICATION_ID = 402
        const val CANCEL_RESULT_NOTIFICATION_ID = 403
        const val COUNTDOWN_CHANNEL = "kiki_trigger_countdown"
        const val ACTION_CANCEL_PENDING = "za.co.xanzi.kiki.CANCEL_PENDING_TRIGGER"
        private const val PRACTICE_WINDOW_MS = 10 * 60 * 1000L
        private const val HOLD_THRESHOLD_MS = 600L
        private const val VOLUME_CHANGED_ACTION = "android.media.VOLUME_CHANGED_ACTION"
        private const val TAG = "KikiTrigger"
        private const val MAX_PENDING_DIAGNOSTICS = 20
        private const val MAX_TRACE_ENTRIES = 200
        private val diagnosticLock = Any()
        private val traceLock = Any()

        @Volatile var running = false
        @Volatile var practice = false
        @Volatile var instance: KikiTriggerService? = null
        @Volatile var listener: ((JSONObject) -> Unit)? = null
        @Volatile var captureEnabled = false
        @Volatile var captureVerificationEnabled = false
        @Volatile var captureProfileId: String? = null
        @Volatile var captureGapMs = GAP_MS
        @Volatile var captureSettleMs = SETTLE_MS
        @Volatile var pendingCountdown = false

        private val logBuffer = ArrayDeque<String>()
        private val traceBuffer = ArrayDeque<JSONObject>()

        fun log(message: String) {
            synchronized(logBuffer) {
                logBuffer.addLast(message)
                while (logBuffer.size > MAX_TRACE_ENTRIES) logBuffer.removeFirst()
            }
            val layer = when {
                message.contains("input raw", ignoreCase = true) -> "INPUT"
                message.contains("match outcome", ignoreCase = true) -> "MATCH"
                message.contains("media button", ignoreCase = true) -> "INPUT"
                message.contains("gesture sequence", ignoreCase = true) -> "GESTURE"
                message.contains("gesture device", ignoreCase = true) || message.contains("gesture profile", ignoreCase = true) -> "MATCH"
                message.contains("push", ignoreCase = true) -> "DELIVERY"
                else -> "SERVER"
            }
            synchronized(traceLock) {
                traceBuffer.addLast(
                    JSONObject()
                        .put("at", isoTimestamp(System.currentTimeMillis()))
                        .put("layer", layer)
                        .put("status", message.take(180))
                )
                while (traceBuffer.size > MAX_TRACE_ENTRIES) traceBuffer.removeFirst()
            }
            Log.d(TAG, message)
        }

        fun logLines(): List<String> = synchronized(logBuffer) { logBuffer.toList() }

        fun traceEntries(): List<JSONObject> = synchronized(traceLock) { traceBuffer.map { JSONObject(it.toString()) } }

        fun countdownNotificationBlockReason(context: Context): String? {
            if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
                return "Enable Kiki notifications before using live Bluetooth alerts; the cancel countdown must be visible."
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                if (manager.getNotificationChannel(COUNTDOWN_CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE) {
                    return "Enable the Kiki alert countdown notification channel before using live Bluetooth alerts."
                }
            }
            return null
        }

        fun clearPendingCountdown() {
            pendingCountdown = false
            instance?.let { service -> service.main.removeCallbacks(service.countdownExpired) }
        }

        fun sendHealthSync() {
            instance?.let { service ->
                Thread({ service.sendHeartbeat() }, "kiki-trigger-health").apply { isDaemon = true }.start()
            }
        }

        fun recordDiagnostic(context: android.content.Context, pattern: String, origin: String, keys: JSONArray) {
            synchronized(diagnosticLock) {
                val prefs = Store.prefs(context)
                val events = try {
                    JSONArray(prefs.getString("diagnosticQueue", "[]"))
                } catch (error: Exception) {
                    log("diagnostic queue was unreadable (${error.javaClass.simpleName})")
                    JSONArray()
                }
                events.put(
                    JSONObject()
                        .put("at", isoTimestamp(System.currentTimeMillis()))
                        .put("pattern", pattern.take(20))
                        .put("origin", if (origin == "media_session") "session" else "key")
                        .put("keys", keys)
                )
                while (events.length() > MAX_PENDING_DIAGNOSTICS) events.remove(0)
                prefs.edit().putString("diagnosticQueue", events.toString()).apply()
            }
        }

        fun pendingDiagnostics(context: android.content.Context): JSONArray = synchronized(diagnosticLock) {
            try {
                JSONArray(Store.prefs(context).getString("diagnosticQueue", "[]"))
            } catch (error: Exception) {
                log("diagnostic queue was unreadable (${error.javaClass.simpleName})")
                JSONArray()
            }
        }

        fun acknowledgeDiagnostics(context: android.content.Context, count: Int) {
            if (count <= 0) return
            synchronized(diagnosticLock) {
                val prefs = Store.prefs(context)
                val events = try {
                    JSONArray(prefs.getString("diagnosticQueue", "[]"))
                } catch (error: Exception) {
                    log("diagnostic queue was unreadable (${error.javaClass.simpleName})")
                    return
                }
                repeat(minOf(count, events.length())) { events.remove(0) }
                prefs.edit().putString("diagnosticQueue", events.toString()).apply()
            }
        }

        private fun isoTimestamp(timestamp: Long): String =
            SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
                .apply { timeZone = TimeZone.getTimeZone("UTC") }
                .format(Date(timestamp))
    }

    private lateinit var mediaSession: MediaSessionCompat
    private var audioTrack: AudioTrack? = null
    @Volatile private var audioRunning = false
    private val main = Handler(Looper.getMainLooper())
    private val merger = PressMerger()
    private var sequencer: Sequencer? = null
    private var sequenceCandidates: List<Profile> = emptyList()
    private val sequenceKeys = ArrayList<Int>()
    private val keyDownAt = ConcurrentHashMap<Int, Long>()
    private val heldKeys = ConcurrentHashMap.newKeySet<Int>()
    private var lastOrigin = "key"
    private var practiceExpiresAt = 0L
    private var volumeReceiverRegistered = false
    private val countdownExpired = Runnable {
        pendingCountdown = false
        log("countdown window elapsed locally")
    }
    private val volumeReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val stream = intent.getIntExtra("android.media.EXTRA_VOLUME_STREAM_TYPE", -1)
            if (stream != AudioManager.STREAM_MUSIC) return
            val current = intent.getIntExtra("android.media.EXTRA_VOLUME_STREAM_VALUE", -1)
            val previous = intent.getIntExtra("android.media.EXTRA_PREV_VOLUME_STREAM_VALUE", -1)
            if (current < 0 || previous < 0 || current == previous) return
            val token = if (current > previous) Tok.VOL_UP else Tok.VOL_DOWN
            onInput(RawInput(SystemClock.elapsedRealtime(), Src.VOLUME, token))
        }
    }

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
        if (running) {
            showArmedNotification(
                when {
                    practice -> "Practice mode is on. No real alerts will be sent."
                    prefs.getBoolean("test", true) -> "TEST ONLY. Button presses are recorded; no alert or countdown is sent."
                    else -> "Live alerts are enabled. A recognized gesture sends an alert and starts its countdown."
                }
            )
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
            .setContentTitle(
                when {
                    practice -> "Kiki trigger · Practice"
                    prefs.getBoolean("test", true) -> "Kiki trigger · TEST ONLY"
                    else -> "Kiki trigger is armed"
                }
            )
            .setContentText(
                when {
                    practice -> "No real alerts will be sent while Practice is on."
                    prefs.getBoolean("test", true) -> "TEST ONLY — no alert, countdown, or responder notification will be sent."
                    else -> "Bluetooth button patterns are being monitored for live alerts."
                }
            )
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
        registerVolumeReceiver()
        log("foreground trigger started")
    }

    override fun onDestroy() {
        running = false
        instance = null
        practice = false
        audioRunning = false
        captureEnabled = false
        captureVerificationEnabled = false
        captureProfileId = null
        main.removeCallbacks(settle)
        main.removeCallbacks(countdownExpired)
        main.removeCallbacks(heartbeat)
        main.removeCallbacks(practiceExpiry)
        audioTrack?.runCatching { pause(); flush(); release() }
        audioTrack = null
        if (::mediaSession.isInitialized) {
            mediaSession.isActive = false
            mediaSession.release()
        }
        if (volumeReceiverRegistered) {
            unregisterReceiver(volumeReceiver)
            volumeReceiverRegistered = false
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
            if (event != null) {
                val keyCode = KeyEvent.keyCodeToString(event.keyCode)
                val action = when (event.action) {
                    KeyEvent.ACTION_DOWN -> "DOWN"
                    KeyEvent.ACTION_UP -> "UP"
                    else -> event.action.toString()
                }
                val eventAt = SystemClock.elapsedRealtime()
                if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
                    keyDownAt[event.keyCode] = eventAt
                    heldKeys.remove(event.keyCode)
                }
                val heldMs = if (event.action == KeyEvent.ACTION_UP) {
                    keyDownAt.remove(event.keyCode)?.let { (eventAt - it).coerceAtLeast(0L) }
                } else {
                    null
                }
                log("media button $action $keyCode repeat=${event.repeatCount}${heldMs?.let { " held=${it}ms" } ?: ""}")
                if (isTriggerKey(event.keyCode)) {
                    val inputDevice = runCatching { event.device }.getOrNull()
                    emitRawEvent(
                        eventAt,
                        Src.KEY,
                        tokenForKeyCode(event.keyCode),
                        event.keyCode,
                        action,
                        event.repeatCount,
                        heldMs,
                        inputDevice
                    )
                    if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount > 0) {
                        if (heldKeys.add(event.keyCode)) {
                            onInput(RawInput(eventAt, Src.KEY, Tok.HOLD, event.keyCode, event.repeatCount, heldMs))
                        }
                    } else if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
                        onInput(RawInput(eventAt, Src.KEY, tokenForKeyCode(event.keyCode), event.keyCode), rawAlreadyEmitted = true)
                    } else if (event.action == KeyEvent.ACTION_UP && heldMs != null && heldMs >= HOLD_THRESHOLD_MS) {
                        if (heldKeys.add(event.keyCode)) {
                            onInput(RawInput(eventAt, Src.KEY, Tok.HOLD, event.keyCode, event.repeatCount, heldMs))
                        }
                    } else if (event.action == KeyEvent.ACTION_UP) {
                        heldKeys.remove(event.keyCode)
                    }
                }
            }
            return true
        }

        override fun onPlay() = onInput(RawInput(SystemClock.elapsedRealtime(), Src.SESSION, Tok.TOGGLE, KeyCodes.PLAY))
        override fun onPause() = onInput(RawInput(SystemClock.elapsedRealtime(), Src.SESSION, Tok.TOGGLE, KeyCodes.PAUSE))
        override fun onStop() = onInput(RawInput(SystemClock.elapsedRealtime(), Src.SESSION, Tok.STOP, KeyCodes.STOP))
        override fun onSkipToNext() = onInput(RawInput(SystemClock.elapsedRealtime(), Src.SESSION, Tok.NEXT, KeyCodes.NEXT))
        override fun onSkipToPrevious() = onInput(RawInput(SystemClock.elapsedRealtime(), Src.SESSION, Tok.PREV, KeyCodes.PREVIOUS))
    }

    private fun isTriggerKey(code: Int) = code in setOf(
        KeyEvent.KEYCODE_HEADSETHOOK,
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
        KeyEvent.KEYCODE_MEDIA_PLAY,
        KeyEvent.KEYCODE_MEDIA_PAUSE,
        KeyEvent.KEYCODE_MEDIA_STOP,
        KeyEvent.KEYCODE_MEDIA_NEXT,
        KeyEvent.KEYCODE_MEDIA_PREVIOUS,
        KeyEvent.KEYCODE_VOLUME_UP,
        KeyEvent.KEYCODE_VOLUME_DOWN
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

    private fun onInput(input: RawInput, rawAlreadyEmitted: Boolean = false) {
        main.post {
            if (!running && !practice) return@post
            if (!rawAlreadyEmitted) {
                emitRawEvent(input.atMs, input.src, input.tok, input.keyCode, null, input.repeat, input.heldMs, null)
            }
            log("input raw src=${input.src.name.lowercase(Locale.ROOT)} token=${input.tok.code}")
            if (!merger.isNewPress(input)) {
                listener?.invoke(
                    JSONObject()
                        .put("type", "raw")
                        .put("src", input.src.name.lowercase(Locale.ROOT))
                        .put("tok", input.tok.code.toString())
                        .put("keyCode", if (input.keyCode >= 0) KeyEvent.keyCodeToString(input.keyCode) else JSONObject.NULL)
                        .put("deduplicated", true)
                )
                return@post
            }
            if (sequencer == null || sequencer?.isEmpty() == true) {
                sequenceCandidates = GestureProfiles.connectedCandidates(this)
                val defaultGap = if (practice && captureEnabled) captureGapMs else GAP_MS
                sequencer = Sequencer(gapMsFor(sequenceCandidates, defaultGap))
            }
            sequencer?.add(input)
            lastOrigin = when (input.src) {
                Src.KEY -> "key"
                Src.SESSION -> "session"
                Src.VOLUME -> "volume"
            }
            if (input.keyCode >= 0) sequenceKeys.add(input.keyCode)
            if (sequenceKeys.size > 20) sequenceKeys.removeAt(0)
            main.removeCallbacks(settle)
            val defaultSettle = if (practice && captureEnabled) captureSettleMs else SETTLE_MS
            main.postDelayed(settle, settleMsFor(sequenceCandidates, defaultSettle))
        }
    }

    private fun emitRawEvent(
        atMs: Long,
        src: Src,
        tok: Tok,
        keyCode: Int,
        action: String?,
        repeat: Int,
        heldMs: Long?,
        device: InputDevice?
    ) {
        listener?.invoke(
            JSONObject()
                .put("type", "raw")
                .put("atMs", atMs)
                .put("src", src.name.lowercase(Locale.ROOT))
                .put("tok", tok.code.toString())
                .put("keyCode", KeyEvent.keyCodeToString(keyCode))
                .put("action", action ?: JSONObject.NULL)
                .put("repeat", repeat)
                .put("heldMs", heldMs ?: JSONObject.NULL)
                .put("deviceId", device?.id ?: JSONObject.NULL)
                .put("deviceName", device?.name?.take(60) ?: JSONObject.NULL)
                .put("vendorId", device?.vendorId ?: JSONObject.NULL)
                .put("productId", device?.productId ?: JSONObject.NULL)
        )
    }

    private fun registerVolumeReceiver() {
        if (volumeReceiverRegistered) return
        try {
            ContextCompat.registerReceiver(
                this,
                volumeReceiver,
                IntentFilter(VOLUME_CHANGED_ACTION),
                ContextCompat.RECEIVER_NOT_EXPORTED
            )
            volumeReceiverRegistered = true
            log("music volume changes are observed when Android broadcasts them; volume gestures can alter volume and may fail at limits")
        } catch (error: Exception) {
            log("music volume observer unavailable (${error.javaClass.simpleName}); gesture capture does not depend on it")
        }
    }

    fun schedulePracticeExpiry(expiresAt: Long) {
        practiceExpiresAt = expiresAt
        main.removeCallbacks(practiceExpiry)
        if (expiresAt > System.currentTimeMillis()) {
            main.postDelayed(practiceExpiry, expiresAt - System.currentTimeMillis())
        }

        fun clearLocalCountdown() {
            clearPendingCountdown()
        }
    }

    private fun evaluateSequence() {
        val gesture = sequencer?.finish() ?: return
        sequencer = null
        val sequence = gesture.signature()
        if (sequence.isEmpty()) return
        val keys = JSONArray(sequenceKeys)
        val keyCodes = JSONArray(sequenceKeys.map { KeyEvent.keyCodeToString(it) })
        val origin = lastOrigin
        sequenceKeys.clear()
        sequenceCandidates = emptyList()

        val prefs = Store.prefs(this)
        val candidates = if (practice && captureEnabled && captureVerificationEnabled) {
            captureProfileId?.let { GestureProfiles.verificationCandidates(this, it) }.orEmpty()
        } else {
            GestureProfiles.connectedCandidates(this)
        }
        val match = matchGesture(sequence, candidates, requireVerified = !practice)
        if (practice && captureEnabled && captureVerificationEnabled) {
            GestureProfiles.recordPracticeResult(this, match)
        }
        val pattern = (match as? MatchResult.Hit)?.action
        val profileId = (match as? MatchResult.Hit)?.profileId
        val status = when (match) {
            is MatchResult.Hit -> "hit"
            is MatchResult.Ambiguous -> "ambiguous"
            is MatchResult.Unverified -> "unverified"
            MatchResult.None -> "unmatched"
        }
        listener?.invoke(
            JSONObject()
                .put("type", "sequence")
                .put("sequence", sequence)
                .put("signature", sequence)
                .put("presses", gesture.presses)
                .put("pattern", pattern ?: JSONObject.NULL)
                .put("origin", origin)
                .put("keyCodes", keyCodes)
                .put("gapsMs", JSONArray(gesture.gapsMs))
                .put("profileId", profileId ?: JSONObject.NULL)
                .put("matchStatus", status)
                .put("matchActions", JSONArray((match as? MatchResult.Ambiguous)?.actions?.toList() ?: emptyList<String>()))
        )
        log("gesture sequence recognized ($status; $sequence; ${gesture.presses} inputs; ${keyCodes.join(",")}; $origin)")
        log("match outcome ($status${pattern?.let { "; $it" } ?: ""}${profileId?.let { "; profile=${it.take(8)}" } ?: ""})")
        if (practice) return
        recordDiagnostic(
            this,
            pattern ?: "$status:$sequence",
            if (origin == "session") "media_session" else "media_button",
            keys
        )
        sendHealthSync()

        val testMode = prefs.getBoolean("test", true)
        when (pattern) {
            "sos" -> fire("sos", false, testMode, sequence, profileId)
            "medical" -> fire("medical", false, testMode, sequence, profileId)
            "duress" -> fire("sos", true, testMode, sequence, profileId)
            "cancel" -> cancelTrigger()
        }
    }

    private fun fire(type: String, duress: Boolean, testMode: Boolean, pattern: String, profileId: String?) {
        vibrate(if (duress) longArrayOf(0, 350, 180, 350) else longArrayOf(0, 80, 100, 80))
        val location = lastKnownLocation()
        Thread({
            if (!testMode) {
                countdownNotificationBlockReason(this)?.let { reason ->
                    log("live trigger blocked before server request: $reason")
                    vibrate(longArrayOf(0, 800))
                    return@Thread
                }
            }
            val payload = JSONObject()
                .put("type", type)
                .put("duress", duress)
                .put("test", testMode)
                .put("src", "bt_media")
                .put("pattern", pattern.take(20))
                .put("profile", profileId?.take(12))
                .put("sig_verified", profileId != null)
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
            if (result.status !in 200..299) {
                log("trigger request failed (HTTP ${result.status}; ${result.body?.optString("error", "server rejected request") ?: "no response body"})")
                vibrate(longArrayOf(0, 800))
                if (result.status == 401) disarmForRevokedToken()
            } else {
                val isTest = result.body?.optBoolean("test", false) == true
                val pendingId = result.body?.optString("pending_id").orEmpty()
                when {
                    isTest -> log("TEST MODE: $type press recorded; no active alert, countdown, or push notification was created")
                    pendingId.isNotBlank() -> {
                        val countdown = result.body?.optInt("countdown_s", 10) ?: 10
                        log("LIVE ALERT: $type pending ${pendingId.take(8)} for ${countdown}s; server accepted the alert request")
                        result.body?.optJSONObject("delivery")?.let { delivery ->
                            log(
                                "push gateway ${delivery.optString("status", "unknown")}; accepted " +
                                    "${delivery.optInt("accepted")}/${delivery.optInt("attempted")}; " +
                                    "device receipt is not confirmed"
                            )
                        }
                        showCancelNotification(countdown)
                    }
                    else -> log("trigger request accepted without a test result or pending alert ID; check the server response")
                }
                if (!duress) vibrate(longArrayOf(0, 70, 80, 70, 80, 70))
            }
        }, "kiki-trigger-fire").apply { isDaemon = true }.start()
    }

    private fun cancelTrigger() {
        if (!pendingCountdown) {
            log("gesture cancel ignored: no local pending countdown")
            return
        }
        Thread({
            val result = post("/api/trigger/cancel", JSONObject())
            log("trigger cancel completed (HTTP ${result.status})")
            if (result.status in 200..299) {
                pendingCountdown = false
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
        val diagnostics = pendingDiagnostics(this)
        val payload = JSONObject()
            .put("armed", running && !practice)
            .put("test", prefs.getBoolean("test", true))
            .put("app_version", version.take(20))
            .put("sdk", Build.VERSION.SDK_INT)
            .put("model", Build.MODEL.take(40))
            .put("battery_unrestricted", powerManager.isIgnoringBatteryOptimizations(packageName))
            .put("events", diagnostics)
            .put("devices", DeviceTracker.syncPayload(this))
        val result = post("/api/trigger/heartbeat", payload)
        log("trigger health sync completed (HTTP ${result.status})")
        if (result.status in 200..299) acknowledgeDiagnostics(this, diagnostics.length())
        if (result.status == 401) disarmForRevokedToken()
    }

    private fun disarmForRevokedToken() {
        Store.prefs(this).edit()
            .putBoolean("wantArmed", false)
            .putBoolean("practiceMode", false)
            .remove("practiceExpiresAt")
            .remove("token")
            .remove("tokenId")
            .apply()
        practice = false
        main.removeCallbacks(heartbeat)
        main.post { stopSelf() }
        log("trigger token rejected; local trigger disarmed")
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
        countdownNotificationBlockReason(this)?.let { reason ->
            log("cannot display the alert countdown notification: $reason")
            return
        }
        pendingCountdown = true
        main.removeCallbacks(countdownExpired)
        main.postDelayed(countdownExpired, countdownSeconds.coerceAtLeast(0) * 1_000L)
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
            .setTimeoutAfter(countdownSeconds.coerceAtLeast(0) * 1_000L)
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
            .setContentTitle(
                when {
                    practice -> "Kiki trigger · Practice"
                    prefs.getBoolean("test", true) -> "Kiki trigger · TEST ONLY"
                    else -> "Kiki trigger is armed"
                }
            )
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
