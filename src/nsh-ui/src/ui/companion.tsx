// The companion pet as the desktop draws it (tauri-gap §1.5, §4.4): one
// sprite cell of a Petdex spritesheet, animated along the row of the fleet's
// attention state, in its own transparent floating window
// (`desktopPresence.ts`), and every pet as a still in Settings › Pet. The
// stills come from the backend, so the picker never decodes a spritesheet.
//
// Everything it shows comes from `companionStore.ts`; colors come only from
// the palette (the selection ring), the pet itself is its artwork.

import { cleanup, effect, Image, reduceMotion, signal, Text, untracked, View } from "nsh";
import { Menu } from "nsh/desktop";
import {
  companionBusy,
  companionPets,
  deleteCompanionPet,
  loadPetSheet,
  loadPetStill,
  PET_COLUMNS,
  PET_FRAME_MS,
  PET_ROW_FRAMES,
  petRowFor,
  petRows,
  petSheetErrors,
  petSheets,
  petState,
  petStillErrors,
  petStills,
  selectCompanionPet,
  selectedPet,
  type CompanionPet,
} from "../companionStore";
import { tr } from "../i18n";
import { compactLayout, palette, radii, space, textStyle, touchSlop } from "../theme";
import { stateWord, type MarkState } from "./fleet";
import { Icon } from "./icons";
import { pressTransition, tactileActiveStyle } from "./motion";
import { focusRingStyle, SkeletonBlock, TooltipBubble } from "./primitives";
import { MoreMenu } from "./studio";

/** Petdex cells are 192 × 208; a sheet whose size is unknown yet uses that shape. */
const DEFAULT_CELL_ASPECT = 192 / 208;
const PET_TILE_WIDTH = space.x6l + space.x4l + space.sm;
const PET_PREVIEW_HEIGHT = space.x5l + space.sm;

/** A pet's picture before it arrives (skeleton) and when it cannot (the glyph). */
function PetPicturePlaceholder(props: { width: number; height: number; failed: boolean }) {
  return (
    <If when={props.failed} else={<SkeletonBlock width={props.width} height={props.height} borderRadius={radii.sm} />}>
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
  );
}

/**
 * A pet's rest pose for a tile: the backend's small still, read when the tile
 * mounts. What a tile shows never depends on hover or selection.
 */
function PetStill(props: { pet: CompanionPet; height: number }) {
  const src = () => petStills()[props.pet.packagePath] ?? "";
  const width = () => Math.round(props.height * DEFAULT_CELL_ASPECT);
  effect(() => {
    const path = props.pet.packagePath;
    untracked(() => void loadPetStill(path));
  });
  return (
    <View
      testID={`pet-${props.pet.id}-still`}
      accessibilityLabel={`pet-sprite-${props.pet.id}`}
      style={{ width: width(), height: props.height, overflow: "hidden" }}
    >
      <If
        when={src()}
        else={
          <PetPicturePlaceholder
            width={width()}
            height={props.height}
            failed={Boolean(petStillErrors()[props.pet.packagePath])}
          />
        }
      >
        {still => (
          <Image
            src={still()}
            accessibilityLabel={`pet-still-image-${props.pet.id}`}
            style={{ width: width(), height: props.height, objectFit: "contain" }}
          />
        )}
      </If>
    </View>
  );
}

export interface PetSpriteProps {
  pet: CompanionPet;
  /** The row's state. */
  state: MarkState;
  /** The cell's height in points. */
  height: number;
}

/** One cell of the pet's spritesheet, stepping through its row's frames. */
export function PetSprite(props: PetSpriteProps) {
  const sheet = () => petSheets()[props.pet.spritesheetPath] ?? "";
  const aspect = signal(DEFAULT_CELL_ASPECT);
  const frame = signal(0);
  const rows = () => petRows(props.pet.spriteVersionNumber);
  const row = () => petRowFor(props.state);
  const width = () => Math.round(props.height * aspect());

  effect(() => {
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
  // Animate every state row (including row 0 idle breathing/blinking) even when
  // the main window is in the background; freeze at frame 0 only under reduced motion.
  effect(() => {
    if (reduceMotion()) {
      frame.set(0);
      return;
    }
    const frames = PET_ROW_FRAMES[row()] ?? 1;
    frame.set(0);
    if (frames <= 1) return;
    const timer = setInterval(() => frame.update(current => (current + 1) % frames), PET_FRAME_MS);
    cleanup(() => clearInterval(timer));
  });

  return (
    <View
      testID={`pet-${props.pet.id}-${props.state}`}
      accessibilityLabel={`pet-sprite-${props.pet.id}`}
      accessibilityValue={{ text: stateWord(props.state) }}
      style={{ width: width(), height: props.height, overflow: "hidden" }}
    >
      <If when={sheet()}>
        {src => (
          <Image
            src={src()}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: width() * PET_COLUMNS,
              height: props.height * rows(),
              transform: [
                { translateX: -frame() * width() },
                { translateY: -row() * props.height },
              ],
            }}
          />
        )}
      </If>
      <If when={!sheet()}>
        <PetPicturePlaceholder
          width={width()}
          height={props.height}
          failed={Boolean(petSheetErrors()[props.pet.spritesheetPath])}
        />
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
        desktop={{ windowDrag: true }}
        role="button"
        accessibilityLabel="pet-open-inbox"
        hitSlop={touchSlop(props.height)}
        onPress={() => props.onOpen()}
        activeStyle={tactileActiveStyle(0.96)}
        focusVisibleStyle={focusRingStyle()}
        style={{
          borderRadius: radii.md,
          cursor: "grab",
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
  const busy = () => companionBusy() !== null;
  const isSelected = (pet: CompanionPet) => {
    const current = selectedPet();
    return Boolean(current && (current.spritesheetPath === pet.spritesheetPath || (current.id === pet.id && current.source === pet.source)));
  };
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
                  <PetStill pet={pet()} height={PET_PREVIEW_HEIGHT} />
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
                          confirmDelete: true,
                          confirmAccessibilityLabel: `pet-delete-confirm-${pet().id}`,
                          disabled: busy(),
                          accessibilityLabel: `pet-delete-${pet().id}`,
                          onSelect: () => void deleteCompanionPet(pet()),
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
    </View>
  );
}
