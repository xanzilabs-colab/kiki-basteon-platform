package za.co.xanzi.kiki

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

class TriggerBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val prefs = Store.prefs(context)
        if (!prefs.getBoolean("wantArmed", false) || prefs.getString("token", null) == null) return
        ContextCompat.startForegroundService(context, Intent(context, KikiTriggerService::class.java))
    }
}
