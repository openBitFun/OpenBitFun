package com.openbitfun.mobile.app

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.openbitfun.mobile.app.ui.chat.message.LocalReduceMotionOverride
import com.openbitfun.mobile.app.ui.chat.message.LocalSubagentAttach
import com.openbitfun.mobile.app.ui.chat.message.LocalSubagentFailures
import com.openbitfun.mobile.app.ui.chat.message.MessageBlockCallbacks
import com.openbitfun.mobile.app.ui.chat.message.MessageBlockList
import com.openbitfun.mobile.app.ui.chat.message.SUBAGENT_GROUP_TEST_TAG
import com.openbitfun.mobile.app.ui.theme.OpenBitFunTheme
import com.openbitfun.mobile.core.feature.session.MessageBlock
import com.openbitfun.mobile.core.feature.session.RemoteSessionFailureReason
import com.openbitfun.mobile.core.feature.workspace.RemoteFileDownloadUiState
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

private const val OWNER = "tool-owner"
private const val TITLE = "Audit the parser"
private const val STEP_ONE = "Read the parser module"
private const val STEP_TWO = "Run the parser tests"

/**
 * The delegation card as it is painted on a device.
 *
 * What this proves is the drawing path: a branch block — the shape the shared
 * presentation produces for a launch item the coordinator decorated — goes through
 * the real `MessageBlockList` -> `SubagentGroup` chain, so the reader really does see
 * the worker's steps behind their own expansion, the worker's own lifecycle reading,
 * the two "no steps" readings with their own copy, and the header's request to follow
 * the worker again reaching the surface that asked for it.
 *
 * What it does not prove is where those steps came from. The child stream, the cap,
 * the gap reset and the unsupported-host discovery are covered by the JVM tests in
 * `core-feature` (`SubagentBranchCoordinatorTest`), because none of them is a drawing
 * fact and all of them need a host to read from. No transport, no relay, no account
 * and no paired session is involved here — the fixture is the coordinator's own
 * output shape.
 *
 * Why the block list and not the whole conversation view: `ConversationView` takes a
 * `RemoteSessionUiState.Ready`, and building one from an invented transcript would
 * mean this test naming `core-domain` and `core-protocol` types, which the app module
 * is not allowed to reach (`scripts/check-mobile-architecture.mjs`, rule 3). The two
 * composition locals the card reads are therefore supplied here directly, exactly as
 * `ConversationView` supplies them from the state it is handed; that wiring is
 * compile-checked, and the store-side half of the same path is asserted in
 * `SubagentBranchCoordinatorTest`.
 *
 * The launch item's status in each fixture is the reading the card is handed, not the
 * spawn call's own answer: overriding the spawn's `completed` with the worker's
 * `running` is the coordinator's job and is asserted there. What is asserted here is
 * that the header prints the status it is given, that the steps are behind the
 * reader's own expansion, and that a card with no readable worker says so in the
 * reader's language instead of showing an invented step.
 */
class SubagentBranchCardTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun aDelegationCardShowsTheWorkersStepsWhileTheChildIsStillRunning() {
        val attached = mutableListOf<String>()
        setCard(
            block = runningCard(children = listOf(step(STEP_ONE), step(STEP_TWO))),
            onAttach = { attached += it },
            // The only fixture here whose worker is in flight, so the only one that
            // pulses: pinned still so the card can be driven to idle.
            reduceMotion = true,
        )

        composeRule.onNodeWithTag(SUBAGENT_GROUP_TEST_TAG).assertIsDisplayed()
        assertCardShows(R.string.tool_phase_running)
        assertCardHides(R.string.tool_phase_completed)

        // Collapsed by default: the worker's steps are one tap away, not on screen.
        assertCardHidesText(STEP_ONE)

        openCard()

        assertCardShowsText(STEP_ONE)
        assertCardShowsText(STEP_TWO)
        // Opening the card is the gesture that asks the store to follow the worker
        // again, and it names the launch item's own tool call — the key the store
        // follows that child by.
        assertEquals(listOf(OWNER), attached)
    }

    @Test
    fun aSettledChildKeepsItsStepsAndShowsTheSettledReading() {
        setCard(block = runningCard(status = "completed", children = listOf(step(STEP_ONE), step(STEP_TWO))))

        composeRule.onNodeWithTag(SUBAGENT_GROUP_TEST_TAG).assertIsDisplayed()
        assertCardShows(R.string.tool_phase_completed)
        assertCardHides(R.string.tool_phase_running)

        openCard()

        // A worker that reported is not a card that empties: its steps stay.
        assertCardShowsText(STEP_ONE)
        assertCardShowsText(STEP_TWO)
    }

    @Test
    fun aDesktopWithoutOnDemandStreamsSaysSoAndInventsNoSteps() {
        setCard(
            block = runningCard(status = "completed", children = emptyList()),
            failures = mapOf(OWNER to RemoteSessionFailureReason.HOST_STREAM_UNSUPPORTED),
        )

        composeRule.onNodeWithTag(SUBAGENT_GROUP_TEST_TAG).assertIsDisplayed()
        // Nothing was read about the worker, so the launch item's own status stands.
        assertCardShows(R.string.tool_phase_completed)

        openCard()

        assertCardShows(R.string.subagent_steps_unsupported)
        // The two "no steps" readings are not the same news, and this one is not a
        // stream that merely failed.
        assertCardHides(R.string.subagent_steps_unavailable)
        // No step was made up to fill the card.
        assertCardHides(R.string.chat_subagent_output)
        assertCardHidesText(STEP_ONE)
    }

    @Test
    fun aChildStreamThatFailedBeforeAnyContentKeepsTheLaunchStatusAndSaysStepsAreUnavailable() {
        setCard(
            block = runningCard(status = "completed", children = emptyList()),
            failures = mapOf(OWNER to RemoteSessionFailureReason.TRANSPORT),
        )

        composeRule.onNodeWithTag(SUBAGENT_GROUP_TEST_TAG).assertIsDisplayed()
        assertCardShows(R.string.tool_phase_completed)
        assertCardHides(R.string.tool_phase_running)

        openCard()

        assertCardShows(R.string.subagent_steps_unavailable)
        assertCardHides(R.string.subagent_steps_unsupported)
        assertCardHides(R.string.chat_subagent_output)
        assertCardHidesText(STEP_ONE)
    }

    // --- assertions -----------------------------------------------------------

    /**
     * Everything below is read *inside* the card.
     *
     * Several status words are shared with other surfaces ("Done", "Running"), so a
     * whole-screen search would be asking a different question than the one these
     * tests answer — and would break the day a "Done" button lands somewhere else.
     */
    private fun inCard(text: String) =
        hasText(text) and hasAnyAncestor(hasTestTag(SUBAGENT_GROUP_TEST_TAG))

    private fun assertCardShows(resource: Int) {
        composeRule.onNode(inCard(string(resource))).assertIsDisplayed()
    }

    private fun assertCardHides(resource: Int) {
        composeRule.onAllNodes(inCard(string(resource))).assertCountEquals(0)
    }

    private fun assertCardShowsText(text: String) {
        composeRule.onNode(inCard(text)).assertIsDisplayed()
    }

    private fun assertCardHidesText(text: String) {
        composeRule.onAllNodes(inCard(text)).assertCountEquals(0)
    }

    /** The reader's own gesture: the card header is the only thing that opens it. */
    private fun openCard() {
        composeRule.onNode(inCard(TITLE)).performClick()
        composeRule.waitForIdle()
    }

    // --- fixtures -------------------------------------------------------------

    private fun setCard(
        block: MessageBlock.Subagent,
        failures: Map<String, RemoteSessionFailureReason> = emptyMap(),
        onAttach: (String) -> Unit = {},
        /**
         * The card's own reading is unchanged by this; only its pulse is.
         *
         * A running worker pulses forever, which is what a reader sees and what
         * [SubagentLivenessCardTest] measures in pixels. Here the subject is the
         * drawing path, not the movement, so the one fixture whose worker is still
         * in flight pins the reading still: a compose test cannot idle on a clock
         * that never stops.
         */
        reduceMotion: Boolean = false,
    ) {
        composeRule.setContent {
            OpenBitFunTheme(dark = false) {
                CompositionLocalProvider(
                    LocalReduceMotionOverride provides reduceMotion,
                    LocalSubagentAttach provides onAttach,
                    LocalSubagentFailures provides failures,
                ) {
                    Surface(
                        modifier = Modifier.fillMaxSize(),
                        color = MaterialTheme.colorScheme.background,
                        contentColor = MaterialTheme.colorScheme.onBackground,
                    ) {
                        Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
                            MessageBlockList(
                                blocks = listOf(block),
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
     * The card a decorated launch item draws.
     *
     * [status] is what the header prints; the owner tool call is the key the store
     * follows that child by, and it is what opening the card names. [children] is
     * what the decoration attaches: the worker's own process, in the worker's own
     * order.
     */
    private fun runningCard(
        status: String = "running",
        children: List<MessageBlock>,
    ) = MessageBlock.Subagent(
        id = "message-owner-subagent-0",
        title = TITLE,
        running = status in setOf("running", "tool_calling"),
        text = "",
        children = children,
        status = status,
        ownerToolCallId = OWNER,
    )

    private fun step(content: String) = MessageBlock.Text("$OWNER-$content", content, false)

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

    private fun string(resource: Int): String =
        InstrumentationRegistry.getInstrumentation().targetContext.getString(resource)
}
