// The companion pet as the desktop draws it (tauri-gap §1.5, §4.4): one
// sprite cell of a Petdex spritesheet, animated along the row of the fleet's
// attention state, in its own transparent floating window
// (`desktopPresence.ts`) and as a still preview in Settings › Pet.
//
// Everything it shows comes from `companionStore.ts`; colors come only from
// the palette (the selection ring), the pet itself is its artwork.

import { cleanup, effect, Image, lifecycle, reduceMotion, signal, Text, untracked, View } from "nsh";
import { Menu } from "nsh/desktop";
import {
  companionBusy,
  companionEnabled,
  companionPets,
  deleteCompanionPet,
  loadPetSheet,
  PET_COLUMNS,
  PET_FRAME_MS,
  PET_ROW_FRAMES,
  petRowFor,
  petRows,
  petSheetErrors,
  petSheets,
  petState,
  selectCompanionPet,
  selectedPet,
  type CompanionPet,
} from "../companionStore";
import { tr } from "../i18n";
import { compactLayout, palette, radii, space, textStyle, touchSlop } from "../theme";
import { stateWord, type MarkState } from "./fleet";
import { Icon } from "./icons";
import { pressTransition, tactileActiveStyle } from "./motion";
import { focusRingStyle, InlineConfirmBar, SkeletonBlock, TooltipBubble } from "./primitives";
import { MoreMenu } from "./studio";

/** Petdex cells are 192 × 208; a sheet whose size is unknown yet uses that shape. */
const DEFAULT_CELL_ASPECT = 192 / 208;
const PET_TILE_WIDTH = space.x6l + space.x4l + space.sm;
const PET_PREVIEW_HEIGHT = space.x5l + space.sm;

export interface PetSpriteProps {
  pet: CompanionPet;
  /** The row's state; a still preview passes `null` (rest pose, first frame). */
  state: MarkState | null;
  /** The cell's height in points. */
  height: number;
  /**
   * Whether to fetch and decode the full spritesheet right now (default `true`).
   * Unselected tiles in the character grid pass `false` so opening Settings › Pet
   * does not decode all 14 sheets (~190 MB of RGBA bitmaps) at once.
   */
  load?: boolean;
}

/** Keeps only the requested spritesheet paths in `petSheets` so unused bitmaps can be freed. */
function retainPetSheets(keepPaths: ReadonlySet<string>): void {
  const current = petSheets();
  const keys = Object.keys(current);
  if (keys.every(path => keepPaths.has(path))) return;
  const next: Record<string, string> = {};
  for (const path of keys) {
    if (keepPaths.has(path)) next[path] = current[path];
  }
  petSheets.set(next);
}

/** One cell of the pet's spritesheet, stepping through its row's frames. */
export function PetSprite(props: PetSpriteProps) {
  const shouldLoad = () => props.load !== false;
  const sheet = () => (shouldLoad() ? (petSheets()[props.pet.spritesheetPath] ?? "") : "");
  const failed = () => (shouldLoad() ? (petSheetErrors()[props.pet.spritesheetPath] ?? "") : "");
  const aspect = signal(DEFAULT_CELL_ASPECT);
  const frame = signal(0);
  const rows = () => petRows(props.pet.spriteVersionNumber);
  const row = () => (props.state ? petRowFor(props.state) : 0);
  const width = () => Math.round(props.height * aspect());

  effect(() => {
    if (!shouldLoad()) return;
    const path = props.pet.spritesheetPath;
    untracked(() => void loadPetSheet(path));
  });
  effect(() => {
    const src = sheet();
    if (!src) return;
    void Image.getSize(src)
      .then(size => {
        if (size.width > 0 && size.height > 0) aspect.set(size.width / PET_COLUMNS / (size.height / rows()));
      })
      .catch(() => undefined);
  });
  // Animated rows only; freeze at frame 0 for still previews, idle rest state, reduced motion, or hidden windows.
  effect(() => {
    if (props.state === null || props.state === "idle" || reduceMotion() || lifecycle() === "background") {
      frame.set(0);
      return;
    }
    const frames = PET_ROW_FRAMES[row()] ?? 1;
    frame.set(0);
    const timer = setInterval(() => frame.set((frame() + 1) % frames), PET_FRAME_MS);
    cleanup(() => clearInterval(timer));
  });

  return (
    <View
      testID={`pet-${props.pet.id}-${props.state ?? "still"}`}
      accessibilityLabel={`pet-sprite-${props.pet.id}`}
      accessibilityValue={{ text: props.state ? stateWord(props.state) : "" }}
      style={{ width: width(), height: props.height, overflow: "hidden" }}
    >
      <If when={sheet()}>
        {src => (
          <Image
            src={src()}
            style={{
              position: "absolute",
              left: -frame() * width(),
              top: -row() * props.height,
              width: width() * PET_COLUMNS,
              height: props.height * rows(),
            }}
          />
        )}
      </If>
      <If when={shouldLoad() && !sheet() && !failed()}>
        <SkeletonBlock width={width()} height={props.height} borderRadius={radii.sm} />
      </If>
      <If when={!shouldLoad() || (!sheet() && failed())}>
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radii.sm,
            backgroundColor: palette().surfaceTertiary,
          }}
        >
          <Icon name="bot" size={20} color={palette().textMuted} />
        </View>
      </If>
    </View>
  );
}

export interface PetWindowContentProps {
  pet: CompanionPet;
  height: number;
  /** A press on the pet: the main window and the Inbox. */
  onOpen: () => void;
  onHide: () => void;
  onSettings: () => void;
}

/**
 * The pet window's content: the pet on a transparent ground. Its edge drags
 * the window; a press on the pet opens the Inbox; the context menu hides it or
 * opens its settings.
 */
export function PetWindowContent(props: PetWindowContentProps) {
  return (
    <View
      desktop={{ windowDrag: true }}
      accessibilityLabel="pet-window"
      onContextMenu={event =>
        void Menu.popup(
          [
            { label: tr("pet.openInbox"), onSelect: () => props.onOpen() },
            { type: "separator" },
            { label: tr("pet.hide"), onSelect: () => props.onHide() },
            { label: tr("pet.settings"), onSelect: () => props.onSettings() },
          ],
          event.pagePosition,
        )
      }
      style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.md, backgroundColor: "transparent" }}
    >
      <View
        role="button"
        accessibilityLabel="pet-open-inbox"
        hitSlop={touchSlop(props.height)}
        tooltip={compactLayout() ? undefined : <TooltipBubble text={stateWord(petState())} />}
        onPress={() => props.onOpen()}
        activeStyle={tactileActiveStyle(0.96)}
        focusVisibleStyle={focusRingStyle()}
        style={{
          borderRadius: radii.md,
          cursor: "pointer",
          userSelect: "none",
          ...pressTransition(120),
        }}
      >
        <PetSprite pet={props.pet} state={petState()} height={props.height} />
      </View>
    </View>
  );
}

/** Settings › Pet: the characters to pick from, the chosen one ringed. */
export function PetCharacterGrid() {
  const pendingDelete = signal<CompanionPet | null>(null);
  const previewPath = signal<string | null>(null);
  const busy = () => companionBusy() !== null;
  const isSelected = (pet: CompanionPet) => {
    const current = selectedPet();
    return Boolean(current && (current.spritesheetPath === pet.spritesheetPath || (current.id === pet.id && current.source === pet.source)));
  };
  // Keep at most the selected pet (and at most one hovered preview) decoded in memory.
  effect(() => {
    const keep = new Set<string>();
    const chosen = selectedPet()?.spritesheetPath;
    if (chosen) keep.add(chosen);
    const hovered = previewPath();
    if (hovered) keep.add(hovered);
    untracked(() => retainPetSheets(keep));
  });
  cleanup(() => {
    const keep = new Set<string>();
    const chosen = selectedPet()?.spritesheetPath;
    if (companionEnabled() !== false && chosen) keep.add(chosen);
    retainPetSheets(keep);
  });
  return (
    <View style={{ gap: space.sm }}>
      <If when={companionPets() === null}>
        <View accessibilityLabel="pet-characters-loading" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          <SkeletonBlock width={PET_TILE_WIDTH} height={space.x6l + space.xxl} borderRadius={radii.md} />
          <SkeletonBlock width={PET_TILE_WIDTH} height={space.x6l + space.xxl} borderRadius={radii.md} />
          <SkeletonBlock width={PET_TILE_WIDTH} height={space.x6l + space.xxl} borderRadius={radii.md} />
        </View>
      </If>
      <If when={companionPets() !== null && (companionPets() ?? []).length === 0}>
        <Text accessibilityLabel="pet-characters-empty" style={textStyle("caption")}>
          {tr("common.none")}
        </Text>
      </If>
      <If when={(companionPets() ?? []).length > 0}>
        <View accessibilityLabel="pet-characters" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          <Each of={companionPets() ?? []} key={pet => `${pet.source}:${pet.packagePath}`}>
            {pet => (
              <View
                style={{
                  position: "relative",
                  width: PET_TILE_WIDTH,
                  borderRadius: radii.md,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: isSelected(pet()) ? palette().borderFocus : palette().borderSubtle,
                  backgroundColor: isSelected(pet()) ? palette().accentSoft : palette().panelRaised,
                  opacity: busy() ? 0.45 : 1,
                }}
              >
                <View
                  role="radio"
                  accessibilityLabel={`pet-choose-${pet().id}`}
                  accessibilityState={{ selected: isSelected(pet()), disabled: busy() }}
                  disabled={busy()}
                  tooltip={compactLayout() ? undefined : <TooltipBubble text={pet().displayName} />}
                  onMouseEnter={() => {
                    if (!compactLayout()) previewPath.set(pet().spritesheetPath);
                  }}
                  onMouseLeave={() => {
                    if (previewPath() === pet().spritesheetPath) previewPath.set(null);
                  }}
                  onPress={() => {
                    if (busy()) return;
                    void selectCompanionPet(pet());
                  }}
                  hoverStyle={busy() || compactLayout() ? undefined : { backgroundColor: palette().panelHover }}
                  activeStyle={busy() ? undefined : tactileActiveStyle(0.97)}
                  focusVisibleStyle={focusRingStyle()}
                  style={{
                    alignItems: "center",
                    gap: space.xs,
                    padding: space.sm,
                    borderRadius: radii.md,
                    cursor: busy() ? "default" : "pointer",
                    userSelect: "none",
                    ...pressTransition(120),
                  }}
                >
                  <PetSprite
                    pet={pet()}
                    state={null}
                    height={PET_PREVIEW_HEIGHT}
                    load={isSelected(pet()) || previewPath() === pet().spritesheetPath}
                  />
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.xs, alignSelf: "stretch", minWidth: 0 }}>
                    <If when={isSelected(pet())}>
                      <Icon name="check" size={12} color={palette().textSecondary} />
                    </If>
                    <Text
                      style={{
                        ...textStyle("caption", { color: isSelected(pet()) ? palette().text : palette().textSecondary }),
                        fontWeight: isSelected(pet()) ? "600" : "400",
                        flexShrink: 1,
                        minWidth: 0,
                        textAlign: "center",
                        numberOfLines: 1,
                        textOverflow: "ellipsis",
                      }}
                    >
                      {pet().displayName}
                    </Text>
                  </View>
                </View>
                <If when={pet().source !== "builtin"}>
                  <View style={{ position: "absolute", top: space.xs, right: space.xs }}>
                    <MoreMenu
                      size="xs"
                      accessibilityLabel={`pet-menu-${pet().id}`}
                      items={[
                        {
                          id: "delete",
                          label: tr("pet.delete"),
                          icon: "trash",
                          danger: true,
                          disabled: busy(),
                          accessibilityLabel: `pet-delete-${pet().id}`,
                          onSelect: () => pendingDelete.set(pet()),
                        },
                      ]}
                    />
                  </View>
                </If>
              </View>
            )}
          </Each>
        </View>
      </If>
      <If when={pendingDelete()}>
        {target => (
          <InlineConfirmBar
            danger
            message={target().displayName}
            confirmLabel={tr("pet.delete")}
            cancelLabel={tr("common.cancel")}
            onConfirm={() => {
              const current = target();
              pendingDelete.set(null);
              void deleteCompanionPet(current);
            }}
            onCancel={() => pendingDelete.set(null)}
          />
        )}
      </If>
    </View>
  );
}
