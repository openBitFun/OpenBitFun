// The composer's voice controls: the dictation button, the bar that shows what
// is being heard, and the voice-call entry. State and rules live in
// `voiceInputStore.ts`; this file only draws them.

import { Text, View } from "nsh";
import { tr } from "../i18n";
import { compactLayout, controlHeight, layout, palette, radii, space, textLineHeight, textSize } from "../theme";
import {
  cancelVoiceInput,
  explainVoiceCallUnsupported,
  finishVoiceInput,
  startVoiceInput,
  voiceCallEnabled,
  voiceInputEnabled,
  voiceNotice,
  voicePhase,
  voiceRecognizerAvailable,
  voiceTranscript,
} from "../voiceInputStore";
import { StateMark } from "./fleet";
import { Icon } from "./icons";
import { Button, IconButton } from "./primitives";

export interface VoiceComposerActions {
  /** Puts the transcript into the composer at its end. */
  insert(text: string): void;
  /** Puts the transcript into the composer and sends it. */
  send(text: string): void;
  /** Whether the composer accepts input now. */
  disabled(): boolean;
}

/** The microphone button (and the voice-call button when calls are on). */
export function VoiceInputButtons(props: { actions: VoiceComposerActions }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.hair, flexShrink: 0 }}>
      <If when={voiceCallEnabled()}>
        <IconButton
          icon="waveform"
          size="sm"
          iconSize={15}
          accessibilityLabel="voice-call"
          tooltip={tr("voice.call")}
          style={compactLayout() ? { width: layout.touchTarget, height: layout.touchTarget } : undefined}
          onPress={explainVoiceCallUnsupported}
        />
      </If>
      <If when={voiceInputEnabled()}>
        <IconButton
          icon="mic"
          size="sm"
          iconSize={15}
          active={voicePhase() !== "idle"}
          disabled={props.actions.disabled()}
          accessibilityLabel="voice-input"
          tooltip={voiceRecognizerAvailable() === false ? tr("voice.unavailable") : tr("voice.dictate")}
          style={compactLayout() ? { width: layout.touchTarget, height: layout.touchTarget } : undefined}
          onPress={() => {
            if (voicePhase() === "idle") startVoiceInput(text => props.actions.insert(text));
            else finishVoiceInput(text => props.actions.insert(text));
          }}
        />
      </If>
    </View>
  );
}

/**
 * Shown above the editor while dictating: what has been heard so far, and the
 * three ways out (cancel, insert, send). After a failed attempt it carries the
 * reason instead, until dismissed or the next attempt.
 */
export function VoiceDictationBar(props: { actions: VoiceComposerActions }) {
  return (
    <>
      <If when={voicePhase() !== "idle"}>
        <View
          accessibilityLabel="voice-dictation"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            marginHorizontal: space.md,
            marginTop: space.sm,
            paddingHorizontal: space.md,
            minHeight: compactLayout() ? layout.touchTarget : controlHeight.lg,
            borderRadius: radii.lg,
            borderCurve: "continuous",
            backgroundColor: palette().surfaceSubtle,
          }}
        >
          <StateMark state={voicePhase() === "listening" ? "working" : "idle"} size={12} />
          <Text
            style={{
              flex: 1,
              minWidth: 0,
              color: voiceTranscript() ? palette().text : palette().textSecondary,
              fontSize: textSize(13),
              lineHeight: textLineHeight(13, 1.45),
              numberOfLines: 2,
              textOverflow: "ellipsis",
            }}
          >
            {voiceTranscript() ||
              (voicePhase() === "starting"
                ? tr("voice.starting")
                : voicePhase() === "finishing"
                  ? tr("voice.finishing")
                  : tr("voice.listening"))}
          </Text>
          <IconButton
            icon="close"
            size="sm"
            accessibilityLabel="voice-cancel"
            tooltip={tr("voice.cancel")}
            style={compactLayout() ? { width: layout.touchTarget, height: layout.touchTarget } : undefined}
            onPress={cancelVoiceInput}
          />
          <Button
            label={tr("voice.insert")}
            variant="secondary"
            size="sm"
            accessibilityLabel="voice-insert"
            disabled={voicePhase() === "finishing"}
            style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
            onPress={() => finishVoiceInput(text => props.actions.insert(text))}
          />
          <Button
            label={tr("voice.send")}
            variant="primary"
            size="sm"
            accessibilityLabel="voice-send"
            disabled={voicePhase() === "finishing" || props.actions.disabled()}
            style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
            onPress={() => finishVoiceInput(text => props.actions.send(text))}
          />
        </View>
      </If>
      <If when={voicePhase() === "idle" && voiceNotice() ? voiceNotice() : ""}>
        {notice => (
          <View
            accessibilityLabel="voice-notice"
            style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginHorizontal: space.lg, marginTop: space.sm }}
          >
            <Icon name="info" size={14} color={palette().textMuted} />
            <Text
              style={{
                flex: 1,
                minWidth: 0,
                color: palette().textSecondary,
                fontSize: textSize(12),
                lineHeight: textLineHeight(12, 1.45),
              }}
            >
              {notice()}
            </Text>
            <IconButton
              icon="close"
              size="sm"
              accessibilityLabel="voice-notice-dismiss"
              tooltip={tr("common.dismiss")}
              style={compactLayout() ? { width: layout.touchTarget, height: layout.touchTarget } : undefined}
              onPress={() => voiceNotice.set("")}
            />
          </View>
        )}
      </If>
    </>
  );
}
