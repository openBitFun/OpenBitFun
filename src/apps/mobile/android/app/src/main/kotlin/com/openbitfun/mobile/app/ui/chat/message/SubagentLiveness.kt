package com.openbitfun.mobile.app.ui.chat.message

/**
 * What a delegation card says about the worker it launched.
 *
 * The six readings are the ones the desktop card draws, and each of them is a
 * fact the host already published — this file only decides which word it is. It
 * exists because the card used to fold every status into two: anything not in the
 * running vocabulary was printed as "Done", so a worker that was calling a tool,
 * waiting in a queue, or wrapping its turn up was reported as finished.
 *
 * [UNKNOWN] is not a seventh state of the design: it is what is drawn when the
 * host sent a status this client cannot read. Guessing "completed" there is the
 * one answer that is always wrong when it is wrong, so the card says it does not
 * know instead.
 */
internal enum class SubagentLiveness {
    RUNNING,
    FINISHING,
    WAITING,
    COMPLETED,
    CANCELLED,
    ERROR,
    UNKNOWN,
    ;

    /** Whether the worker is still taking its turn, i.e. the card should move. */
    val inFlight: Boolean get() = this == RUNNING || this == FINISHING
}

/**
 * The reading for one host status.
 *
 * The vocabulary is the host's, lowercased: the child's own turn status when its
 * stream could be read, and the launching item's status otherwise. Anything not
 * listed here is [SubagentLiveness.UNKNOWN] on purpose — see the enum's note.
 */
internal fun subagentLiveness(status: String): SubagentLiveness = when (status.trim().lowercase()) {
    // Started and not finished. `tool_calling` and `pending_confirmation` are the
    // states a worker spends most of its life in, and the ones the card used to
    // print as "Done".
    "running", "streaming", "active", "inprogress", "in_progress", "preparing", "starting",
    "thinking", "tool_calling", "pending_confirmation", "capability_required",
    -> SubagentLiveness.RUNNING

    // Its last token is written and it is closing the turn out.
    "finishing", "finalizing", "wrapping_up",
    -> SubagentLiveness.FINISHING

    // Accepted but not started: the host is holding it, so nothing is running yet.
    "queued", "pending", "waiting", "blocked", "deferred", "scheduled",
    -> SubagentLiveness.WAITING

    "completed", "complete", "success", "succeeded", "done", "finished",
    -> SubagentLiveness.COMPLETED

    "cancelled", "canceled", "aborted", "interrupted", "stopped", "skipped",
    -> SubagentLiveness.CANCELLED

    "failed", "error", "timeout", "timed_out", "rejected", "crashed", "denied",
    -> SubagentLiveness.ERROR

    else -> SubagentLiveness.UNKNOWN
}

/**
 * The one identity a card is drawn with: a glyph and a tint, both derived from a
 * stable key.
 *
 * The desktop draws twenty authored robots picked by session id; a phone card is
 * 24dp and the same reader has to tell two delegations apart at a glance, so this
 * client uses the same idea with its own vocabulary: one of five worker glyphs and
 * one of three semantic tints. Both are hash-derived, so a worker looks the same
 * every time its card is drawn, and two launches of different workers almost never
 * look alike. Collisions are allowed — this is identity, not a key.
 */
internal data class SubagentIdentity(val glyph: Int, val tint: Int)

/** How many distinct glyphs [subagentIdentity] can pick from. */
internal const val SUBAGENT_GLYPH_COUNT: Int = 5

/** How many semantic tints [subagentIdentity] can pick from. */
internal const val SUBAGENT_TINT_COUNT: Int = 3

/**
 * What a card is identified by.
 *
 * The launch item's tool call id is the host's own name for this delegation, and
 * it is the key this client follows the child session by; a block the host
 * published without one falls back to the position id the transcript gave it.
 * Neither is invented from the worker's name or the tool that launched it.
 */
internal fun subagentIdentityKey(ownerToolCallId: String, blockId: String): String =
    ownerToolCallId.trim().ifEmpty { blockId.trim() }

/**
 * The identity for [key], stable across redraws and across restarts.
 *
 * Two seeds are hashed rather than two slices of one hash, so the glyph and the
 * tint vary independently instead of moving together.
 */
internal fun subagentIdentity(key: String): SubagentIdentity {
    val seed = key.trim()
    if (seed.isEmpty()) return SubagentIdentity(glyph = 0, tint = 0)
    return SubagentIdentity(
        glyph = (fnv1a("$SUBAGENT_IDENTITY_VERSION:glyph:$seed") ushr 1) % SUBAGENT_GLYPH_COUNT,
        tint = (fnv1a("$SUBAGENT_IDENTITY_VERSION:tint:$seed") ushr 1) % SUBAGENT_TINT_COUNT,
    )
}

/**
 * The worker's name: the delegation's own words when it has them.
 *
 * A worker's name is the brief it was spawned with, which the shared presentation
 * already extracted from the launch item; this client never substitutes a tool
 * name for it. Blank means the host gave none, and the card falls back to its own
 * word for "subagent".
 */
internal fun subagentDisplayName(title: String): String = title.trim()

/** Versioned so a future change to the pools does not silently repaint old cards. */
private const val SUBAGENT_IDENTITY_VERSION = "subagent-identity-v1"

/** FNV-1a, 32-bit: the whole point is that it is identical on every run and device. */
private fun fnv1a(text: String): Int {
    var hash = 0x811C9DC5.toInt()
    text.forEach { char ->
        hash = hash xor char.code
        hash *= 0x01000193
    }
    return hash
}
