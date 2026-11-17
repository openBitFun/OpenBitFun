package com.openbitfun.mobile.app.ui.chat.message

import android.provider.Settings
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.openbitfun.mobile.app.R
import com.openbitfun.mobile.app.ui.theme.OpenBitFunEaseInOut
import com.openbitfun.mobile.app.ui.theme.openBitFunColors

internal const val SUBAGENT_AVATAR_TEST_TAG: String = "subagent-avatar"
internal const val SUBAGENT_STATE_TEST_TAG: String = "subagent-state"
internal const val SUBAGENT_STATE_MARK_TEST_TAG: String = "subagent-state-mark"
internal const val SUBAGENT_STATE_LABEL_TEST_TAG: String = "subagent-state-label"

/**
 * Forces the reduced-motion reading for a composition, for fixtures and tests.
 *
 * Null means "ask the platform", which is what every production surface does.
 */
internal val LocalReduceMotionOverride = staticCompositionLocalOf<Boolean?> { null }

/**
 * Whether the reader asked the system to remove animations.
 *
 * The window recomposer already scales finite Compose animations by this setting,
 * but the pulse below never ends, so a zero scale would leave it parked at
 * whichever value it happened to reach rather than stopping it. Reading the scale
 * once per composition is what turns the pulse off outright. A change to the
 * setting is picked up the next time a card is composed, which is when it matters.
 */
@Composable
internal fun rememberReduceMotion(): Boolean {
    val context = LocalContext.current
    return remember(context) {
        runCatching {
            Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
        }.getOrDefault(false)
    }
}

/**
 * A worker's identity, drawn: one glyph on one semantic tint.
 *
 * Ported in spirit from the desktop's `SubagentAvatar` — the same worker keeps the
 * same face — without its authored artwork: a phone card is 24dp and this client
 * has no brand SVGs of its own, so the identity is composed from existing symbol
 * assets and existing colour roles. It is decorative: the card's title already
 * names the worker, and a screen reader that read the avatar too would say it
 * twice.
 */
@Composable
internal fun SubagentAvatar(identity: SubagentIdentity, modifier: Modifier = Modifier) {
    val tint = subagentIdentityTint(identity.tint)
    val shape = RoundedCornerShape(6.dp)
    Box(
        modifier = modifier
            .size(24.dp)
            .testTag(SUBAGENT_AVATAR_TEST_TAG)
            // A tinted field rather than a solid one: the glyph has to stay legible
            // in both themes, and the card behind it is the only thing composited.
            .background(tint.copy(alpha = IDENTITY_FILL_ALPHA), shape)
            .border(1.dp, tint.copy(alpha = IDENTITY_LINE_ALPHA), shape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            painter = painterResource(SUBAGENT_GLYPHS[identity.glyph % SUBAGENT_GLYPHS.size]),
            contentDescription = null,
            tint = tint,
            modifier = Modifier.size(15.dp),
        )
    }
}

/**
 * The worker's lifecycle, drawn next to its name.
 *
 * The word carries the state and the mark reinforces it: the palette's own status
 * greens and ambers are below the 3:1 a graphic needs against the light card, so
 * nothing here is legible by colour alone. A worker that is still taking its turn
 * pulses; one that is finishing keeps its pulse in a ring; one that is queued,
 * done, cancelled, failed, or unknown holds still. The pulse is the only moving
 * pixel on the card, and it is drawn inside its own 10dp box, so a frame captured
 * a second later differs there and nowhere else.
 */
@Composable
internal fun SubagentStateChip(liveness: SubagentLiveness, modifier: Modifier = Modifier) {
    val reduceMotion = LocalReduceMotionOverride.current ?: rememberReduceMotion()
    val color = subagentStateColor(liveness)
    val pulse = liveness.inFlight && !reduceMotion
    Row(
        modifier = modifier.testTag(SUBAGENT_STATE_TEST_TAG),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // One fixed box for every reading, so the six marks are the same size and
        // can be compared, captured, and swapped without moving the row.
        Box(
            modifier = Modifier.size(MARK_SIZE).testTag(SUBAGENT_STATE_MARK_TEST_TAG),
            contentAlignment = Alignment.Center,
        ) {
            when (liveness) {
                // A shape, not a dot: a terminal state is not a heartbeat.
                SubagentLiveness.COMPLETED -> StateGlyph(R.drawable.ic_symbol_checkmark_circle_fill, color)
                SubagentLiveness.ERROR -> StateGlyph(R.drawable.ic_symbol_xmark, color)
                SubagentLiveness.UNKNOWN -> StateGlyph(R.drawable.ic_symbol_questionmark_circle, color)
                else -> StateDot(
                    color = color,
                    ring = liveness == SubagentLiveness.FINISHING || liveness == SubagentLiveness.CANCELLED,
                    pulsing = pulse,
                )
            }
        }
        Text(
            stringResource(subagentStateLabel(liveness)),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = if (liveness.inFlight) FontWeight.Medium else FontWeight.Normal,
            color = subagentStateLabelColor(liveness),
            modifier = Modifier.testTag(SUBAGENT_STATE_LABEL_TEST_TAG),
        )
    }
}

@Composable
private fun StateGlyph(icon: Int, tint: Color) {
    Icon(
        painter = painterResource(icon),
        contentDescription = null,
        tint = tint,
        modifier = Modifier.size(12.dp),
    )
}

@Composable
private fun StateDot(color: Color, ring: Boolean, pulsing: Boolean) {
    // The pulse runs from the composition's own clock, never from data: no state
    // is re-read, no command is sent, and the value dies with the card.
    val pulse = if (pulsing) {
        val transition = rememberInfiniteTransition(label = "subagent-state")
        val value by transition.animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(PULSE_MS, easing = OpenBitFunEaseInOut),
                repeatMode = RepeatMode.Reverse,
            ),
            label = "subagent-state-pulse",
        )
        value
    } else {
        1f
    }
    val mark = if (ring) {
        Modifier.border(1.5.dp, color, CircleShape)
    } else {
        Modifier.background(color, CircleShape)
    }
    Box(
        modifier = Modifier
            .size(DOT_SIZE)
            .graphicsLayer {
                // Inside the dot's own bounds, so the pulse can never move a
                // neighbour or push the row's layout around.
                scaleX = PULSE_MIN_SCALE + (1f - PULSE_MIN_SCALE) * pulse
                scaleY = scaleX
                alpha = PULSE_MIN_ALPHA + (1f - PULSE_MIN_ALPHA) * pulse
            }
            .then(mark),
    )
}

@Composable
private fun subagentIdentityTint(index: Int): Color = when (index % SUBAGENT_TINT_COUNT) {
    0 -> MaterialTheme.colorScheme.tertiary
    1 -> MaterialTheme.colorScheme.onSurface
    else -> MaterialTheme.colorScheme.onSurfaceVariant
}

@Composable
private fun subagentStateColor(liveness: SubagentLiveness): Color = when (liveness) {
    SubagentLiveness.RUNNING, SubagentLiveness.FINISHING -> openBitFunColors.statusSuccess
    SubagentLiveness.WAITING -> openBitFunColors.statusWarning
    SubagentLiveness.COMPLETED -> MaterialTheme.colorScheme.tertiary
    SubagentLiveness.CANCELLED -> MaterialTheme.colorScheme.onSurfaceVariant
    SubagentLiveness.ERROR -> MaterialTheme.colorScheme.error
    SubagentLiveness.UNKNOWN -> MaterialTheme.colorScheme.outline
}

/**
 * The word for a reading, in the reader's language.
 *
 * Reuses the phase words the rest of the surface already speaks with, so "Running"
 * means the same thing on a card as on the tool row inside it.
 */
private fun subagentStateLabel(liveness: SubagentLiveness): Int = when (liveness) {
    SubagentLiveness.RUNNING -> R.string.tool_phase_running
    SubagentLiveness.FINISHING -> R.string.subagent_state_finishing
    SubagentLiveness.WAITING -> R.string.tool_phase_waiting
    SubagentLiveness.COMPLETED -> R.string.tool_phase_completed
    SubagentLiveness.CANCELLED -> R.string.tool_phase_cancelled
    SubagentLiveness.ERROR -> R.string.tool_phase_failed
    SubagentLiveness.UNKNOWN -> R.string.subagent_state_unknown
}

/**
 * The label's colour.
 *
 * In-flight readings are inked rather than tinted: the palette's status colours do
 * not reach the 4.5:1 small text needs on the light card, and a status a reader
 * cannot read is worse than one they have to look at twice.
 */
@Composable
private fun subagentStateLabelColor(liveness: SubagentLiveness): Color = when (liveness) {
    SubagentLiveness.RUNNING, SubagentLiveness.FINISHING -> MaterialTheme.colorScheme.onSurface
    SubagentLiveness.ERROR -> MaterialTheme.colorScheme.error
    else -> MaterialTheme.colorScheme.onSurfaceVariant
}

/**
 * The worker glyphs, in the order [subagentIdentity] indexes them.
 *
 * Existing symbol assets, not new artwork: a delegated worker is a robot, a
 * person, code, a tool, or a stack of steps, and which one a card gets is derived
 * from its own key rather than from what the worker happens to be doing.
 */
private val SUBAGENT_GLYPHS = intArrayOf(
    R.drawable.ic_symbol_robot,
    R.drawable.ic_symbol_person,
    R.drawable.ic_symbol_code_square,
    R.drawable.ic_symbol_wrench_and_screwdriver,
    R.drawable.ic_symbol_rectangle_stack,
)

private const val IDENTITY_FILL_ALPHA = 0.12f
private const val IDENTITY_LINE_ALPHA = 0.30f
private val MARK_SIZE = 12.dp
private val DOT_SIZE = 8.dp
private const val PULSE_MS = 900
private const val PULSE_MIN_SCALE = 0.62f
private const val PULSE_MIN_ALPHA = 0.45f
