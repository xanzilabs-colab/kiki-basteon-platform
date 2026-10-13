package za.co.xanzi.kiki

import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class PressPatternRecognizerTest {
    @Test
    fun recognizesQuickPressesAsSos() {
        val result = presses(0, 100, 200, 300, 400).finish()
        assertNotNull(result)
        assertEquals("5", result?.sequence)
        assertEquals("sos", result?.pattern)
    }

    @Test
    fun recognizesMedicalBurstPattern() {
        val result = presses(0, 100, 200, 1_000, 1_100).finish()
        assertNotNull(result)
        assertEquals("3-2", result?.sequence)
        assertEquals("medical", result?.pattern)
    }

    @Test
    fun recognizesDiscreetDuressPattern() {
        val result = presses(0, 100, 900, 1_000, 1_800, 1_900).finish()
        assertNotNull(result)
        assertEquals("2-2-2", result?.sequence)
        assertEquals("duress", result?.pattern)
    }

    @Test
    fun recognizesFourPressCancelPattern() {
        val result = presses(0, 100, 200, 300).finish()
        assertNotNull(result)
        assertEquals("cancel", result?.pattern)
    }

    @Test
    fun ignoresUnmatchedSequencesAndResetsForNextPattern() {
        val recognizer = presses(0, 100, 900)
        assertEquals(null, recognizer.finish()?.pattern)
        val second = pressesOn(recognizer, 2_000, 2_100, 2_200, 2_300, 2_400).finish()
        assertEquals("sos", second?.pattern)
    }

    @Test
    fun universalModeMapsConfiguredSingleBurstClickCounts() {
        val patterns = mapOf(2 to "sos", 3 to "medical")
        assertEquals("sos", resolveUniversalPattern("2", patterns))
        assertEquals("medical", resolveUniversalPattern("3", patterns))
        assertEquals(null, resolveUniversalPattern("4", patterns))
    }

    @Test
    fun universalModeCountsClicksAcrossBurstGroupsInOneSequence() {
        assertEquals("sos", resolveUniversalPattern("2-2", mapOf(4 to "sos")))
        assertEquals(null, resolveUniversalPattern("2-x", mapOf(2 to "sos")))
    }

    @Test
    fun countsMediaPreviousAsTheObservedTwoClickGesture() {
        val recognizer = PressPatternRecognizer()
        val count = recognizer.press(100, mediaButtonClickWeight(KeyEvent.KEYCODE_MEDIA_PREVIOUS))

        assertEquals(2, count)
        val result = recognizer.finish()
        assertNotNull(result)
        assertEquals("2", result?.sequence)
        assertEquals(2, result?.presses)
        assertEquals("sos", resolveUniversalPattern(result?.sequence.orEmpty(), mapOf(2 to "sos")))
    }

    @Test
    fun keepsMediaPauseAsOneClick() {
        val recognizer = PressPatternRecognizer()
        val count = recognizer.press(100, mediaButtonClickWeight(KeyEvent.KEYCODE_MEDIA_PAUSE))

        assertEquals(1, count)
        assertEquals("1", recognizer.finish()?.sequence)
    }

    private fun presses(vararg timestamps: Long) = pressesOn(PressPatternRecognizer(), *timestamps)

    private fun pressesOn(recognizer: PressPatternRecognizer, vararg timestamps: Long): PressPatternRecognizer {
        timestamps.forEach(recognizer::press)
        return recognizer
    }
}
