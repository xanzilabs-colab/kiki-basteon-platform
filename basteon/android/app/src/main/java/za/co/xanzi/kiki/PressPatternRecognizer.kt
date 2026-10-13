package za.co.xanzi.kiki

import android.view.KeyEvent

data class PressPattern(
    val sequence: String,
    val presses: Int,
    val pattern: String?
)

fun mediaButtonClickWeight(keyCode: Int): Int = when (keyCode) {
    KeyEvent.KEYCODE_MEDIA_PREVIOUS -> 2
    else -> 1
}

fun resolveUniversalPattern(sequence: String, patterns: Map<Int, String>): String? {
    val bursts = sequence.split("-")
    if (bursts.isEmpty()) return null
    val clicks = bursts.sumOf { it.toIntOrNull() ?: return null }
    if (clicks <= 0) return null
    return patterns[clicks]
}

class PressPatternRecognizer(private val gapMs: Long = 650L) {
    private val bursts = ArrayList<Int>()
    private var currentBurst = 0
    private var lastPressAt = 0L

    fun press(atMs: Long, clickWeight: Int = 1): Int {
        require(atMs >= 0) { "Press time must be non-negative." }
        require(clickWeight > 0) { "Click weight must be positive." }
        if (currentBurst > 0 && atMs - lastPressAt > gapMs) {
            bursts.add(currentBurst)
            currentBurst = 0
        }
        currentBurst += clickWeight
        lastPressAt = atMs
        return bursts.sum() + currentBurst
    }

    fun finish(): PressPattern? {
        if (currentBurst == 0) return null
        bursts.add(currentBurst)
        val sequence = bursts.joinToString("-")
        val totalPresses = bursts.sum()
        val pattern = when {
            sequence == "3-2" -> "medical"
            sequence == "2-2-2" -> "duress"
            sequence == "4" -> "cancel"
            !sequence.contains("-") && totalPresses >= 5 -> "sos"
            else -> null
        }
        bursts.clear()
        currentBurst = 0
        lastPressAt = 0
        return PressPattern(sequence, totalPresses, pattern)
    }
}
