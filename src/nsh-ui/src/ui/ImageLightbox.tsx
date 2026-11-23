// Full-screen image preview lightbox for composer thumbnails, user message images,
// assistant Markdown images, and tool output images.

import { Image, Text, View, cleanup, signal } from "nsh";
import { Dialog } from "nsh/base";
import { tr } from "../i18n";
import { elevationShadow, palette, radii, space, textLineHeight, textSize } from "../theme";
import { Icon } from "./icons";
import { modalEnterMotion } from "./motion";
import { registerEscapeDismiss } from "./overlays";
import { IconButton } from "./primitives";

export interface LightboxImage {
  src: string;
  title?: string;
}

export const lightboxImage = signal<LightboxImage | null>(null);

export function openImageLightbox(image: LightboxImage): void {
  const src = image.src.trim();
  if (!src) return;
  lightboxImage.set({ src, title: image.title?.trim() || undefined });
}

export function closeImageLightbox(): void {
  lightboxImage.set(null);
}

function ImageLightboxCard(props: { image: LightboxImage }) {
  const naturalSize = signal<{ width: number; height: number } | null>(null);
  const loadFailed = signal(false);
  const motion = modalEnterMotion();
  cleanup(registerEscapeDismiss(() => closeImageLightbox()));

  return (
    <View
      role="dialog"
      accessibilityLabel="image-lightbox-dialog"
      style={[
        {
          width: "100%",
          maxWidth: 1040,
          maxHeight: "90%",
          borderRadius: radii.xl,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: palette().border,
          backgroundColor: palette().surfaceElevated,
          boxShadow: `${elevationShadow(3)}, ${palette().innerHighlight}`,
          overflow: "hidden",
          flexDirection: "column",
        },
        motion.style,
      ]}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: space.md,
          paddingHorizontal: space.lg,
          paddingVertical: space.sm,
          borderBottomWidth: 1,
          borderColor: palette().borderSubtle,
          backgroundColor: palette().surfaceSubtle,
          flexShrink: 0,
        }}
      >
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Icon name="image" size={14} color={palette().textMuted} />
          <Text
            style={{
              flexShrink: 1,
              minWidth: 0,
              color: palette().text,
              fontSize: textSize(13),
              lineHeight: textLineHeight(13, 1.35),
              fontWeight: "500",
              numberOfLines: 1,
              textOverflow: "ellipsis-middle",
            }}
          >
            {props.image.title || tr("sessions.imagePreviewTitle")}
          </Text>
          <If when={naturalSize()}>
            {size => (
              <Text
                style={{
                  flexShrink: 0,
                  color: palette().textMuted,
                  fontSize: textSize(12),
                  lineHeight: textLineHeight(12, 1.3),
                  fontVariant: ["tabular-nums"],
                }}
              >
                {`${size().width} × ${size().height}`}
              </Text>
            )}
          </If>
        </View>
        <IconButton
          icon="close"
          size="xs"
          accessibilityLabel="image-lightbox-close"
          tooltip={tr("common.close")}
          onPress={closeImageLightbox}
        />
      </View>

      <View
        style={{
          flex: 1,
          minHeight: 240,
          padding: space.lg,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: palette().canvas,
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
          <Image
            src={props.image.src}
            accessibilityLabel="image-lightbox-img"
            onLoad={event => {
              if (event.size.width > 0 && event.size.height > 0) {
                naturalSize.set(event.size);
              }
            }}
            onError={() => loadFailed.set(true)}
            style={{
              width: "100%",
              height: "100%",
              minHeight: 220,
              maxHeight: 680,
              objectFit: "contain",
              borderRadius: radii.md,
            }}
          />
        </If>
      </View>
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
          accessibilityLabel="image-lightbox"
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
            backdropFilter: "blur(14px)",
          }}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            padding: space.xl,
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "box-none",
          }}
        >
          <ImageLightboxCard image={image()} />
        </Dialog>
      )}
    </If>
  );
}
