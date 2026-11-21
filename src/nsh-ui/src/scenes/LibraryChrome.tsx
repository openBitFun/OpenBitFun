// The Library page column (visual spec §4.8) shared by the Library scene and
// the five scenes it hosts (Assistants, Agents, Skills, Spaces, Routines). A
// hosted scene drops its own title, subtitle and KPI rows and draws only its
// toolbar (search, filters and its one primary button) and its body in this
// column. Kept apart from `LibraryScene.tsx`, which imports the five scenes.

import { View, type JSX, type ViewStyle } from "nsh";
import { layout, space } from "../theme";
import { studioCompact } from "../ui/studio";

/** Gallery pages (Spaces) may widen the column to this. */
export const LIBRARY_GALLERY_WIDTH = 960;

/** Page gutter: 32, 16 on a phone-sized scene. */
export function libraryGutter(): number {
  return studioCompact() ? layout.phoneGutter : layout.pageGutter;
}

/** The centred page column: 720 (960 for a gallery) plus its gutters. */
export function libraryColumnStyle(wide = false): ViewStyle {
  const gutter = libraryGutter();
  return {
    width: "100%",
    maxWidth: (wide ? LIBRARY_GALLERY_WIDTH : layout.pageWidth) + gutter * 2,
    alignSelf: "center",
    paddingHorizontal: gutter,
  };
}

/** `StudioBody` style for a hosted scene: the Library column, sections 32 apart. */
export function libraryBodyStyle(wide = false): ViewStyle {
  return { ...libraryColumnStyle(wide), paddingBottom: space.x5l, gap: layout.sectionGap };
}

/**
 * The hosted scene's toolbar: 24 under the Library header, then its search
 * and filters on the left and its one primary button on the right, 16 above
 * the rows.
 */
export function LibraryToolbar(props: {
  leading?: JSX.Element;
  primary?: JSX.Element;
  wide?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <View
      accessibilityLabel={props.accessibilityLabel}
      style={{
        ...libraryColumnStyle(props.wide),
        paddingTop: layout.titleToSection,
        paddingBottom: space.lg,
        flexDirection: "row",
        alignItems: "center",
        flexWrap: studioCompact() ? "wrap" : "nowrap",
        gap: space.sm,
      }}
    >
      <View
        style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm }}
      >
        {props.leading}
      </View>
      <If when={Boolean(props.primary)}>
        <View style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: space.sm }}>
          {props.primary}
        </View>
      </If>
    </View>
  );
}
