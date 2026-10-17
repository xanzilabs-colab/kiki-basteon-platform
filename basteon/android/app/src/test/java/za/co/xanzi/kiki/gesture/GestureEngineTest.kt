package za.co.xanzi.kiki.gesture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GestureEngineTest {
    @Test
    fun mediaToggleKeysShareOneToken() {
        listOf(KeyCodes.HEADSETHOOK, KeyCodes.PLAY_PAUSE, KeyCodes.PLAY, KeyCodes.PAUSE)
            .forEach { assertEquals(Tok.TOGGLE, tokenForKeyCode(it)) }
    }

    @Test
    fun mapsTrackVolumeAndUnknownKeys() {
        assertEquals(Tok.NEXT, tokenForKeyCode(KeyCodes.NEXT))
        assertEquals(Tok.PREV, tokenForKeyCode(KeyCodes.PREVIOUS))
        assertEquals(Tok.STOP, tokenForKeyCode(KeyCodes.STOP))
        assertEquals(Tok.VOL_UP, tokenForKeyCode(KeyCodes.VOLUME_UP))
        assertEquals(Tok.VOL_DOWN, tokenForKeyCode(KeyCodes.VOLUME_DOWN))
        assertEquals(Tok.OTHER, tokenForKeyCode(999))
    }

    @Test
    fun mergerDropsCrossSourceDuplicatesButKeepsSeparateSameSourceTaps() {
        val merger = PressMerger()
        assertTrue(merger.isNewPress(RawInput(100, Src.KEY, Tok.TOGGLE)))
        assertFalse(merger.isNewPress(RawInput(150, Src.SESSION, Tok.TOGGLE)))
        assertTrue(merger.isNewPress(RawInput(300, Src.KEY, Tok.TOGGLE)))
    }

    @Test
    fun mergerDeduplicatesObservedVolumeBroadcastsAgainstMediaKeys() {
        val merger = PressMerger()
        assertTrue(merger.isNewPress(RawInput(100, Src.KEY, Tok.VOL_UP)))
        assertFalse(merger.isNewPress(RawInput(160, Src.VOLUME, Tok.VOL_UP)))
    }

    @Test
    fun sequencerBuildsBurstSignaturesAndGaps() {
        val sequencer = Sequencer(650)
        listOf(0L, 100L, 200L).forEach { sequencer.add(RawInput(it, Src.KEY, Tok.TOGGLE)) }
        val fast = sequencer.finish()!!
        assertEquals("TTT", fast.signature())
        assertEquals(listOf(100L, 100L), fast.gapsMs)

        listOf(1000L, 1100L, 1900L).forEach { sequencer.add(RawInput(it, Src.KEY, Tok.TOGGLE)) }
        assertEquals("TT-T", sequencer.finish()?.signature())
    }

    @Test
    fun sequencerPreservesPlayPauseAndDistinctVolumeEventsUpToSixPresses() {
        val mixed = Sequencer(650)
        listOf(Tok.TOGGLE, Tok.VOL_UP, Tok.VOL_DOWN).forEachIndexed { index, token ->
            mixed.add(RawInput(index * 100L, Src.KEY, token))
        }
        assertEquals("TUD", mixed.finish()?.signature())

        val repeated = Sequencer(650)
        repeat(6) { index -> repeated.add(RawInput(index * 100L, Src.KEY, Tok.VOL_UP)) }
        assertEquals("UUUUUU", repeated.finish()?.signature())
    }

    @Test
    fun truncatesLongSignaturesToTwentyCharacters() {
        val sequencer = Sequencer()
        repeat(25) { sequencer.add(RawInput(it.toLong(), Src.KEY, Tok.TOGGLE)) }
        assertEquals(20, sequencer.finish()?.signature()?.length)
    }

    @Test
    fun matcherRequiresVerifiedProfilesAndRejectsAmbiguousActions() {
        val unverified = profile("unverified", mapOf("TTT" to "sos"), null)
        assertTrue(matchGesture("TTT", listOf(unverified)) is MatchResult.Unverified)
        assertTrue(matchGesture("TTT", listOf(unverified), requireVerified = false) is MatchResult.Hit)
        assertTrue(matchGesture("other", listOf(unverified)) is MatchResult.None)

        val a = profile("a", mapOf("TTT" to "sos"), 1L)
        val b = profile("b", mapOf("TTT" to "medical"), 1L)
        assertEquals(setOf("sos", "medical"), (matchGesture("TTT", listOf(a, b)) as MatchResult.Ambiguous).actions)
    }

    @Test
    fun autoOnlyUsesProfilesAssignedToConnectedDevicesOrAnUnassignedAccessory() {
        val connected = profile("connected", mapOf("TTT" to "sos"), 1L).copy(deviceRef = "bt:AA:BB")
        val disconnected = profile("disconnected", mapOf("UUU" to "sos"), 1L).copy(deviceRef = "bt:CC:DD")
        val shared = profile("shared", mapOf("PPP" to "sos"), 1L)

        assertEquals(
            listOf(connected, shared),
            connectedProfiles(listOf(connected, disconnected, shared), "auto", setOf("bt:AA:BB"))
        )
    }

    @Test
    fun selectedProfileCannotFallBackToAnUnrelatedVerifiedAccessory() {
        val selected = profile("selected", mapOf("TTT" to "sos"), 1L).copy(deviceRef = "bt:AA:BB")
        val other = profile("other", mapOf("UUU" to "sos"), 1L).copy(deviceRef = "bt:CC:DD")

        assertTrue(connectedProfiles(listOf(selected, other), "selected", setOf("bt:CC:DD")).isEmpty())
    }

    @Test
    fun duplicateDisplayNamesRemainIndependentByStableDeviceReference() {
        val left = profile("left-profile", mapOf("TTT" to "sos"), 1L).copy(
            name = "Wireless earbuds",
            deviceRef = "bt:device-left"
        )
        val right = profile("right-profile", mapOf("UUU" to "sos"), 1L).copy(
            name = "Wireless earbuds",
            deviceRef = "bt:device-right"
        )

        assertEquals(
            listOf(left),
            connectedProfiles(listOf(left, right), "auto", setOf("bt:device-left"))
        )
    }

    @Test
    fun timingUsesTheMostConservativeCandidate() {
        assertEquals(900L, settleMsFor(emptyList()))
        assertEquals(650L, gapMsFor(emptyList()))
        assertEquals(1200L, settleMsFor(listOf(profile("a", emptyMap(), 1L).copy(settleMs = 800), profile("b", emptyMap(), 1L).copy(settleMs = 1200))))
        assertEquals(700L, gapMsFor(listOf(profile("a", emptyMap(), 1L).copy(gapMs = 500), profile("b", emptyMap(), 1L).copy(gapMs = 700))))
    }

    private fun profile(id: String, mapping: Map<String, String>, verifiedAt: Long?) =
        Profile(id, id, "earbuds", null, 650, 900, mapping, verifiedAt)
}
