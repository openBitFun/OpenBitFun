package com.openbitfun.mobile.app

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.openbitfun.mobile.app.ui.chat.message.LocalReduceMotionOverride
import com.openbitfun.mobile.app.ui.chat.message.MessageBlockCallbacks
import com.openbitfun.mobile.app.ui.chat.message.MessageBlockList
import com.openbitfun.mobile.app.ui.chat.message.SUBAGENT_AVATAR_TEST_TAG
import com.openbitfun.mobile.app.ui.chat.message.SUBAGENT_GROUP_TEST_TAG
import com.openbitfun.mobile.app.ui.chat.message.SUBAGENT_STATE_MARK_TEST_TAG
import com.openbitfun.mobile.app.ui.theme.OpenBitFunTheme
import com.openbitfun.mobile.core.feature.session.MessageBlock
import com.openbitfun.mobile.core.feature.workspace.RemoteFileDownloadUiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * The delegation card as it is painted on a device.
 *
 * The JVM tests own the mapping (which host word means which reading) and the
 * identity derivation. This file owns what a reader's eyes and a screen reader get:
 * that the six readings are drawn differently, that two spawn cards with one title
 * still look like two workers, that the header says what tapping it does, and that
 * a running worker actually moves — measured in pixels, on the device, in a
 * composition whose only input is written here. No session, no host, no account.
 */
class SubagentLivenessCardTest {
    @get:Rule
    val composeRule = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @Test
    fun everyReadingIsDrawnInItsOwnWords() {
        // The card never ends, so the clock is driven by hand.
        composeRule.mainClock.autoAdvance = false
        setCards(
            listOf(
                card("a", "tool-a", "Audit the parser", "tool_calling"),
                card("b", "tool-b", "Summarize the diff", "finishing"),
                card("c", "tool-c", "Draft the release note", "queued"),
                card("d", "tool-d", "Run the parser tests", "completed"),
                card("e", "tool-e", "Rewrite the lexer", "cancelled"),
                card("f", "tool-f", "Deploy the preview", "failed"),
            ),
        )
        composeRule.mainClock.advanceTimeByFrame()

        assertCardSays("Audit the parser", R.string.tool_phase_running)
        assertCardSays("Summarize the diff", R.string.subagent_state_finishing)
        assertCardSays("Draft the release note", R.string.tool_phase_waiting)
        assertCardSays("Run the parser tests", R.string.tool_phase_completed)
        assertCardSays("Rewrite the lexer", R.string.tool_phase_cancelled)
        assertCardSays("Deploy the preview", R.string.tool_phase_failed)
    }

    @Test
    fun aQueuedWorkerIsNeverReportedAsDone() {
        setCards(listOf(card("c", "tool-c", "Draft the release note", "queued")))

        assertCardSays("Draft the release note", R.string.tool_phase_waiting)
        // The reported symptom: a worker the host is still holding, printed as done.
        composeRule.onAllNodesWithText(string(R.string.tool_phase_completed)).assertCountEquals(0)
    }

    @Test
    fun everyReadingHasItsOwnMarkAndNotOnlyItsOwnWord() {
        composeRule.mainClock.autoAdvance = false
        setCards(
            listOf(
                card("a", "tool-a", "Audit the parser", "tool_calling"),
                card("b", "tool-b", "Summarize the diff", "finishing"),
                card("c", "tool-c", "Draft the release note", "queued"),
                card("d", "tool-d", "Run the parser tests", "completed"),
                card("e", "tool-e", "Rewrite the lexer", "cancelled"),
                card("f", "tool-f", "Deploy the preview", "failed"),
            ),
        )
        composeRule.mainClock.advanceTimeByFrame()

        // Same box, same density, six different pictures: the state is legible before
        // the word is read, and no two readings share a mark.
        val marks = composeRule.onAllNodesWithTag(SUBAGENT_STATE_MARK_TEST_TAG, useUnmergedTree = true)
        val images = (0 until 6).map { marks[it].captureToImage() }
        images.forEachIndexed { index, image ->
            assertTrue("mark $index was not drawn", image.width > 0 && image.height > 0)
        }
        for (first in images.indices) {
            for (second in first + 1 until images.size) {
                assertNotEquals(
                    "readings $first and $second draw the same mark",
                    images[first].pixels(),
                    images[second].pixels(),
                )
            }
        }
    }

    @Test
    fun twoSpawnCardsWithOneTitleStillHaveTwoFaces() {
        composeRule.mainClock.autoAdvance = false
        setCards(
            listOf(
                card("a", "tool-owner", "AgentSpawn", "tool_calling"),
                card("b", "tool-owner-2", "AgentSpawn", "tool_calling"),
            ),
        )
        composeRule.mainClock.advanceTimeByFrame()

        // The reported symptom: two spawn cards a reader could not tell apart.
        assertEquals(2, composeRule.onAllNodesWithText("AgentSpawn").fetchSemanticsNodes().size)
        val avatars = composeRule.onAllNodesWithTag(SUBAGENT_AVATAR_TEST_TAG, useUnmergedTree = true)
        val first = avatars[0].captureToImage()
        val second = avatars[1].captureToImage()
        assertEquals(first.width, second.width)
        assertEquals(first.height, second.height)
        assertNotEquals("two workers were drawn with one face", first.pixels(), second.pixels())
    }

    @Test
    fun theHeaderSaysWhatTappingItDoesAndTheAvatarSaysNothingTwice() {
        setCards(listOf(card("c", "tool-c", "Draft the release note", "queued")))

        // The avatar is decoration: the title already names the worker, so a screen
        // reader that read the avatar too would say it twice.
        val avatar = composeRule.onNodeWithTag(SUBAGENT_AVATAR_TEST_TAG, useUnmergedTree = true)
            .fetchSemanticsNode()
        assertFalse(
            "the avatar must not repeat the name a screen reader already reads",
            avatar.config.contains(SemanticsProperties.ContentDescription),
        )

        // The header is the only control that opens the steps, so it announces that.
        composeRule.onNodeWithContentDescription(string(R.string.subagent_expand_steps)).assertExists()
        composeRule.onNode(hasText("Draft the release note")).performClick()
        composeRule.onNodeWithContentDescription(string(R.string.subagent_collapse_steps)).assertExists()
        // And the state is announced with the name, in the same node.
        composeRule.onNode(
            hasText("Draft the release note") and hasText(string(R.string.tool_phase_waiting)),
        ).assertExists()
    }

    @Test
    fun aRunningWorkerMovesAndOnlyItsMarkMoves() {
        composeRule.mainClock.autoAdvance = false
        setCards(listOf(card("a", "tool-a", "Audit the parser", "tool_calling")))
        composeRule.mainClock.advanceTimeByFrame()

        val card = composeRule.onNodeWithTag(SUBAGENT_GROUP_TEST_TAG)
        val before = card.captureToImage()
        val cardBounds = card.fetchSemanticsNode().boundsInRoot
        val markBounds = composeRule
            .onNodeWithTag(SUBAGENT_STATE_MARK_TEST_TAG, useUnmergedTree = true)
            .fetchSemanticsNode().boundsInRoot

        // Half the pulse, which is what a second of watching looks like at 60fps.
        composeRule.mainClock.advanceTimeBy(450)
        val after = card.captureToImage()

        val changed = changedPixels(before, after)
        assertTrue("a running worker must move", changed.isNotEmpty())
        // Everything that changed is the indicator: the name, the avatar and the
        // chevron are the same pixels in both frames.
        changed.forEach { (x, y) ->
            val rootX = cardBounds.left + x
            val rootY = cardBounds.top + y
            assertTrue(
                "pixel ($rootX,$rootY) changed outside the state mark $markBounds",
                rootX >= markBounds.left - 1f && rootX <= markBounds.right + 1f &&
                    rootY >= markBounds.top - 1f && rootY <= markBounds.bottom + 1f,
            )
        }
    }

    @Test
    fun aReaderWhoRemovedAnimationsGetsTheSameCardTwice() {
        composeRule.mainClock.autoAdvance = false
        setCards(listOf(card("a", "tool-a", "Audit the parser", "tool_calling")), reduceMotion = true)
        composeRule.mainClock.advanceTimeByFrame()

        val card = composeRule.onNodeWithTag(SUBAGENT_GROUP_TEST_TAG)
        val before = card.captureToImage()
        composeRule.mainClock.advanceTimeBy(450)
        val after = card.captureToImage()

        // The reading is still there; only the movement is gone.
        assertCardSays("Audit the parser", R.string.tool_phase_running)
        assertTrue(
            "reduced motion must not animate",
            changedPixels(before, after).isEmpty(),
        )
    }

    // --- assertions -----------------------------------------------------------

    /** The name and the reading are announced together, in the card's own header. */
    private fun assertCardSays(title: String, word: Int) {
        composeRule.onNode(hasText(title) and hasText(string(word))).assertExists()
    }

    private fun string(resource: Int): String = context.getString(resource)

    // --- fixtures -------------------------------------------------------------

    private fun setCards(cards: List<MessageBlock.Subagent>, reduceMotion: Boolean = false) {
        composeRule.setContent {
            OpenBitFunTheme(dark = false) {
                CompositionLocalProvider(LocalReduceMotionOverride provides reduceMotion) {
                    Surface(
                        modifier = Modifier.fillMaxSize(),
                        color = MaterialTheme.colorScheme.background,
                        contentColor = MaterialTheme.colorScheme.onBackground,
                    ) {
                        Column(
                            modifier = Modifier.fillMaxSize().padding(16.dp),
                        ) {
                            MessageBlockList(
                                blocks = cards,
                                callbacks = callbacks(),
                                modifier = Modifier,
                            )
                        }
                    }
                }
            }
        }
    }

    /**
     * One card, written here.
     *
     * [status] is the host word the transcript carries; [owner] is the launch item's
     * tool call, which is what a worker's identity is derived from. The steps are
     * what makes the card openable, and they are the same in every fixture because
     * they are not what this file is about.
     */
    private fun card(id: String, owner: String, title: String, status: String) = MessageBlock.Subagent(
        id = id,
        title = title,
        running = status in setOf("running", "tool_calling", "queued", "finishing"),
        text = "",
        children = listOf(
            MessageBlock.Text("$id-step-1", "Read the module", false),
            MessageBlock.Text("$id-step-2", "Report what changed", false),
        ),
        status = status,
        ownerToolCallId = owner,
    )

    private fun callbacks() = MessageBlockCallbacks(
        enabled = true,
        onApproveTool = { _, _ -> },
        onRejectTool = { _, _ -> },
        onCancelTool = { _, _ -> },
        onAnswerTool = { _, _ -> },
        onAnswerToolStructured = { _, _ -> },
        onOpenLink = { _, _ -> },
        previewingRemotePath = "",
        previewLoading = false,
        download = RemoteFileDownloadUiState.None,
        onDownloadFile = { _, _ -> },
        downloadEnabled = true,
    )

    // --- pixel measurement ----------------------------------------------------

    /** Every pixel that differs, as card-local coordinates. */
    private fun changedPixels(first: ImageBitmap, second: ImageBitmap): List<Pair<Int, Int>> {
        assertEquals("captures must be the same size", first.pixels().size, second.pixels().size)
        val a = first.toPixelMap()
        val b = second.toPixelMap()
        val changed = mutableListOf<Pair<Int, Int>>()
        for (y in 0 until first.height) {
            for (x in 0 until first.width) {
                if (a[x, y].toArgb() != b[x, y].toArgb()) changed += x to y
            }
        }
        return changed
    }

    private fun ImageBitmap.pixels(): List<Int> {
        val map = toPixelMap()
        return (0 until height).flatMap { y -> (0 until width).map { x -> map[x, y].toArgb() } }
    }
}
