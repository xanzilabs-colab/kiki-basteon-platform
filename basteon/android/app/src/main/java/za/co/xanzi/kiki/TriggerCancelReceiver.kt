package za.co.xanzi.kiki

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class TriggerCancelReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != KikiTriggerService.ACTION_CANCEL_PENDING) return
        val pendingResult = goAsync()
        Thread({
            var connection: HttpURLConnection? = null
            try {
                val prefs = Store.prefs(context)
                val base = prefs.getString("base", null)
                val token = prefs.getString("token", null)
                if (base.isNullOrBlank() || token.isNullOrBlank()) {
                    KikiTriggerService.log("notification cancel unavailable: trigger credentials missing")
                    return@Thread
                }
                connection = URL(base.trimEnd('/') + "/api/trigger/cancel").openConnection() as HttpURLConnection
                connection.requestMethod = "POST"
                connection.doOutput = true
                connection.connectTimeout = 8_000
                connection.readTimeout = 8_000
                connection.setRequestProperty("Authorization", "Bearer $token")
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(JSONObject().toString().toByteArray(Charsets.UTF_8)) }
                val status = connection.responseCode
                KikiTriggerService.log("notification cancel completed (HTTP $status)")
                if (status in 200..299) {
                    NotificationManagerCompat.from(context)
                        .cancel(KikiTriggerService.COUNTDOWN_NOTIFICATION_ID)
                }
            } catch (error: Exception) {
                KikiTriggerService.log("notification cancel failed: ${error.javaClass.simpleName}")
            } finally {
                connection?.disconnect()
                pendingResult.finish()
            }
        }, "kiki-trigger-notification-cancel").apply { isDaemon = true }.start()
    }
}
