package za.co.xanzi.kiki

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class TriggerCancelReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != KikiTriggerService.ACTION_CANCEL_PENDING) return
        val notifications = NotificationManagerCompat.from(context)
        notifications.cancel(KikiTriggerService.COUNTDOWN_NOTIFICATION_ID)
        val pendingResult = goAsync()
        Thread({
            var connection: HttpURLConnection? = null
            try {
                val prefs = Store.prefs(context)
                val base = prefs.getString("base", null)
                val token = prefs.getString("token", null)
                if (base.isNullOrBlank() || token.isNullOrBlank()) {
                    KikiTriggerService.log("notification cancel unavailable: trigger credentials missing")
                    showOutcome(context, "Cancellation could not be confirmed. The alert may still proceed.")
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
                val responseStream = if (status in 200..299) connection.inputStream else connection.errorStream
                val response = responseStream?.bufferedReader(Charsets.UTF_8)?.use { JSONObject(it.readText()) }
                if (status in 200..299 && response?.optBoolean("ok", false) == true) {
                    KikiTriggerService.log("notification cancel succeeded (HTTP $status)")
                    showOutcome(context, "Alert cancelled.")
                } else if (status == 404) {
                    KikiTriggerService.log("notification cancel too late: no pending countdown remains")
                    showOutcome(context, "Too late to cancel. The alert may already be active; check Kiki.")
                } else {
                    KikiTriggerService.log("notification cancel rejected (HTTP $status)")
                    showOutcome(context, "Cancellation could not be confirmed. The alert may still proceed.")
                }
            } catch (error: Exception) {
                KikiTriggerService.log("notification cancel failed: ${error.javaClass.simpleName}")
                showOutcome(context, "Could not confirm cancellation. The alert may still proceed.")
            } finally {
                connection?.disconnect()
                pendingResult.finish()
            }
        }, "kiki-trigger-notification-cancel").apply { isDaemon = true }.start()
    }

    private fun showOutcome(context: Context, message: String) {
        val notification = NotificationCompat.Builder(context, KikiTriggerService.COUNTDOWN_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("Kiki alert")
            .setContentText(message)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(context)
            .notify(KikiTriggerService.CANCEL_RESULT_NOTIFICATION_ID, notification)
    }
}
