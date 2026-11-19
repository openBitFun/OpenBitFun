// Native <Canvas> + Path2D vector icon library and companion characters
// modeled after OpenBitFun Tauri's Lucide icon grammar.
// Every dynamic palette read happens inside Canvas `draw` or JSX bindings.

import {
  Canvas,
  Path2D,
  View,
  type CanvasRenderingContext2D,
  type StyleProp,
  type ViewStyle,
} from "nsh";
import { isLightAppearance, palette } from "../theme";
import { LUCIDE_PATHS } from "./lucideIcons";

export type IconName =
  | "chat"
  | "search"
  | "sparkles"
  | "notes"
  | "folder"
  | "folder-open"
  | "folder-plus"
  | "file"
  | "file-code"
  | "file-text"
  | "git"
  | "git-branch"
  | "git-commit"
  | "git-merge"
  | "git-pull-request"
  | "terminal"
  | "terminal-square"
  | "bulb"
  | "check-square"
  | "check-circle"
  | "alert-circle"
  | "help-circle"
  | "x-circle"
  | "shapes"
  | "bot"
  | "sidebar"
  | "link"
  | "sliders"
  | "plus"
  | "arrow-up"
  | "arrow-down"
  | "arrow-left"
  | "arrow-right"
  | "arrow-left-right"
  | "stop"
  | "mic"
  | "waveform"
  | "more"
  | "close"
  | "copy"
  | "check"
  | "chevron-left"
  | "chevron-right"
  | "chevron-down"
  | "chevron-up"
  | "paperclip"
  | "at"
  | "bolt"
  | "zap"
  | "message-circle"
  | "globe"
  | "trash"
  | "edit"
  | "refresh"
  | "laptop"
  | "server"
  | "container"
  | "network"
  | "hard-drive"
  | "cloud"
  | "wifi"
  | "smartphone"
  | "panel-left"
  | "panel-right"
  | "maximize"
  | "minimize"
  | "swap"
  | "menu"
  | "filter"
  | "layers"
  | "layout-grid"
  | "pin"
  | "cpu"
  | "plug"
  | "database"
  | "shield"
  | "calendar"
  | "clock"
  | "history"
  | "code"
  | "external-link"
  | "download"
  | "upload"
  | "key"
  | "lock"
  | "unlock"
  | "eye"
  | "eye-off"
  | "warning"
  | "info"
  | "bell"
  | "play"
  | "pause"
  | "undo"
  | "home"
  | "settings"
  | "palette"
  | "monitor"
  | "sun"
  | "moon"
  | "list"
  | "command"
  | "star"
  | "image"
  | "hash"
  | "tag"
  | "compass"
  | "activity"
  | "bar-chart"
  | "flame"
  | "wrench"
  | "package"
  | "languages"
  | "arrow-up-right"
  | "panel-left-close"
  | "circle-dot"
  | "inbox"
  | "user"
  | "log-in"
  | "log-out";

const PATH_MAP: Partial<Record<IconName, string>> = {
  chat: "M4.5 6.8 C4.5 4.9 6.0 3.5 7.9 3.5 H16.1 C18.0 3.5 19.5 4.9 19.5 6.8 V13.2 C19.5 15.1 18.0 16.5 16.1 16.5 H9.4 L5.0 19.8 V16.1 C4.7 15.3 4.5 14.3 4.5 13.2 Z M8.5 8.8 H15.5 M8.5 12.0 H13.2",
  search: "M15.15 15.15 L20.0 20.0",
  sparkles:
    "M11.0 3.5 L12.7 9.3 L18.5 11.0 L12.7 12.7 L11.0 18.5 L9.3 12.7 L3.5 11.0 L9.3 9.3 Z M18.5 15.5 V19.5 M16.5 17.5 H20.5",
  notes: "M8.5 8.5 H15.5 M8.5 12.0 H15.5 M8.5 15.5 H13.0",
  folder:
    "M3.5 7.5 C3.5 6.1 4.6 5.0 6.0 5.0 H9.5 L11.5 7.2 H18.0 C19.4 7.2 20.5 8.3 20.5 9.7 V16.5 C20.5 17.9 19.4 19.0 18.0 19.0 H6.0 C4.6 19.0 3.5 17.9 3.5 16.5 Z",
  "folder-open":
    "M3.5 17.5 V7.2 C3.5 5.9 4.5 5.0 5.8 5.0 H9.4 L11.2 7.2 H17.5 C18.6 7.2 19.5 8.1 19.5 9.2 V10.5 M3.5 17.5 C3.5 18.4 4.3 19.0 5.2 19.0 H17.8 C18.7 19.0 19.5 18.3 19.8 17.4 L21.2 12.2 C21.4 11.3 20.8 10.5 19.8 10.5 H6.4 C5.5 10.5 4.7 11.1 4.5 12.0 Z",
  "folder-plus":
    "M3.5 7.5 C3.5 6.1 4.6 5.0 6.0 5.0 H9.5 L11.5 7.2 H18.0 C19.4 7.2 20.5 8.3 20.5 9.7 V16.5 C20.5 17.9 19.4 19.0 18.0 19.0 H6.0 C4.6 19.0 3.5 17.9 3.5 16.5 Z M12.0 10.5 V15.5 M9.5 13.0 H14.5",
  file:
    "M6.5 3.5 H13.8 L18.5 8.2 V18.5 C18.5 19.6 17.6 20.5 16.5 20.5 H6.5 C5.4 20.5 4.5 19.6 4.5 18.5 V5.5 C4.5 4.4 5.4 3.5 6.5 3.5 Z M13.5 3.5 V8.5 H18.5",
  "file-code":
    "M6.5 3.5 H13.8 L18.5 8.2 V18.5 C18.5 19.6 17.6 20.5 16.5 20.5 H6.5 C5.4 20.5 4.5 19.6 4.5 18.5 V5.5 C4.5 4.4 5.4 3.5 6.5 3.5 Z M13.5 3.5 V8.5 H18.5 M9.8 12.5 L7.8 14.5 L9.8 16.5 M13.2 12.5 L15.2 14.5 L13.2 16.5",
  "file-text":
    "M6.5 3.5 H13.8 L18.5 8.2 V18.5 C18.5 19.6 17.6 20.5 16.5 20.5 H6.5 C5.4 20.5 4.5 19.6 4.5 18.5 V5.5 C4.5 4.4 5.4 3.5 6.5 3.5 Z M13.5 3.5 V8.5 H18.5 M8.0 12.8 H15.0 M8.0 16.2 H13.0",
  git: "M7.0 8.0 V16.0 M17.0 9.0 C17.0 12.4 13.0 12.8 7.0 14.2",
  "git-branch": "M7.0 8.0 V16.0 M17.0 9.0 C17.0 12.4 13.0 12.8 7.0 14.2",
  "git-commit": "M3.5 12.0 H8.5 M15.5 12.0 H20.5",
  "git-merge": "M7.0 8.0 V18.5 M7.0 8.5 C9.0 12.5 12.0 15.5 15.5 16.0",
  "git-pull-request":
    "M6.5 8.5 V18.5 M17.5 15.5 V9.5 C17.5 7.5 16.0 6.0 14.0 6.0 H12.0 M14.2 3.8 L12.0 6.0 L14.2 8.2",
  terminal: "M5.0 7.5 L10.0 12.0 L5.0 16.5 M12.0 17.0 H19.0",
  "terminal-square": "M7.5 9.0 L10.5 12.0 L7.5 15.0 M12.5 15.0 H16.5",
  bulb: "M9.0 17.5 H15.0 M10.2 20.5 H13.8 M12.0 3.2 C8.7 3.2 6.0 5.9 6.0 9.2 C6.0 11.5 7.4 13.4 9.0 14.7 V15.3 H15.0 V14.7 C16.6 13.4 18.0 11.5 18.0 9.2 C18.0 5.9 15.3 3.2 12.0 3.2 Z",
  "check-square": "M8.4 12.2 L10.9 14.7 L15.8 9.5",
  "check-circle": "M8.5 12.2 L10.9 14.6 L15.6 9.6",
  "alert-circle": "M12.0 8.0 V12.5",
  "help-circle":
    "M9.4 9.4 C9.7 8.1 10.7 7.3 12.0 7.3 C13.5 7.3 14.6 8.3 14.6 9.6 C14.6 10.9 13.3 11.4 12.4 12.1 C12.1 12.3 12.0 12.7 12.0 13.3",
  "x-circle": "M9.2 9.2 L14.8 14.8 M14.8 9.2 L9.2 14.8",
  shapes: "M16.5 13.5 L19.8 19.5 H13.2 Z",
  bot: "M12.0 3.8 V7.0 M9.8 3.8 H14.2",
  sidebar: "M9.5 4.5 V19.5",
  "panel-left": "M9.5 4.5 V19.5",
  "panel-right": "M14.5 4.5 V19.5",
  link: "M10.2 13.8 C8.7 15.3 6.3 15.3 4.8 13.8 C3.3 12.3 3.3 9.9 4.8 8.4 L7.7 5.5 C9.2 4.0 11.6 4.0 13.1 5.5 C13.9 6.3 14.2 7.4 14.1 8.5 M13.8 10.2 C15.3 8.7 17.7 8.7 19.2 10.2 C20.7 11.7 20.7 14.1 19.2 15.6 L16.3 18.5 C14.8 20.0 12.4 20.0 10.9 18.5 C10.1 17.7 9.8 16.6 9.9 15.5",
  sliders:
    "M4.0 7.0 H8.0 M12.0 7.0 H20.0 M10.0 5.0 V9.0 M4.0 12.0 H14.0 M18.0 12.0 H20.0 M16.0 10.0 V14.0 M4.0 17.0 H7.0 M11.0 17.0 H20.0 M9.0 15.0 V19.0",
  plus: "M12.0 5.0 V19.0 M5.0 12.0 H19.0",
  "arrow-up": "M12.0 19.0 V5.0 M6.5 10.5 L12.0 5.0 L17.5 10.5",
  "arrow-down": "M12.0 5.0 V19.0 M6.5 13.5 L12.0 19.0 L17.5 13.5",
  "arrow-left": "M19.0 12.0 H5.0 M11.0 6.0 L5.0 12.0 L11.0 18.0",
  "arrow-right": "M5.0 12.0 H19.0 M13.0 6.0 L19.0 12.0 L13.0 18.0",
  "arrow-left-right":
    "M7.5 17.0 L3.5 13.0 L7.5 9.0 M4.0 13.0 H20.0 M16.5 7.0 L20.5 11.0 L16.5 15.0",
  mic: "M6.0 11.5 C6.0 15.0 8.7 17.5 12.0 17.5 C15.3 17.5 18.0 15.0 18.0 11.5 M12.0 17.5 V20.8 M9.0 20.8 H15.0",
  waveform: "M4.5 10.2 V13.8 M8.2 7.2 V16.8 M12.0 4.8 V19.2 M15.8 7.2 V16.8 M19.5 10.2 V13.8",
  close: "M6.5 6.5 L17.5 17.5 M17.5 6.5 L6.5 17.5",
  copy: "M15.0 9.0 V6.2 C15.0 5.0 14.0 4.0 12.8 4.0 H6.2 C5.0 4.0 4.0 5.0 4.0 6.2 V12.8 C4.0 14.0 5.0 15.0 6.2 15.0 H9.0",
  check: "M5.0 12.5 L9.5 17.0 L19.0 7.0",
  "chevron-left": "M14.5 6.0 L8.5 12.0 L14.5 18.0",
  "chevron-right": "M9.5 6.0 L15.5 12.0 L9.5 18.0",
  "chevron-down": "M6.0 9.0 L12.0 15.0 L18.0 9.0",
  "chevron-up": "M6.0 15.0 L12.0 9.0 L18.0 15.0",
  paperclip:
    "M19.8 11.2 L11.5 19.5 C9.5 21.5 6.3 21.5 4.3 19.5 C2.3 17.5 2.3 14.3 4.3 12.3 L13.3 3.3 C14.6 2.0 16.8 2.0 18.1 3.3 C19.4 4.6 19.4 6.8 18.1 8.1 L9.3 16.9 C8.6 17.6 7.5 17.6 6.8 16.9 C6.1 16.2 6.1 15.1 6.8 14.4 L14.7 6.5",
  at: "M15.6 8.4 V13.2 C15.6 14.6 16.8 15.6 18.0 15.4 C19.7 15.0 20.8 13.4 20.8 11.6 C20.8 6.9 16.9 3.2 12.0 3.2 C7.1 3.2 3.2 7.1 3.2 12.0 C3.2 16.9 7.1 20.8 12.0 20.8 C14.4 20.8 16.6 19.9 18.2 18.4",
  bolt: "M13.0 2.5 L5.5 13.0 H12.0 L11.0 21.5 L18.5 11.0 H12.0 Z",
  zap: "M13.2 2.8 L5.2 13.2 H11.8 L10.8 21.2 L18.8 10.8 H12.2 Z",
  "message-circle":
    "M20.0 12.0 C20.0 16.4 16.4 20.0 12.0 20.0 C10.6 20.0 9.3 19.6 8.1 19.0 L4.0 20.0 L5.0 15.9 C4.4 14.7 4.0 13.4 4.0 12.0 C4.0 7.6 7.6 4.0 12.0 4.0 C16.4 4.0 20.0 7.6 20.0 12.0 Z",
  globe: "M3.8 12.0 H20.2",
  trash:
    "M4.5 7.0 H19.5 M9.5 4.0 H14.5 M6.5 7.0 L7.5 19.0 C7.6 19.8 8.3 20.5 9.1 20.5 H14.9 C15.7 20.5 16.4 19.8 16.5 19.0 L17.5 7.0 M10.0 10.8 V16.5 M14.0 10.8 V16.5",
  edit: "M16.2 3.8 L20.2 7.8 L8.5 19.5 H4.5 V15.5 Z M13.8 6.2 L17.8 10.2",
  refresh:
    "M19.5 12.0 C19.5 16.1 16.1 19.5 12.0 19.5 C9.2 19.5 6.8 18.0 5.5 15.7 M4.5 12.0 C4.5 7.9 7.9 4.5 12.0 4.5 C14.8 4.5 17.2 6.0 18.5 8.3 M18.8 4.5 V8.5 H14.8 M5.2 19.5 V15.5 H9.2",
  laptop:
    "M2.5 18.0 H21.5 M5.0 15.2 L3.2 18.0 M19.0 15.2 L20.8 18.0",
  server: "M3.5 12.0 H20.5 M7.0 7.0 H7.2 M7.0 17.0 H7.2",
  container:
    "M20.0 8.5 L12.0 4.0 L4.0 8.5 V15.5 L12.0 20.0 L20.0 15.5 Z M4.0 8.5 L12.0 13.0 L20.0 8.5 M12.0 13.0 V20.0",
  network: "M12.0 8.0 V12.0 M6.5 16.0 V12.0 H17.5 V16.0",
  "hard-drive":
    "M20.5 13.5 H3.5 M5.5 6.2 L3.5 13.5 V17.5 C3.5 18.6 4.4 19.5 5.5 19.5 H18.5 C19.6 19.5 20.5 18.6 20.5 17.5 V13.5 L18.5 6.2 C18.2 5.2 17.3 4.5 16.2 4.5 H7.8 C6.7 4.5 5.8 5.2 5.5 6.2 Z",
  cloud:
    "M7.2 18.5 H17.4 C19.7 18.5 21.5 16.7 21.5 14.5 C21.5 12.5 20.0 10.9 18.1 10.6 C17.6 7.3 14.8 4.8 11.4 4.8 C8.1 4.8 5.4 7.1 4.8 10.2 C3.3 10.8 2.5 12.2 2.5 13.9 C2.5 16.4 4.6 18.5 7.2 18.5 Z",
  wifi:
    "M3.5 9.2 C8.2 5.0 15.8 5.0 20.5 9.2 M6.5 12.6 C9.6 9.8 14.4 9.8 17.5 12.6 M9.5 16.0 C10.9 14.7 13.1 14.7 14.5 16.0",
  smartphone: "M11.0 17.5 H13.0",
  maximize:
    "M14.5 4.5 H19.5 V9.5 M9.5 19.5 H4.5 V14.5 M19.5 4.5 L13.8 10.2 M4.5 19.5 L10.2 13.8",
  minimize:
    "M4.5 14.5 H9.5 V19.5 M19.5 9.5 H14.5 V4.5 M14.5 9.5 L20.0 4.0 M9.5 14.5 L4.0 20.0",
  swap: "M7.0 16.0 L3.5 12.5 L7.0 9.0 M4.0 12.5 H20.0 M17.0 8.0 L20.5 11.5 L17.0 15.0",
  menu: "M4.5 7.0 H19.5 M4.5 12.0 H19.5 M4.5 17.0 H19.5",
  filter: "M4.0 5.5 H20.0 L14.0 12.5 V18.5 L10.0 20.0 V12.5 Z",
  layers: "M12.0 3.5 L3.5 8.0 L12.0 12.5 L20.5 8.0 Z M3.5 12.5 L12.0 17.0 L20.5 12.5 M3.5 16.5 L12.0 21.0 L20.5 16.5",
  pin: "M12.0 17.0 V21.5 M6.0 16.5 H18.0 L16.2 11.5 V5.5 H17.5 V3.5 H6.5 V5.5 H7.8 V11.5 Z",
  cpu: "M9.0 2.8 V5.5 M15.0 2.8 V5.5 M9.0 18.5 V21.2 M15.0 18.5 V21.2 M2.8 9.0 H5.5 M2.8 15.0 H5.5 M18.5 9.0 H21.2 M18.5 15.0 H21.2",
  plug: "M12.0 17.5 V21.0 M8.5 4.0 V8.0 M15.5 4.0 V8.0 M6.5 8.0 H17.5 V12.0 C17.5 15.0 15.0 17.5 12.0 17.5 C9.0 17.5 6.5 15.0 6.5 12.0 Z",
  database:
    "M4.5 6.5 V17.5 C4.5 19.2 7.9 20.5 12.0 20.5 C16.1 20.5 19.5 19.2 19.5 17.5 V6.5 M4.5 12.0 C4.5 13.7 7.9 15.0 12.0 15.0 C16.1 15.0 19.5 13.7 19.5 12.0",
  shield: "M12.0 3.2 L19.0 6.0 V11.5 C19.0 16.0 16.0 19.5 12.0 21.0 C8.0 19.5 5.0 16.0 5.0 11.5 V6.0 Z",
  calendar: "M4.5 9.5 H19.5 M8.0 3.5 V6.5 M16.0 3.5 V6.5",
  clock: "M12.0 7.0 V12.0 L15.5 14.0",
  history:
    "M4.2 12.0 C4.2 16.3 7.7 19.8 12.0 19.8 C16.3 19.8 19.8 16.3 19.8 12.0 C19.8 7.7 16.3 4.2 12.0 4.2 C9.0 4.2 6.4 5.9 5.1 8.4 M4.5 4.5 V8.6 H8.6 M12.0 8.0 V12.0 L14.8 13.6",
  code: "M8.5 8.0 L4.0 12.0 L8.5 16.0 M15.5 8.0 L20.0 12.0 L15.5 16.0 M13.5 5.5 L10.5 18.5",
  "external-link": "M14.5 4.5 H19.5 V9.5 M10.5 13.5 L19.5 4.5 M18.0 13.5 V18.5 C18.0 19.3 17.3 20.0 16.5 20.0 H5.5 C4.7 20.0 4.0 19.3 4.0 18.5 V7.5 C4.0 6.7 4.7 6.0 5.5 6.0 H10.5",
  download: "M12.0 4.0 V15.0 M7.5 10.5 L12.0 15.0 L16.5 10.5 M4.5 19.0 H19.5",
  upload: "M12.0 15.0 V4.0 M7.5 8.5 L12.0 4.0 L16.5 8.5 M4.5 19.0 H19.5",
  key: "M14.2 10.8 L20.5 4.5 M18.0 7.0 L20.0 9.0",
  lock: "M8.0 10.5 V7.8 C8.0 5.6 9.8 3.8 12.0 3.8 C14.2 3.8 16.0 5.6 16.0 7.8 V10.5",
  unlock: "M8.0 10.5 V7.8 C8.0 5.6 9.8 3.8 12.0 3.8 C13.8 3.8 15.3 4.9 15.8 6.5",
  eye: "M2.8 12.0 C5.0 7.5 8.2 5.5 12.0 5.5 C15.8 5.5 19.0 7.5 21.2 12.0 C19.0 16.5 15.8 18.5 12.0 18.5 C8.2 18.5 5.0 16.5 2.8 12.0 Z",
  "eye-off":
    "M3.5 3.5 L20.5 20.5 M9.8 6.0 C10.5 5.7 11.2 5.5 12.0 5.5 C15.8 5.5 19.0 7.5 21.2 12.0 C20.3 13.8 19.1 15.3 17.8 16.4 M6.4 7.7 C4.9 8.8 3.7 10.2 2.8 12.0 C5.0 16.5 8.2 18.5 12.0 18.5 C13.6 18.5 15.1 18.1 16.4 17.4",
  warning: "M12.0 3.8 L21.0 19.5 H3.0 Z M12.0 9.5 V13.8",
  info: "M12.0 11.5 V16.5",
  bell: "M18.0 15.0 C18.0 15.0 19.5 16.5 19.5 17.2 H4.5 C4.5 16.5 6.0 15.0 6.0 15.0 V10.5 C6.0 7.2 8.7 4.5 12.0 4.5 C15.3 4.5 18.0 7.2 18.0 10.5 Z M10.2 19.8 C10.6 20.5 11.3 21.0 12.0 21.0 C12.7 21.0 13.4 20.5 13.8 19.8",
  play: "M8.0 5.2 L19.2 12.0 L8.0 18.8 Z",
  pause: "M7.5 5.0 V19.0 M16.5 5.0 V19.0",
  undo: "M9.0 7.5 L4.5 11.5 L9.0 15.5 M5.0 11.5 H14.5 C17.5 11.5 19.5 13.5 19.5 16.2 C19.5 18.5 17.8 20.0 15.5 20.0 H12.0",
  home: "M4.0 10.5 L12.0 4.0 L20.0 10.5 V19.0 C20.0 19.6 19.6 20.0 19.0 20.0 H14.5 V14.0 H9.5 V20.0 H5.0 C4.4 20.0 4.0 19.6 4.0 19.0 Z",
  settings: "M12.0 3.0 V5.8 M12.0 18.2 V21.0 M3.0 12.0 H5.8 M18.2 12.0 H21.0 M5.9 5.9 L7.65 7.65 M16.35 16.35 L18.1 18.1 M18.1 5.9 L16.35 7.65 M7.65 16.35 L5.9 18.1",
  palette: "M12.0 3.5 C7.0 3.5 3.5 7.2 3.5 11.8 C3.5 16.0 6.8 19.5 11.0 19.5 C12.4 19.5 13.2 18.6 13.2 17.4 C13.2 16.8 13.0 16.3 12.7 15.9 C12.4 15.5 12.9 14.8 13.5 14.8 H15.5 C18.3 14.8 20.5 12.7 20.5 10.2 C20.5 6.4 16.7 3.5 12.0 3.5 Z",
  monitor: "M8.0 20.0 H16.0 M12.0 16.0 V20.0",
  sun: "M12.0 2.8 V5.0 M12.0 19.0 V21.2 M2.8 12.0 H5.0 M19.0 12.0 H21.2 M5.5 5.5 L7.1 7.1 M16.9 16.9 L18.5 18.5 M18.5 5.5 L16.9 7.1 M7.1 16.9 L5.5 18.5",
  moon: "M19.5 14.5 C18.1 15.1 16.5 15.3 14.9 15.0 C10.9 14.2 8.2 10.5 9.0 6.5 C9.3 5.1 9.9 3.9 10.8 2.9 C6.7 3.4 3.5 6.9 3.5 11.2 C3.5 15.9 7.3 19.7 12.0 19.7 C15.4 19.7 18.3 17.6 19.5 14.5 Z",
  list: "M8.5 6.5 H20.0 M8.5 12.0 H20.0 M8.5 17.5 H20.0",
  command:
    "M9.0 9.0 H15.0 V15.0 H9.0 Z M9.0 9.0 V6.5 C9.0 5.1 7.9 4.0 6.5 4.0 C5.1 4.0 4.0 5.1 4.0 6.5 C4.0 7.9 5.1 9.0 6.5 9.0 Z M15.0 9.0 V6.5 C15.0 5.1 16.1 4.0 17.5 4.0 C18.9 4.0 20.0 5.1 20.0 6.5 C20.0 7.9 18.9 9.0 17.5 9.0 Z M9.0 15.0 V17.5 C9.0 18.9 7.9 20.0 6.5 20.0 C5.1 20.0 4.0 18.9 4.0 17.5 C4.0 16.1 5.1 15.0 6.5 15.0 Z M15.0 15.0 V17.5 C15.0 18.9 16.1 20.0 17.5 20.0 C18.9 20.0 20.0 18.9 20.0 17.5 C20.0 16.1 18.9 15.0 17.5 15.0 Z",
  star: "M12.0 3.5 L14.6 8.8 L20.4 9.6 L16.2 13.7 L17.2 19.5 L12.0 16.7 L6.8 19.5 L7.8 13.7 L3.6 9.6 L9.4 8.8 Z",
  image: "M4.5 16.5 L9.2 11.8 L12.8 15.4 L15.5 12.7 L19.5 16.7",
  hash: "M4.5 9.0 H19.5 M4.5 15.0 H19.5 M10.0 4.0 L8.0 20.0 M16.0 4.0 L14.0 20.0",
  tag: "M11.5 4.0 H6.0 C4.9 4.0 4.0 4.9 4.0 6.0 V11.5 L12.5 20.0 C13.3 20.8 14.6 20.8 15.4 20.0 L20.0 15.4 C20.8 14.6 20.8 13.3 20.0 12.5 Z",
  compass: "M15.6 8.4 L13.8 13.8 L8.4 15.6 L10.2 10.2 Z",
  activity: "M3.0 12.0 H6.8 L9.5 5.2 L14.5 18.8 L17.2 12.0 H21.0",
  "bar-chart": "M6.5 19.5 V12.5 M12.0 19.5 V5.5 M17.5 19.5 V9.5 M3.5 19.5 H20.5",
  flame:
    "M12.2 3.2 C12.2 3.2 17.5 7.2 17.5 12.8 C17.5 16.4 14.9 19.8 11.8 19.8 C8.5 19.8 6.2 17.2 6.2 13.8 C6.2 11.4 7.6 9.2 8.8 8.0 C8.8 8.0 9.0 10.6 10.6 11.2 C10.1 8.4 11.2 5.4 12.2 3.2 Z",
  wrench:
    "M14.7 6.3 C16.3 4.7 18.7 4.4 20.2 5.6 L17.4 8.4 L19.6 10.6 L20.4 9.8 C21.2 11.4 20.8 13.5 19.2 15.0 C17.6 16.5 15.4 16.6 13.8 15.6 L7.0 20.2 C6.2 20.8 5.1 20.7 4.4 20.0 C3.7 19.3 3.6 18.2 4.2 17.4 L8.8 10.6 C7.8 9.0 7.9 6.8 9.4 5.2 C10.9 3.7 13.0 3.3 14.6 4.1 L12.2 6.5 L14.7 6.3 Z",
  package:
    "M12.0 3.2 L19.8 7.5 V16.5 L12.0 20.8 L4.2 16.5 V7.5 Z M4.2 7.5 L12.0 11.8 L19.8 7.5 M12.0 11.8 V20.8 M8.1 5.4 L15.9 9.7",
  languages:
    "M4.0 6.5 H13.0 M8.5 4.0 V6.5 M11.5 6.5 C10.6 10.2 8.2 13.0 4.5 14.8 M6.2 9.5 C7.6 11.8 9.8 13.7 12.2 14.8 M13.2 20.0 L16.6 11.5 L20.0 20.0 M14.4 17.2 H18.8",
  "arrow-up-right": "M7.0 17.0 L17.0 7.0 M9.0 7.0 H17.0 V15.0",
  "panel-left-close": "M9.5 4.5 V19.5 M15.5 9.5 L13.0 12.0 L15.5 14.5",
  inbox:
    "M4.2 13.0 L6.4 5.5 C6.7 4.6 7.5 4.0 8.5 4.0 H15.5 C16.5 4.0 17.3 4.6 17.6 5.5 L19.8 13.0 M4.2 13.0 V17.5 C4.2 18.9 5.3 20.0 6.7 20.0 H17.3 C18.7 20.0 19.8 18.9 19.8 17.5 V13.0 H15.2 L13.8 15.5 H10.2 L8.8 13.0 Z",
  user: "M5.2 20.0 C5.2 16.6 8.2 14.5 12.0 14.5 C15.8 14.5 18.8 16.6 18.8 20.0",
  "log-in":
    "M14.5 4.0 H18.5 C19.6 4.0 20.5 4.9 20.5 6.0 V18.0 C20.5 19.1 19.6 20.0 18.5 20.0 H14.5 M10.0 16.5 L14.5 12.0 L10.0 7.5 M14.5 12.0 H3.5",
  "log-out":
    "M9.5 4.0 H5.5 C4.4 4.0 3.5 4.9 3.5 6.0 V18.0 C3.5 19.1 4.4 20.0 5.5 20.0 H9.5 M14.0 16.5 L18.5 12.0 L14.0 7.5 M18.5 12.0 H9.0",
};

function strokeRoundRect(
  cx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  cx.beginPath();
  cx.roundRect(x, y, w, h, r);
  cx.stroke();
}

function strokeCircle(cx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  cx.beginPath();
  cx.arc(x, y, r, 0, Math.PI * 2);
  cx.stroke();
}

function fillCircle(cx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  cx.beginPath();
  cx.arc(x, y, r, 0, Math.PI * 2);
  cx.fill();
}

const ICON_PATH_CACHE = new Map<IconName, Path2D>();

function getCachedIconPath(name: IconName): Path2D | null {
  const existing = ICON_PATH_CACHE.get(name);
  if (existing) return existing;
  const pathData = PATH_MAP[name];
  if (!pathData) return null;
  const compiled = new Path2D(pathData);
  ICON_PATH_CACHE.set(name, compiled);
  return compiled;
}

function drawIconGlyph(cx: CanvasRenderingContext2D, name: IconName): void {
  const path = getCachedIconPath(name);
  if (path) {
    cx.stroke(path);
  }

  switch (name) {
    case "search":
      strokeCircle(cx, 10.6, 10.6, 6.4);
      break;
    case "notes":
      strokeRoundRect(cx, 5, 3.5, 14, 17, 2.5);
      break;
    case "git":
    case "git-branch":
      strokeCircle(cx, 7, 6, 2);
      strokeCircle(cx, 7, 18, 2);
      strokeCircle(cx, 17, 7, 2);
      break;
    case "git-commit":
      strokeCircle(cx, 12, 12, 3.2);
      break;
    case "git-merge":
      strokeCircle(cx, 7, 6, 2);
      strokeCircle(cx, 17.5, 16, 2);
      break;
    case "git-pull-request":
      strokeCircle(cx, 6.5, 6.5, 2);
      strokeCircle(cx, 17.5, 17.5, 2);
      break;
    case "terminal-square":
      strokeRoundRect(cx, 3.8, 4.2, 16.4, 15.6, 3);
      break;
    case "check-square":
      strokeRoundRect(cx, 4, 4, 16, 16, 3.5);
      break;
    case "check-circle":
    case "x-circle":
      strokeCircle(cx, 12, 12, 8.8);
      break;
    case "alert-circle":
      strokeCircle(cx, 12, 12, 8.8);
      fillCircle(cx, 12, 15.8, 1.05);
      break;
    case "help-circle":
      strokeCircle(cx, 12, 12, 8.8);
      fillCircle(cx, 12, 16.2, 1.05);
      break;
    case "shapes":
      strokeCircle(cx, 7.5, 7.5, 3);
      strokeRoundRect(cx, 13.5, 4.5, 6, 6, 1.5);
      strokeRoundRect(cx, 4.5, 13.5, 6, 6, 1.5);
      break;
    case "layout-grid":
      strokeRoundRect(cx, 4.0, 4.0, 6.5, 6.5, 1.6);
      strokeRoundRect(cx, 13.5, 4.0, 6.5, 6.5, 1.6);
      strokeRoundRect(cx, 4.0, 13.5, 6.5, 6.5, 1.6);
      strokeRoundRect(cx, 13.5, 13.5, 6.5, 6.5, 1.6);
      break;
    case "bot":
      strokeRoundRect(cx, 4, 7, 16, 12, 4);
      fillCircle(cx, 9.5, 13, 1.15);
      fillCircle(cx, 14.5, 13, 1.15);
      break;
    case "sidebar":
    case "panel-left":
    case "panel-right":
    case "panel-left-close":
      strokeRoundRect(cx, 3.5, 4.5, 17, 15, 3);
      break;
    case "circle-dot":
      strokeCircle(cx, 12, 12, 8.6);
      fillCircle(cx, 12, 12, 2.2);
      break;
    case "stop":
      cx.beginPath();
      cx.roundRect(7, 7, 10, 10, 2.2);
      cx.fill();
      break;
    case "mic":
      strokeRoundRect(cx, 9, 3.5, 6, 10, 3);
      break;
    case "more":
      fillCircle(cx, 6, 12, 1.45);
      fillCircle(cx, 12, 12, 1.45);
      fillCircle(cx, 18, 12, 1.45);
      break;
    case "copy":
      strokeRoundRect(cx, 9, 9, 11, 11, 2.2);
      break;
    case "at":
      strokeCircle(cx, 12, 12, 3.6);
      break;
    case "globe":
      strokeCircle(cx, 12, 12, 8.5);
      cx.beginPath();
      cx.ellipse(12, 12, 3.6, 8.5, 0, 0, Math.PI * 2);
      cx.stroke();
      break;
    case "laptop":
      strokeRoundRect(cx, 4.8, 5.2, 14.4, 10.0, 1.8);
      break;
    case "server":
      strokeRoundRect(cx, 3.5, 3.8, 17, 7, 2);
      strokeRoundRect(cx, 3.5, 13.2, 17, 7, 2);
      break;
    case "network":
      strokeRoundRect(cx, 9.5, 3.5, 5, 4.5, 1.2);
      strokeRoundRect(cx, 4, 16, 5, 4.5, 1.2);
      strokeRoundRect(cx, 15, 16, 5, 4.5, 1.2);
      break;
    case "hard-drive":
      fillCircle(cx, 7.2, 16.5, 0.9);
      fillCircle(cx, 10.4, 16.5, 0.9);
      break;
    case "wifi":
      fillCircle(cx, 12, 18.8, 1.15);
      break;
    case "smartphone":
      strokeRoundRect(cx, 6.5, 3.2, 11.0, 17.6, 2.2);
      break;
    case "cpu":
      strokeRoundRect(cx, 5.5, 5.5, 13, 13, 2.5);
      strokeRoundRect(cx, 9.2, 9.2, 5.6, 5.6, 1);
      break;
    case "database":
      cx.beginPath();
      cx.ellipse(12, 6.5, 7.5, 3, 0, 0, Math.PI * 2);
      cx.stroke();
      break;
    case "calendar":
      strokeRoundRect(cx, 4.5, 5.2, 15, 14.8, 2.5);
      break;
    case "clock":
      strokeCircle(cx, 12, 12, 8.6);
      break;
    case "key":
      strokeCircle(cx, 8.2, 15.8, 4.2);
      break;
    case "lock":
    case "unlock":
      strokeRoundRect(cx, 5.0, 10.5, 14.0, 9.8, 2.2);
      break;
    case "eye":
      strokeCircle(cx, 12, 12, 2.8);
      break;
    case "warning":
      fillCircle(cx, 12, 16.8, 1.05);
      break;
    case "info":
      strokeCircle(cx, 12, 12, 9);
      fillCircle(cx, 12, 7.8, 1.05);
      break;
    case "settings":
      strokeCircle(cx, 12, 12, 6.2);
      strokeCircle(cx, 12, 12, 2.5);
      break;
    case "palette":
      fillCircle(cx, 8.2, 10.5, 1.0);
      fillCircle(cx, 11.0, 7.6, 1.0);
      fillCircle(cx, 14.8, 8.0, 1.0);
      break;
    case "monitor":
      strokeRoundRect(cx, 3.2, 4.0, 17.6, 12.0, 2.2);
      break;
    case "sun":
      strokeCircle(cx, 12, 12, 4.2);
      break;
    case "list":
      fillCircle(cx, 4.5, 6.5, 1.1);
      fillCircle(cx, 4.5, 12.0, 1.1);
      fillCircle(cx, 4.5, 17.5, 1.1);
      break;
    case "image":
      strokeRoundRect(cx, 3.8, 4.2, 16.4, 15.6, 2.5);
      fillCircle(cx, 9.0, 8.8, 1.35);
      break;
    case "tag":
      fillCircle(cx, 8.2, 8.2, 1.15);
      break;
    case "compass":
      strokeCircle(cx, 12, 12, 8.8);
      break;
    case "user":
      strokeCircle(cx, 12, 8, 3.8);
      break;
    default:
      break;
  }
}

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
}

const lucidePathCache = new Map<string, Path2D>();

function lucidePath(d: string): Path2D {
  let path = lucidePathCache.get(d);
  if (!path) {
    path = new Path2D(d);
    lucidePathCache.set(d, path);
  }
  return path;
}

export function Icon(props: IconProps) {
  return (
    <Canvas
      style={[
        {
          width: props.size ?? 18,
          height: props.size ?? 18,
          flexShrink: 0,
          pointerEvents: "none",
        },
        props.style,
      ]}
      draw={(cx, size) => {
        if (size.width <= 0 || size.height <= 0) return;
        const stroke = props.color ?? palette().textSecondary;
        const px = Math.min(size.width, size.height);
        // The desktop draws lucide at a 1.6 stroke; small glyphs get a touch more
        // so they hold up on 1x displays.
        const opticalStroke = px <= 14 ? 1.8 : px <= 18 ? 1.65 : 1.6;
        cx.save();
        cx.scale(size.width / 24, size.height / 24);
        cx.strokeStyle = stroke;
        cx.fillStyle = stroke;
        cx.lineWidth = props.strokeWidth ?? opticalStroke;
        cx.lineCap = "round";
        cx.lineJoin = "round";
        const lucide = LUCIDE_PATHS[props.name];
        if (lucide) {
          for (const d of lucide) cx.stroke(lucidePath(d));
        } else {
          drawIconGlyph(cx, props.name);
        }
        cx.restore();
      }}
    />
  );
}

export type BotVariant = "grok" | "muse" | "amber" | "mint" | "violet";

const BOT_VARIANTS: ReadonlyArray<BotVariant> = ["grok", "muse", "amber", "mint", "violet"];

function pickVariant(seed?: string, explicit?: BotVariant): BotVariant {
  if (explicit) return explicit;
  const text = (seed ?? "").trim();
  if (!text) return "grok";
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return BOT_VARIANTS[hash % BOT_VARIANTS.length] ?? "grok";
}

function characterStatusColor(status: string): string {
  const key = status.trim().toLowerCase();
  if (key === "online" || key === "ready" || key === "active") return palette().success;
  if (key === "running" || key === "busy" || key === "working") return palette().accent;
  if (key === "approval" || key === "warning" || key === "idle" || key === "waiting") {
    return palette().warning;
  }
  if (key === "failed" || key === "error") return palette().danger;
  return palette().textMuted;
}

function drawPillEye(
  cx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  withCatchlight = true,
): void {
  cx.fillStyle = color;
  cx.beginPath();
  cx.roundRect(x - w / 2, y - h / 2, w, h, w / 2);
  cx.fill();
  if (withCatchlight) {
    cx.fillStyle = "rgba(255, 255, 255, 0.78)";
    fillCircle(cx, x - w * 0.16, y - h * 0.24, Math.max(0.42, w * 0.2));
  }
}

function drawAmbientHalo(
  cx: CanvasRenderingContext2D,
  glowRgb: string,
): void {
  const light = isLightAppearance();
  // Soft atmospheric halo that integrates the companion into Dark & Light canvases
  // so the sculptural orb never floats like an ungrounded sticker.
  const halo = cx.createRadialGradient(12, 12, 5.2, 12, 12, 11.8);
  halo.addColorStop(0, `rgba(${glowRgb}, ${light ? 0.14 : 0.22})`);
  halo.addColorStop(0.62, `rgba(${glowRgb}, ${light ? 0.05 : 0.08})`);
  halo.addColorStop(1, `rgba(${glowRgb}, 0)`);
  cx.fillStyle = halo;
  fillCircle(cx, 12, 12, 11.8);

  // Delicate architectural medallion saucer & rim ring.
  cx.fillStyle = light ? "rgba(15, 23, 42, 0.032)" : "rgba(255, 255, 255, 0.042)";
  fillCircle(cx, 12, 12, 10.65);

  cx.beginPath();
  cx.arc(12, 12, 10.65, 0, Math.PI * 2);
  cx.strokeStyle = light ? "rgba(15, 23, 42, 0.085)" : "rgba(255, 255, 255, 0.11)";
  cx.lineWidth = 0.55;
  cx.stroke();
}

function fillShadedOrb(
  cx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  hi: string,
  mid: string,
  lo: string,
  rimColor: string,
): void {
  // Soft contact grounding shadow beneath the sculptural orb.
  cx.fillStyle = isLightAppearance() ? "rgba(15, 23, 42, 0.10)" : "rgba(0, 0, 0, 0.36)";
  cx.beginPath();
  cx.ellipse(x, y + r * 0.9, r * 0.64, r * 0.15, 0, 0, Math.PI * 2);
  cx.fill();

  const grad = cx.createRadialGradient(x - r * 0.28, y - r * 0.34, r * 0.1, x, y, r);
  grad.addColorStop(0, hi);
  grad.addColorStop(0.62, mid);
  grad.addColorStop(1, lo);
  cx.fillStyle = grad;
  cx.beginPath();
  cx.arc(x, y, r, 0, Math.PI * 2);
  cx.fill();

  // Crisp architectural rim bevel so the orb holds clean edge definition on both Light & Dark canvases.
  cx.beginPath();
  cx.arc(x, y, r - 0.3, 0, Math.PI * 2);
  cx.strokeStyle = rimColor;
  cx.lineWidth = 0.6;
  cx.stroke();

  // Delicate top specular arc
  cx.fillStyle = isLightAppearance() ? "rgba(255, 255, 255, 0.48)" : "rgba(255, 255, 255, 0.32)";
  cx.beginPath();
  cx.ellipse(x - r * 0.12, y - r * 0.56, r * 0.38, r * 0.14, -0.18, 0, Math.PI * 2);
  cx.fill();
}

function drawCharacterFace(cx: CanvasRenderingContext2D, variant: BotVariant): void {
  const light = isLightAppearance();

  if (variant === "grok") {
    drawAmbientHalo(cx, light ? "59, 130, 246" : "147, 197, 253");
    fillShadedOrb(
      cx,
      12,
      11.8,
      8.2,
      light ? "#ffffff" : "#eef2f8",
      light ? "#f0f3f9" : "#d6dfec",
      light ? "#d2dbe7" : "#adb9cc",
      light ? "rgba(15, 23, 42, 0.14)" : "rgba(255, 255, 255, 0.28)",
    );

    // Sculpted obsidian visor with vertical glass gradient.
    const visorGrad = cx.createLinearGradient(12, 8.6, 12, 14.8);
    visorGrad.addColorStop(0, "#242936");
    visorGrad.addColorStop(0.55, "#141720");
    visorGrad.addColorStop(1, "#0d1017");
    cx.fillStyle = visorGrad;
    cx.beginPath();
    cx.roundRect(6.4, 8.6, 11.2, 6.1, 3.05);
    cx.fill();

    // Subtle inner visor optical rim & upper glass reflection.
    cx.strokeStyle = "rgba(255, 255, 255, 0.16)";
    cx.lineWidth = 0.48;
    cx.beginPath();
    cx.roundRect(6.7, 8.9, 10.6, 5.5, 2.75);
    cx.stroke();

    cx.fillStyle = "rgba(255, 255, 255, 0.08)";
    cx.beginPath();
    cx.roundRect(7.4, 9.2, 9.2, 1.55, 0.8);
    cx.fill();

    // Soft ambient halo behind companion eyes for optical depth.
    const leftGlow = cx.createRadialGradient(9.8, 11.65, 0.2, 9.8, 11.65, 2.1);
    leftGlow.addColorStop(0, "rgba(147, 197, 253, 0.34)");
    leftGlow.addColorStop(1, "rgba(147, 197, 253, 0)");
    cx.fillStyle = leftGlow;
    fillCircle(cx, 9.8, 11.65, 2.1);

    const rightGlow = cx.createRadialGradient(14.2, 11.65, 0.2, 14.2, 11.65, 2.1);
    rightGlow.addColorStop(0, "rgba(147, 197, 253, 0.34)");
    rightGlow.addColorStop(1, "rgba(147, 197, 253, 0)");
    cx.fillStyle = rightGlow;
    fillCircle(cx, 14.2, 11.65, 2.1);

    // Crisp luminous pill eyes inside visor.
    drawPillEye(cx, 9.8, 11.65, 1.7, 2.8, "#f0f6ff", true);
    drawPillEye(cx, 14.2, 11.65, 1.7, 2.8, "#f0f6ff", true);

    // Minimal understated smile curve below visor.
    cx.strokeStyle = "rgba(24, 24, 30, 0.32)";
    cx.lineWidth = 0.75;
    cx.lineCap = "round";
    cx.stroke(new Path2D("M10.6 16.5 Q12.0 17.3 13.4 16.5"));
    return;
  }

  if (variant === "amber") {
    drawAmbientHalo(cx, "245, 158, 11");
    fillShadedOrb(
      cx,
      12,
      12.9,
      7.7,
      "#ff9d5c",
      "#eb7131",
      "#be4b16",
      "rgba(255, 196, 150, 0.28)",
    );

    cx.strokeStyle = "#3f6a34";
    cx.lineWidth = 1.45;
    cx.lineCap = "round";
    cx.stroke(new Path2D("M12 5.3 C12.4 3.7 13.8 3.0 15.2 3.4"));
    cx.fillStyle = "#5ba048";
    cx.beginPath();
    cx.ellipse(14.8, 3.6, 1.9, 1.0, -0.35, 0, Math.PI * 2);
    cx.fill();

    cx.save();
    cx.translate(9.6, 12.5);
    cx.rotate(0.2);
    drawPillEye(cx, 0, 0, 1.9, 3.5, "#1c120d");
    cx.restore();

    cx.save();
    cx.translate(14.4, 12.5);
    cx.rotate(-0.2);
    drawPillEye(cx, 0, 0, 1.9, 3.5, "#1c120d");
    cx.restore();
    return;
  }

  if (variant === "muse") {
    drawAmbientHalo(cx, "244, 114, 182");
    fillShadedOrb(
      cx,
      12,
      13.1,
      7.4,
      "#fce3d4",
      "#f2cdba",
      "#dba78f",
      "rgba(201, 74, 74, 0.24)",
    );

    cx.fillStyle = "rgba(214, 108, 98, 0.34)";
    fillCircle(cx, 8.0, 14.5, 1.2);
    fillCircle(cx, 16.0, 14.5, 1.2);

    drawPillEye(cx, 9.9, 13.0, 1.85, 3.2, "#1f1918");
    drawPillEye(cx, 14.1, 13.0, 1.85, 3.2, "#1f1918");

    const capGrad = cx.createLinearGradient(5, 4.2, 19, 11.4);
    capGrad.addColorStop(0, "#df5c5c");
    capGrad.addColorStop(1, "#a93535");
    cx.fillStyle = capGrad;
    cx.fill(
      new Path2D(
        "M4.6 11.4 C5.0 6.0 8.4 4.1 12.2 4.2 C16.2 4.3 19.1 6.8 19.3 11.2 C16.3 9.4 7.8 9.4 4.6 11.4 Z",
      ),
    );
    fillCircle(cx, 12.2, 3.9, 1.2);
    return;
  }

  if (variant === "mint") {
    drawAmbientHalo(cx, "52, 211, 153");
    fillShadedOrb(
      cx,
      12,
      12.0,
      8.2,
      "#86dfc0",
      "#4db894",
      "#2d8c6e",
      "rgba(134, 223, 192, 0.30)",
    );
    drawPillEye(cx, 9.8, 11.6, 1.95, 3.6, "#12211b");
    drawPillEye(cx, 14.2, 11.6, 1.95, 3.6, "#12211b");
    cx.strokeStyle = "rgba(18, 33, 27, 0.48)";
    cx.lineWidth = 0.85;
    cx.lineCap = "round";
    cx.stroke(new Path2D("M10.5 15.4 Q12.0 16.3 13.5 15.4"));
    return;
  }

  drawAmbientHalo(cx, "167, 139, 250");
  fillShadedOrb(
    cx,
    12,
    12.0,
    8.2,
    "#b3a1f7",
    "#856fe0",
    "#5d47b5",
    "rgba(179, 161, 247, 0.30)",
  );
  drawPillEye(cx, 9.8, 11.5, 1.95, 3.5, "#161226");
  drawPillEye(cx, 14.2, 11.5, 1.95, 3.5, "#161226");
  cx.strokeStyle = "rgba(22, 18, 38, 0.45)";
  cx.lineWidth = 0.85;
  cx.lineCap = "round";
  cx.stroke(new Path2D("M10.5 15.4 Q12.0 16.3 13.5 15.4"));
}

export interface BotCharacterProps {
  seed?: string;
  variant?: BotVariant;
  size?: number;
  status?: string;
  /** Cutout ring color around the status badge; defaults to `palette().canvas` (safe on Monochrome). */
  ringColor?: string;
}

export function BotCharacter(props: BotCharacterProps) {
  return (
    <View
      style={{
        position: "relative",
        width: props.size ?? 34,
        height: props.size ?? 34,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Canvas
        style={{
          width: props.size ?? 34,
          height: props.size ?? 34,
          flexShrink: 0,
          pointerEvents: "none",
        }}
        draw={(cx, size) => {
          if (size.width <= 0 || size.height <= 0) return;
          cx.save();
          cx.scale(size.width / 24, size.height / 24);
          drawCharacterFace(cx, pickVariant(props.seed, props.variant));
          cx.restore();
        }}
      />
      <If when={(props.status ?? "").trim()}>
        {status => (
          <View
            style={{
              position: "absolute",
              right: -1,
              bottom: -1,
              width: Math.max(8, Math.round((props.size ?? 34) * 0.26)),
              height: Math.max(8, Math.round((props.size ?? 34) * 0.26)),
              borderRadius: 999,
              borderWidth: 2,
              borderColor: props.ringColor ?? palette().canvas,
              backgroundColor: characterStatusColor(status()),
            }}
          />
        )}
      </If>
    </View>
  );
}
