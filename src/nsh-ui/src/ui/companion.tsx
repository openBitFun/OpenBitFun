// The companion pet as the desktop draws it (tauri-gap §1.5, §4.4): one
// sprite cell of a Petdex spritesheet, animated along the row of the fleet's
// attention state, in its own transparent floating window
// (`desktopPresence.ts`) and as a still preview in Settings › Pet.
//
// Everything it shows comes from `companionStore.ts`; colors come only from
// the palette (the selection ring), the pet itself is its artwork.

import { cleanup, effect, Image, signal, Text, untracked, View } from "nsh";
import { Menu } from "nsh/desktop";
import {
  companionBusy,
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
import { palette, radii, space, textStyle } from "../theme";
import { stateWord, type MarkState } from "./fleet";
import { Icon } from "./icons";
import { MoreMenu } from "./studio";

/** Petdex cells are 192 × 208; a sheet whose size is unknown yet uses that shape. */
const DEFAULT_CELL_ASPECT = 192 / 208;

export interface PetSpriteProps {
  pet: CompanionPet;
  /** The row's state; a still preview passes `null` (rest pose, first frame). */
  state: MarkState | null;
  /** The cell's height in points. */
  height: number;
}

/** One cell of the pet's spritesheet, stepping through its row's frames. */
export function PetSprite(props: PetSpriteProps) {
  const sheet = () => petSheets()[props.pet.spritesheetPath] ?? "";
  const failed = () => petSheetErrors()[props.pet.spritesheetPath] ?? "";
  const aspect = signal(DEFAULT_CELL_ASPECT);
  const frame = signal(0);
  const rows = () => petRows(props.pet.spriteVersionNumber);
  const row = () => (props.state ? petRowFor(props.state) : 0);
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
  // Animated rows only; a still preview keeps the first frame.
  effect(() => {
    if (props.state === null) {
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
      <If when={!sheet() && failed()}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
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
      style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.sm, backgroundColor: "transparent" }}
    >
      <View
        role="button"
        accessibilityLabel="pet-open-inbox"
        tooltip={stateWord(petState())}
        onPress={() => props.onOpen()}
        style={{ cursor: "pointer" }}
      >
        <PetSprite pet={props.pet} state={petState()} height={props.height} />
      </View>
    </View>
  );
}

/** Settings › Pet: the characters to pick from, the chosen one ringed. */
export function PetCharacterGrid() {
  const isSelected = (pet: CompanionPet) => {
    const current = selectedPet();
    return Boolean(current && (current.spritesheetPath === pet.spritesheetPath || (current.id === pet.id && current.source === pet.source)));
  };
  return (
    <View accessibilityLabel="pet-characters" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
      <Each of={companionPets() ?? []} key={pet => `${pet.source}:${pet.packagePath}`}>
        {pet => (
          <View
            role="radio"
            accessibilityLabel={`pet-choose-${pet().id}`}
            accessibilityState={{ selected: isSelected(pet()), disabled: companionBusy() !== null }}
            onPress={() => void selectCompanionPet(pet())}
            style={{
              width: space.x6l + space.x3l,
              alignItems: "center",
              gap: space.xs,
              padding: space.sm,
              borderRadius: radii.md,
              borderWidth: 1,
              borderColor: isSelected(pet()) ? palette().borderFocus : palette().borderSubtle,
              backgroundColor: palette().panelRaised,
              cursor: "pointer",
            }}
            hoverStyle={{ backgroundColor: palette().panelHover }}
          >
            <PetSprite pet={pet()} state={null} height={space.x5l + space.sm} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.hair, alignSelf: "stretch" }}>
              <Text style={{ ...textStyle("caption"), flex: 1, minWidth: 0, textAlign: "center", numberOfLines: 1, textOverflow: "ellipsis" }}>
                {pet().displayName}
              </Text>
              <If when={pet().source !== "builtin"}>
                <MoreMenu
                  size="xs"
                  accessibilityLabel={`pet-menu-${pet().id}`}
                  items={[
                    {
                      id: "delete",
                      label: tr("pet.delete"),
                      icon: "trash",
                      danger: true,
                      accessibilityLabel: `pet-delete-${pet().id}`,
                      onSelect: () => void deleteCompanionPet(pet()),
                    },
                  ]}
                />
              </If>
            </View>
          </View>
        )}
      </Each>
    </View>
  );
}
