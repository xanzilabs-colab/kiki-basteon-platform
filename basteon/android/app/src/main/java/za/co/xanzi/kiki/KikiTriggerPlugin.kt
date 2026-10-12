package za.co.xanzi.kiki

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONObject
import java.net.URI
import java.util.UUID

@CapacitorPlugin(
    name = "KikiTrigger",
    permissions = [
        Permission(strings = [Manifest.permission.BLUETOOTH_CONNECT], alias = "bluetooth")
    ]
)
class KikiTriggerPlugin : Plugin() {
    override fun load() {
        DeviceTracker.start(context)
        KikiTriggerService.listener = { event ->
            notifyListeners("event", JSObject(event.toString()))
        }
        DeviceTracker.onChange = { event ->
            notifyListeners("devices", JSObject(event.toString()))
        }
    }

    override fun handleOnDestroy() {
        KikiTriggerService.listener = null
        DeviceTracker.onChange = null
    }

    @PluginMethod
    fun arm(call: PluginCall) {
        val prefs = Store.prefs(context)
        val base = call.getString("baseUrl") ?: prefs.getString("base", null)
        val token = call.getString("token") ?: prefs.getString("token", null)
        val tokenId = call.getString("tokenId") ?: prefs.getString("tokenId", null)
        if (base.isNullOrBlank() || token.isNullOrBlank()) {
            call.reject("A trigger token and app URL are required.")
            return
        }
        if (!TOKEN_PATTERN.matches(token)) {
            call.reject("The trigger token has an invalid format.")
            return
        }
        val origin = try {
            val uri = URI(base)
            val permittedScheme = uri.scheme == "https" ||
                (BuildConfig.DEBUG && uri.scheme == "http")
            if (!permittedScheme || uri.host.isNullOrBlank() || uri.userInfo != null) {
                call.reject("The app URL must be HTTPS (HTTP is available only in debug builds).")
                return
            }
            "${uri.scheme}://${uri.rawAuthority}"
        } catch (_: Exception) {
            call.reject("The app URL is invalid.")
            return
        }
        if (origin != BuildConfig.TRIGGER_APP_ORIGIN) {
            call.reject("This app can only connect to the Kiki server it was built for.")
            return
        }
        prefs.edit()
            .putString("base", origin)
            .putString("token", token)
            .putString("tokenId", tokenId)
            .putBoolean("test", call.getBoolean("test", true) ?: true)
            .putBoolean("practiceMode", false)
            .remove("practiceExpiresAt")
            .putBoolean("wantArmed", true)
            .apply()
        KikiTriggerService.practice = false
        KikiTriggerService.instance?.schedulePracticeExpiry(0L)
        try {
            ContextCompat.startForegroundService(context, Intent(context, KikiTriggerService::class.java))
            call.resolve()
        } catch (error: Exception) {
            prefs.edit().putBoolean("wantArmed", false).apply()
            call.reject("Android could not start the trigger service.", error)
        }
    }

    @PluginMethod
    fun disarm(call: PluginCall) {
        Store.prefs(context).edit()
            .putBoolean("wantArmed", false)
            .putBoolean("practiceMode", false)
            .remove("practiceExpiresAt")
            .apply()
        KikiTriggerService.practice = false
        KikiTriggerService.instance?.schedulePracticeExpiry(0L)
        context.stopService(Intent(context, KikiTriggerService::class.java))
        call.resolve()
    }

    @PluginMethod
    fun forgetToken(call: PluginCall) {
        val prefs = Store.prefs(context)
        val tokenId = prefs.getString("tokenId", null)
        prefs.edit()
            .remove("token")
            .remove("tokenId")
            .putBoolean("practiceMode", false)
            .remove("practiceExpiresAt")
            .putBoolean("wantArmed", false)
            .apply()
        KikiTriggerService.practice = false
        KikiTriggerService.instance?.schedulePracticeExpiry(0L)
        context.stopService(Intent(context, KikiTriggerService::class.java))
        call.resolve(JSObject().put("tokenId", tokenId))
    }

    @PluginMethod
    fun status(call: PluginCall) {
        val prefs = Store.prefs(context)
        val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        fun granted(permission: String) =
            ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

        call.resolve(
            JSObject()
                .put("armed", KikiTriggerService.running && !KikiTriggerService.practice)
                .put("practice", KikiTriggerService.practice)
                .put("wantArmed", prefs.getBoolean("wantArmed", false))
                .put("hasToken", !prefs.getString("token", null).isNullOrEmpty())
                .put("tokenId", prefs.getString("tokenId", null))
                .put("test", prefs.getBoolean("test", true))
                .put("batteryUnrestricted", power.isIgnoringBatteryOptimizations(context.packageName))
                .put("fineLocation", granted(Manifest.permission.ACCESS_FINE_LOCATION))
                .put("bgLocation", Build.VERSION.SDK_INT < 29 || granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION))
                .put("notifications", androidx.core.app.NotificationManagerCompat.from(context).areNotificationsEnabled())
                .put("bluetooth", DeviceTracker.hasBluetoothPermission(context))
                .put("notifyDrop", prefs.getBoolean("notifyDrop", true))
        )
    }

    @PluginMethod
    fun setPractice(call: PluginCall) {
        val on = call.getBoolean("on", false) ?: false
        val prefs = Store.prefs(context)
        val wasArmed = prefs.getBoolean("wantArmed", false)
        val expiresAt = if (on) System.currentTimeMillis() + PRACTICE_WINDOW_MS else 0L
        val edit = prefs.edit().putBoolean("practiceMode", on)
        if (on) edit.putLong("practiceExpiresAt", expiresAt) else edit.remove("practiceExpiresAt")
        edit.apply()
        KikiTriggerService.practice = on
        KikiTriggerService.instance?.schedulePracticeExpiry(expiresAt)
        if (on) {
            try {
                ContextCompat.startForegroundService(context, Intent(context, KikiTriggerService::class.java))
            } catch (error: Exception) {
                KikiTriggerService.practice = false
                prefs.edit()
                    .putBoolean("practiceMode", false)
                    .putBoolean("wantArmed", wasArmed)
                    .remove("practiceExpiresAt")
                    .apply()
                call.reject("Android could not start practice mode.", error)
                return
            }
        } else if (!Store.prefs(context).getBoolean("wantArmed", false)) {
            context.stopService(Intent(context, KikiTriggerService::class.java))
        }
        call.resolve()
    }

    @PluginMethod
    fun getLog(call: PluginCall) {
        val lines = JSArray()
        KikiTriggerService.logLines().forEach(lines::put)
        call.resolve(JSObject().put("lines", lines))
    }

    @PluginMethod
    fun requestBluetooth(call: PluginCall) {
        if (Build.VERSION.SDK_INT < 31 || getPermissionState("bluetooth") == PermissionState.GRANTED) {
            DeviceTracker.refresh()
            call.resolve(JSObject().put("granted", true))
            return
        }
        requestPermissionForAlias("bluetooth", call, "bluetoothPermissionResult")
    }

    @PermissionCallback
    private fun bluetoothPermissionResult(call: PluginCall) {
        DeviceTracker.refresh()
        call.resolve(JSObject().put("granted", getPermissionState("bluetooth") == PermissionState.GRANTED))
    }

    @PluginMethod
    fun audioDevices(call: PluginCall) {
        call.resolve(JSObject().put("devices", JSArray(DeviceTracker.audioOutputs(context).toString())))
    }

    @PluginMethod
    fun pairedDevices(call: PluginCall) {
        call.resolve(JSObject().put("devices", JSArray(DeviceTracker.paired(context).toString())))
    }

    @PluginMethod
    fun devices(call: PluginCall) {
        call.resolve(JSObject().put("devices", JSArray(DeviceTracker.snapshot(context).toString())))
    }

    @PluginMethod
    fun registerDevice(call: PluginCall) {
        val ref = call.getString("ref")
        val kind = call.getString("kind")
        val name = call.getString("name")?.trim()
        val address = call.getString("address") ?: ""
        val bluetoothName = call.getString("btName") ?: ""
        if (ref.isNullOrBlank() || kind !in DEVICE_KINDS || name.isNullOrBlank() || name.length > 40) {
            call.reject("Enter a device name and choose a valid device type.")
            return
        }
        if (address.isNotEmpty() && !ADDRESS_PATTERN.matches(address)) {
            call.reject("The selected Bluetooth device is invalid.")
            return
        }
        val device = JSONObject()
            .put("ref", ref)
            .put("kind", kind)
            .put("name", name)
            .put("address", address)
            .put("btName", bluetoothName.take(80))
            .put("addedAt", isoNow())
        if (!DeviceTracker.register(context, device)) {
            call.reject("You can register up to 10 everyday devices.")
            return
        }
        KikiTriggerService.sendHealthSync()
        call.resolve()
    }

    @PluginMethod
    fun removeDevice(call: PluginCall) {
        call.getString("ref")?.let { DeviceTracker.remove(context, it) }
        KikiTriggerService.sendHealthSync()
        call.resolve()
    }

    @PluginMethod
    fun renameDevice(call: PluginCall) {
        val ref = call.getString("ref")
        val name = call.getString("name")?.trim()
        if (ref.isNullOrBlank() || name.isNullOrBlank() || name.length > 40) {
            call.reject("Enter a device name of 1 to 40 characters.")
            return
        }
        if (!DeviceTracker.rename(context, ref, name)) {
            call.reject("That everyday device could not be found.")
            return
        }
        KikiTriggerService.sendHealthSync()
        call.resolve()
    }

    @PluginMethod
    fun markVerified(call: PluginCall) {
        call.getString("ref")?.let { DeviceTracker.markVerified(context, it) }
        KikiTriggerService.sendHealthSync()
        call.resolve()
    }

    @PluginMethod
    fun setNotifyDrop(call: PluginCall) {
        Store.prefs(context).edit().putBoolean("notifyDrop", call.getBoolean("on", true) ?: true).apply()
        call.resolve()
    }

    @PluginMethod
    fun openBluetoothSettings(call: PluginCall) {
        context.startActivity(
            Intent(Settings.ACTION_BLUETOOTH_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
        call.resolve()
    }

    @PluginMethod
    fun requestBatteryExemption(call: PluginCall) {
        context.startActivity(
            Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
        call.resolve()
    }

    @PluginMethod
    fun openAppSettings(call: PluginCall) {
        context.startActivity(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
        call.resolve()
    }

    companion object {
        private const val PRACTICE_WINDOW_MS = 120_000L
        private val TOKEN_PATTERN = Regex("^ktk_[0-9a-f]{64}$")
        private val ADDRESS_PATTERN = Regex("^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$")
        private val DEVICE_KINDS = setOf(
            "earbuds", "wired", "car", "speaker", "helmet", "glasses", "ring", "pedal", "keyboard", "watch"
        )

        private fun isoNow(): String =
            java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US)
                .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
                .format(java.util.Date())
    }
}
