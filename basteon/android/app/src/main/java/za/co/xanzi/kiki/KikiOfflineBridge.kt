package za.co.xanzi.kiki

import android.content.Context
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import za.co.xanzi.kiki.gesture.GestureProfiles

class KikiOfflineBridge(context: Context) {
    private val appContext = context.applicationContext

    @Volatile
    private var offlineFallbackActive = false

    fun setOfflineFallbackActive(active: Boolean) {
        offlineFallbackActive = active
    }

    @JavascriptInterface
    fun getStatus(): String {
        if (!offlineFallbackActive) {
            return errorResult("Local trigger status is only available on the offline screen.")
        }

        return try {
            val prefs = Store.prefs(appContext)
            JSONObject()
                .put("armed", KikiTriggerService.running && !KikiTriggerService.practice)
                .put("practice", KikiTriggerService.practice)
                .put("wantArmed", prefs.getBoolean("wantArmed", false))
                .toString()
        } catch (error: Exception) {
            errorResult("Could not read local trigger status: ${error.javaClass.simpleName}.")
        }
    }

    @JavascriptInterface
    fun getProfiles(): String {
        if (!offlineFallbackActive) {
            return errorResult("Saved trigger setups are only available on the offline screen.")
        }

        return try {
            val profiles = JSONArray()
            GestureProfiles.all(appContext).forEach { profiles.put(GestureProfiles.toJson(it)) }
            JSONObject()
                .put("profiles", profiles)
                .put("mode", GestureProfiles.mode(appContext))
                .toString()
        } catch (error: Exception) {
            errorResult("Could not read saved trigger setups: ${error.javaClass.simpleName}.")
        }
    }

    private fun errorResult(message: String): String =
        JSONObject().put("error", message).toString()
}
