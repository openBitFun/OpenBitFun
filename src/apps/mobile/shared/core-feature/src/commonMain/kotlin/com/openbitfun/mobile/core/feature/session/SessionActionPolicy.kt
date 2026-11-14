package com.openbitfun.mobile.core.feature.session

/** Which list a session row is being shown in. */
public enum class SessionActionScope {
    /** The on-device general chat list, backed by local storage. */
    GENERAL,

    /** A paired desktop's sessions, where every action is a round trip. */
    REMOTE,
}

public data class SessionActionCapabilities public constructor(
    public val canViewDetails: Boolean,
    public val canArchive: Boolean,
    public val canExport: Boolean,
    public val canDelete: Boolean,
    /**
     * Appended after the four flags that already existed, so their positions
     * keep their meaning. Renaming is not one of the local-storage operations
     * above — for a remote session it is a round trip to the desktop, for a
     * general chat it rewrites the stored row — so folding it into one of them
     * would read wrong in one scope or the other.
     *
     * No Swift-compatible secondary constructor accompanies this addition: the
     * iOS client has no caller of [SessionActionCapabilities] today, so there is
     * no `init(canViewDetails:canArchive:…)` to keep in step. If iOS ever starts
     * reading these flags, it will need one, and this note is the reminder.
     */
    public val canRename: Boolean,
)

/**
 * What a session row's overflow menu may offer.
 *
 * Ported from `pages/policy/SessionActionPolicy.ets`. Archive and export are
 * local-storage operations, so a remote session never offers them however it is
 * typed; while a command is in flight nothing is offered at all, because the
 * row the menu was opened over may not survive the answer.
 *
 * Rename is offered in both scopes, for different reasons. A remote session's
 * title belongs to the desktop and `update_session_title` is already on the
 * wire; a general chat's title belongs to this device, where
 * `GeneralChatIntent.RenameSession` reaches `GeneralChatStore.renameSession` and
 * rewrites the stored row. Neither is one of the local-storage operations above,
 * which is why it is a flag of its own rather than folded into them.
 */
public object SessionActionPolicy {
    public fun resolve(
        scope: SessionActionScope,
        agentType: String,
        busy: Boolean,
    ): SessionActionCapabilities {
        if (busy) return SessionActionCapabilities(false, false, false, false, false)
        if (scope == SessionActionScope.REMOTE) {
            return SessionActionCapabilities(true, false, false, true, true)
        }
        // Two names for one kind: the desktop and the HarmonyOS client say
        // "chat", the on-device store writes "general_chat" into its own rows.
        val isGeneralChat = agentType.lowercase() in GENERAL_CHAT_AGENT_TYPES
        // Rename is true here because the path really exists on this device
        // (`GeneralChatIntent.RenameSession` -> `GeneralChatStore.renameSession`),
        // not because the two lists should look alike. A surface that offers the
        // row still has to pass a rename callback; without one no row is drawn.
        return SessionActionCapabilities(true, isGeneralChat, isGeneralChat, true, true)
    }

    private val GENERAL_CHAT_AGENT_TYPES = setOf("chat", "general_chat")
}
