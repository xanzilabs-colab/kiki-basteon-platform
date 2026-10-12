package za.co.xanzi.kiki

data class PressPattern(
    val sequence: String,
    val presses: Int,
    val pattern: String?
)

class PressPatternRecognizer(private val gapMs: Long = 650L) {
    private val bursts = ArrayList<Int>()
    private var currentBurst = 0
    private var lastPressAt = 0L

    fun press(atMs: Long): Int {
        require(atMs >= 0) { "Press time must be non-negative." }
        if (currentBurst > 0 && atMs - lastPressAt > gapMs) {
            bursts.add(currentBurst)
            currentBurst = 0
        }
        currentBurst += 1
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
