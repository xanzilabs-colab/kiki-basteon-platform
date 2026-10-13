package za.co.xanzi.kiki.gesture

enum class Tok(val code: Char) {
    TOGGLE('T'), NEXT('N'), PREV('P'), STOP('S'), VOL_UP('U'), VOL_DOWN('D'), HOLD('H'), OTHER('X')
}

enum class Src { KEY, SESSION, VOLUME }

object KeyCodes {
    const val VOLUME_UP = 24
    const val VOLUME_DOWN = 25
    const val HEADSETHOOK = 79
    const val PLAY_PAUSE = 85
    const val STOP = 86
    const val NEXT = 87
    const val PREVIOUS = 88
    const val PLAY = 126
    const val PAUSE = 127
}

fun tokenForKeyCode(code: Int): Tok = when (code) {
    KeyCodes.HEADSETHOOK, KeyCodes.PLAY_PAUSE, KeyCodes.PLAY, KeyCodes.PAUSE -> Tok.TOGGLE
    KeyCodes.NEXT -> Tok.NEXT
    KeyCodes.PREVIOUS -> Tok.PREV
    KeyCodes.STOP -> Tok.STOP
    KeyCodes.VOLUME_UP -> Tok.VOL_UP
    KeyCodes.VOLUME_DOWN -> Tok.VOL_DOWN
    else -> Tok.OTHER
}

data class RawInput(
    val atMs: Long,
    val src: Src,
    val tok: Tok,
    val keyCode: Int = -1,
    val repeat: Int = 0,
    val heldMs: Long? = null
)

class PressMerger(private val mergeMs: Long = 80L) {
    private var previous: RawInput? = null

    fun isNewPress(input: RawInput): Boolean {
        require(input.atMs >= 0L) { "Input time must be non-negative." }
        val last = previous
        previous = input
        return last == null ||
            last.tok != input.tok ||
            last.src == input.src ||
            input.atMs - last.atMs !in 0..mergeMs
    }
}

data class Gesture(val bursts: List<List<Tok>>, val gapsMs: List<Long>) {
    val presses: Int get() = bursts.sumOf(List<Tok>::size)

    fun signature(maxLength: Int = 20): String =
        bursts.joinToString("-") { burst -> burst.joinToString("") { it.code.toString() } }.take(maxLength)
}

class Sequencer(private val gapMs: Long = 650L) {
    private val bursts = mutableListOf<MutableList<Tok>>()
    private val gaps = mutableListOf<Long>()
    private var lastAt = -1L

    init {
        require(gapMs in 200L..1500L) { "Gesture gap must be between 200 and 1500 ms." }
    }

    fun add(input: RawInput) {
        require(input.atMs >= 0L) { "Input time must be non-negative." }
        if (lastAt >= 0L) {
            val gap = input.atMs - lastAt
            if (gap < 0L) return
            gaps.add(gap)
            if (gap > gapMs) bursts.add(mutableListOf())
        }
        if (bursts.isEmpty()) bursts.add(mutableListOf())
        bursts.last().add(input.tok)
        lastAt = input.atMs
    }

    fun isEmpty(): Boolean = bursts.isEmpty()

    fun finish(): Gesture? {
        if (bursts.isEmpty()) return null
        val result = Gesture(bursts.map { it.toList() }, gaps.toList())
        bursts.clear()
        gaps.clear()
        lastAt = -1L
        return result
    }
}

data class GestureSample(val prompted: Int, val signature: String, val presses: Int, val gapsMs: List<Long>)

data class Profile(
    val id: String,
    val name: String,
    val kind: String,
    val deviceRef: String?,
    val gapMs: Long,
    val settleMs: Long,
    val mapping: Map<String, String>,
    val verifiedAt: Long?,
    val library: List<GestureSample> = emptyList(),
    val appVersion: String? = null,
    val androidSdk: Int? = null
)

sealed class MatchResult {
    data class Hit(val action: String, val profileId: String) : MatchResult()
    data class Ambiguous(val actions: Set<String>) : MatchResult()
    data class Unverified(val profileId: String) : MatchResult()
    object None : MatchResult()
}

fun matchGesture(signature: String, candidates: List<Profile>, requireVerified: Boolean = true): MatchResult {
    val hits = candidates.mapNotNull { profile ->
        profile.mapping[signature]?.let { action -> Triple(action, profile.id, profile.verifiedAt) }
    }
    if (hits.isEmpty()) return MatchResult.None
    val usable = if (requireVerified) hits.filter { it.third != null } else hits
    if (usable.isEmpty()) return MatchResult.Unverified(hits.first().second)
    val actions = usable.map { it.first }.toSet()
    return if (actions.size == 1) MatchResult.Hit(actions.first(), usable.first().second)
    else MatchResult.Ambiguous(actions)
}

fun settleMsFor(candidates: List<Profile>, default: Long = 900L): Long =
    candidates.maxOfOrNull(Profile::settleMs) ?: default

fun gapMsFor(candidates: List<Profile>, default: Long = 650L): Long =
    candidates.maxOfOrNull(Profile::gapMs) ?: default
