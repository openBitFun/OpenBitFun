package com.openbitfun.mobile.core.feature.session

import kotlin.test.Test
import kotlin.test.assertEquals

class SessionActionPolicyTest {
    @Test
    fun aRemoteSessionOffersRenameButNeverTheLocalStorageActions() {
        val capabilities = SessionActionPolicy.resolve(SessionActionScope.REMOTE, "code", busy = false)

        assertEquals(
            SessionActionCapabilities(
                canViewDetails = true,
                canArchive = false,
                canExport = false,
                canDelete = true,
                canRename = true,
            ),
            capabilities,
        )
    }

    @Test
    fun archiveAndExportBelongToGeneralChatAlone() {
        assertEquals(
            SessionActionCapabilities(
                canViewDetails = true,
                canArchive = true,
                canExport = true,
                canDelete = true,
                // A general chat is renamed on this device by
                // `GeneralChatIntent.RenameSession`, so the row may offer it.
                canRename = true,
            ),
            SessionActionPolicy.resolve(SessionActionScope.GENERAL, "chat", busy = false),
        )
        assertEquals(
            SessionActionCapabilities(
                canViewDetails = true,
                canArchive = false,
                canExport = false,
                canDelete = true,
                canRename = true,
            ),
            SessionActionPolicy.resolve(SessionActionScope.GENERAL, "code", busy = false),
        )
    }

    @Test
    fun theRenameFlagWasAppendedSoEarlierPositionsKeepTheirMeaning() {
        // Named and positional construction of the same value: a caller that
        // still writes the four flags in order cannot silently be read as
        // asking for rename instead of delete.
        assertEquals(
            SessionActionCapabilities(
                canViewDetails = true,
                canArchive = false,
                canExport = false,
                canDelete = true,
                canRename = true,
            ),
            SessionActionCapabilities(true, false, false, true, true),
        )
        assertEquals(
            SessionActionPolicy.resolve(SessionActionScope.REMOTE, "code", busy = false),
            SessionActionCapabilities(true, false, false, true, true),
        )
    }

    @Test
    fun aCommandInFlightWithdrawsEverything() {
        // The row the menu was opened over may not survive the answer, and that
        // includes a rename the menu could otherwise have offered.
        listOf(SessionActionScope.GENERAL, SessionActionScope.REMOTE).forEach { scope ->
            assertEquals(
                SessionActionCapabilities(
                    canViewDetails = false,
                    canArchive = false,
                    canExport = false,
                    canDelete = false,
                    canRename = false,
                ),
                SessionActionPolicy.resolve(scope, "chat", busy = true),
                scope.name,
            )
        }
    }
}
