package com.openbitfun.mobile.app.ui.chat

import com.openbitfun.mobile.app.ui.chat.message.*
import org.junit.Assert.*
import org.junit.Test

/**
 * What a delegation card is allowed to say about its worker.
 *
 * The card used to fold the host's vocabulary into two readings, and everything it
 * did not recognise became "Done". These are the facts that replaced that: which
 * host word means which of the six readings, that an unreadable status is not
 * guessed at, and that the identity a worker is drawn with is stable and derived
 * from the delegation itself.
 */
class SubagentLivenessTest {
    @Test fun aWorkerThatIsStillTakingItsTurnIsNeverReportedAsDone() {
        val inFlight = listOf(
            "running", "streaming", "active", "inprogress", "in_progress", "preparing",
            "starting", "thinking", "tool_calling", "pending_confirmation", "capability_required",
        )
        inFlight.forEach { assertEquals("status=$it", SubagentLiveness.RUNNING, subagentLiveness(it)) }
        // The host's own case and padding are not a different state.
        assertEquals(SubagentLiveness.RUNNING, subagentLiveness("  Tool_Calling "))
        assertTrue(SubagentLiveness.RUNNING.inFlight)
    }

    @Test fun aTurnThatIsWrappingUpIsItsOwnReadingAndStillInFlight() {
        listOf("finishing", "finalizing", "wrapping_up").forEach {
            assertEquals("status=$it", SubagentLiveness.FINISHING, subagentLiveness(it))
        }
        assertTrue(SubagentLiveness.FINISHING.inFlight)
    }

    @Test fun aQueuedWorkerIsWaitingRatherThanRunningOrDone() {
        listOf("queued", "pending", "waiting", "blocked", "deferred", "scheduled").forEach {
            assertEquals("status=$it", SubagentLiveness.WAITING, subagentLiveness(it))
        }
        // Accepted but not started: nothing is running, so nothing may pulse.
        assertFalse(SubagentLiveness.WAITING.inFlight)
    }

    @Test fun terminalOutcomesKeepTheirOwnReading() {
        listOf("completed", "complete", "success", "succeeded", "done", "finished").forEach {
            assertEquals("status=$it", SubagentLiveness.COMPLETED, subagentLiveness(it))
        }
        listOf("cancelled", "canceled", "aborted", "interrupted", "stopped", "skipped").forEach {
            assertEquals("status=$it", SubagentLiveness.CANCELLED, subagentLiveness(it))
        }
        listOf("failed", "error", "timeout", "timed_out", "rejected", "crashed", "denied").forEach {
            assertEquals("status=$it", SubagentLiveness.ERROR, subagentLiveness(it))
        }
        listOf(SubagentLiveness.COMPLETED, SubagentLiveness.CANCELLED, SubagentLiveness.ERROR).forEach {
            assertFalse(it.inFlight)
        }
    }

    @Test fun aStatusThisClientCannotReadIsSaidSoInsteadOfGuessedAsDone() {
        // The one answer that is always wrong when it is wrong is the invented one.
        listOf("", "   ", "paused-by-policy", "reticulating", "in progress").forEach {
            assertEquals("status=$it", SubagentLiveness.UNKNOWN, subagentLiveness(it))
        }
        assertFalse(SubagentLiveness.UNKNOWN.inFlight)
    }

    @Test fun aWorkerIsIdentifiedByItsOwnDelegationAndNotByItsLabel() {
        // The launch item's tool call is the host's name for this delegation; a block
        // the host published without one falls back to its position.
        assertEquals("tool-abc", subagentIdentityKey(" tool-abc ", "message-1-subagent-0"))
        assertEquals("message-1-subagent-0", subagentIdentityKey("", "message-1-subagent-0"))
        assertEquals("message-1-subagent-0", subagentIdentityKey("   ", " message-1-subagent-0 "))
    }

    @Test fun theSameDelegationIsAlwaysDrawnTheSameWay() {
        val first = subagentIdentity("tool-abc")
        repeat(5) { assertEquals(first, subagentIdentity("tool-abc")) }
        // Padding is not a different worker.
        assertEquals(first, subagentIdentity("  tool-abc  "))
        // Pinned: the derivation is a pure function of the key, so a worker keeps its
        // face across redraws, restarts and devices. Changing this value repaints
        // every card that already exists, which is why it is asserted here.
        assertEquals(SubagentIdentity(glyph = 3, tint = 2), subagentIdentity("tool-owner"))
        assertEquals(SubagentIdentity(glyph = 0, tint = 0), subagentIdentity(""))
        // Pools are bounded, so a card can never index outside them.
        listOf("tool-abc", "tool-def", "tool-1", "message-9-subagent-3", "session-42").forEach { key ->
            val identity = subagentIdentity(key)
            assertTrue(identity.glyph in 0 until SUBAGENT_GLYPH_COUNT)
            assertTrue(identity.tint in 0 until SUBAGENT_TINT_COUNT)
        }
    }

    @Test fun twoDelegationsOfTheSameTitleDoNotShareOneFace() {
        // The reported symptom: two spawn cards with the same words and no way to
        // tell them apart. Collisions are allowed by design, but the launches a
        // screen actually shows have to differ.
        val keys = listOf("tool-owner", "tool-owner-2", "tool-owner-3", "tool-owner-4")
        val faces = keys.map(::subagentIdentity)
        assertEquals(faces.size, faces.distinct().size)
        assertNotEquals(subagentIdentity("tool-owner"), subagentIdentity("tool-owner-2"))
    }

    @Test fun aWorkersNameIsItsOwnWordsOrNothing() {
        assertEquals("Audit the parser", subagentDisplayName("  Audit the parser \n"))
        assertEquals("", subagentDisplayName("   "))
        // Never the tool that launched it, and never a name this client invented.
        assertEquals("agentspawn", subagentDisplayName("agentspawn"))
    }
}
