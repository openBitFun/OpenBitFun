package com.openbitfun.mobile.core.feature.session

import com.openbitfun.mobile.core.domain.ChatMessage
import com.openbitfun.mobile.core.domain.ChatTimelineStore
import com.openbitfun.mobile.core.feature.connection.ConnectionPhase
import com.openbitfun.mobile.core.feature.session.RemoteSessionFailureReason
import com.openbitfun.mobile.core.protocol.ChatMessageItemResponse
import com.openbitfun.mobile.core.protocol.CommandStatus
import com.openbitfun.mobile.core.protocol.RelayJson
import com.openbitfun.mobile.core.protocol.RemoteCommand
import com.openbitfun.mobile.core.protocol.RemoteToolStatusResponse
import com.openbitfun.mobile.core.transport.HostStreamUnsupportedException
import com.openbitfun.mobile.core.transport.RemoteCommandTransport
import com.openbitfun.mobile.core.transport.RemoteSessionStreamTransport
import com.openbitfun.mobile.core.transport.STREAM_EVENT_GAP
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

private const val PARENT = "s-parent"
private const val CHILD = "s-child"
private const val OWNER = "tool-owner"

/**
 * A delegation tool's child session, drawn inside the card that launched it.
 *
 * Every host here is simulated: these tests say what this client does with the
 * records a host publishes, and nothing about what a live host publishes. The
 * reference for the behaviour is the HarmonyOS coordinator; the grouping rule it
 * implements is the one asserted here — a child's steps belong to the launch item
 * the parent transcript names, and nothing else is ever probed.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SubagentBranchCoordinatorTest {

    /**
     * The child session id the host stamped on the launching item has to survive
     * mapping: it is the only key a reader has to open the child's stream.
     */
    @Test
    fun aChildSessionIdSurvivesTheParentTranscriptAndMarksTheBranch() {
        val replica = SessionRecordReplica(PARENT)
        replica.apply(launchEvent(PARENT, "t-parent", OWNER, CHILD, revision = 1).getValue("payload").jsonObject)
        val item = replica.messages().flatMap { it.items.orEmpty() }.single { it.tool != null }

        assertEquals(CHILD, item.tool?.subagentSessionId)
        assertEquals(OWNER, item.tool?.id)
        assertEquals(true, item.isSubagent)
    }

    /**
     * One subscription per owner. The parent republishes the same launch on every
     * record it receives, and that is not a reason to take a slot back from a
     * worker that is using one.
     */
    @Test
    fun oneSubscriptionPerOwnerEvenWhenTheLaunchIsRestated() = runTest {
        val host = FakeChildStreams()
        val coordinator = SubagentBranchCoordinator(backgroundScope, host, publish = {}, onError = { _, _ -> })
        coordinator.beginSession(PARENT)
        val parent = listOf(parentMessage(launchItem(OWNER, CHILD)))

        coordinator.decorate(parent)
        runCurrent()
        coordinator.decorate(parent)
        coordinator.decorate(parent)
        runCurrent()

        assertEquals(listOf(CHILD), host.attempts)
        assertEquals(1, host.openCount)
        assertEquals(1, coordinator.followState().branches)
    }

    /**
     * The card shows the worker's own steps and the worker's own lifecycle. The
     * launch item's status is the spawn call's outcome, which says nothing about
     * whether the worker is still working.
     */
    @Test
    fun theChildsStepsAttachToTheOwnerItemAndItsStatusFollowsTheChildsTurns() = runTest {
        val host = FakeChildStreams()
        val coordinator = SubagentBranchCoordinator(backgroundScope, host, publish = {}, onError = { _, _ -> })
        coordinator.beginSession(PARENT)
        val parent = listOf(parentMessage(launchItem(OWNER, CHILD, status = "completed")))

        var decorated = coordinator.decorate(parent).single().items!!.single()
        runCurrent()
        // Started and not finished: the worker is running, whatever the spawn answered.
        assertEquals("running", decorated.tool?.status)

        host.push(CHILD, richRecord(CHILD, "t-child", 0, 1, "inprogress", "step one"))
        runCurrent()
        decorated = coordinator.decorate(parent).single().items!!.single()
        assertEquals(listOf("step one"), decorated.subItems?.map { it.content })
        assertEquals("running", decorated.tool?.status)

        host.push(CHILD, richRecord(CHILD, "t-child", 0, 2, "completed", "step one"))
        runCurrent()
        decorated = coordinator.decorate(parent).single().items!!.single()
        assertEquals(listOf("step one"), decorated.subItems?.map { it.content })
        assertEquals("completed", decorated.tool?.status)
        coordinator.endSession()
    }

    /**
     * A worker that is still taking its turn is never reported as finished.
     *
     * The host's turn vocabulary is wider than `running`: a turn that started, is
     * thinking, is calling a tool, or is waiting on a permission answer has not
     * produced an outcome, and reading any of them as one is what printed "Done"
     * over a worker that was still working. The card is handed the reading, so the
     * reading is what is asserted here.
     */
    @Test
    fun aChildTurnThatIsStillTakingItsTurnIsNotReportedAsFinished() = runTest {
        val host = FakeChildStreams()
        val coordinator = SubagentBranchCoordinator(backgroundScope, host, publish = {}, onError = { _, _ -> })
        coordinator.beginSession(PARENT)
        val parent = listOf(parentMessage(launchItem(OWNER, CHILD, status = "completed")))

        coordinator.decorate(parent)
        runCurrent()

        // Each of these is a turn in progress, published by the host in that word.
        var revision = 0L
        for (status in listOf("starting", "thinking", "tool_calling", "pending_confirmation", "capability_required")) {
            revision += 1
            host.push(CHILD, richRecord(CHILD, "t-child", 0, revision, status, "step one"))
            runCurrent()
            assertEquals("running", coordinator.decorate(parent).single().items!!.single().tool?.status)
        }

        revision += 1
        host.push(CHILD, richRecord(CHILD, "t-child", 0, revision, "completed", "step one"))
        runCurrent()
        assertEquals("completed", coordinator.decorate(parent).single().items!!.single().tool?.status)
        coordinator.endSession()
    }

    /**
     * A queued turn is its own reading: not running, not done.
     *
     * The host accepts a turn before it starts one, and says so with `queued` or
     * `pending`. The card drew that as "Running" — and, since it is in flight for
     * the drawing, pulsed over a worker that had not begun — while an older reading
     * of the same word printed "Done". It is neither: the reading is passed through
     * as `waiting`, and the branch keeps its stream, because the turn it was queued
     * for is still going to be published on it.
     */
    @Test
    fun aChildTurnThatIsOnlyQueuedIsReportedAsWaitingAndKeepsItsStream() = runTest {
        val host = FakeChildStreams()
        val coordinator = SubagentBranchCoordinator(backgroundScope, host, publish = {}, onError = { _, _ -> })
        coordinator.beginSession(PARENT)
        val parent = listOf(parentMessage(launchItem(OWNER, CHILD, status = "completed")))

        coordinator.decorate(parent)
        runCurrent()

        var revision = 0L
        for (status in listOf("queued", "pending", "waiting")) {
            revision += 1
            host.push(CHILD, richRecord(CHILD, "t-child", 0, revision, status, "step one"))
            runCurrent()
            assertEquals("waiting", coordinator.decorate(parent).single().items!!.single().tool?.status)
        }

        // Accepted, not started: releasing the stream here would drop the turn the
        // host queued, so the branch keeps its slot.
        assertEquals(1, host.openCount)

        // The work it was queued for still arrives on the same stream, and is the
        // reading from then on.
        revision += 1
        host.push(CHILD, richRecord(CHILD, "t-child", 0, revision, "tool_calling", "step one"))
        runCurrent()
        assertEquals("running", coordinator.decorate(parent).single().items!!.single().tool?.status)

        revision += 1
        host.push(CHILD, richRecord(CHILD, "t-child", 0, revision, "completed", "step one"))
        runCurrent()
        assertEquals("completed", coordinator.decorate(parent).single().items!!.single().tool?.status)
        coordinator.endSession()
    }

    /**
     * A turn that is wrapping up is its own reading, and it is not an outcome.
     *
     * The host says `finishing` between the last token and the result. Collapsing
     * that into `completed` told the reader the worker was done while it still had
     * work to close out, so the reading is passed through and the branch keeps its
     * stream until the turn actually settles.
     */
    @Test
    fun aChildTurnThatIsFinishingIsReportedAsFinishingAndKeepsItsStream() = runTest {
        val host = FakeChildStreams()
        val coordinator = SubagentBranchCoordinator(backgroundScope, host, publish = {}, onError = { _, _ -> })
        coordinator.beginSession(PARENT)
        val parent = listOf(parentMessage(launchItem(OWNER, CHILD, status = "completed")))

        coordinator.decorate(parent)
        runCurrent()
        host.push(CHILD, richRecord(CHILD, "t-child", 0, 1, "finishing", "step one"))
        runCurrent()

        assertEquals("finishing", coordinator.decorate(parent).single().items!!.single().tool?.status)
        // Still the worker's turn: releasing the stream here would drop what it has
        // left to publish, so the branch keeps its slot.
        assertEquals(1, host.openCount)

        host.push(CHILD, richRecord(CHILD, "t-child", 0, 2, "completed", "step one"))
        runCurrent()
        assertEquals("completed", coordinator.decorate(parent).single().items!!.single().tool?.status)
        coordinator.endSession()
    }

    /**
     * Older hosts published a subagent's records inside the parent stream and
     * marked them, and the transcript grouping already attaches those to the item
     * that launched them. Attaching the child session as well would draw every
     * step twice, so nothing is attached and no child stream is opened.
     */
    @Test
    fun aHostThatMarksItsOwnSiblingRecordsKeepsThePathItAlwaysUsed() = runTest {
        val host = FakeChildStreams()
        val coordinator = SubagentBranchCoordinator(backgroundScope, host, publish = {}, onError = { _, _ -> })
        coordinator.beginSession(PARENT)
        val parent = listOf(
            parentMessage(
                launchItem(OWNER, CHILD, status = "completed"),
                ChatMessageItemResponse(type = "text", content = "step one", isSubagent = true),
            ),
        )

        val decorated = coordinator.decorate(parent).single()
        runCurrent()

        assertTrue(host.attempts.isEmpty())
        assertNull(decorated.items!!.first().subItems)
        assertEquals("completed", decorated.items!!.first().tool?.status)
        coordinator.endSession()
    }

    /**
     * A child stream that restarts drops only that child's replica, and the replay
     * that follows is the same steps, not a second copy of them.
     */
    @Test
    fun aChildGapReReadsThatChildOnceWithoutDuplicatingItsSteps() = runTest {
        val host = FakeChildStreams()
        val coordinator = SubagentBranchCoordinator(backgroundScope, host, publish = {}, onError = { _, _ -> })
        coordinator.beginSession(PARENT)
        val parent = listOf(parentMessage(launchItem(OWNER, CHILD)))

        coordinator.decorate(parent)
        runCurrent()
        host.push(CHILD, richRecord(CHILD, "t-child", 0, 1, "inprogress", "step one"))
        runCurrent()
        assertEquals(1, coordinator.decorate(parent).single().items!!.single().subItems?.size)

        host.push(CHILD, buildJsonObject { put("session_id", CHILD); put("event", STREAM_EVENT_GAP); put("payload", buildJsonObject {}) })
        runCurrent()
        // The host restarted the child's stream, so what was reduced is stale until
        // the replay arrives; the branch is empty in between, not wrong.
        assertNull(coordinator.decorate(parent).single().items!!.single().subItems)

        host.push(CHILD, richRecord(CHILD, "t-child", 0, 1, "inprogress", "step one"))
        host.catchUp(CHILD)
        runCurrent()
        val decorated = coordinator.decorate(parent).single().items!!.single()
        assertEquals(listOf("step one"), decorated.subItems?.map { it.content })
        assertEquals(1, host.attempts.count { it == CHILD })
        coordinator.endSession()
    }

    /**
     * A child stream that failed before it published anything says nothing about
     * the worker: no lifecycle is invented, the launch item's own status stands,
     * and the failure is reported once, keyed by the card that owns it — never as a
     * failure of the conversation around it.
     */
    @Test
    fun aChildStreamThatFailsBeforeAnyContentKeepsTheLaunchStatusAndReportsOnce() = runTest {
        val host = FakeChildStreams()
        val surfaced = mutableListOf<Throwable>()
        val coordinator = SubagentBranchCoordinator(backgroundScope, host, publish = {}, onError = { _, error -> surfaced += error })
        coordinator.beginSession(PARENT)
        val parent = listOf(parentMessage(launchItem(OWNER, CHILD, status = "completed")))

        coordinator.decorate(parent)
        runCurrent()
        host.fail(CHILD, IllegalStateException("stream dropped"))
        runCurrent()

        val decorated = coordinator.decorate(parent).single().items!!.single()
        assertEquals("completed", decorated.tool?.status)
        assertNull(decorated.subItems)
        assertEquals(1, surfaced.size)
        assertIs<IllegalStateException>(surfaced.single())
        coordinator.endSession()
    }

    /**
     * A child stream that dies after publishing steps keeps them but stops being a
     * reading of the worker.
     *
     * The steps are the worker's own work, so dropping them would empty a card the
     * reader was reading. The `running` is not: it came from a turn of a stream that
     * has stopped, and nothing will ever settle it, so the card falls back to the
     * launching item's own status — the host's word about the spawn — instead of
     * claiming forever that a dead worker is still working. No `failed` is invented,
     * and the failure is reported once on the card that owns it.
     */
    @Test
    fun aChildStreamThatDiesAfterPublishingStepsKeepsThemAndStopsClaimingToBeRunning() = runTest {
        val host = FakeChildStreams()
        val surfaced = mutableListOf<Throwable>()
        val coordinator = SubagentBranchCoordinator(backgroundScope, host, publish = {}, onError = { _, error -> surfaced += error })
        coordinator.beginSession(PARENT)
        val parent = listOf(parentMessage(launchItem(OWNER, CHILD, status = "completed")))

        coordinator.decorate(parent)
        runCurrent()
        host.push(CHILD, richRecord(CHILD, "t-child", 0, 1, "inprogress", "step one"))
        runCurrent()
        // The worker's turn is still in progress, so the card reads as running.
        assertEquals("running", coordinator.decorate(parent).single().items!!.single().tool?.status)

        host.fail(CHILD, IllegalStateException("stream dropped"))
        runCurrent()

        val card = coordinator.decorate(parent).single().items!!.single()
        assertEquals(listOf("step one"), card.subItems?.map { it.content })
        assertEquals("completed", card.tool?.status)
        assertEquals(1, surfaced.size)
        assertIs<IllegalStateException>(surfaced.single())
        coordinator.endSession()
    }

    /**
     * A record belongs to the session that published it.
     *
     * One subscription carries one child's records, so a record stamped with another
     * session id is a broken contract. Reducing it would put another agent's work on
     * this card, so it is rejected the way the parent stream rejects the same
     * mismatch — loud, and contained to the card that owns the stream.
     */
    @Test
    fun aChildRecordStampedWithAnotherSessionIsRejectedInsteadOfReduced() = runTest {
        val host = FakeChildStreams()
        val surfaced = mutableListOf<Throwable>()
        val coordinator = SubagentBranchCoordinator(backgroundScope, host, publish = {}, onError = { _, error -> surfaced += error })
        coordinator.beginSession(PARENT)
        val parent = listOf(parentMessage(launchItem(OWNER, CHILD)))

        coordinator.decorate(parent)
        runCurrent()
        host.push(CHILD, richRecord("s-someone-else", "t-other", 0, 1, "inprogress", "another agent's work"))
        runCurrent()

        val card = coordinator.decorate(parent).single().items!!.single()
        assertNull(card.subItems)
        assertEquals(1, surfaced.size)
        assertIs<IllegalStateException>(surfaced.single())
        coordinator.endSession()
    }

    /**
     * A host without on-demand streams is recorded once and then left alone: no
     * per-card retry, no command it would fail to parse, and no child read again.
     */
    @Test
    fun aHostWithoutOnDemandStreamsIsReportedOnceAndNoFurtherChildIsRead() = runTest {
        val host = FakeChildStreams().apply { failSubscribe = { HostStreamUnsupportedException() } }
        val surfaced = mutableListOf<Throwable>()
        val coordinator = SubagentBranchCoordinator(backgroundScope, host, publish = {}, onError = { _, error -> surfaced += error })
        coordinator.beginSession(PARENT)
        val parent = listOf(parentMessage(launchItem(OWNER, CHILD), launchItem("tool-owner-2", "s-child-2")))

        coordinator.decorate(parent)
        runCurrent()
        coordinator.decorate(parent)
        runCurrent()

        assertEquals(listOf(CHILD), host.attempts)
        assertEquals(1, surfaced.size)
        assertIs<HostStreamUnsupportedException>(surfaced.single())
        assertEquals(0, coordinator.followState().subscribed)
        coordinator.endSession()
    }

    /**
     * Nothing keeps pushing once the session is gone: a switch closes every child
     * stream, and so does closing the session outright.
     */
    @Test
    fun switchingOrEndingTheSessionClosesEveryChildStream() = runTest {
        val host = FakeChildStreams()
        val coordinator = SubagentBranchCoordinator(backgroundScope, host, publish = {}, onError = { _, _ -> })
        coordinator.beginSession(PARENT)
        val parent = listOf(parentMessage(launchItem(OWNER, CHILD), launchItem("tool-owner-2", "s-child-2")))

        coordinator.decorate(parent)
        runCurrent()
        assertEquals(2, host.openCount)

        coordinator.beginSession("s-other")
        runCurrent()
        assertEquals(0, host.openCount)
        assertEquals(listOf(CHILD, "s-child-2"), host.closed)
        assertEquals(0, coordinator.followState().branches)

        coordinator.beginSession(PARENT)
        coordinator.decorate(parent)
        runCurrent()
        assertEquals(2, host.openCount)
        coordinator.endSession()
        runCurrent()
        assertEquals(0, host.openCount)
    }

    /**
     * The cap bounds how many children are followed at once, and a card that is
     * opened is always served: a settled worker frees its slot to the child that
     * was waiting, and an open card can re-attach a branch the cap released.
     */
    @Test
    fun theConcurrencyCapIsRespectedAndAnOpenedCardCanAlwaysReattach() = runTest {
        val host = FakeChildStreams()
        val coordinator = SubagentBranchCoordinator(backgroundScope, host, publish = {}, onError = { _, _ -> })
        coordinator.beginSession(PARENT)
        val owners = (0 until MAX_CONCURRENT_CHILD_STREAMS + 1).map { index -> "owner-$index" }
        val children = owners.map { owner -> "child-$owner" }
        val parent = listOf(parentMessage(*owners.indices.map { launchItem(owners[it], children[it]) }.toTypedArray()))

        coordinator.decorate(parent)
        runCurrent()
        assertEquals(MAX_CONCURRENT_CHILD_STREAMS, host.openCount)
        assertEquals(1, coordinator.followState().waiting)
        // The launch that had been quiet longest gave up its slot for the newest one,
        // so the branch waiting for a slot is the first child, not the last.
        assertTrue(children[0] !in host.opened)
        assertTrue(children.last() in host.opened)

        // A worker that reported costs nothing to stop following, and the child that
        // was waiting takes the slot it frees.
        host.push(children[1], richRecord(children[1], "t-child", 0, 1, "completed", "done"))
        runCurrent()
        assertEquals(MAX_CONCURRENT_CHILD_STREAMS, host.openCount)
        assertEquals(0, coordinator.followState().waiting)
        assertTrue(children[0] in host.opened)

        // The released branch keeps its steps and is followed again when its card is
        // opened, which is what an expansion asks for.
        val attemptsBefore = host.attempts.size
        coordinator.ensureAttached(owners[1])
        runCurrent()
        assertEquals(attemptsBefore + 1, host.attempts.size)
        assertEquals(MAX_CONCURRENT_CHILD_STREAMS, host.openCount)
        coordinator.endSession()
    }

    /**
     * A worker that is still running when the cap takes its slot keeps the steps it
     * published, and opening its card follows it again.
     *
     * This is the case the cap cannot avoid: past the bound some card has to be
     * released, and a running worker is the one that cannot be dropped silently. The
     * branch keeps its prefix, the card stays readable, and the reader's own gesture —
     * opening it — is what resumes the stream and brings the branch up to date.
     */
    @Test
    fun aRunningChildEvictedByTheCapIsFollowedAgainWhenItsCardIsOpened() = runTest {
        val host = FakeSubagentHost()
        val reported = mutableListOf<Throwable>()
        val coordinator = SubagentBranchCoordinator(backgroundScope, host, publish = {}, onError = { _, error -> reported += error })
        coordinator.beginSession(PARENT)
        val owners = (0 until MAX_CONCURRENT_CHILD_STREAMS + 1).map { index -> "owner-$index" }
        val children = owners.map { owner -> "child-$owner" }
        val first = listOf(parentMessage(launchItem(owners[0], children[0])))
        // Two steps are two items, and `richRecord` names an item after its turn, so a
        // second step is a second turn — which is also how a continued worker reads.
        val stepOne = richRecord(children[0], "t-child-1", 0, 1, "inprogress", "step one")
        val stepTwo = richRecord(children[0], "t-child-2", 1, 2, "inprogress", "step two")

        host.replay(children[0], stepOne)
        coordinator.decorate(first)
        runCurrent()
        assertEquals(1, coordinator.decorate(first).single().items!!.single().subItems?.size)

        // Every remaining launch takes a slot, and the cap takes this worker's — the
        // oldest still running one.
        val all = listOf(parentMessage(*owners.indices.map { launchItem(owners[it], children[it]) }.toTypedArray()))
        coordinator.decorate(all)
        runCurrent()
        assertEquals(MAX_CONCURRENT_CHILD_STREAMS, host.openCount)
        val attemptsBefore = host.attempts.count { it == children[0] }

        // The worker kept working while its slot was gone; a host replays that page.
        host.replay(children[0], stepOne, stepTwo)
        coordinator.ensureAttached(owners[0])
        runCurrent()

        assertEquals(attemptsBefore + 1, host.attempts.count { it == children[0] })
        assertEquals(emptyList(), reported)
        val steps = coordinator.decorate(all).single().items!!.first().subItems?.map { it.content }
        assertEquals(listOf("step one", "step two"), steps)
        assertEquals(MAX_CONCURRENT_CHILD_STREAMS, host.openCount)
        coordinator.endSession()
    }

    /**
     * A host that starts publishing a worker's process inside its own stream is
     * honoured from that moment on.
     *
     * The older shape needs no child stream: those marked records are already grouped
     * under the launch item by the transcript itself. Following the child as well
     * would draw every step twice, so the stream is released and the item stops being
     * rewritten.
     */
    @Test
    fun aHostThatStartsPublishingMarkedSiblingsStopsBeingFollowed() = runTest {
        val host = FakeChildStreams()
        val coordinator = SubagentBranchCoordinator(backgroundScope, host, publish = {}, onError = { _, _ -> })
        coordinator.beginSession(PARENT)
        val named = listOf(parentMessage(launchItem(OWNER, CHILD, status = "completed")))

        coordinator.decorate(named)
        runCurrent()
        host.push(CHILD, richRecord(CHILD, "t-child", 0, 1, "inprogress", "step one"))
        runCurrent()
        assertEquals(
            listOf("step one"),
            coordinator.decorate(named).single().items!!.single().subItems?.map { it.content },
        )
        assertEquals(1, host.openCount)

        // The same host now carries that worker's process in its own stream, marked.
        val marked = listOf(
            parentMessage(
                launchItem(OWNER, CHILD, status = "completed"),
                ChatMessageItemResponse(type = "text", content = "step one", isSubagent = true),
            ),
        )
        val takenOver = coordinator.decorate(marked).single().items!!.first()
        runCurrent()

        assertNull(takenOver.subItems)
        assertEquals("completed", takenOver.tool?.status)
        assertEquals(0, host.openCount)
        assertTrue(CHILD in host.closed)
        assertEquals(0, coordinator.followState().branches)
        coordinator.endSession()
    }

    /**
     * A backgrounded app follows nothing: the branch keeps what it published, and
     * coming back re-opens the streams that were released.
     */
    @Test
    fun leavingTheForegroundReleasesChildStreamsAndReturningReattachesThem() = runTest {
        val host = FakeChildStreams()
        val coordinator = SubagentBranchCoordinator(backgroundScope, host, publish = {}, onError = { _, _ -> })
        coordinator.beginSession(PARENT)
        val parent = listOf(parentMessage(launchItem(OWNER, CHILD)))

        coordinator.decorate(parent)
        runCurrent()
        assertEquals(1, host.openCount)

        coordinator.setForeground(false)
        runCurrent()
        assertEquals(0, host.openCount)
        assertEquals(1, coordinator.followState().branches)

        coordinator.setForeground(true)
        runCurrent()
        assertEquals(1, host.openCount)
        coordinator.endSession()
    }

    /**
     * Opening a conversation follows the child its own transcript names, and the
     * decorated transcript is what the store publishes — the UI needs no new state.
     */
    @Test
    fun openingASessionFollowsTheChildItsTranscriptNames() = runTest {
        val host = FakeSubagentHost().apply { replay(PARENT, launchEvent(PARENT, "t-parent", OWNER, CHILD, revision = 1)) }
        val store = RemoteSessionStore(this, host, followSubagentBranches = true)

        store.dispatch(RemoteSessionIntent.Open(PARENT))
        runCurrent()
        assertEquals(listOf(PARENT, CHILD), host.attempts)

        host.push(CHILD, richRecord(CHILD, "t-child", 0, 1, "inprogress", "step one"))
        runCurrent()

        val owner = assertIs<RemoteSessionUiState.Ready>(store.state.value).timeline!!
            .persistedMessages.flatMap { it.items.orEmpty() }.single { it.tool?.id == OWNER }
        assertEquals(listOf("step one"), owner.subItems?.map { it.content })
        assertEquals("running", owner.tool?.status)
        store.stop()
    }

    /**
     * The transcript this coordinator publishes is the card the surface draws.
     *
     * The coordinator attaches a child's items to the launch item; what a reader
     * actually sees is what the presentation layer makes of that transcript. This
     * walks the same handover the app does — timeline state, then rows, then
     * blocks — so the branch is known to become a subagent block that still names
     * the launch item's tool call (the key a card re-attaches by), still reads as
     * the worker's lifecycle, and still carries the worker's steps. The device
     * test then only has to prove the drawing.
     */
    @Test
    fun theDecoratedTranscriptBecomesTheSubagentCardTheSurfaceDraws() = runTest {
        val host = FakeChildStreams()
        val coordinator = SubagentBranchCoordinator(backgroundScope, host, publish = {}, onError = { _, _ -> })
        coordinator.beginSession(PARENT)
        // The launch carries the task's own description, which is what the card is
        // titled with — the same string the device test clicks to open it.
        val launched = launchItem(OWNER, CHILD, status = "completed")
        val parent = listOf(parentMessage(launched.copy(tool = launched.tool?.copy(inputPreview = "Audit the parser"))))

        coordinator.decorate(parent)
        runCurrent()
        host.push(CHILD, richRecord(CHILD, "t-child", 0, 1, "inprogress", "step one"))
        runCurrent()

        val timeline = ChatTimelineStore()
        timeline.reset(PARENT)
        timeline.setPersistedMessages(coordinator.decorate(parent))
        val card = timeline.snapshot().conversationRows()
            .flatMap { it.blocks }
            .filterIsInstance<MessageBlock.Subagent>()
            .single()

        assertEquals("Audit the parser", card.title)
        assertEquals(OWNER, card.ownerToolCallId)
        assertEquals("running", card.status)
        assertEquals(listOf("step one"), card.children.filterIsInstance<MessageBlock.Text>().map { it.text })
        coordinator.endSession()
    }

    /**
     * A conversation that is no longer on screen does not keep reading its workers,
     * and neither does a closed store.
     */
    @Test
    fun switchingOrClosingTheConversationStopsEveryChildStream() = runTest {
        val host = FakeSubagentHost().apply { replay(PARENT, launchEvent(PARENT, "t-parent", OWNER, CHILD, revision = 1)) }
        val store = RemoteSessionStore(this, host, followSubagentBranches = true)

        store.dispatch(RemoteSessionIntent.Open(PARENT))
        runCurrent()
        assertEquals(2, host.openCount)

        store.dispatch(RemoteSessionIntent.Open("s-other"))
        runCurrent()
        assertEquals(1, host.openCount)
        assertTrue(CHILD in host.closed)

        store.dispatch(RemoteSessionIntent.Open(PARENT))
        runCurrent()
        assertEquals(2, host.openCount)
        store.stop()
        runCurrent()
        assertEquals(0, host.openCount)
    }

    /**
     * A host that cannot serve one worker's stream is not a host that cannot serve
     * this conversation.
     *
     * The parent transcript is the host's own answer for the session the reader
     * opened, so it stays on screen, the launch item keeps the status the host gave
     * it, no lifecycle is invented from a stream that said nothing, and the failure
     * is reported once on the card that owns it. Reading is abandoned for that host,
     * so nothing else is opened and no command it would fail to parse is sent.
     */
    @Test
    fun anUnsupportedChildStreamLeavesTheConversationReadableAndIsReportedOnItsCard() = runTest {
        val host = FakeSubagentHost().apply { replay(PARENT, launchEvent(PARENT, "t-parent", OWNER, CHILD, revision = 1)) }
        val store = RemoteSessionStore(this, host, followSubagentBranches = true)

        store.dispatch(RemoteSessionIntent.Open(PARENT))
        runCurrent()
        // The conversation plus the child its transcript names.
        assertEquals(2, host.openCount)
        val attemptsBeforeFailure = host.attempts.size

        host.fail(CHILD, HostStreamUnsupportedException())
        runCurrent()

        // The session is still the readable conversation it was, not a failure page.
        val ready = assertIs<RemoteSessionUiState.Ready>(store.state.value)
        assertEquals(ConnectionPhase.CONNECTED, store.connectionPhase.value)
        assertEquals(
            mapOf(OWNER to RemoteSessionFailureReason.HOST_STREAM_UNSUPPORTED),
            ready.subagentFailures,
        )
        val owner = ready.timeline!!.persistedMessages.flatMap { it.items.orEmpty() }.single { it.tool?.id == OWNER }
        // The launch item's own status stands: the stream said nothing about the worker.
        assertEquals("completed", owner.tool?.status)
        assertNull(owner.subItems)

        // Read once, and never again — not for this child, and not for one the parent
        // names afterwards, because following children is off for this host.
        assertEquals(1, host.attempts.count { it == CHILD })
        host.push(PARENT, launchEvent(PARENT, "t-parent", "tool-owner-2", "s-child-2", revision = 2))
        runCurrent()
        assertEquals(attemptsBeforeFailure, host.attempts.size)
        assertEquals(1, host.openCount)
        // Reported once: a second failure on the same card adds nothing.
        host.fail(CHILD, HostStreamUnsupportedException())
        runCurrent()
        assertEquals(
            mapOf(OWNER to RemoteSessionFailureReason.HOST_STREAM_UNSUPPORTED),
            assertIs<RemoteSessionUiState.Ready>(store.state.value).subagentFailures,
        )
        store.stop()
    }

    /**
     * A child's failure belongs to the session that spawned it.
     *
     * The coordinator of a conversation that is no longer on screen is detached with
     * its streams, so an error arriving late describes something nobody is reading and
     * must not mark the conversation now on screen — which is a different session —
     * as failed.
     */
    @Test
    fun aLateChildErrorFromAClosedSessionLeavesTheNewSessionUntouched() = runTest {
        val host = FakeSubagentHost().apply {
            replay(PARENT, launchEvent(PARENT, "t-parent", OWNER, CHILD, revision = 1))
            replay("s-other", richRecord("s-other", "t-other", 0, 1, "completed", "unrelated"))
        }
        val store = RemoteSessionStore(this, host, followSubagentBranches = true)

        store.dispatch(RemoteSessionIntent.Open(PARENT))
        runCurrent()
        assertEquals(listOf(PARENT, CHILD), host.attempts)

        store.dispatch(RemoteSessionIntent.Open("s-other"))
        runCurrent()
        val before = assertIs<RemoteSessionUiState.Ready>(store.state.value)

        // The old session's child stream fails after the reader moved on.
        host.fail(CHILD, IllegalStateException("stream dropped"))
        runCurrent()

        val after = assertIs<RemoteSessionUiState.Ready>(store.state.value)
        assertEquals("s-other", after.selectedSessionId)
        assertTrue(after.subagentFailures.isEmpty())
        assertEquals(before.timeline, after.timeline)
        assertEquals(ConnectionPhase.CONNECTED, store.connectionPhase.value)
        store.stop()
    }

    /**
     * A child transcript is drawn from the child's stream on demand, so it is never
     * written into this device's copy of the parent's transcript.
     */
    @Test
    fun aChildsStepsAreNeverStoredInTheParentsTranscript() {
        val child = ChatMessageItemResponse(type = "text", content = "step one")
        val item = launchItem(OWNER, CHILD).copy(subItems = listOf(child))

        val stored = withoutChildSteps(item)

        assertEquals(CHILD, stored.tool?.subagentSessionId)
        assertNull(stored.subItems)
        // An ordinary tool row is stored exactly as the host sent it.
        assertEquals(launchItem("tool-read", ""), withoutChildSteps(launchItem("tool-read", "")))
    }

    /**
     * A card stops reporting its worker once that worker's stream is read again — and
     * only then.
     *
     * The report describes an attempt, not the worker, so it is dropped when a read
     * really happened. The case that matters is the one the cap documents: the branch
     * lost its stream (here because the phone left the foreground), the card said it
     * could not be read, and opening the card follows the worker again.
     */
    @Test
    fun aCardStopsReportingItsWorkerOnceTheStreamIsReadAgain() = runTest {
        val host = FakeSubagentHost().apply { replay(PARENT, launchEvent(PARENT, "t-parent", OWNER, CHILD, revision = 1)) }
        val store = RemoteSessionStore(this, host, followSubagentBranches = true)

        store.dispatch(RemoteSessionIntent.Open(PARENT))
        runCurrent()
        assertEquals(1, host.attempts.count { it == CHILD })

        host.fail(CHILD, IllegalStateException("stream dropped"))
        runCurrent()
        assertEquals(
            mapOf(OWNER to RemoteSessionFailureReason.TRANSPORT),
            assertIs<RemoteSessionUiState.Ready>(store.state.value).subagentFailures,
        )

        // The branch gives up its lane, and its card says why it has nothing to show.
        store.dispatch(RemoteSessionIntent.SetForeground(false))
        runCurrent()

        store.dispatch(RemoteSessionIntent.EnsureSubagentAttached(OWNER))
        runCurrent()

        // The read really happened, so the report was dropped with it.
        assertEquals(2, host.attempts.count { it == CHILD })
        assertTrue(assertIs<RemoteSessionUiState.Ready>(store.state.value).subagentFailures.isEmpty())
        store.stop()
    }

    /**
     * The other half of the guard above: no read, no clearing.
     *
     * A host that cannot serve child streams is never read again, so the one sentence
     * that explains the card — this desktop cannot share worker steps — has to survive
     * the only gesture that could take it away.
     */
    @Test
    fun openingACardWhoseHostCannotServeChildStreamsKeepsTheExplanationItHas() = runTest {
        val host = FakeSubagentHost().apply { replay(PARENT, launchEvent(PARENT, "t-parent", OWNER, CHILD, revision = 1)) }
        val store = RemoteSessionStore(this, host, followSubagentBranches = true)

        store.dispatch(RemoteSessionIntent.Open(PARENT))
        runCurrent()
        host.fail(CHILD, HostStreamUnsupportedException())
        runCurrent()
        val attempts = host.attempts.size
        assertEquals(
            mapOf(OWNER to RemoteSessionFailureReason.HOST_STREAM_UNSUPPORTED),
            assertIs<RemoteSessionUiState.Ready>(store.state.value).subagentFailures,
        )

        store.dispatch(RemoteSessionIntent.EnsureSubagentAttached(OWNER))
        runCurrent()

        // Nothing was read, so nothing about the card changed.
        assertEquals(attempts, host.attempts.size)
        assertEquals(
            mapOf(OWNER to RemoteSessionFailureReason.HOST_STREAM_UNSUPPORTED),
            assertIs<RemoteSessionUiState.Ready>(store.state.value).subagentFailures,
        )
        store.stop()
    }

    /**
     * A card that is already drawing its worker's steps has nothing left to report.
     *
     * A stream can die after it published a turn. The steps stay — they are the
     * worker's own work — and the failure recorded for that card is dropped as soon as
     * the transcript carrying those steps is rendered again: the card is no longer in
     * the state the report described.
     */
    @Test
    fun aCardThatIsShowingItsWorkersStepsStopsReportingAFailure() = runTest {
        val host = FakeSubagentHost().apply { replay(PARENT, launchEvent(PARENT, "t-parent", OWNER, CHILD, revision = 1)) }
        val store = RemoteSessionStore(this, host, followSubagentBranches = true)

        store.dispatch(RemoteSessionIntent.Open(PARENT))
        runCurrent()
        host.push(CHILD, richRecord(CHILD, "t-child", 0, 1, "inprogress", "step one"))
        runCurrent()
        host.fail(CHILD, IllegalStateException("stream dropped"))
        runCurrent()
        assertEquals(
            mapOf(OWNER to RemoteSessionFailureReason.TRANSPORT),
            assertIs<RemoteSessionUiState.Ready>(store.state.value).subagentFailures,
        )

        // The parent transcript is rendered again while this card already has steps.
        host.push(PARENT, launchEvent(PARENT, "t-parent", "tool-owner-2", "s-child-2", revision = 2))
        runCurrent()

        val ready = assertIs<RemoteSessionUiState.Ready>(store.state.value)
        assertTrue(ready.subagentFailures.isEmpty())
        val owner = ready.timeline!!.persistedMessages.flatMap { it.items.orEmpty() }.single { it.tool?.id == OWNER }
        // The report is gone; the work it reported on is not.
        assertEquals(listOf("step one"), owner.subItems?.map { it.content })
        store.stop()
    }

    /**
     * Following delegated children is opted in by the platform, not assumed.
     *
     * A client that has not wired the card's expansion and its per-card failure surface
     * would otherwise open a child stream it can never re-open and record a failure it
     * can never show. With the flag off — which is every platform but Android — the
     * store publishes the host's own transcript item for item and nothing about a
     * delegation is attempted.
     */
    @Test
    fun subagentBranchesAreOffByDefaultAndLeaveTheTranscriptUntouched() = runTest {
        val host = FakeSubagentHost().apply {
            replay(PARENT, launchEvent(PARENT, "t-parent", OWNER, CHILD, revision = 1))
            // A child stream that would fail loudly if it were ever asked for.
            failSubscribe = { if (it == CHILD) IllegalStateException("stream dropped") else null }
        }
        val store = RemoteSessionStore(this, host)

        store.dispatch(RemoteSessionIntent.Open(PARENT))
        runCurrent()

        // (i) The parent's own stream, and no attempt at the child it names.
        assertEquals(listOf(PARENT), host.attempts)

        // (ii) The launch item is the host's item: the child id it named is kept, no
        // child item is attached, and the status is the one the host sent.
        val published = assertIs<RemoteSessionUiState.Ready>(store.state.value).timeline!!
            .persistedMessages.flatMap { it.items.orEmpty() }.single { it.tool?.id == OWNER }
        val replica = SessionRecordReplica(PARENT)
        replica.apply(launchEvent(PARENT, "t-parent", OWNER, CHILD, revision = 1).getValue("payload").jsonObject)
        val hostOwnItem = replica.messages().flatMap { it.items.orEmpty() }.single { it.tool?.id == OWNER }
        assertEquals(hostOwnItem, published)
        assertEquals(CHILD, published.tool?.subagentSessionId)
        assertEquals("completed", published.tool?.status)
        assertNull(published.subItems)

        // (iii) The card's expansion is inert: no stream, and not even a new state
        // object for the surface to redraw.
        val before = store.state.value
        val attempts = host.attempts.size
        store.dispatch(RemoteSessionIntent.EnsureSubagentAttached(OWNER))
        runCurrent()
        assertEquals(attempts, host.attempts.size)
        assertSame(before, store.state.value)

        // (iv) Nothing can be reported about a stream that was never opened.
        assertTrue(assertIs<RemoteSessionUiState.Ready>(store.state.value).subagentFailures.isEmpty())
        store.stop()
    }

    // --- fixtures -------------------------------------------------------------

    private fun parentMessage(vararg items: ChatMessageItemResponse) = ChatMessage(
        id = "m-parent", role = "assistant", text = "", status = "completed", renderVersion = null,
        turnId = "t-parent", detail = null, timestamp = null, thinking = null, tools = null,
        items = items.toList(), images = null, error = null,
    )

    private fun launchItem(ownerToolCallId: String, childSessionId: String, status: String = "running") =
        ChatMessageItemResponse(
            type = "tool",
            tool = RemoteToolStatusResponse(
                id = ownerToolCallId,
                name = "task",
                status = status,
                subagentSessionId = childSessionId.takeIf { it.isNotEmpty() },
            ),
            isSubagent = childSessionId.isNotEmpty(),
        )

    /** A parent record for the tool item that launched [child]. */
    private fun launchEvent(
        session: String,
        turn: String,
        ownerToolCallId: String,
        child: String,
        revision: Long,
    ): JsonObject = buildJsonObject {
        put("session_id", session)
        put("event", "session-record")
        put("payload", buildJsonObject {
            put("sessionId", session)
            put("id", "item/$ownerToolCallId")
            put("revision", revision)
            put("turn", buildJsonObject {
                put("sessionId", session); put("turnId", turn); put("turnIndex", 0); put("status", "completed")
                put("userMessage", buildJsonObject { put("id", "${turn}_user"); put("content", "delegate this"); put("timestamp", 1) })
            })
            put("round", buildJsonObject { put("id", "$turn-round"); put("turnId", turn); put("roundIndex", 0) })
            put("item", buildJsonObject {
                put("type", "tool")
                put("data", buildJsonObject {
                    put("id", ownerToolCallId); put("orderIndex", 0); put("timestamp", 1)
                    put("toolName", "task"); put("status", "completed")
                    put("toolCall", buildJsonObject { put("id", ownerToolCallId) })
                    put("subagentSessionId", child)
                })
            })
        })
    }
}

/**
 * Host streams for one parent session and the children it names.
 *
 * Each session is its own flow, so a child's records can only arrive on the
 * subscription the coordinator opened for that child — which is the grouping rule
 * being asserted.
 */
private class FakeChildStreams : RemoteSessionStreamTransport {
    /** Every `subscribe` call, including one that fails before returning a flow. */
    val attempts = mutableListOf<String>()
    /** Subscriptions that started collecting, in order. */
    val opened = mutableListOf<String>()
    /** Subscriptions whose flow ended, in order. */
    val closed = mutableListOf<String>()
    val openCount: Int get() = opened.size - closed.size

    private val channels = mutableMapOf<String, MutableSharedFlow<JsonObject>>()
    private val caughtUp = mutableMapOf<String, () -> Unit>()
    private val errors = mutableMapOf<String, (Throwable) -> Unit>()

    /** When set, opening a stream for that session fails instead. */
    var failSubscribe: ((String) -> Throwable?)? = null

    fun push(sessionId: String, event: JsonObject) {
        channels.getOrPut(sessionId) { MutableSharedFlow(extraBufferCapacity = 16) }.tryEmit(event)
    }

    fun catchUp(sessionId: String) {
        caughtUp[sessionId]?.invoke()
    }

    fun fail(sessionId: String, error: Throwable) {
        errors[sessionId]?.invoke(error)
    }

    override suspend fun subscribe(
        sessionId: String,
        onError: (Throwable) -> Unit,
        onCaughtUp: () -> Unit,
    ): Flow<JsonObject> {
        attempts += sessionId
        failSubscribe?.invoke(sessionId)?.let { throw it }
        return flow {
            opened += sessionId
            errors[sessionId] = onError
            caughtUp[sessionId] = onCaughtUp
            try {
                onCaughtUp()
                channels.getOrPut(sessionId) { MutableSharedFlow(extraBufferCapacity = 16) }.collect { emit(it) }
            } finally {
                closed += sessionId
            }
        }
    }
}

/**
 * A simulated host for one open conversation: the parent stream and the children
 * it names are served from the same device, as a real host does.
 */
private class FakeSubagentHost : RemoteCommandTransport, RemoteSessionStreamTransport {
    val attempts = mutableListOf<String>()
    val opened = mutableListOf<String>()
    val closed = mutableListOf<String>()
    val openCount: Int get() = opened.size - closed.size

    private val replayEvents = mutableMapOf<String, List<JsonObject>>()
    private val channels = mutableMapOf<String, MutableSharedFlow<JsonObject>>()
    private val caughtUp = mutableMapOf<String, () -> Unit>()
    private val errors = mutableMapOf<String, (Throwable) -> Unit>()

    var failSubscribe: ((String) -> Throwable?)? = null

    fun replay(sessionId: String, vararg events: JsonObject) {
        replayEvents[sessionId] = events.toList()
    }

    fun push(sessionId: String, event: JsonObject) {
        channels.getOrPut(sessionId) { MutableSharedFlow(extraBufferCapacity = 16) }.tryEmit(event)
    }

    fun fail(sessionId: String, error: Throwable) {
        errors[sessionId]?.invoke(error)
    }

    override suspend fun loadOlder(sessionId: String) = Unit

    override suspend fun subscribe(
        sessionId: String,
        onError: (Throwable) -> Unit,
        onCaughtUp: () -> Unit,
    ): Flow<JsonObject> {
        attempts += sessionId
        failSubscribe?.invoke(sessionId)?.let { throw it }
        return flow {
            opened += sessionId
            errors[sessionId] = onError
            caughtUp[sessionId] = onCaughtUp
            try {
                replayEvents[sessionId].orEmpty().forEach { emit(it) }
                onCaughtUp()
                channels.getOrPut(sessionId) { MutableSharedFlow(extraBufferCapacity = 16) }.collect { emit(it) }
            } finally {
                closed += sessionId
            }
        }
    }

    override suspend fun <T : CommandStatus> send(
        deserializer: DeserializationStrategy<T>,
        command: RemoteCommand,
        timeoutMs: Long,
    ): T {
        val json = when (command.cmd) {
            "get_workspace_info" -> """{"resp":"ok","path":"/repo","capabilities":["host_stream_v1"]}"""
            "get_permission_mode" -> """{"resp":"ok","mode":"ask"}"""
            "get_model_catalog" -> """{"resp":"ok","catalog":{"version":0,"models":[],"default_models":{}}}"""
            "list_sessions" -> """{"resp":"ok","sessions":[],"has_more":false}"""
            "get_session_messages" -> """{"resp":"ok","messages":[],"has_more":false}"""
            "poll_session" -> """{"resp":"ok","version":1,"changed":false,"session_state":"idle"}"""
            else -> """{"resp":"ok"}"""
        }
        return RelayJson.decodeFromString(deserializer, json)
    }
}
