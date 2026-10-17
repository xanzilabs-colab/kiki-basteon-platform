package za.co.xanzi.kiki.gesture

import android.content.Context
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import za.co.xanzi.kiki.DeviceTracker
import za.co.xanzi.kiki.KikiTriggerService
import za.co.xanzi.kiki.Store

object GestureProfiles {
    private const val PREFS_KEY = "gestureProfiles"
    private const val ACTIVE_MODE_KEY = "gestureProfileMode"
    private val actions = setOf("sos", "medical", "duress", "cancel")
    private val kinds = setOf("earbuds", "wired", "car", "speaker", "watch", "ring", "other")
    private const val MAX_VERIFICATION_AGE_MS = 90L * 24 * 60 * 60 * 1000

    fun all(context: Context): List<Profile> {
        val values = try {
            JSONArray(Store.prefs(context).getString(PREFS_KEY, "[]"))
        } catch (error: Exception) {
            KikiTriggerService.log("gesture profiles were unreadable (${error.javaClass.simpleName})")
            return emptyList()
        }
        return (0 until values.length()).mapNotNull { index ->
            val item = values.optJSONObject(index) ?: return@mapNotNull null
            try {
                item.toProfile()
            } catch (error: Exception) {
                KikiTriggerService.log("skipped invalid local gesture profile at index $index (${error.javaClass.simpleName})")
                null
            }
        }
    }

    fun save(context: Context, profile: Profile) {
        val normalizedProfile = profile.copy(name = profile.name.trim())
        validate(normalizedProfile)
        val saved = all(context)
        val previous = saved.firstOrNull { it.id == normalizedProfile.id }
        val sameConfiguration = previous != null &&
            previous.kind == normalizedProfile.kind &&
            previous.deviceRef == normalizedProfile.deviceRef &&
            previous.gapMs == normalizedProfile.gapMs &&
            previous.settleMs == normalizedProfile.settleMs &&
            previous.mapping == normalizedProfile.mapping &&
            previous.appVersion == normalizedProfile.appVersion &&
            previous.androidSdk == normalizedProfile.androidSdk
        val effectiveProfile = normalizedProfile.copy(verifiedAt = previous?.verifiedAt.takeIf { sameConfiguration })
        val profiles = saved.filterNot { it.id == normalizedProfile.id }.toMutableList()
        require(profiles.size < 20) { "You can save up to 20 gesture profiles." }
        profiles.add(effectiveProfile)
        write(context, profiles)
    }

    fun delete(context: Context, id: String) {
        write(context, all(context).filterNot { it.id == id })
        val prefs = Store.prefs(context)
        if (prefs.getString(ACTIVE_MODE_KEY, "auto") == id) {
            prefs.edit().putString(ACTIVE_MODE_KEY, "auto").apply()
        }
    }

    fun replaceAll(context: Context, profiles: List<Profile>) {
        require(profiles.size <= 20) { "You can import up to 20 gesture profiles." }
        profiles.forEach(::validate)
        require(profiles.map(Profile::id).distinct().size == profiles.size) { "Profile IDs must be unique." }
        write(context, profiles)
    }

    fun recordPracticeResult(context: Context, result: MatchResult) {
        val profiles = all(context)
        val progress = try {
            JSONObject(Store.prefs(context).getString("gestureVerificationProgress", "{}"))
        } catch (error: Exception) {
            KikiTriggerService.log("gesture verification progress was unreadable (${error.javaClass.simpleName})")
            JSONObject()
        }
        val hit = result as? MatchResult.Hit
        if (hit == null) {
            profiles.forEach { progress.remove(it.id) }
        } else {
            val profile = profiles.firstOrNull { it.id == hit.profileId } ?: return
            val actionProgress = progress.optJSONObject(profile.id) ?: JSONObject()
            val count = (actionProgress.optInt(hit.action, 0) + 1).coerceAtMost(3)
            actionProgress.put(hit.action, count)
            progress.put(profile.id, actionProgress)
            val requiredActions = profile.mapping.values.toSet()
            if (requiredActions.isNotEmpty() && requiredActions.all { actionProgress.optInt(it, 0) >= 3 }) {
                write(
                    context,
                    profiles.map { item ->
                        if (item.id == profile.id) item.copy(
                            verifiedAt = System.currentTimeMillis(),
                            appVersion = currentVersion(context),
                            androidSdk = Build.VERSION.SDK_INT
                        ) else item
                    }
                )
                progress.remove(profile.id)
                KikiTriggerService.log("gesture profile verification complete (${profile.id.take(8)})")
            }
        }
        Store.prefs(context).edit().putString("gestureVerificationProgress", progress.toString()).apply()
    }

    fun setMode(context: Context, mode: String) {
        require(mode == "auto" || all(context).any { it.id == mode }) { "Choose an existing profile or Auto." }
        Store.prefs(context).edit().putString(ACTIVE_MODE_KEY, mode).apply()
    }

    fun mode(context: Context): String = Store.prefs(context).getString(ACTIVE_MODE_KEY, "auto") ?: "auto"

    fun connectedCandidates(context: Context): List<Profile> {
        val profiles = all(context)
        val connectedRefs = DeviceTracker.connectedRefs(context)
        return connectedProfiles(profiles, mode(context), connectedRefs)
    }

    fun liveBlockReason(context: Context): String? {
        val connectedRefs = DeviceTracker.connectedRefs(context)
        val hasConnectedAudio = connectedRefs.isNotEmpty() || DeviceTracker.audioOutputs(context).length() > 0
        if (!hasConnectedAudio) return "Connect the accessory you want to use before enabling live alerts."

        val profiles = all(context)
        if (profiles.isEmpty()) return "No gesture profile is saved. Open Trigger Lab and calibrate one in Practice."
        val candidates = connectedCandidates(context)
        if (candidates.isEmpty()) {
            return if (mode(context) == "auto") {
                "No saved profile matches the connected accessory. Select or create its profile in Trigger Lab."
            } else {
                "The selected profile's accessory is not connected. Connect it or select Auto in Trigger Lab."
            }
        }

        val connectedProfiles = candidates.filter { profile ->
            profile.deviceRef?.let { it in connectedRefs } ?: hasConnectedAudio
        }
        if (connectedProfiles.isEmpty()) return "Connect the accessory assigned to this gesture profile."
        val profilesWithRequiredActions = connectedProfiles.filter {
            it.mapping.values.containsAll(listOf("sos", "cancel"))
        }
        if (profilesWithRequiredActions.isEmpty()) {
            return "This profile needs distinct SOS and Cancel gestures. Re-check it in Trigger Lab."
        }

        val now = System.currentTimeMillis()
        if (profilesWithRequiredActions.any {
                it.androidSdk == Build.VERSION.SDK_INT &&
                    it.appVersion == currentVersion(context) &&
                    it.verifiedAt?.let { verifiedAt ->
                        verifiedAt <= now && now - verifiedAt <= MAX_VERIFICATION_AGE_MS
                    } == true
            }) return null

        if (profilesWithRequiredActions.any { it.androidSdk != null && it.androidSdk != Build.VERSION.SDK_INT }) {
            return "Android changed since this profile was verified. Re-check SOS and Cancel in Trigger Lab."
        }
        if (profilesWithRequiredActions.any { it.appVersion != null && it.appVersion != currentVersion(context) }) {
            return "The Kiki app was updated since this profile was verified. Re-check SOS and Cancel in Trigger Lab."
        }
        if (profilesWithRequiredActions.any { it.verifiedAt == null }) {
            return "This profile is not verified on this phone yet. Re-check SOS and Cancel in Trigger Lab."
        }
        if (profilesWithRequiredActions.any {
                it.verifiedAt?.let { verifiedAt -> verifiedAt > now || now - verifiedAt > MAX_VERIFICATION_AGE_MS } == true
            }) {
            return "This profile's verification is older than 90 days. Re-check SOS and Cancel in Trigger Lab."
        }
        return "Re-check SOS and Cancel for the connected accessory in Trigger Lab before enabling live alerts."
    }

    fun hasLiveReadyProfile(context: Context): Boolean = liveBlockReason(context) == null

    private fun currentVersion(context: Context): String? =
        runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull()

    fun toJson(profile: Profile): JSONObject = JSONObject()
        .put("id", profile.id)
        .put("name", profile.name)
        .put("kind", profile.kind)
        .put("deviceRef", profile.deviceRef ?: JSONObject.NULL)
        .put("gapMs", profile.gapMs)
        .put("settleMs", profile.settleMs)
        .put("mapping", JSONObject().also { mapping ->
            profile.mapping.forEach { (signature, action) -> mapping.put(signature, action) }
        })
        .put("library", JSONArray().also { library ->
            profile.library.forEach { sample ->
                library.put(
                    JSONObject()
                        .put("prompted", sample.prompted)
                        .put("sig", sample.signature)
                        .put("presses", sample.presses)
                        .put("gaps", JSONArray(sample.gapsMs))
                )
            }
        })
        .put("appVersion", profile.appVersion ?: JSONObject.NULL)
        .put("androidSdk", profile.androidSdk ?: JSONObject.NULL)
        .put("verifiedAt", profile.verifiedAt ?: JSONObject.NULL)

    fun fromJson(value: JSONObject): Profile {
        val mappingJson = value.optJSONObject("mapping") ?: JSONObject()
        val mapping = mappingJson.keys().asSequence().associateWith { mappingJson.optString(it) }
        val libraryJson = value.optJSONArray("library") ?: JSONArray()
        val library = (0 until libraryJson.length()).map { index ->
            val sample = libraryJson.getJSONObject(index)
            val gaps = sample.optJSONArray("gaps") ?: JSONArray()
            GestureSample(
                prompted = sample.optInt("prompted"),
                signature = sample.optString("sig"),
                presses = sample.optInt("presses"),
                gapsMs = (0 until gaps.length()).map(gaps::getLong)
            )
        }
        return Profile(
            id = value.optString("id"),
            name = value.optString("name").trim(),
            kind = value.optString("kind"),
            deviceRef = value.optString("deviceRef").takeIf { it.isNotBlank() && it != "null" },
            gapMs = value.optLong("gapMs", 650L),
            settleMs = value.optLong("settleMs", 900L),
            mapping = mapping,
            verifiedAt = value.optLong("verifiedAt", 0L).takeIf { it > 0L },
            library = library,
            appVersion = value.optString("appVersion").takeIf { it.isNotBlank() && it != "null" },
            androidSdk = value.optInt("androidSdk", -1).takeIf { it > 0 }
        ).also(::validate)
    }

    private fun write(context: Context, profiles: List<Profile>) {
        val json = JSONArray()
        profiles.forEach { json.put(toJson(it)) }
        Store.prefs(context).edit().putString(PREFS_KEY, json.toString()).apply()
    }

    private fun JSONObject.toProfile(): Profile = fromJson(this)

    private fun validate(profile: Profile) {
        require(profile.id.length in 8..40) { "Profile ID must be between 8 and 40 characters." }
        require(profile.name.trim().length in 1..40) { "Profile name must be between 1 and 40 characters." }
        require(profile.kind in kinds) { "Choose a supported accessory kind." }
        require(profile.deviceRef == null || profile.deviceRef.length <= 64) { "Accessory reference is too long." }
        require(profile.gapMs in 200..1500) { "Gesture gap must be between 200 and 1500 ms." }
        require(profile.settleMs in 300..2500) { "Gesture settle time must be between 300 and 2500 ms." }
        require(profile.mapping.size <= 20) { "A profile can contain up to 20 gestures." }
        require(profile.mapping.all { (signature, action) ->
            signature.length in 1..20 && signature.all { character -> Tok.entries.any { it.code == character } } &&
                action in actions
        }) { "Profile gestures or action assignments are invalid." }
        require(profile.mapping.values.distinct().size == profile.mapping.values.size) {
            "Each action may only have one assigned gesture."
        }
        require(profile.library.size <= 30 && profile.library.all { sample ->
            sample.prompted in 1..6 && sample.signature.length <= 20 && sample.presses in 0..40 &&
                sample.gapsMs.size <= 39 && sample.gapsMs.all { it in 0..30_000 }
        }) { "The calibration sample library is invalid." }
    }
}
