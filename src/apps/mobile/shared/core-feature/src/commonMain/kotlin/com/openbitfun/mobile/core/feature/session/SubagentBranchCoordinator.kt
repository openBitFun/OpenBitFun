package com.openbitfun.mobile.core.feature.session

import com.openbitfun.mobile.core.domain.ChatMessage
import com.openbitfun.mobile.core.domain.ToolNamePolicy
import com.openbitfun.mobile.core.protocol.ChatMessageItemResponse
import com.openbitfun.mobile.core.protocol.RemoteToolStatusResponse
import com.openbitfun.mobile.core.transport.HostStreamUnsupportedException
import com.openbitfun.mobile.core.transport.RemoteSessionStreamTransport
import com.openbitfun.mobile.core.transport.STREAM_EVENT_GAP
import com.openbitfun.mobile.core.transport.STREAM_EVENT_HISTORY_STARTED
import com.openbitfun.mobile.core.transport.STREAM_EVENT_READY
import com.openbitfun.mobile.core.transport.STREAM_EVENT_RESUMED
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * How many of a session's children are followed, and how many wait for a slot.
 *
 * Read by focused tests; the transcript itself never needs it.
 */
internal data class SubagentFollowState(
    val branches: Int,
    val subscribed: Int,
    val waiting: Int,
)

/**
 * How many child sessions one parent session follows at once.
 *
 * Every child is another paged stream read over the same device RPC lane as the
 * parent session, and a delegation wider than this is past what a phone screen
 * presents at once. The cap never costs a card its content: a child that holds
 * no slot keeps the branch it already published, and takes a slot as soon as one
 * frees or the reader opens its card.
 */
internal const val MAX_CONCURRENT_CHILD_STREAMS: Int = 8

/**
 * How many distinct child sessions one parent session tracks over its lifetime.
 *
 * A long-lived session can name more workers than any reader will scroll through,
 * and each tracked child holds its own reduced transcript, so the map is bounded
 * rather than growing with the session's history. Both the tracked branches and the
 * launch items pointing at them are bounded by this number: one owner is one entry,
 * and a session that keeps launching workers would otherwise grow that index with
 * its whole history. Past the bound, a later launch is not followed: its card keeps
 * the launching item's own status and result, which is what every card showed
 * before child streams existed. The number is far above the concurrent cap on
 * purpose — this bounds memory, not attention.
 */
internal const val MAX_TRACKED_CHILD_BRANCHES: Int = 64

/**
 * Streams a delegation tool's child sessions into the branch that launched them.
 *
 * A host keeps a spawned child agent in its own hidden session: the parent record
 * names that session on the launching tool item, and nothing the child does
 * appears in the parent's own stream. The only place the child's steps exist is
 * its stream, so the branch content is grouped by the subscription the records
 * arrived on — the child session id the host named — and never by a marker on a
 * record. Behavioural reference: HarmonyOS
 * `harmonyos/entry/src/main/ets/services/SubagentStreamCoordinator.ets`.
 *
 * The parent session's replica stays the single author of the parent transcript:
 * this coordinator only attaches each child's own projection as the branch items
 * of the item that owns it, and [MessageBlockPresentation] then draws that item as
 * the card it already knew how to draw. A host that names no child session
 * produces no branch here at all, so an older desktop keeps the plain tool rows it
 * has always sent.
 *
 * Two facts about a branch are read from two different places, and are kept apart
 * on purpose:
 *
 * - The launching item's own status is the spawn call's outcome. A host answers an
 *   asynchronous `AgentSpawn` as soon as the worker starts, so that status says
 *   nothing about whether the worker is still working.
 * - The card's lifecycle is the worker's, so it is derived from the child's own
 *   stream here, and only that reading is what the card is fed.
 *
 * Nothing is persisted: a child transcript is reconstructible by asking the host
 * for the child's stream again, and this change deliberately keeps child steps out
 * of the phone's stored parent transcript (HarmonyOS does cache them).
 *
 * A child stream that cannot be read is not a failure of the session on screen. The
 * parent transcript is still the host's answer for the conversation the reader
 * opened, so a child's error is reported as a per-card fact and the session stays
 * readable; the reference client is explicit about the same thing
 * (`SubagentStreamCoordinator.ets`, a child stream that cannot be opened does not
 * fail the session).
 *
 * Threading: every member runs on the store's dispatcher — the same one that
 * renders the parent transcript and collects the parent stream — so branch state
 * needs no locking, and a child record can never interleave with a render.
 */
internal class SubagentBranchCoordinator(
    private val scope: CoroutineScope,
    private val source: RemoteSessionStreamTransport?,
    private val publish: () -> Unit,
    /**
     * Reports one child's unreadable stream, keyed by the launch item it belongs to.
     *
     * Deliberately not the parent session's failure channel: the conversation is
     * still readable, so a child's stream cannot be allowed to replace it.
     */
    private val onError: (ownerToolCallId: String, error: Throwable) -> Unit,
) {
    /** One child session whose records are drawn inside the branch that launched it. */
    private class Branch(
        val sessionId: String,
        var ownerToolCallId: String,
        var replica: SessionRecordReplica = SessionRecordReplica(sessionId),
        var job: Job? = null,
        /** Identifies the current subscription, so a late `finally` cannot clear a newer one. */
        var subscription: Int = 0,
        var subscribed: Boolean = false,
        /** False until the child's first page settled, so its backfill is one publish. */
        var caughtUp: Boolean = false,
        /** True when the child's stream failed before it published anything. */
        var streamFailed: Boolean = false,
        var items: List<ChatMessageItemResponse> = emptyList(),
        /** The worker's own lifecycle: running, completed, failed, or empty for "nothing to say". */
        var status: String = "",
        /** Whether [status] came from the child's own stream rather than from silence. */
        var liveStatus: Boolean = false,
        var signature: String = "",
        /** How many times this branch's content or status changed. */
        var changes: Int = 0,
        /** Monotonic stamp of when this child was last seen working; decides release order. */
        var lastActivity: Long = 0,
    )

    private var parentSessionId: String = ""
    private val branches = LinkedHashMap<String, Branch>()
    /** Owner tool call id -> child session id, i.e. which item a child belongs to. */
    private val owners = mutableMapOf<String, String>()
    /** Child session ids holding no slot, oldest first; newest is served first. */
    private val waiters = ArrayDeque<String>()
    /** Monotonic stamp backing [Branch.lastActivity], so release order needs no clock. */
    private var activitySeq: Long = 0
    /** True once this host answered a child stream with "no on-demand streams". */
    private var unsupported: Boolean = false
    private var foreground: Boolean = true
    /** Set while [decorate] runs, so a publish cannot re-enter the render it came from. */
    private var decorating: Boolean = false
    private var publishPending: Boolean = false

    /**
     * Binds the coordinator to the parent session that is being opened.
     *
     * Nothing survives a session switch: another session's children are not this
     * session's branches, and their streams would keep pushing records into a
     * transcript that is no longer on screen.
     */
    fun beginSession(parentSessionId: String) {
        detach()
        this.parentSessionId = parentSessionId
    }

    /** Closes every child stream; the parent session's own transcript is untouched. */
    fun endSession() {
        detach()
    }

    /**
     * The parent transcript with every named child's work attached to its owner.
     *
     * Discovery happens here and only here: a child is opened when the parent
     * transcript itself names one, so nothing is probed speculatively and no
     * amount of tool ordering is treated as a subagent.
     *
     * Messages are returned unchanged when no branch applies, so a session without
     * spawned children pays nothing beyond one map lookup per tool item.
     */
    fun decorate(messages: List<ChatMessage>): List<ChatMessage> {
        if (parentSessionId.isEmpty()) return messages
        decorating = true
        try {
            observe(messages)
            if (branches.isEmpty()) return messages
            var decoratedAny = false
            val decorated = messages.map { message ->
                val items = message.items
                if (items.isNullOrEmpty()) return@map message
                var attached = 0
                val nextItems = items.mapIndexed { index, item ->
                    val childSessionId = owners[item.tool?.id.orEmpty()] ?: return@mapIndexed item
                    val branch = branches[childSessionId] ?: return@mapIndexed item
                    val replaced = ownerItem(item, branch, index, items) ?: return@mapIndexed item
                    attached += 1
                    replaced
                }
                if (attached == 0) message else {
                    decoratedAny = true
                    message.copy(items = nextItems)
                }
            }
            return if (decoratedAny) decorated else messages
        } finally {
            decorating = false
            if (publishPending) {
                publishPending = false
                publish()
            }
        }
    }

    /**
     * Makes sure the child behind one launching item is being followed.
     *
     * This is what a reader opening a card asks for. The branch may have lost its
     * slot to the cap, never had one, or been released when the phone left the
     * foreground; either way an open card has to show the worker's own steps rather
     * than a prefix that stopped where its slot did.
     *
     * Returns true when a stream was actually (re)opened. False means nothing was
     * read — the child is unknown, already followed, or this host cannot serve
     * child streams at all — and the caller must not treat that as a retry.
     */
    fun ensureAttached(ownerToolCallId: String): Boolean {
        if (parentSessionId.isEmpty()) return false
        val childSessionId = owners[ownerToolCallId] ?: return false
        val branch = branches[childSessionId] ?: return false
        if (branch.subscribed) return false
        if (source == null || unsupported) return false
        acquireSubscriber(branch)
        return branch.subscribed
    }

    /**
     * Follows children only while the session is on screen.
     *
     * A child stream is another device RPC lane, and nothing is looking at its card
     * once the app is in the background. What the branch published stays attached,
     * so the card keeps its steps; the stream is re-opened on the way back in, and a
     * child that published while this phone was away replays from its newest page.
     *
     * A settled worker is not re-opened: it has nothing left to publish (that is what
     * [isSettled] reads), so following it again would spend one of the eight child
     * lanes on a card that cannot change — and a phone that leaves and returns a few
     * times would spend them on the oldest finished workers rather than on the ones
     * still working.
     */
    fun setForeground(active: Boolean) {
        if (active == foreground) return
        foreground = active
        if (!active) {
            branches.values.filter { it.subscribed }.forEach { releaseSubscription(it, wait = false) }
            return
        }
        branches.values.filterNot(::isSettled).sortedByDescending { it.lastActivity }.forEach { acquireSubscriber(it) }
    }

    /** What this coordinator currently follows, for focused tests. */
    fun followState(): SubagentFollowState =
        SubagentFollowState(branches.size, subscribedCount(), waiters.size)

    /**
     * The children the transcript itself names.
     *
     * Discovery reads the rendered parent transcript rather than the raw records,
     * because the item is where the host writes the child session id and the item is
     * what survives both a live record and a re-render of the same transcript.
     *
     * On this client [decorate] is called from one place only — `render()` in
     * `RemoteSessionStore`, over the messages the open session's replica just
     * produced. The transcript restored from this device's cache is deliberately not
     * decorated: it still carries the launch item's child id, but it is this device's
     * copy of a session the host has not answered for yet, and opening a child stream
     * against it would follow a worker for a session the host may have moved on from.
     * The card is served as soon as the host's own transcript is rendered, which is
     * when the launching item is the host's word rather than the cache's.
     *
     * A host that starts publishing a subagent's process inside its own stream — the
     * older shape — is honoured from that moment on: a branch already followed for
     * that owner is released and forgotten, so the transcript's own grouping draws it
     * and this coordinator stops rewriting the item.
     */
    private fun observe(messages: List<ChatMessage>) {
        messages.forEach { message ->
            val items = message.items.orEmpty()
            items.forEachIndexed { index, item ->
                val tool = item.tool ?: return@forEachIndexed
                val ownerToolCallId = tool.id.orEmpty()
                // A host that publishes a subagent's process inside its own stream
                // needs no child stream at all: those records are already here, and
                // opening the child would read the same work twice.
                if (parentCarriesBranchItems(items, index)) {
                    dropBranch(owners[ownerToolCallId].orEmpty())
                    return@forEachIndexed
                }
                openBranch(tool.subagentSessionId.orEmpty(), ownerToolCallId)
            }
        }
    }

    /**
     * Stops following one child, keeping nothing about it.
     *
     * Used when the parent takes the branch over: its own records are the process
     * now, so the stream is released and the owner mapping is dropped, which is what
     * stops the item from being rewritten with a branch that no longer speaks for it.
     */
    private fun dropBranch(childSessionId: String) {
        if (childSessionId.isEmpty()) return
        val branch = branches.remove(childSessionId) ?: return
        releaseSubscription(branch, wait = false)
        forgetWaiter(branch)
        owners.entries.removeAll { it.value == childSessionId }
        drainWaiters()
    }

    /**
     * One launching item, as the card reads it.
     *
     * Two things are replaced and nothing else: the status the card draws is the
     * worker's own lifecycle, and the branch's items are the worker's own process.
     * A host that publishes the process inside its own stream keeps this item on
     * the path it has always used, and needs no branch attached here.
     */
    private fun ownerItem(
        item: ChatMessageItemResponse,
        branch: Branch,
        ownerIndex: Int,
        items: List<ChatMessageItemResponse>,
    ): ChatMessageItemResponse? {
        val tool = if (branch.status.isNotEmpty()) item.tool?.copy(status = branch.status) else item.tool
        val subItems = if (branch.items.isEmpty() || parentCarriesBranchItems(items, ownerIndex)) {
            item.subItems
        } else {
            branch.items
        }
        if (tool == item.tool && subItems == item.subItems) return null
        return item.copy(tool = tool, subItems = subItems)
    }

    /**
     * Whether the parent stream itself already carries this owner's process.
     *
     * Older hosts published a subagent's records inside the parent stream and
     * marked them, and the transcript grouping already attaches those records to
     * the item that launched them. Attaching the child session's records here as
     * well would draw every step twice, so a marked sibling record — up to the next
     * launch item, which owns its own records — keeps that host on the path it has
     * always used.
     */
    private fun parentCarriesBranchItems(items: List<ChatMessageItemResponse>, ownerIndex: Int): Boolean {
        for (index in ownerIndex + 1 until items.size) {
            val entry = items[index]
            if (entry.isSubagent != true) continue
            val tool = entry.tool
            if (tool != null && isOwnerTool(tool)) return false
            return true
        }
        return false
    }

    /** Whether an item is one of the tools that launches a delegation. */
    private fun isOwnerTool(tool: RemoteToolStatusResponse): Boolean =
        ToolNamePolicy.isTask(tool) || ToolNamePolicy.normalized(tool) == "agentspawn"

    private fun openBranch(childSessionId: String, ownerToolCallId: String) {
        // A host that names no child session, or names this very session, has no
        // branch to open: the launch item stays the plain tool row it always was.
        if (childSessionId.isEmpty() || ownerToolCallId.isEmpty()) return
        if (parentSessionId == childSessionId) return
        if (unsupported) return
        // One subscription per owner. The same launch is republished by every
        // parent record, and that is not a reason to take a slot back from a worker
        // that is using one.
        if (owners.containsKey(ownerToolCallId)) return
        // Owners and branches are bounded by the same number: an owner is one entry
        // pointing at a branch, and a session that keeps launching workers would
        // otherwise grow this map with its whole history. A launch past the bound is
        // not followed; its card keeps the launching item's own status.
        if (owners.size >= MAX_TRACKED_CHILD_BRANCHES || branches.size >= MAX_TRACKED_CHILD_BRANCHES) return
        val resumed = branches[childSessionId]
        if (resumed != null) {
            // The same worker, named by a launch this session has not seen before: a
            // reusable child that was continued. It is one branch — its steps are the
            // worker's, not the launch's — but the launch happening now is what its
            // records have to land under, and a branch the cap released has to be
            // followed again, or the turn it is taking would never arrive.
            owners[ownerToolCallId] = childSessionId
            resumed.ownerToolCallId = ownerToolCallId
            resumed.lastActivity = ++activitySeq
            if (!resumed.subscribed) acquireSubscriber(resumed)
            return
        }
        val branch = Branch(sessionId = childSessionId, ownerToolCallId = ownerToolCallId, lastActivity = ++activitySeq)
        branches[childSessionId] = branch
        owners[ownerToolCallId] = childSessionId
        acquireSubscriber(branch)
    }

    /**
     * Opens a child's stream if this session can follow one more child.
     *
     * Past the cap a slot is taken from another child, oldest activity first and a
     * settled child before a working one: a worker that already reported is the one
     * whose stream can be released for nothing, and a working one that loses its
     * slot keeps the branch it published and waits to be re-attached.
     */
    private fun acquireSubscriber(branch: Branch) {
        if (branch.subscribed || source == null || unsupported) return
        if (subscribedCount() >= MAX_CONCURRENT_CHILD_STREAMS) {
            val victim = releaseCandidate(branch)
            if (victim == null) {
                waitForSlot(branch)
                return
            }
            releaseSubscription(victim, wait = true)
        }
        forgetWaiter(branch)
        subscribe(branch)
        // Subscribing decides what can be said about the worker: a branch opened
        // over the cap has no reading until this point.
        refresh(branch)
    }

    private fun subscribe(branch: Branch) {
        val source = source ?: return
        val token = ++branch.subscription
        branch.subscribed = true
        branch.job = scope.launch {
            try {
                source.subscribe(
                    branch.sessionId,
                    { error -> childStreamFailed(branch.sessionId, token, error) },
                    { childCaughtUp(branch.sessionId) },
                ).collect { event -> applyChildEvent(branch.sessionId, event) }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Throwable) {
                childStreamFailed(branch.sessionId, token, error)
            } finally {
                // Cancellation is what releases the child's flow, and the host
                // stream's own cleanup runs under `NonCancellable`; this marks the
                // slot free on the same terms, so the cap cannot drift.
                withContext(NonCancellable) {
                    val current = branches[branch.sessionId]
                    if (current === branch && branch.subscription == token) {
                        branch.subscribed = false
                        branch.job = null
                    }
                }
            }
        }
    }

    /** Closes one child's stream, keeping the branch and everything it published. */
    private fun releaseSubscription(branch: Branch, wait: Boolean) {
        branch.job?.cancel()
        branch.job = null
        branch.subscription += 1
        branch.subscribed = false
        if (wait) waitForSlot(branch)
    }

    /**
     * Which child gives up its slot, or null when every other child is already
     * waiting.
     *
     * The most recently active children stay followed — a card the reader is
     * watching is the one that just changed — and a settled child goes before a
     * working one, because releasing it cannot lose a step.
     */
    private fun releaseCandidate(except: Branch): Branch? {
        var settled: Branch? = null
        var oldest: Branch? = null
        branches.values.forEach { branch ->
            if (branch === except || !branch.subscribed) return@forEach
            val quietest = oldest
            if (quietest == null || branch.lastActivity < quietest.lastActivity) oldest = branch
            val settledFirst = settled
            if (isSettled(branch) && (settledFirst == null || branch.lastActivity < settledFirst.lastActivity)) settled = branch
        }
        return settled ?: oldest
    }

    private fun waitForSlot(branch: Branch) {
        if (branch.sessionId !in waiters) waiters.addLast(branch.sessionId)
    }

    private fun forgetWaiter(branch: Branch) {
        waiters.removeAll { it == branch.sessionId }
    }

    /**
     * Follows waiting children as slots free, newest first.
     *
     * Newest first because a launch the reader just watched appear is the card most
     * likely to be on screen; the older ones keep their branch and are served when
     * their turn comes or when their card is opened.
     */
    private fun drainWaiters() {
        var budget = waiters.size
        while (budget > 0 && subscribedCount() < MAX_CONCURRENT_CHILD_STREAMS) {
            budget -= 1
            val sessionId = waiters.removeLastOrNull() ?: return
            val branch = branches[sessionId] ?: continue
            if (branch.subscribed) continue
            acquireSubscriber(branch)
        }
    }

    private fun subscribedCount(): Int = branches.values.count { it.subscribed }

    /**
     * A child that has settled: its own stream read a turn of it and no turn of it
     * is in progress.
     *
     * Only the stream makes a branch settled. Silence is not a reading, so a child
     * whose stream never published anything is never treated as finished.
     */
    private fun isSettled(branch: Branch): Boolean =
        branch.caughtUp && branch.liveStatus && branch.status.isNotEmpty() && branch.status !in UNSETTLED

    /**
     * One record of one child session.
     *
     * Records are deduplicated by identity and revision inside the child's own
     * replica, which is the same replica the session on screen uses, so a replayed
     * page cannot publish a step twice. Until the child's first page has settled the
     * parent is not republished at all: a child that finished before its branch was
     * opened backfills hundreds of records, and each of them republishing the parent
     * transcript would repaint the whole conversation per record for a branch nobody
     * has seen yet.
     */
    private fun applyChildEvent(childSessionId: String, event: JsonObject) {
        val branch = branches[childSessionId] ?: return
        if (parentSessionId.isEmpty()) return
        // One subscription carries one session's records, so a record stamped with
        // another session id is a broken contract, not a step of this worker. The
        // parent stream fails loud on the same mismatch, and a child reduced into
        // the wrong branch would put another agent's work on this card.
        check(event["session_id"]?.jsonPrimitive?.content == childSessionId) { "Session binding mismatch" }
        when (event["event"]?.jsonPrimitive?.content) {
            STREAM_EVENT_GAP -> {
                // The host restarted this child's stream: everything reduced so far
                // came from its previous epoch, so it is dropped before the replay.
                // Only this child is affected — the parent's own epoch is the
                // parent replica's business, and another child's stream is another
                // subscription.
                branch.replica = SessionRecordReplica(childSessionId)
                branch.caughtUp = false
                branch.streamFailed = false
                refresh(branch)
                return
            }
            "session-record" -> {
                // The replica drops a record it already holds at that revision, so a
                // replayed page leaves the branch unchanged and publishes nothing.
                val payload = event["payload"] as? JsonObject ?: return
                branch.replica.apply(payload)
            }
            "agentic://tool-event" -> {
                val payload = event["payload"] as? JsonObject ?: return
                branch.replica.applyControl(payload)
            }
            STREAM_EVENT_READY, STREAM_EVENT_HISTORY_STARTED, STREAM_EVENT_RESUMED -> return
            else -> return
        }
        branch.streamFailed = false
        branch.lastActivity = ++activitySeq
        if (!branch.caughtUp) return
        refresh(branch)
    }

    private fun childCaughtUp(childSessionId: String) {
        val branch = branches[childSessionId] ?: return
        branch.caughtUp = true
        branch.streamFailed = false
        refresh(branch)
    }

    /**
     * A child stream that failed or could not be opened.
     *
     * A child stream that failed before it published anything says nothing about the
     * worker, so no lifecycle is invented for it: the card keeps the launching item's
     * own status, and that child is not read again on its own (only a card being
     * opened asks for it again).
     *
     * A stream that died *after* publishing steps is a different case, and the branch
     * is marked failed either way. The steps it published stay — they are the worker's
     * own work and dropping them would empty a card the reader was reading — but a
     * worker whose last turn was still in progress when its stream stopped is no longer
     * vouched for by anything: that `running` is a snapshot of a dead stream, not
     * evidence the worker is alive, and a card that keeps saying "running" forever is
     * the worst of the available readings. Nothing terminal is invented in its place;
     * see [childStatus].
     *
     * The failure is reported to this coordinator's own channel, never to the parent
     * session's failure state. A host that serves this conversation perfectly well can
     * still refuse one child's `read_stream`, and losing the readable transcript
     * behind a session-level error would be a lie about what is on screen. A host that
     * answers "no on-demand streams" at all is recorded once — no further child stream
     * is opened for it — and every child stream is released.
     *
     * Only a failure belonging to the session still on screen is reported: an error
     * that arrives after the session was closed, switched away from, or re-subscribed
     * describes a stream nobody is looking at any more.
     */
    private fun childStreamFailed(childSessionId: String, token: Int, error: Throwable) {
        if (parentSessionId.isEmpty()) return
        val branch = branches[childSessionId] ?: return
        if (branch.subscription != token) return
        // Whatever the branch published, a dead stream stops being a reading of the
        // worker, so the derived status is recomputed rather than left as it was.
        branch.streamFailed = true
        refresh(branch)
        if (error is HostStreamUnsupportedException) {
            if (unsupported) return
            unsupported = true
            branches.values.filter { it.subscribed }.forEach { releaseSubscription(it, wait = false) }
        }
        onError(branch.ownerToolCallId, error)
    }

    /**
     * Republishes a branch that changed in any way the card can show.
     *
     * The items are what the card draws; the status is what its header says, and a
     * child's turn can settle without publishing another item, so both are compared
     * before the parent transcript is republished.
     */
    private fun refresh(branch: Branch) {
        val wasSettled = isSettled(branch)
        val messages = branch.replica.messages()
        val items = branchItems(messages)
        val signature = branchSignature(items)
        val live = turnStatus(messages)
        val status = childStatus(branch, live)
        branch.liveStatus = live.isNotEmpty()
        if (signature == branch.signature && status == branch.status) return
        branch.signature = signature
        branch.items = items
        branch.status = status
        branch.changes += 1
        requestPublish()
        // A settled worker will not publish again, so it costs nothing to stop
        // following it. It is the transition that releases: a worker that settled,
        // was continued and then settled again keeps its stream until the cap wants
        // the slot back, which is where a settled branch is the first one to be taken.
        if (!wasSettled && isSettled(branch) && branch.subscribed) {
            releaseSubscription(branch, wait = false)
            drainWaiters()
        }
    }

    /**
     * Publishes once, and never from inside the render that caused the change.
     *
     * The store's publish re-renders the parent transcript, which decorates again;
     * publishing from within [decorate] would recurse through that render. The
     * pending publish is flushed as soon as the decoration finishes, so a branch
     * opened by discovery still reaches the screen in the same turn.
     */
    private fun requestPublish() {
        if (decorating) {
            publishPending = true
            return
        }
        publish()
    }

    /**
     * The worker's own lifecycle, as its stream describes it.
     *
     * A child session is an ordinary session with its own turns, so the reading is
     * the child's own: a turn of it still in progress means the worker is working,
     * and the last turn's outcome is what a finished worker reported. Multi-turn
     * children — a worker continued after it answered once — are running again the
     * moment any of their turns is.
     *
     * Nothing is invented from what is missing. Before the child has said anything
     * at all the worker was started and is not finished, so it reads as running; a
     * stream that failed before publishing anything says nothing, and the launching
     * item's own status stands.
     *
     * A dead stream makes no claim, which is why it wins over an in-progress turn:
     * "the last turn I saw was still going" describes a stream that has stopped, not
     * a worker that is alive, and nothing will ever settle it. The card therefore
     * falls back to the launching item's own status — the host's word about the
     * spawn, which this client has no right to overrule — rather than inventing a
     * `failed` the host never sent. What the child did report before the stream died
     * is a real outcome and is kept: a settled worker does not become unsettled
     * because a stream ended afterwards, and its steps stay on the card either way.
     */
    private fun childStatus(branch: Branch, live: String): String = when {
        branch.streamFailed && live in UNSETTLED -> ""
        live.isNotEmpty() -> live
        branch.streamFailed -> ""
        else -> RUNNING
    }

    /**
     * A child transcript's lifecycle reading, or "" when it holds no turn yet.
     *
     * The child's turn status is the host's own vocabulary, and only part of it
     * means "finished". A turn that is starting, thinking, calling a tool, or
     * waiting on a permission answer is still a turn in progress, and a card that
     * read those as an outcome would print "Done" over a worker that was
     * demonstrably still working. A turn the host accepted but has not started is
     * [WAITING]: not an outcome, and not a worker at work either. The newest
     * assistant message decides which reading applies; anything this client does
     * not recognise is read as an outcome, which is the pre-existing behaviour.
     */
    private fun turnStatus(messages: List<ChatMessage>): String {
        var sawTurn = false
        var running = false
        var lastStatus = ""
        var lastOutcome = ""
        messages.forEach { message ->
            if (message.role != "assistant") return@forEach
            sawTurn = true
            val status = message.status.orEmpty().lowercase()
            lastStatus = status
            if (status in RUNNING_STATUSES) {
                running = true
                return@forEach
            }
            if (status in FINISHING_STATUSES || status in WAITING_STATUSES) return@forEach
            lastOutcome = if (status in FAILED_STATUSES) "failed" else "completed"
        }
        if (!sawTurn) return ""
        return when {
            // A turn of this worker is going, whatever any other turn of it says.
            running -> RUNNING
            lastStatus in FINISHING_STATUSES -> FINISHING
            lastStatus in WAITING_STATUSES -> WAITING
            else -> lastOutcome
        }
    }

    /**
     * The process a child session publishes, in its own order.
     *
     * A child session is an ordinary session: it has its own turns and its own user
     * message (the brief it was spawned with), which the card already shows as the
     * branch title, so only the assistant's items are branch content.
     */
    private fun branchItems(messages: List<ChatMessage>): List<ChatMessageItemResponse> {
        val items = mutableListOf<ChatMessageItemResponse>()
        messages.forEach { message ->
            if (message.role != "assistant") return@forEach
            items += message.items.orEmpty()
        }
        return items
    }

    /** Everything about a branch that can change what the card draws. */
    private fun branchSignature(items: List<ChatMessageItemResponse>): String = buildString {
        append(items.size)
        items.forEach { item ->
            val tool = item.tool
            append('\u0001')
            append(item.type.orEmpty())
            append('\u0000')
            append(item.content.orEmpty().length)
            append('\u0000')
            if (tool != null) {
                append(tool.id.orEmpty()); append(':')
                append(tool.name.orEmpty()); append(':')
                append(tool.status.orEmpty())
            }
        }
    }

    private fun detach() {
        branches.values.forEach { branch ->
            branch.job?.cancel()
            branch.job = null
            branch.subscription += 1
            branch.subscribed = false
        }
        branches.clear()
        owners.clear()
        waiters.clear()
        parentSessionId = ""
        publishPending = false
        decorating = false
    }

    private companion object {
        /** Host vocabulary, not user-visible copy: presentation maps it to its own words. */
        const val RUNNING = "running"

        /**
         * The worker's turn is wrapping up: still its turn, no longer its work.
         *
         * Kept apart from [RUNNING] because the card says something different for
         * it, and because a branch that reports it is not settled either.
         */
        const val FINISHING = "finishing"

        /**
         * The worker's turn is accepted but has not started: nothing of it is running.
         *
         * A queued turn is neither an outcome nor a worker at work. Reading it as
         * [RUNNING] made the card say "Running" and pulse over a worker the host was
         * still holding; reading it as an outcome printed "Done" before it had begun.
         * It is kept out of the settled readings too: the turn it was queued for is
         * still going to be published on this branch's stream.
         */
        const val WAITING = "waiting"

        /** Readings that mean the worker still owes work, so a branch that says one is not settled. */
        val UNSETTLED = setOf(RUNNING, FINISHING, WAITING)

        /**
         * Host vocabularies for "this turn is still going".
         *
         * `streaming` is here because the replica renders an in-progress turn as a
         * streaming message, and a child transcript is read through that same replica.
         * The rest are the host's own in-progress states: a turn that started, is
         * thinking, is calling a tool, or is waiting on an answer has not finished,
         * and reading any of them as an outcome is what printed "Done" over a
         * worker that was still working.
         */
        val RUNNING_STATUSES = setOf(
            "running", "streaming", "active", "inprogress", "in_progress", "preparing",
            "starting", "thinking", "tool_calling", "pending_confirmation", "capability_required",
        )

        /** Host vocabularies for "this turn was accepted and has not started yet". */
        val WAITING_STATUSES = setOf("queued", "pending", "waiting", "blocked", "deferred", "scheduled")
        val FINISHING_STATUSES = setOf("finishing", "finalizing", "wrapping_up")
        val FAILED_STATUSES = setOf("failed", "error", "timeout", "cancelled", "canceled", "rejected")
    }
}
