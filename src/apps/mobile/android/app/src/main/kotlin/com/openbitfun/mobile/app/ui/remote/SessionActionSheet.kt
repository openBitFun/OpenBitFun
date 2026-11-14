package com.openbitfun.mobile.app.ui.remote

import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import com.openbitfun.mobile.app.R
import com.openbitfun.mobile.app.ui.settings.statusText
import com.openbitfun.mobile.app.ui.common.AdaptiveModalSurface
import com.openbitfun.mobile.core.feature.session.SessionActionCapabilities
import com.openbitfun.mobile.core.feature.layout.SettingsPlacement
import com.openbitfun.mobile.core.feature.session.SessionTimePresentation
import com.openbitfun.mobile.app.ui.theme.generated.MobileDesignGeometry

internal const val SESSION_ACTIONS_TEST_TAG: String = "session-actions"
internal const val SESSION_DETAILS_TEST_TAG: String = "session-details"

/** The row that opens the rename step, and the field that step shows. */
internal const val SESSION_RENAME_ROW_TEST_TAG: String = "session-rename-row"
internal const val SESSION_RENAME_FIELD_TEST_TAG: String = "session-rename-field"

/**
 * The longest title this surface will submit.
 *
 * The host normalizes a title and refuses only an empty one, so this is not a
 * protocol limit: it is the client's own guard against pasting a document into
 * a row that is drawn on one line. Nothing is truncated on the way out — a
 * draft over the limit simply cannot be submitted.
 *
 * A title the host already holds that is longer than this therefore shows Save
 * disabled with no explanation of its own. `ui/chat/ConversationHeader.TitleEditor`
 * caps nothing, so the two editors differ here; that inconsistency is known and
 * accepted rather than fixed by widening this one.
 */
private const val SESSION_TITLE_MAX_LENGTH: Int = 120

/**
 * A session row's overflow menu, ported from
 * `pages/components/SessionActionSurface.ets`.
 *
 * Which rows appear is [SessionActionCapabilities]' answer, not this file's:
 * archive and export are local-storage operations that a remote session cannot
 * offer however it is typed, and while a command is in flight nothing is
 * offered at all because the row this was opened over may not survive the
 * answer.
 *
 * Deleting replaces the action list in place instead of stacking a dialog on
 * top of it, as the source does. Two layers of scrim over a bottom sheet gives
 * the confirmation two dismiss gestures with different meanings — tapping
 * outside would cancel the delete or the whole menu depending on how far the
 * finger landed. Renaming is the same kind of step for the same reason.
 *
 * Takes the fields rather than the session: `RemoteSession` lives in
 * `core-domain`, which the app is not allowed to import (design doc §5 rule 3),
 * and re-exporting a domain type through `core-feature` just to name it here
 * would defeat the rule rather than satisfy it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun SessionActionSheet(
    title: String,
    status: String,
    capabilities: SessionActionCapabilities,
    onViewDetails: () -> Unit,
    onRename: ((String) -> Unit)? = null,
    onArchive: (() -> Unit)? = null,
    onExport: (() -> Unit)? = null,
    onDelete: () -> Unit,
    onDismiss: () -> Unit,
) {
    // Deliberately not `rememberSaveable`: the confirmation is a step inside a
    // sheet that is itself gone after a process death, and restoring "about to
    // delete" without the tap that got there is not a state worth rebuilding.
    var confirmingDelete by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf(false) }
    var renameDraft by remember { mutableStateOf("") }
    // Archive and export are local-storage operations a remote session can never
    // offer, so those callbacks are optional: a surface without them renders no
    // row instead of rendering one that does nothing. Rename is optional for the
    // same reason — the row is capability-gated *and* callback-gated.
    val showArchive = capabilities.canArchive && onArchive != null
    val showExport = capabilities.canExport && onExport != null
    val showRename = capabilities.canRename && onRename != null

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        shape = RoundedCornerShape(
            topStart = MobileDesignGeometry.PopoverRadius,
            topEnd = MobileDesignGeometry.PopoverRadius,
        ),
        containerColor = MaterialTheme.colorScheme.surface,
        tonalElevation = 0.dp,
        dragHandle = null,
        modifier = Modifier
            .testTag(SESSION_ACTIONS_TEST_TAG)
            .border(
                width = 1.dp,
                color = MaterialTheme.colorScheme.outlineVariant,
                shape = RoundedCornerShape(
                    topStart = MobileDesignGeometry.PopoverRadius,
                    topEnd = MobileDesignGeometry.PopoverRadius,
                ),
            ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 18.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                modifier = Modifier
                    .padding(bottom = 10.dp)
                    .size(width = 36.dp, height = 4.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(MaterialTheme.colorScheme.outlineVariant),
            )
            Row(
                modifier = Modifier.fillMaxWidth().height(52.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    Text(
                        stringResource(R.string.session_actions),
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        title.ifBlank { stringResource(R.string.sidebar_untitled) },
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Box(
                    modifier = Modifier
                        .size(40.dp)
                        .clip(RoundedCornerShape(20.dp))
                        .clickable(onClick = onDismiss),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        painter = painterResource(R.drawable.ic_symbol_xmark),
                        contentDescription = stringResource(R.string.common_close),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(16.dp),
                    )
                }
            }

            HorizontalDivider(modifier = Modifier.padding(top = 6.dp, bottom = 8.dp))

            // Pre-existing and out of scope here: this branch reads no capability
            // either, so an already-open confirmation can still submit after
            // `busy` flips. Not audited and cleared — see the rename step below.
            if (confirmingDelete) {
                Text(
                    stringResource(R.string.session_delete_confirm),
                    fontSize = 13.sp,
                    lineHeight = 19.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                )
                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    ConfirmationButton(
                        label = stringResource(R.string.common_cancel),
                        containerColor = MaterialTheme.colorScheme.surfaceVariant,
                        contentColor = MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.weight(1f),
                        onClick = { confirmingDelete = false },
                    )
                    ConfirmationButton(
                        label = stringResource(R.string.session_delete),
                        containerColor = MaterialTheme.colorScheme.error,
                        contentColor = MaterialTheme.colorScheme.onError,
                        modifier = Modifier.weight(1f),
                        onClick = {
                            onDelete()
                            onDismiss()
                        },
                    )
                }
                return@Column
            }

            if (renaming) {
                RenameStep(
                    draft = renameDraft,
                    // The capability is re-read here rather than only at the row
                    // that opened this step: a command starting while the field
                    // is open must not let it submit, because the store's
                    // `beginWork()` cancels whatever is already in flight.
                    submitEnabled = renameSubmittable(renameDraft, title) && capabilities.canRename,
                    onDraftChange = { renameDraft = it },
                    onSave = {
                        // Gated twice on purpose: the button is disabled, and the
                        // verdict is re-decided here. Which semantics a disabled
                        // clickable publishes is a Compose implementation detail,
                        // so the handler must not rely on the button being the only
                        // way in.
                        if (renameSubmittable(renameDraft, title) && capabilities.canRename) {
                            // The store trims and owns the authority update; this
                            // surface never retitles the row itself.
                            onRename?.invoke(renameDraft.trim())
                            onDismiss()
                        }
                    },
                    onCancel = { renaming = false },
                )
                return@Column
            }

            if (capabilities.canViewDetails) {
                ActionRow(R.drawable.ic_symbol_info_circle, stringResource(R.string.session_view_details)) {
                    onViewDetails()
                    onDismiss()
                }
            }
            if (showRename) {
                ActionRow(
                    R.drawable.ic_symbol_square_and_pencil,
                    stringResource(R.string.session_rename),
                    modifier = Modifier.testTag(SESSION_RENAME_ROW_TEST_TAG),
                ) {
                    renameDraft = title
                    renaming = true
                }
            }
            if (showArchive) {
                val archived = status.equals("archived", ignoreCase = true)
                val label = stringResource(
                    if (archived) R.string.session_unarchive else R.string.session_archive,
                )
                ActionRow(R.drawable.ic_symbol_archivebox, label) {
                    onArchive()
                    onDismiss()
                }
            }
            if (showExport) {
                // The label says "Copy Markdown" for Harmony parity, but Android
                // opens an Intent.ACTION_SEND text/plain share sheet; this icon
                // must not promise a file or cloud export.
                ActionRow(
                    R.drawable.ic_symbol_doc_text_badge_arrow_up,
                    stringResource(R.string.general_chat_export),
                ) {
                    onExport()
                    onDismiss()
                }
            }
            if (capabilities.canDelete) {
                if (showArchive || showExport) {
                    HorizontalDivider(modifier = Modifier.padding(vertical = 6.dp))
                }
                ActionRow(
                    icon = R.drawable.ic_symbol_trash,
                    label = stringResource(R.string.session_delete),
                    destructive = true,
                ) { confirmingDelete = true }
            }
        }
    }
}

/** Wide-sidebar counterpart of [SessionActionSheet]. It renders the same rows
 * next to the row that opened it and keeps the native popup lifecycle arrowless. */
@Composable
internal fun SessionActionPopup(
    anchorBounds: IntRect,
    title: String,
    status: String,
    capabilities: SessionActionCapabilities,
    onViewDetails: () -> Unit,
    onRename: ((String) -> Unit)? = null,
    onArchive: (() -> Unit)? = null,
    onExport: (() -> Unit)? = null,
    onDelete: () -> Unit,
    onDismiss: () -> Unit,
) {
    var confirmingDelete by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf(false) }
    var renameDraft by remember { mutableStateOf("") }
    val showArchive = capabilities.canArchive && onArchive != null
    val showExport = capabilities.canExport && onExport != null
    val showRename = capabilities.canRename && onRename != null
    val targetBounds = anchorBounds
    val positionProvider = remember(targetBounds) {
        object : PopupPositionProvider {
            override fun calculatePosition(
                anchorBounds: IntRect,
                windowSize: IntSize,
                layoutDirection: LayoutDirection,
                popupContentSize: IntSize,
            ): IntOffset {
                val desiredX = targetBounds.right + 6
                val desiredY = (
                    targetBounds.top + targetBounds.bottom -
                        popupContentSize.height
                    ) / 2
                return IntOffset(
                    x = desiredX.coerceIn(
                        8,
                        (windowSize.width - popupContentSize.width - 8).coerceAtLeast(8),
                    ),
                    y = desiredY.coerceIn(
                        8,
                        (windowSize.height - popupContentSize.height - 8).coerceAtLeast(8),
                    ),
                )
            }
        }
    }
    Popup(
        popupPositionProvider = positionProvider,
        onDismissRequest = onDismiss,
        properties = PopupProperties(focusable = true),
    ) {
        Column(
            modifier = Modifier
                .width(300.dp)
                .shadow(20.dp, RoundedCornerShape(MobileDesignGeometry.PopoverRadius))
                .clip(RoundedCornerShape(MobileDesignGeometry.PopoverRadius))
                .background(MaterialTheme.colorScheme.surface)
                .border(
                    1.dp,
                    MaterialTheme.colorScheme.outlineVariant,
                    RoundedCornerShape(MobileDesignGeometry.PopoverRadius),
                )
                .padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 18.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().height(52.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(
                        stringResource(R.string.session_actions),
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        title.ifBlank { stringResource(R.string.sidebar_untitled) },
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Box(
                    modifier = Modifier.size(40.dp).clip(RoundedCornerShape(20.dp)).clickable(onClick = onDismiss),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        painterResource(R.drawable.ic_symbol_xmark),
                        contentDescription = stringResource(R.string.common_close),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(16.dp),
                    )
                }
            }
            HorizontalDivider(modifier = Modifier.padding(top = 6.dp, bottom = 8.dp))
            // Pre-existing and out of scope here: this branch reads no capability
            // either, so an already-open confirmation can still submit after
            // `busy` flips. Not audited and cleared — see the rename step below.
            if (confirmingDelete) {
                Text(
                    stringResource(R.string.session_delete_confirm),
                    fontSize = 13.sp,
                    lineHeight = 19.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                )
                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    ConfirmationButton(
                        stringResource(R.string.common_cancel),
                        MaterialTheme.colorScheme.surfaceVariant,
                        MaterialTheme.colorScheme.onSurface,
                        Modifier.weight(1f),
                    ) { confirmingDelete = false }
                    ConfirmationButton(
                        stringResource(R.string.session_delete),
                        MaterialTheme.colorScheme.error,
                        MaterialTheme.colorScheme.onError,
                        Modifier.weight(1f),
                    ) {
                        onDelete()
                        onDismiss()
                    }
                }
            } else if (renaming) {
                RenameStep(
                    draft = renameDraft,
                    // Re-read here for the reason the sheet does: the row that
                    // opened this step can be withdrawn while it is open.
                    submitEnabled = renameSubmittable(renameDraft, title) && capabilities.canRename,
                    onDraftChange = { renameDraft = it },
                    onSave = {
                        // Gated twice for the reason the sheet's step is: the
                        // verdict is re-decided in the handler rather than trusted
                        // to the button's disabled state alone.
                        if (renameSubmittable(renameDraft, title) && capabilities.canRename) {
                            onRename?.invoke(renameDraft.trim())
                            onDismiss()
                        }
                    },
                    onCancel = { renaming = false },
                )
            } else {
                if (capabilities.canViewDetails) {
                    ActionRow(R.drawable.ic_symbol_info_circle, stringResource(R.string.session_view_details)) {
                        onViewDetails(); onDismiss()
                    }
                }
                if (showRename) {
                    ActionRow(
                        R.drawable.ic_symbol_square_and_pencil,
                        stringResource(R.string.session_rename),
                        modifier = Modifier.testTag(SESSION_RENAME_ROW_TEST_TAG),
                    ) {
                        renameDraft = title
                        renaming = true
                    }
                }
                if (showArchive) {
                    ActionRow(
                        R.drawable.ic_symbol_archivebox,
                        stringResource(
                            if (status.equals("archived", true)) R.string.session_unarchive
                            else R.string.session_archive,
                        ),
                    ) { onArchive(); onDismiss() }
                }
                if (showExport) {
                    ActionRow(
                        R.drawable.ic_symbol_doc_text_badge_arrow_up,
                        stringResource(R.string.general_chat_export),
                    ) {
                        onExport(); onDismiss()
                    }
                }
                if (capabilities.canDelete) {
                    if (showArchive || showExport) {
                        HorizontalDivider(modifier = Modifier.padding(vertical = 6.dp))
                    }
                    ActionRow(
                        R.drawable.ic_symbol_trash,
                        stringResource(R.string.session_delete),
                        destructive = true,
                    ) { confirmingDelete = true }
                }
            }
        }
    }
}

/**
 * The rename step: a field seeded with the title the row carries now, and the
 * two verdicts.
 *
 * A step inside the menu rather than a dialog over it, for the reason the
 * delete confirmation is one: a second scrim gives one gesture two meanings.
 */
@Composable
private fun RenameStep(
    draft: String,
    submitEnabled: Boolean,
    onDraftChange: (String) -> Unit,
    onSave: () -> Unit,
    onCancel: () -> Unit,
) {
    val fieldShape = RoundedCornerShape(8.dp)
    Column(modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) {
        Text(
            stringResource(R.string.session_rename_label),
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.fillMaxWidth(),
        )
        BasicTextField(
            value = draft,
            onValueChange = onDraftChange,
            singleLine = true,
            textStyle = MaterialTheme.typography.bodyMedium.copy(
                fontSize = 15.sp,
                color = MaterialTheme.colorScheme.onSurface,
            ),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            decorationBox = { field ->
                // A blank host title seeds an empty draft, which would otherwise
                // be an empty box with no hint of what belongs in it. Same
                // pattern, and the same label, as `ui/chat/ConversationHeader`.
                Box(contentAlignment = Alignment.CenterStart) {
                    if (draft.isEmpty()) {
                        Text(
                            stringResource(R.string.session_rename_label),
                            fontSize = 15.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    field()
                }
            },
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 8.dp)
                .height(44.dp)
                .clip(fieldShape)
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant, fieldShape)
                .padding(horizontal = 12.dp)
                .testTag(SESSION_RENAME_FIELD_TEST_TAG),
        )
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            ConfirmationButton(
                label = stringResource(R.string.common_cancel),
                containerColor = MaterialTheme.colorScheme.surfaceVariant,
                contentColor = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.weight(1f),
                onClick = onCancel,
            )
            ConfirmationButton(
                label = stringResource(R.string.session_rename_confirm),
                containerColor = if (submitEnabled) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.surfaceVariant
                },
                contentColor = if (submitEnabled) {
                    MaterialTheme.colorScheme.onPrimary
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
                modifier = Modifier.weight(1f),
                enabled = submitEnabled,
                onClick = onSave,
            )
        }
    }
}

/** A draft is worth sending when it says something new and fits the field. */
private fun renameSubmittable(draft: String, currentTitle: String): Boolean {
    val trimmed = draft.trim()
    return trimmed.isNotEmpty() &&
        trimmed != currentTitle.trim() &&
        trimmed.length <= SESSION_TITLE_MAX_LENGTH
}

@Composable
private fun ConfirmationButton(
    label: String,
    containerColor: androidx.compose.ui.graphics.Color,
    contentColor: androidx.compose.ui.graphics.Color,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Box(
        modifier = modifier
            .height(44.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(containerColor)
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = contentColor,
            fontSize = 14.sp,
            fontWeight = if (containerColor == MaterialTheme.colorScheme.error) {
                FontWeight.Medium
            } else {
                FontWeight.Normal
            },
            maxLines = 1,
        )
    }
}

@Composable
private fun ActionRow(
    @DrawableRes icon: Int,
    label: String,
    destructive: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val tint = if (destructive) {
        MaterialTheme.colorScheme.error
    } else {
        MaterialTheme.colorScheme.onSurfaceVariant
    }
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
            .heightIn(min = 46.dp)
            .padding(horizontal = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            painterResource(icon),
            contentDescription = null,
            tint = tint,
            // The source draws these at fontSize 19, a size up from a list
            // glyph: this sheet is where a session gets destroyed.
            modifier = Modifier.size(19.dp),
        )
        Text(
            label,
            fontSize = 15.sp,
            color = if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun ActionRow(
    @DrawableRes icon: Int,
    label: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    ActionRow(icon, label, destructive = false, modifier = modifier, onClick = onClick)
}

/**
 * The read-only facts about a session, ported from
 * `pages/components/SessionDetailsView.ets`.
 *
 * Every row is conditional on having something to say. A timestamp the desktop
 * never sent is left out rather than rendered as "unknown", which is the same
 * rule the list rows follow.
 *
 * Takes fields rather than the session for the reason [SessionActionSheet] does.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun SessionDetailsSheet(
    title: String,
    agentType: String,
    status: String,
    workspaceName: String?,
    workspacePath: String?,
    createdAt: String,
    updatedAt: String,
    messageCount: Int,
    placement: SettingsPlacement,
    onDismiss: () -> Unit,
) {
    val now = remember(createdAt, updatedAt) { System.currentTimeMillis() }
    val created = relativeTimeText(
        remember(createdAt, now) { SessionTimePresentation.relative(createdAt, now) },
    )
    val updated = relativeTimeText(
        remember(updatedAt, now) { SessionTimePresentation.relative(updatedAt, now) },
    )

    AdaptiveModalSurface(
        visible = true,
        placement = placement,
        onDismissRequest = onDismiss,
    ) { surfaceModifier ->
        Column(
            modifier = surfaceModifier
                .testTag(SESSION_DETAILS_TEST_TAG)
                .padding(start = 20.dp, end = 16.dp, bottom = 24.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        stringResource(R.string.session_details),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        title.ifBlank { stringResource(R.string.sidebar_untitled) },
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_close)) }
            }

            HorizontalDivider(modifier = Modifier.padding(top = 12.dp))

            Column(modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
                DetailRow(
                    stringResource(R.string.session_agent_type),
                    agentType.ifBlank { stringResource(R.string.common_unknown) },
                )
                workspaceName?.takeIf { it.isNotBlank() }?.let {
                    DetailRow(stringResource(R.string.session_workspace), it)
                }
                workspacePath?.takeIf { it.isNotBlank() }?.let {
                    PathRow(stringResource(R.string.session_workspace_path), it)
                }
                created?.let { DetailRow(stringResource(R.string.session_created_at), it) }
                updated?.let { DetailRow(stringResource(R.string.session_updated_at), it) }
                DetailRow(
                    stringResource(R.string.session_message_count),
                    messageCount.coerceAtLeast(0).toString(),
                )
                if (status.isNotBlank()) {
                    DetailRow(stringResource(R.string.session_status), statusText(status))
                }
            }
        }
    }
}

@Composable
private fun DetailRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.width(104.dp),
        )
        Text(
            value,
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.End,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
    }
    HorizontalDivider()
}

/**
 * A path gets its own full-width row and stays selectable.
 *
 * The source marks it `CopyOptions.LocalDevice` for the same reason: it is the
 * one value here a user needs somewhere else, and it is too long to retype.
 */
@Composable
private fun PathRow(label: String, value: String) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        SelectionContainer {
            Text(
                value,
                style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(6.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .padding(horizontal = 10.dp, vertical = 8.dp),
            )
        }
    }
    HorizontalDivider()
}
