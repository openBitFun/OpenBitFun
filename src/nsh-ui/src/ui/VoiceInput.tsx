// The composer's voice controls: the dictation button, the bar that shows what
// is being heard, and the voice-call entry. State and rules live in
// `voiceInputStore.ts`; this file only draws them.

import { Text, View } from "nsh";
import { tr } from "../i18n";
import { palette, radii, textLineHeight, textSize } from "../theme";
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
import { Icon } from "./icons";
import { MOTION_DURATION, paintTransition } from "./motion";
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
    <View style={{ flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 }}>
      <If when={voiceCallEnabled()}>
        <IconButton
          icon="waveform"
          size="sm"
          iconSize={15}
          accessibilityLabel="voice-call"
          tooltip={tr("voice.call")}
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
            gap: 10,
            marginHorizontal: 12,
            marginTop: 10,
            paddingHorizontal: 12,
            minHeight: 40,
            borderRadius: radii.lg,
            borderCurve: "continuous",
            backgroundColor: palette().surfaceSubtle,
          }}
        >
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              flexShrink: 0,
              backgroundColor: voicePhase() === "listening" ? palette().danger : palette().textMuted,
              ...paintTransition(MOTION_DURATION.fast),
            }}
          />
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
            onPress={cancelVoiceInput}
          />
          <Button
            label={tr("voice.insert")}
            variant="secondary"
            size="xs"
            accessibilityLabel="voice-insert"
            disabled={voicePhase() === "finishing"}
            onPress={() => finishVoiceInput(text => props.actions.insert(text))}
          />
          <Button
            label={tr("voice.send")}
            variant="primary"
            size="xs"
            accessibilityLabel="voice-send"
            disabled={voicePhase() === "finishing" || props.actions.disabled()}
            onPress={() => finishVoiceInput(text => props.actions.send(text))}
          />
        </View>
      </If>
      <If when={voicePhase() === "idle" && voiceNotice() ? voiceNotice() : ""}>
        {notice => (
          <View
            accessibilityLabel="voice-notice"
            style={{ flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginTop: 10 }}
          >
            <Icon name="info" size={14} color={palette().warning} />
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
              size="xs"
              accessibilityLabel="voice-notice-dismiss"
              tooltip={tr("common.dismiss")}
              onPress={() => voiceNotice.set("")}
            />
          </View>
        )}
      </If>
    </>
  );
}
