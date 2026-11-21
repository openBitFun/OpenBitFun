// The shared atoms of `ui/fleet.tsx`, `ui/jobs.tsx`, `ui/attention.tsx` and the
// re-valued primitives on one page, for `test/foundations-atoms.test.tsx`.
// The shell loads its stores before the primitives (which read `state.ts`); keep that order.
import "../../src/agentEvents";
import { Scroll, Text, View, mount } from "nsh";
import { currentLocale } from "../../src/i18n";
import { compactLayout, palette, space, textStyle } from "../../src/theme";
import { AttentionItem } from "../../src/ui/attention";
import { DeviceBadge, DeviceGlyph, StateMark, StateLabel, type MarkState } from "../../src/ui/fleet";
import { CitationChip } from "../../src/ui/jobs";
import { Button, EmptyStateCard, StatusDot } from "../../src/ui/primitives";

const STATES: MarkState[] = ["working", "needs_you", "done", "failed", "idle", "stopped", "queued", "waiting", "thinking"];

const LONG_REQUEST = ["Run the migration", "on the staging database", "then restart the workers", "and report the row counts"].join("\n");

function Gallery() {
  return (
    <Scroll style={{ flex: 1, backgroundColor: palette().canvas }}>
      <View style={{ padding: space.lg, gap: space.md }}>
        <Text style={textStyle("pageTitle")}>Foundations</Text>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button label="Use compact" onPress={() => compactLayout.set(true)} />
          <Button label="Use Chinese" onPress={() => currentLocale.set("zh-CN")} />
          <Button label="Tip button" tooltip="Gallery tip" onPress={() => undefined} />
        </View>
        <Each of={STATES} key={state => state}>
          {state => <StateMark testID={`mark-${state()}`} state={state()} withWord device="linux-box" />}
        </Each>
        <StateMark testID="mark-done-seen" state="done" seen withWord />
        <StateLabel testID="label-working" state="working" detail="2 min" />
        <DeviceBadge testID="badge-offline" name="linux-box" kind="cli" exception="offline" exceptionDetail="3 h ago" />
        <DeviceBadge testID="badge-update" name="mac-mini" kind="desktop" exception="update_required" />
        <DeviceBadge testID="badge-healthy" name="studio-mac" kind="laptop" />
        <View testID="glyph-idle">
          <DeviceGlyph kind="laptop" size={34} status="idle" active />
        </View>
        <StatusDot testID="dot-solid" kind="accent" size={8} />
        <StatusDot testID="dot-ring" kind="muted" size={8} variant="ring" />
        <StatusDot testID="dot-half" kind="warning" size={8} variant="half" />
        <CitationChip testID="cite" label="Build release 1.2" device="linux-box" onPress={() => undefined} />
        <AttentionItem
          testID="attention-open"
          device={{ name: "linux-box", kind: "cli" }}
          source="Fix flaky test"
          age="2 min"
          request={LONG_REQUEST}
          command="cargo test --workspace"
          actions={<Button label="Allow once" variant="primary" size="sm" onPress={() => undefined} />}
          onOpen={() => undefined}
        />
        <AttentionItem
          testID="attention-answered"
          source="Docs pass"
          request="Overwrite README.md?"
          actions={<Button label="Allow twice" variant="primary" size="sm" onPress={() => undefined} />}
          answered="Answered on linux-box"
        />
        <AttentionItem
          testID="attention-blocked"
          source="Release notes"
          request="Push the tag?"
          actions={<Button label="Allow thrice" variant="primary" size="sm" onPress={() => undefined} />}
          unanswerableReason="Update OpenBitFun on linux-box to answer here."
          onOpen={() => undefined}
        />
        <EmptyStateCard icon="inbox" title="Nothing needs you" subtitle="Requests from your devices show up here." />
      </View>
    </Scroll>
  );
}

mount(Gallery);
