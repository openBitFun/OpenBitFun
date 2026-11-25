// Frameless full-viewport image preview lightbox + shared ImageViewerStage /
// ImageViewerToolbar reused by both the session image lightbox and FilesScene
// image preview. Supports 25% step zoom, real percentage readout, fit / 1:1
// toggle, right-click copy (`Menu.popup` -> `Clipboard.writeImage`), and click
// copy button below the image.

import { Clipboard, Image, Scroll, Text, View, cleanup, computed, effect, signal } from "nsh";
import { Dialog } from "nsh/base";
import { isAvailable as desktopMenusAvailable, Menu } from "nsh/desktop";
import { tr } from "../i18n";
import { elevationShadow, palette, radii, space, textLineHeight, textSize, textStyle } from "../theme";
import { Icon } from "./icons";
import { MOTION_DURATION, modalEnterMotion, pressTransition, tactileActiveStyle } from "./motion";
import { pushToast, registerEscapeDismiss } from "./overlays";
import { IconButton, TooltipBubble, focusRingStyle } from "./primitives";

export interface LightboxImage {
  src: string;
  title?: string;
}

export type ImageZoomState = "fit" | number;

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4.0;

export const lightboxImage = signal<LightboxImage | null>(null);

export function openImageLightbox(image: LightboxImage): void {
  const src = image.src.trim();
  if (!src) return;
  lightboxImage.set({ src, title: image.title?.trim() || undefined });
}

export function closeImageLightbox(): void {
  lightboxImage.set(null);
}

/** Computes the fit scale (<= 1 for small images, proportional shrink for large ones). */
export function computeImageFitScale(
  natural: { width: number; height: number } | null,
  stage: { width: number; height: number } | null,
): number {
  if (!natural || natural.width <= 0 || natural.height <= 0) return 1;
  if (!stage || stage.width <= 0 || stage.height <= 0) return 1;
  return Math.min(1, stage.width / natural.width, stage.height / natural.height);
}

/** Steps zoom cleanly by 25% increments (`25%`, `50%`, `75%`, `100%`, `125%`, ...). */
export function stepImageZoom(current: ImageZoomState, direction: 1 | -1, fitScale: number): number {
  const base = current === "fit" ? fitScale : current;
  const raw =
    direction > 0
      ? (Math.floor(base / ZOOM_STEP + 1e-6) + 1) * ZOOM_STEP
      : (Math.ceil(base / ZOOM_STEP - 1e-6) - 1) * ZOOM_STEP;
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, raw));
  return Math.round(clamped * 100) / 100;
}

export interface ImageViewerToolbarProps {
  zoom: () => ImageZoomState;
  effectiveScale: () => number;
  src: () => string;
  onZoomChange: (next: ImageZoomState) => void;
  showClose?: boolean;
  onClose?: () => void;
}

/**
 * Shared floating pill toolbar rendered beneath an image preview in both
 * ImageLightbox and FilesScene: `[ - | 100% | + | 1:1 / Fit | Copy (| Close) ]`.
 */
export function ImageViewerToolbar(props: ImageViewerToolbarProps) {
  const copied = signal(false);
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;
  cleanup(() => {
    if (copiedTimer) {
      clearTimeout(copiedTimer);
      copiedTimer = null;
    }
  });

  const copyImage = async () => {
    const src = props.src();
    if (!src) return;
    try {
      await Clipboard.writeImage(src);
      copied.set(true);
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => {
        copiedTimer = null;
        copied.set(false);
      }, 1500);
      pushToast(tr("sessions.imageCopied"), "success");
    } catch {
      pushToast(tr("sessions.imageCopyFailed"), "error");
    }
  };

  const pct = () => `${Math.max(1, Math.round(props.effectiveScale() * 100))}%`;
  const atMin = () => props.zoom() !== "fit" && (props.zoom() as number) <= ZOOM_MIN + 1e-4;
  const atMax = () => props.zoom() !== "fit" && (props.zoom() as number) >= ZOOM_MAX - 1e-4;

  return (
    <View
      accessibilityLabel="image-viewer-toolbar"
      onPress={() => undefined}
      style={{
        flexDirection: "row",
        alignItems: "center",
        flexShrink: 0,
        gap: 2,
        paddingHorizontal: 6,
        paddingVertical: 4,
        borderRadius: radii.pill,
        borderWidth: 1,
        borderColor: palette().border,
        backgroundColor: palette().glassOverlayBg,
        backdropFilter: "blur(16px) saturate(1.2)",
        boxShadow: `${elevationShadow(2)}, ${palette().innerHighlight}`,
      }}
    >
      <IconButton
        icon="minus"
        size="xs"
        iconSize={13}
        disabled={atMin()}
        tooltip={tr("files.zoomOut")}
        accessibilityLabel="image-zoom-out"
        style={{ borderRadius: radii.pill }}
        onPress={() => props.onZoomChange(stepImageZoom(props.zoom(), -1, props.effectiveScale()))}
      />
      <View
        role="button"
        accessibilityLabel="image-zoom-percent"
        tooltip={<TooltipBubble text={tr("files.zoomFit")} />}
        onPress={() => props.onZoomChange("fit")}
        style={{
          minWidth: 46,
          height: 24,
          paddingHorizontal: space.xs,
          borderRadius: radii.pill,
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          userSelect: "none",
          ...pressTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={{ backgroundColor: palette().panelHover }}
        activeStyle={tactileActiveStyle(0.96)}
        focusVisibleStyle={focusRingStyle()}
      >
        <Text
          style={{
            ...textStyle("caption", { color: palette().text, tabular: true }),
            fontWeight: "500",
          }}
        >
          {pct()}
        </Text>
      </View>
      <IconButton
        icon="plus"
        size="xs"
        iconSize={13}
        disabled={atMax()}
        tooltip={tr("files.zoomIn")}
        accessibilityLabel="image-zoom-in"
        style={{ borderRadius: radii.pill }}
        onPress={() => props.onZoomChange(stepImageZoom(props.zoom(), 1, props.effectiveScale()))}
      />

      <View style={{ width: 1, height: 14, marginHorizontal: 4, backgroundColor: palette().borderSubtle }} />

      <View
        role="button"
        accessibilityLabel={props.zoom() === "fit" ? "image-zoom-actual" : "image-zoom-fit"}
        onPress={() => props.onZoomChange(props.zoom() === "fit" ? 1 : "fit")}
        style={{
          height: 24,
          paddingHorizontal: space.sm,
          borderRadius: radii.pill,
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          userSelect: "none",
          ...pressTransition(MOTION_DURATION.fast),
        }}
        hoverStyle={{ backgroundColor: palette().panelHover }}
        activeStyle={tactileActiveStyle(0.96)}
        focusVisibleStyle={focusRingStyle()}
      >
        <Text
          style={{
            ...textStyle("caption", { color: palette().textSecondary, tabular: true }),
            fontWeight: "500",
          }}
        >
          {props.zoom() === "fit" ? "1:1" : tr("files.zoomFit")}
        </Text>
      </View>

      <View style={{ width: 1, height: 14, marginHorizontal: 4, backgroundColor: palette().borderSubtle }} />

      <IconButton
        icon={copied() ? "check" : "copy"}
        size="xs"
        iconSize={13}
        accessibilityLabel="image-lightbox-copy"
        tooltip={tr("sessions.copyImage")}
        style={{ borderRadius: radii.pill }}
        onPress={() => void copyImage()}
      />

      <If when={Boolean(props.showClose && props.onClose)}>
        <View style={{ width: 1, height: 14, marginHorizontal: 4, backgroundColor: palette().borderSubtle }} />
        <IconButton
          icon="close"
          size="xs"
          iconSize={13}
          accessibilityLabel="image-lightbox-close"
          tooltip={tr("common.close")}
          style={{ borderRadius: radii.pill }}
          onPress={() => props.onClose?.()}
        />
      </If>
    </View>
  );
}

export interface ImageViewerSurfaceProps {
  src: () => string;
  imageAccessibilityLabel?: () => string;
  zoom: () => ImageZoomState;
  onZoomChange: (next: ImageZoomState) => void;
  showClose?: boolean;
  onClose?: () => void;
  onBackdropPress?: () => void;
  onError?: (message: string) => void;
  padding?: number;
}

/**
 * Shared borderless image preview stage + floating bottom zoom/copy toolbar.
 * Used identically by both full-screen `ImageLightboxHost` and `FilesScene`.
 */
export function ImageViewerSurface(props: ImageViewerSurfaceProps) {
  const naturalSize = signal<{ width: number; height: number } | null>(null);
  const stageSize = signal<{ width: number; height: number } | null>(null);
  const loadFailed = signal(false);

  effect(() => {
    props.src();
    naturalSize.set(null);
    loadFailed.set(false);
  });

  const fitScale = computed(() => computeImageFitScale(naturalSize(), stageSize()));
  const effectiveScale = computed(() => {
    const z = props.zoom();
    return z === "fit" ? fitScale() : z;
  });

  const displayDimensions = computed<{ width: number; height: number } | null>(() => {
    const nat = naturalSize();
    if (!nat || nat.width <= 0 || nat.height <= 0) return null;
    const scale = effectiveScale();
    return {
      width: Math.max(1, Math.round(nat.width * scale)),
      height: Math.max(1, Math.round(nat.height * scale)),
    };
  });

  const copyViaContextMenu = async () => {
    const src = props.src();
    if (!src) return;
    try {
      await Clipboard.writeImage(src);
      pushToast(tr("sessions.imageCopied"), "success");
    } catch {
      pushToast(tr("sessions.imageCopyFailed"), "error");
    }
  };

  const pad = props.padding ?? space.lg;

  return (
    <View
      style={{
        flex: 1,
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: pad,
        gap: space.md,
      }}
    >
      <View
        accessibilityLabel="image-lightbox-stage"
        onPress={props.onBackdropPress}
        onLayout={event => {
          const w = Math.floor(event.bounds.size.width);
          const h = Math.floor(event.bounds.size.height);
          const prev = stageSize();
          if (w > 0 && h > 0 && (!prev || Math.abs(prev.width - w) > 1 || Math.abs(prev.height - h) > 1)) {
            stageSize.set({ width: w, height: h });
          }
        }}
        style={{
          flex: 1,
          width: "100%",
          minWidth: 0,
          minHeight: 0,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <If
          when={!loadFailed()}
          else={
            <View style={{ alignItems: "center", gap: space.sm, padding: space.xl }}>
              <Icon name="image" size={28} color={palette().textMuted} />
              <Text style={{ color: palette().textMuted, fontSize: textSize(13), lineHeight: textLineHeight(13, 1.4) }}>
                {tr("sessions.imagePreviewFailed")}
              </Text>
            </View>
          }
        >
          <Scroll
            horizontal={false}
            scrollbar={props.zoom() !== "fit"}
            style={{ flex: 1, width: "100%", minHeight: 0 }}
            contentStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}
          >
            <Scroll
              horizontal
              scrollbar={props.zoom() !== "fit"}
              style={{ flex: 1, minWidth: 0 }}
              contentStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}
            >
              <View
                onPress={() => undefined}
                onContextMenu={event => {
                  // Desktops only: the toolbar's copy button is the same action elsewhere.
                  if (!desktopMenusAvailable) return;
                  void Menu.popup(
                    [{ label: tr("sessions.copyImage"), onSelect: () => void copyViaContextMenu() }],
                    event.pagePosition,
                  );
                }}
                style={{
                  width: displayDimensions()?.width ?? stageSize()?.width ?? "100%",
                  height: displayDimensions()?.height ?? stageSize()?.height ?? "100%",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Image
                  src={props.src()}
                  accessibilityLabel={props.imageAccessibilityLabel?.() ?? "image-lightbox-img"}
                  onLoad={event => {
                    loadFailed.set(false);
                    if (event.size.width > 0 && event.size.height > 0) {
                      naturalSize.set(event.size);
                    }
                  }}
                  onError={event => {
                    loadFailed.set(true);
                    props.onError?.(event.message);
                  }}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    borderRadius: radii.md,
                  }}
                />
              </View>
            </Scroll>
          </Scroll>
        </If>
      </View>

      <ImageViewerToolbar
        zoom={props.zoom}
        effectiveScale={effectiveScale}
        src={props.src}
        onZoomChange={props.onZoomChange}
        showClose={props.showClose}
        onClose={props.onClose}
      />
    </View>
  );
}

function ImageLightboxView(props: { image: LightboxImage }) {
  const zoom = signal<ImageZoomState>("fit");
  const motion = modalEnterMotion();
  cleanup(registerEscapeDismiss(() => closeImageLightbox()));

  return (
    <View
      role="dialog"
      accessibilityLabel="image-lightbox-dialog"
      style={[
        {
          flex: 1,
          width: "100%",
          height: "100%",
          flexDirection: "column",
        },
        motion.style,
      ]}
    >
      <ImageViewerSurface
        src={() => props.image.src}
        zoom={zoom}
        onZoomChange={next => zoom.set(next)}
        showClose={true}
        onClose={closeImageLightbox}
        onBackdropPress={closeImageLightbox}
        padding={space.xl}
      />
    </View>
  );
}

export function ImageLightboxHost() {
  return (
    <If when={lightboxImage()}>
      {image => (
        <Dialog
          open={true}
          animation="none"
          accessibilityLabel="image-lightbox-modal"
          closeOnBackdropPress={true}
          closeOnEscape={true}
          onOpenChange={event => {
            if (!event.open) closeImageLightbox();
          }}
          onCancel={closeImageLightbox}
          backdropStyle={{
            position: "absolute",
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            backgroundColor: palette().scrimBg,
            backdropFilter: "blur(16px)",
          }}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            alignItems: "stretch",
            justifyContent: "center",
            pointerEvents: "box-none",
          }}
        >
          <ImageLightboxView image={image()} />
        </Dialog>
      )}
    </If>
  );
}
