package za.co.xanzi.kiki

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ConcurrentHashMap

@SuppressLint("MissingPermission")
object DeviceTracker {
    @Volatile var onChange: ((JSONObject) -> Unit)? = null
    private var started = false
    private lateinit var app: Context
    private val connected = ConcurrentHashMap.newKeySet<String>()
    @Volatile private var bluetoothOn = false

    private val wiredTypes = setOf(
        AudioDeviceInfo.TYPE_WIRED_HEADSET,
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
        AudioDeviceInfo.TYPE_USB_HEADSET
    )
    private val bluetoothTypes = buildSet {
        add(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP)
        add(AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
        if (Build.VERSION.SDK_INT >= 31) add(AudioDeviceInfo.TYPE_BLE_HEADSET)
    }

    fun hasBluetoothPermission(context: Context) =
        Build.VERSION.SDK_INT < 31 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

    private fun adapter(context: Context): BluetoothAdapter? =
        (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter

    @Synchronized
    fun start(context: Context) {
        if (started) return
        started = true
        app = context.applicationContext
        bluetoothOn = runCatching { adapter(app)?.isEnabled == true }.getOrDefault(false)
        val filter = IntentFilter().apply {
            addAction(BluetoothDevice.ACTION_ACL_CONNECTED)
            addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED)
            addAction(BluetoothDevice.ACTION_BOND_STATE_CHANGED)
            addAction(BluetoothAdapter.ACTION_STATE_CHANGED)
        }
        ContextCompat.registerReceiver(app, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        val audioManager = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        audioManager.registerAudioDeviceCallback(
            object : AudioDeviceCallback() {
                override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) = emit()
                override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) = emit()
            },
            Handler(Looper.getMainLooper())
        )
        seedConnected()
    }

    fun refresh() {
        if (!started) return
        bluetoothOn = runCatching { adapter(app)?.isEnabled == true }.getOrDefault(false)
        seedConnected()
        emit()
    }

    private val receiver = object : BroadcastReceiver() {
        @Suppress("DEPRECATION")
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == BluetoothAdapter.ACTION_STATE_CHANGED) {
                bluetoothOn = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1) == BluetoothAdapter.STATE_ON
                if (!bluetoothOn) connected.clear()
                emit()
                return
            }
            val device = if (Build.VERSION.SDK_INT >= 33) {
                intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
            } else {
                intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
            } ?: return
            when (intent.action) {
                BluetoothDevice.ACTION_ACL_CONNECTED -> {
                    connected.add(device.address)
                    registeredLabel(device.address)?.let { label ->
                        KikiTriggerService.log("registered device connected")
                        val manager = app.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
                        manager.cancel(label.hashCode())
                    }
                    KikiTriggerService.sendHealthSync()
                }
                BluetoothDevice.ACTION_ACL_DISCONNECTED -> {
                    connected.remove(device.address)
                    registeredLabel(device.address)?.let { label ->
                        KikiTriggerService.log("registered device disconnected")
                        onLocalDisconnect(label)
                    }
                    KikiTriggerService.sendHealthSync()
                }
            }
            emit()
        }
    }

    private fun onLocalDisconnect(label: String) {
        if (!KikiTriggerService.running || !Store.prefs(app).getBoolean("notifyDrop", true)) return
        val manager = app.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        val channel = "kiki_device_status"
        manager.createNotificationChannel(
            android.app.NotificationChannel(channel, "Paired device status", android.app.NotificationManager.IMPORTANCE_DEFAULT)
        )
        val notification = androidx.core.app.NotificationCompat.Builder(app, channel)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentTitle("$label disconnected")
            .setContentText("Trigger presses from this device may not be available.")
            .setAutoCancel(true)
            .build()
        manager.notify(label.hashCode(), notification)
        Thread({ KikiTriggerService.sendHealthSync() }, "kiki-device-health").apply { isDaemon = true }.start()
    }

    private fun seedConnected() {
        if (!hasBluetoothPermission(app)) return
        try {
            adapter(app)?.bondedDevices?.forEach { device ->
                if (isConnected(device)) connected.add(device.address)
            }
        } catch (_: SecurityException) {
            return
        }
    }

    private fun isConnected(device: BluetoothDevice): Boolean = try {
        BluetoothDevice::class.java.getMethod("isConnected").invoke(device) as Boolean
    } catch (_: Exception) {
        false
    }

    private fun guessKind(device: BluetoothDevice): String {
        val bluetoothClass = device.bluetoothClass ?: return "earbuds"
        return when (bluetoothClass.majorDeviceClass) {
            BluetoothClass.Device.Major.AUDIO_VIDEO -> when (bluetoothClass.deviceClass) {
                BluetoothClass.Device.AUDIO_VIDEO_CAR_AUDIO -> "car"
                BluetoothClass.Device.AUDIO_VIDEO_LOUDSPEAKER,
                BluetoothClass.Device.AUDIO_VIDEO_PORTABLE_AUDIO -> "speaker"
                else -> "earbuds"
            }
            BluetoothClass.Device.Major.WEARABLE -> "watch"
            BluetoothClass.Device.Major.PERIPHERAL -> "other"
            else -> "earbuds"
        }
    }

    private fun isWiredConnected(): Boolean {
        val audioManager = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        return audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any { it.type in wiredTypes }
    }

    fun registry(context: Context): JSONArray =
        try {
            JSONArray(Store.prefs(context).getString("devices", "[]"))
        } catch (_: Exception) {
            JSONArray()
        }

    private fun save(context: Context, devices: JSONArray) {
        Store.prefs(context).edit().putString("devices", devices.toString()).apply()
    }

    private fun registeredLabel(address: String): String? {
        val saved = registry(app)
        for (index in 0 until saved.length()) {
            val device = saved.optJSONObject(index) ?: continue
            if (device.optString("address") == address) return device.optString("name")
        }
        return null
    }

    fun register(context: Context, device: JSONObject): Boolean {
        val previous = registry(context)
        val next = JSONArray()
        for (index in 0 until previous.length()) {
            val item = previous.optJSONObject(index) ?: continue
            if (item.optString("ref") != device.optString("ref")) next.put(item)
        }
        if (next.length() >= MAX_DEVICES && next.length() == previous.length()) return false
        next.put(device)
        save(context, next)
        emit()
        return true
    }

    fun remove(context: Context, ref: String) {
        val previous = registry(context)
        val next = JSONArray()
        for (index in 0 until previous.length()) {
            val item = previous.optJSONObject(index) ?: continue
            if (item.optString("ref") != ref) next.put(item)
        }
        save(context, next)
        emit()
    }

    fun rename(context: Context, ref: String, name: String): Boolean {
        val devices = registry(context)
        var renamed = false
        for (index in 0 until devices.length()) {
            val item = devices.optJSONObject(index) ?: continue
            if (item.optString("ref") == ref) {
                item.put("name", name)
                renamed = true
                break
            }
        }
        if (renamed) {
            save(context, devices)
            emit()
        }
        return renamed
    }

    fun markVerified(context: Context, ref: String) {
        val devices = registry(context)
        for (index in 0 until devices.length()) {
            val item = devices.optJSONObject(index) ?: continue
            if (item.optString("ref") == ref) item.put("verifiedAt", iso(System.currentTimeMillis()))
        }
        save(context, devices)
        emit()
    }

    fun paired(context: Context): JSONArray {
        val result = JSONArray()
        if (!hasBluetoothPermission(context)) return result
        try {
            adapter(context)?.bondedDevices?.forEach { device ->
                result.put(
                    JSONObject()
                        .put("address", device.address)
                        .put("btName", device.name ?: "Unknown device")
                        .put("kind", guessKind(device))
                        .put("connected", connected.contains(device.address) || isConnected(device))
                )
            }
        } catch (_: SecurityException) {
            return JSONArray()
        }
        return result
    }

    fun snapshot(context: Context): JSONArray {
        val devices = registry(context)
        val activeAudioAddresses = audioOutputAddresses(context)
        val paired = if (hasBluetoothPermission(context)) {
            try {
                adapter(context)?.bondedDevices?.associateBy { it.address }
            } catch (_: SecurityException) {
                null
            }
        } else null
        val result = JSONArray()
        var registryChanged = false
        for (index in 0 until devices.length()) {
            val item = devices.optJSONObject(index) ?: continue
            val address = item.optString("address")
            val kind = item.optString("kind")
            val status = when {
                kind == "wired" -> if (isWiredConnected()) "connected" else "disconnected"
                address.isEmpty() -> "untracked"
                !hasBluetoothPermission(context) -> "permission_needed"
                !bluetoothOn -> "bluetooth_off"
                paired != null && !paired.containsKey(address) -> "unpaired"
                else -> {
                    val device = paired?.get(address)
                    if (connected.contains(address) || address in activeAudioAddresses || (device != null && isConnected(device))) "connected" else "disconnected"
                }
            }
            if (status == "connected" && item.optString("lastStatus") != "connected") {
                item.put("lastConnectedAt", iso(System.currentTimeMillis()))
                registryChanged = true
            }
            if (item.optString("lastStatus") != status) {
                item.put("lastStatus", status)
                registryChanged = true
            }
            result.put(
                JSONObject()
                    .put("ref", item.optString("ref"))
                    .put("profileRef", bluetoothProfileRef(address) ?: item.optString("ref"))
                    .put("kind", kind)
                    .put("name", item.optString("name"))
                    .put("btName", item.optString("btName"))
                    .put("status", status)
                    .put("battery", batteryLevel(paired?.get(address)))
                    .put("verifiedAt", item.opt("verifiedAt") ?: JSONObject.NULL)
                    .put("addedAt", item.optString("addedAt"))
                    .put("lastConnectedAt", item.optString("lastConnectedAt").takeIf { it.isNotBlank() } ?: JSONObject.NULL)
            )
        }
        if (registryChanged) save(context, devices)
        return result
    }

    fun connectedRefs(context: Context): Set<String> {
        val state = snapshot(context)
        val refs = (0 until state.length()).mapNotNull { index ->
            state.optJSONObject(index)
                ?.takeIf { it.optString("status") == "connected" }
                ?.let { item ->
                    listOf(item.optString("ref"), item.optString("profileRef"))
                        .filter(String::isNotBlank)
                }
                .orEmpty()
        }.flatten().toMutableSet()
        val outputs = audioOutputs(context)
        for (index in 0 until outputs.length()) {
            val profileRef = (outputs.optJSONObject(index)?.opt("profileRef") as? String)?.takeIf(String::isNotBlank)
            if (profileRef != null) refs.add(profileRef)
        }
        return refs
    }

    fun syncPayload(context: Context): JSONArray {
        val state = snapshot(context)
        val payload = JSONArray()
        for (index in 0 until state.length()) {
            val item = state.optJSONObject(index) ?: continue
            payload.put(
                JSONObject()
                    .put("ref", item.optString("ref"))
                    .put("kind", item.optString("kind"))
                    .put("label", item.optString("name"))
                    .put("status", item.optString("status"))
                    .put("battery", item.opt("battery") ?: JSONObject.NULL)
                    .put("verified_at", item.opt("verifiedAt") ?: JSONObject.NULL)
            )
        }
        return payload
    }

    fun audioOutputs(context: Context): JSONArray {
        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val outputs = JSONArray()
        audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
            .filter { it.type in audioOutputTypes() }
            .forEach { device ->
                val address = audioBluetoothAddress(context, device)
                outputs.put(
                    JSONObject()
                        .put("name", device.productName.toString())
                        .put("type", device.type)
                        .put("address", address)
                        .put("profileRef", audioProfileRef(device.type, address) ?: JSONObject.NULL)
                )
            }
        return outputs
    }

    private fun audioBluetoothAddress(context: Context, audioDevice: AudioDeviceInfo): String {
        if (audioDevice.type !in bluetoothTypes) return ""
        val reported = if (Build.VERSION.SDK_INT >= 28) audioDevice.address.trim() else ""
        if (reported.isNotEmpty()) return reported
        if (!hasBluetoothPermission(context)) return ""
        return try {
            val name = audioDevice.productName.toString().trim()
            val matches = adapter(context)?.bondedDevices.orEmpty().filter { device ->
                device.name?.trim()?.equals(name, ignoreCase = true) == true &&
                    (connected.contains(device.address) || isConnected(device))
            }
            matches.singleOrNull()?.address.orEmpty()
        } catch (_: SecurityException) {
            ""
        }
    }

    fun audioProfileRef(type: Int, address: String): String? {
        if (type in bluetoothTypes) bluetoothProfileRef(address)?.let { return it }
        return when (type) {
            AudioDeviceInfo.TYPE_WIRED_HEADSET,
            AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
            AudioDeviceInfo.TYPE_USB_HEADSET -> "wired:$type"
            else -> null
        }
    }

    private fun bluetoothProfileRef(address: String): String? {
        val normalized = address.trim().uppercase(Locale.US)
        if (normalized.isEmpty()) return null
        val digest = MessageDigest.getInstance("SHA-256").digest(normalized.toByteArray(Charsets.UTF_8))
        val stableSuffix = digest.take(16).joinToString("") { "%02x".format(it.toInt() and 0xff) }
        return "bt:$stableSuffix"
    }

    private fun audioOutputAddresses(context: Context): Set<String> {
        val outputs = audioOutputs(context)
        return (0 until outputs.length())
            .mapNotNull { outputs.optJSONObject(it)?.optString("address")?.takeIf(String::isNotBlank) }
            .toSet()
    }

    private fun audioOutputTypes(): Set<Int> = buildSet {
        add(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP)
        add(AudioDeviceInfo.TYPE_BLUETOOTH_SCO)
        add(AudioDeviceInfo.TYPE_WIRED_HEADSET)
        add(AudioDeviceInfo.TYPE_WIRED_HEADPHONES)
        add(AudioDeviceInfo.TYPE_USB_HEADSET)
        if (Build.VERSION.SDK_INT >= 31) add(AudioDeviceInfo.TYPE_BLE_HEADSET)
    }

    private fun batteryLevel(device: BluetoothDevice?): Int? = try {
        (device?.javaClass?.getMethod("getBatteryLevel")?.invoke(device) as? Int)?.takeIf { it in 0..100 }
    } catch (_: Exception) {
        null
    }

    private fun emit() {
        if (!started) return
        onChange?.invoke(JSONObject().put("devices", snapshot(app)))
    }

    private fun iso(timestamp: Long): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
            .apply { timeZone = TimeZone.getTimeZone("UTC") }
            .format(Date(timestamp))

    private const val MAX_DEVICES = 10
}
