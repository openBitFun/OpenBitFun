package com.openbitfun.mobile.app

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.dp
import com.openbitfun.mobile.app.ui.remote.RemoteRecentRow
import com.openbitfun.mobile.app.ui.remote.SESSION_RENAME_FIELD_TEST_TAG
import com.openbitfun.mobile.app.ui.remote.SESSION_RENAME_ROW_TEST_TAG
import com.openbitfun.mobile.app.ui.remote.SessionActionPopup
import com.openbitfun.mobile.app.ui.remote.SessionActionSheet
import com.openbitfun.mobile.app.ui.theme.OpenBitFunTheme
import com.openbitfun.mobile.core.feature.session.RemoteSessionIntent
import com.openbitfun.mobile.core.feature.session.SessionActionPolicy
import com.openbitfun.mobile.core.feature.session.SessionActionScope
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * The rename step of the remote session menu, on an isolated fixture.
 *
 * The surface takes fields rather than a session — `RemoteSession` lives in
 * `core-domain`, which app sources may not import — so this exercises the sheet
 * and the popup directly and records what they would hand the store. Nothing
 * here proves a live host round trip: the store and `update_session_title` are
 * the other half, and only a real paired desktop answers them.
 */
class SessionRenameActionTest {
    @get:Rule
    val composeRule = createComposeRule()

    private val sessionId = "6f1c2d9a"
    private val sessionTitle = "Fix the relay timeout"

    @Test
    fun theRemoteMenuOffersRenameAndSeedsTheFieldWithTheCurrentTitle() {
        val intents = mutableListOf<RemoteSessionIntent>()
        setSheet(intents = intents)

        composeRule.onNodeWithTag(SESSION_RENAME_ROW_TEST_TAG).assertIsDisplayed().performClick()

        composeRule.onNodeWithTag(SESSION_RENAME_FIELD_TEST_TAG)
            .assertIsDisplayed()
            .assertTextEquals(sessionTitle)
        assertTrue(intents.isEmpty())
    }

    @Test
    fun submittingSendsOneRenameForThisSessionAndDismisses() {
        val intents = mutableListOf<RemoteSessionIntent>()
        var dismissals = 0
        setSheet(intents = intents, onDismiss = { dismissals += 1 })

        composeRule.onNodeWithTag(SESSION_RENAME_ROW_TEST_TAG).performClick()
        composeRule.onNodeWithTag(SESSION_RENAME_FIELD_TEST_TAG).performTextClearance()
        composeRule.onNodeWithTag(SESSION_RENAME_FIELD_TEST_TAG).performTextInput("New title")
        composeRule.onNodeWithText(testString(R.string.session_rename_confirm)).performClick()

        assertEquals(
            listOf(RemoteSessionIntent.RenameSession(sessionId, "New title")),
            intents,
        )
        assertEquals(1, dismissals)
    }

    @Test
    fun theSubmittedTitleIsTheTrimmedDraft() {
        val intents = mutableListOf<RemoteSessionIntent>()
        setSheet(intents = intents)

        composeRule.onNodeWithTag(SESSION_RENAME_ROW_TEST_TAG).performClick()
        composeRule.onNodeWithTag(SESSION_RENAME_FIELD_TEST_TAG).performTextClearance()
        composeRule.onNodeWithTag(SESSION_RENAME_FIELD_TEST_TAG).performTextInput("  Padded title  ")
        composeRule.onNodeWithText(testString(R.string.session_rename_confirm)).performClick()

        // The store trims too; this pins that the surface never hands it padding
        // that would be stored and rendered as part of the title.
        assertEquals(
            listOf(RemoteSessionIntent.RenameSession(sessionId, "Padded title")),
            intents,
        )
    }

    @Test
    fun aBlankHostTitleIsShownAsUntitledAndCanBeGivenAName() {
        val intents = mutableListOf<RemoteSessionIntent>()
        // A host that has not named the session yet sends no title at all.
        setSheet(intents = intents, title = "")

        composeRule.onNodeWithText(testString(R.string.sidebar_untitled)).assertIsDisplayed()
        composeRule.onNodeWithTag(SESSION_RENAME_ROW_TEST_TAG).assertIsDisplayed().performClick()

        // Seeded from the raw title, not from the placeholder: saving without
        // typing must not rename the session to "Untitled session".
        composeRule.onNodeWithTag(SESSION_RENAME_FIELD_TEST_TAG).assertIsDisplayed()
        composeRule.onNodeWithText(testString(R.string.session_rename_confirm)).assertIsNotEnabled()

        composeRule.onNodeWithTag(SESSION_RENAME_FIELD_TEST_TAG).performTextInput("Named on the phone")
        composeRule.onNodeWithText(testString(R.string.session_rename_confirm)).performClick()

        assertEquals(
            listOf(RemoteSessionIntent.RenameSession(sessionId, "Named on the phone")),
            intents,
        )
    }

    @Test
    fun cancellingReturnsToTheActionListAndSendsNothing() {
        val intents = mutableListOf<RemoteSessionIntent>()
        setSheet(intents = intents)

        composeRule.onNodeWithTag(SESSION_RENAME_ROW_TEST_TAG).performClick()
        composeRule.onNodeWithTag(SESSION_RENAME_FIELD_TEST_TAG).performTextInput(" typed")
        composeRule.onNodeWithText(testString(R.string.common_cancel)).performClick()

        assertTrue(intents.isEmpty())
        // The step is gone and the rows it replaced are back.
        composeRule.onNodeWithTag(SESSION_RENAME_FIELD_TEST_TAG).assertDoesNotExist()
        composeRule.onNodeWithTag(SESSION_RENAME_ROW_TEST_TAG).assertIsDisplayed()
    }

    @Test
    fun anUnchangedOrBlankTitleCannotBeSubmitted() {
        val intents = mutableListOf<RemoteSessionIntent>()
        setSheet(intents = intents)

        composeRule.onNodeWithTag(SESSION_RENAME_ROW_TEST_TAG).performClick()
        // Seeded with the title the row already carries, so there is nothing to send.
        composeRule.onNodeWithText(testString(R.string.session_rename_confirm)).assertIsNotEnabled()

        composeRule.onNodeWithTag(SESSION_RENAME_FIELD_TEST_TAG).performTextClearance()
        composeRule.onNodeWithText(testString(R.string.session_rename_confirm)).assertIsNotEnabled()

        // Something new is exactly what re-enables it.
        composeRule.onNodeWithTag(SESSION_RENAME_FIELD_TEST_TAG).performTextInput("New title")
        composeRule.onNodeWithText(testString(R.string.session_rename_confirm)).assertIsEnabled()

        assertTrue(intents.isEmpty())
    }

    @Test
    fun aCommandStartingWhileTheEditorIsOpenCannotBeSubmitted() {
        val intents = mutableListOf<RemoteSessionIntent>()
        val capabilities = mutableStateOf(
            SessionActionPolicy.resolve(SessionActionScope.REMOTE, "code", busy = false),
        )
        composeRule.setContent {
            OpenBitFunTheme(dark = false) {
                SessionActionSheet(
                    title = sessionTitle,
                    status = "idle",
                    capabilities = capabilities.value,
                    onViewDetails = {},
                    onRename = { intents += RemoteSessionIntent.RenameSession(sessionId, it) },
                    onDelete = {},
                    onDismiss = {},
                )
            }
        }

        composeRule.onNodeWithTag(SESSION_RENAME_ROW_TEST_TAG).performClick()
        composeRule.onNodeWithTag(SESSION_RENAME_FIELD_TEST_TAG).performTextClearance()
        composeRule.onNodeWithTag(SESSION_RENAME_FIELD_TEST_TAG).performTextInput("New title")

        // A delete or a refresh starts while the field is open: the row that
        // opened this step is gone, and submitting now would cancel that command.
        // Mutated inside runOnIdle rather than from the test thread, so the write
        // and the recomposition it triggers are ordered by the rule's clock
        // instead of racing it.
        composeRule.runOnIdle {
            capabilities.value = SessionActionPolicy.resolve(
                SessionActionScope.REMOTE,
                "code",
                busy = true,
            )
        }

        // Only the disabled state is asserted here. Clicking the node to prove the
        // handler re-checks would depend on a disabled clickable still publishing
        // an onClick action, which is a Compose implementation detail: the day it
        // changes, this test would fail for a reason that has nothing to do with
        // renaming.
        composeRule.onNodeWithText(testString(R.string.session_rename_confirm))
            .assertIsNotEnabled()

        assertTrue(intents.isEmpty())
    }

    @Test
    fun aCommandInFlightOffersNoRename() {
        val intents = mutableListOf<RemoteSessionIntent>()
        setSheet(intents = intents, busy = true)

        composeRule.onAllNodesWithTag(SESSION_RENAME_ROW_TEST_TAG).assertCountEquals(0)
    }

    @Test
    fun aSurfaceWithoutARenameCallbackDrawsNoRenameRow() {
        // A shell that cannot dispatch a rename passes no callback; the row is
        // capability-gated *and* callback-gated, so it must not be drawn at all.
        composeRule.setContent {
            OpenBitFunTheme(dark = false) {
                SessionActionSheet(
                    title = sessionTitle,
                    status = "idle",
                    capabilities = SessionActionPolicy.resolve(
                        SessionActionScope.REMOTE,
                        "code",
                        busy = false,
                    ),
                    onViewDetails = {},
                    onRename = null,
                    onDelete = {},
                    onDismiss = {},
                )
            }
        }

        composeRule.onAllNodesWithTag(SESSION_RENAME_ROW_TEST_TAG).assertCountEquals(0)
    }

    @Test
    fun theWideSidebarPopupOffersTheSameStep() {
        val intents = mutableListOf<RemoteSessionIntent>()
        composeRule.setContent {
            OpenBitFunTheme(dark = false) {
                Box(modifier = Modifier.size(320.dp)) {
                    SessionActionPopup(
                        // Anchored inside the window rather than at its origin: the
                        // popup is placed relative to this rect, and an anchor at
                        // (0, 0) puts the menu under the status bar on a real phone,
                        // where `assertIsDisplayed` would then be arguing with the
                        // system bars instead of with the rename row.
                        anchorBounds = IntRect(24, 240, 144, 280),
                        title = sessionTitle,
                        status = "idle",
                        capabilities = SessionActionPolicy.resolve(
                            SessionActionScope.REMOTE,
                            "code",
                            busy = false,
                        ),
                        onViewDetails = {},
                        onRename = { intents += RemoteSessionIntent.RenameSession(sessionId, it) },
                        onDelete = {},
                        onDismiss = {},
                    )
                }
            }
        }

        composeRule.onNodeWithTag(SESSION_RENAME_ROW_TEST_TAG).assertIsDisplayed().performClick()
        composeRule.onNodeWithTag(SESSION_RENAME_FIELD_TEST_TAG)
            .assertIsDisplayed()
            .assertTextEquals(sessionTitle)
        composeRule.onNodeWithTag(SESSION_RENAME_FIELD_TEST_TAG).performTextClearance()
        composeRule.onNodeWithTag(SESSION_RENAME_FIELD_TEST_TAG).performTextInput("Renamed in the rail")
        composeRule.onNodeWithText(testString(R.string.session_rename_confirm)).performClick()

        assertEquals(
            listOf(RemoteSessionIntent.RenameSession(sessionId, "Renamed in the rail")),
            intents,
        )
    }

    @Test
    fun theHomeRecentRowShowsTheUntitledLabelForABlankHostTitle() {
        composeRule.setContent {
            OpenBitFunTheme(dark = false) {
                Column {
                    RemoteRecentRow(title = "", subtitle = "Studio · main", onOpen = {})
                    RemoteRecentRow(title = sessionTitle, subtitle = "Studio · main", onOpen = {})
                }
            }
        }

        // The home screen is the first surface the user sees: a host that has not
        // named the session sends no title, and that must read as the same
        // localized "untitled" the list row, rail and sheets show rather than as
        // an empty line.
        composeRule.onNodeWithText(testString(R.string.sidebar_untitled)).assertIsDisplayed()
        // A real host title is shown verbatim, not replaced by the label.
        composeRule.onNodeWithText(sessionTitle).assertIsDisplayed()
    }

    private fun setSheet(
        intents: MutableList<RemoteSessionIntent>,
        busy: Boolean = false,
        title: String = sessionTitle,
        onDismiss: () -> Unit = {},
    ) {
        composeRule.setContent {
            OpenBitFunTheme(dark = false) {
                SessionActionSheet(
                    title = title,
                    status = "idle",
                    capabilities = SessionActionPolicy.resolve(
                        SessionActionScope.REMOTE,
                        "code",
                        busy,
                    ),
                    onViewDetails = {},
                    onRename = { intents += RemoteSessionIntent.RenameSession(sessionId, it) },
                    onDelete = {},
                    onDismiss = onDismiss,
                )
            }
        }
    }
}
