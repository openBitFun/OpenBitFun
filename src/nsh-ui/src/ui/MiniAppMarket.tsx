// Spaces > Market and Submissions: the MiniApp market in the calm studio
// language. Display only — every number, permission and decision is the host's
// (`src/miniAppMarketStore.ts`); this file draws it.

import { Canvas, openUrl, Path2D, Text, View } from "nsh";
import { formatCount, formatDate } from "../format";
import { localizeHostError, tr } from "../i18n";
import {
  canWithdrawSubmission,
  cancelMarketInstallPrompt,
  closeMarketListing,
  closePackageImport,
  confirmingWithdrawId,
  confirmMarketInstallPrompt,
  importInspectedPackage,
  inspectPackage,
  installMarketListing,
  loadMarket,
  loadMoreMarket,
  loadSubmissions,
  MARKET_CATEGORIES,
  MARKET_RELEASES_COLLAPSED,
  marketActionBusy,
  marketCanUpdate,
  marketCategory,
  marketCategoryLabel,
  marketDetail,
  marketDetailError,
  marketDetailLoading,
  marketDetailSlug,
  marketError,
  marketInitialLoad,
  marketInstalled,
  marketInstalledYanked,
  marketInstalling,
  marketInstallPrompt,
  marketItems,
  marketLoading,
  marketLoadingMore,
  marketNextCursor,
  marketOrigins,
  marketPermissionLines,
  marketQuery,
  marketReleasesExpanded,
  marketSignInRequired,
  marketSort,
  marketUnsupported,
  marketWorkspaceBlockedReason,
  openInstalledMarketApp,
  openMarketListing,
  packageImportBusy,
  packageImportError,
  packageImportOpen,
  packageImportPath,
  packageInspection,
  rateMarketListing,
  refreshMarketListing,
  setMarketCategory,
  setMarketQuery,
  setMarketSort,
  setPackageImportPath,
  submissions,
  submissionsError,
  submissionsLoaded,
  submissionsLoading,
  submissionsSignInRequired,
  submissionStatusLabel,
  toggleMarketFavorite,
  withdrawingSubmissionId,
  withdrawSubmission,
  type MarketCategory,
  type MarketListing,
  type MarketSort,
  type MarketSubmission,
} from "../miniAppMarketStore";
import { spaceWindowBlockedReason } from "../spacesStore";
import {
  compactLayout,
  fontMono,
  layout,
  palette,
  radii,
  space,
  textLineHeight,
  textSize,
  touchSlop,
} from "../theme";
import { openAccountAuthModal } from "./AccountAuthModal";
import { stateColor } from "./fleet";
import { Icon, type IconName } from "./icons";
import { pressTransition, Spinner, tactileActiveStyle } from "./motion";
import { ModalDialog, pushToast, SelectDropdown, type SelectDropdownOption } from "./overlays";
import { Button, focusRingStyle, IconButton, InlineBanner, InlineConfirmBar, InputBox, SearchInput } from "./primitives";
import {
  GalleryGrid,
  GallerySkeleton,
  InsetGroup,
  InsetRow,
  StudioEmpty,
  StudioSection,
  galleryCardHoverStyle,
  galleryCardStyle,
  studioCompact,
} from "./studio";

// ── Icons ─────────────────────────────────────────────────────────────────────

/**
 * Manifest icon names the desktop's miniAppIcons map knows (kebab-case lucide
 * names), projected onto glyphs this surface draws. Unknown names fall back
 * to the package glyph, as the desktop falls back to lucide's Box.
 */
const SPACE_ICON_MAP: Readonly<Record<string, IconName>> = {
  "app-window": "layers",
  aperture: "compass",
  bot: "bot",
  box: "package",
  code: "code",
  database: "database",
  "file-text": "file-text",
  "git-pull-request": "git-pull-request",
  globe: "globe",
  "grid-3x3": "layout-grid",
  image: "image",
  "layout-grid": "layout-grid",
  presentation: "monitor",
  regex: "hash",
  rocket: "zap",
  settings: "settings",
  sparkles: "sparkles",
  terminal: "terminal",
  workflow: "network",
  wrench: "wrench",
};

export function spaceIconName(icon: string): IconName {
  const key = icon
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
  return SPACE_ICON_MAP[key] ?? "package";
}

const HEART_PATH =
  "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z";
const STAR_PATH =
  "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z";

const glyphPaths = new Map<string, Path2D>();
function glyphPath(d: string): Path2D {
  let path = glyphPaths.get(d);
  if (!path) {
    path = new Path2D(d);
    glyphPaths.set(d, path);
  }
  return path;
}

/** A heart or star that can be drawn filled (favourited / rated) or outlined. */
function MarketGlyph(props: { shape: "heart" | "star"; filled: () => boolean; color: () => string; size?: number }) {
  return (
    <Canvas
      style={{ width: props.size ?? 14, height: props.size ?? 14, flexShrink: 0, pointerEvents: "none" }}
      draw={(cx, size) => {
        if (size.width <= 0 || size.height <= 0) return;
        const color = props.color();
        cx.save();
        cx.scale(size.width / 24, size.height / 24);
        cx.strokeStyle = color;
        cx.fillStyle = color;
        cx.lineWidth = 1.8;
        cx.lineCap = "round";
        cx.lineJoin = "round";
        const path = glyphPath(props.shape === "heart" ? HEART_PATH : STAR_PATH);
        if (props.filled()) cx.fill(path);
        cx.stroke(path);
        cx.restore();
      }}
    />
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────────

function MutedLine(props: { text: string; mono?: boolean; accessibilityLabel?: string }) {
  return (
    <Text
      accessibilityLabel={props.accessibilityLabel}
      style={{
        minWidth: 0,
        color: palette().textMuted,
        fontFamily: props.mono ? fontMono : undefined,
        fontSize: textSize(12),
        lineHeight: textLineHeight(12, 1.45),
      }}
    >
      {props.text}
    </Text>
  );
}

function BodyText(props: { text: string; secondary?: boolean }) {
  return (
    <Text
      style={{
        minWidth: 0,
        color: props.secondary ? palette().textSecondary : palette().text,
        fontSize: textSize(13),
        lineHeight: textLineHeight(13, 1.5),
      }}
    >
      {props.text}
    </Text>
  );
}

function SectionHeader(props: { text: string }) {
  return (
    <Text
      role="header"
      style={{
        color: palette().textSecondary,
        fontSize: textSize(13),
        fontWeight: "600",
        lineHeight: textLineHeight(13, 1.35),
        marginBottom: 2,
      }}
    >
      {props.text}
    </Text>
  );
}

/** "4.6 · 1,234 downloads · 31 favorites", paired with a vector star glyph. */
function listingStats(item: MarketListing): string {
  return [
    item.ratingAverage.toFixed(1),
    tr("market.downloads", { count: formatCount(item.downloadCount) }),
    tr("market.favorites", { count: formatCount(item.favoriteCount) }),
  ].join(" · ");
}

function sortOptions(): ReadonlyArray<SelectDropdownOption<MarketSort>> {
  return [
    { value: "newest", label: tr("market.sortNewest") },
    { value: "downloads", label: tr("market.sortDownloads") },
    { value: "rating", label: tr("market.sortRating") },
  ];
}

function categoryOptions(): ReadonlyArray<SelectDropdownOption<MarketCategory>> {
  return MARKET_CATEGORIES.map(value => ({
    value,
    label: marketCategoryLabel(value),
    accessibilityLabel: `market-category-${value}`,
  }));
}

// ── Market view ───────────────────────────────────────────────────────────────

function MarketCard(props: { item: () => MarketListing }) {
  const installed = () => Boolean(marketOrigins()[props.item().listingId]);
  return (
    <View
      role="button"
      accessibilityLabel={`market-card-${props.item().slug}`}
      onPress={() => void openMarketListing(props.item().slug)}
      style={{
        ...galleryCardStyle(),
        minHeight: 148,
        gap: space.xs,
        cursor: "pointer",
        borderColor: marketDetailSlug() === props.item().slug ? palette().borderFocus : palette().borderSubtle,
        ...pressTransition(),
      }}
      hoverStyle={compactLayout() ? undefined : galleryCardHoverStyle()}
      activeStyle={tactileActiveStyle(0.99)}
      focusVisibleStyle={{ ...focusRingStyle(), outlineOffset: -2 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minWidth: 0 }}>
        <Icon name={spaceIconName(props.item().icon)} size={16} color={palette().textSecondary} />
        <Text
          style={{
            flex: 1,
            minWidth: 0,
            color: palette().text,
            fontSize: textSize(14),
            fontWeight: "600",
            lineHeight: textLineHeight(14, 1.35),
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {props.item().name}
        </Text>
        <If when={installed()}>
          <Text
            accessibilityLabel={`market-installed-${props.item().slug}`}
            style={{
              flexShrink: 0,
              color: palette().textMuted,
              fontSize: textSize(12),
              lineHeight: textLineHeight(12, 1.3),
            }}
          >
            {tr("market.installedMark")}
          </Text>
        </If>
      </View>
      <Text
        style={{
          minWidth: 0,
          color: palette().textMuted,
          fontSize: textSize(12),
          fontVariant: ["tabular-nums"],
          lineHeight: textLineHeight(12, 1.4),
          numberOfLines: 1,
          textOverflow: "ellipsis",
        }}
      >
        {[marketCategoryLabel(props.item().category), `v${props.item().latestRelease}`, props.item().ownerLogin]
          .filter(Boolean)
          .join(" · ")}
      </Text>
      <Text
        style={{
          marginTop: space.hair,
          minWidth: 0,
          color: palette().textSecondary,
          fontSize: textSize(13),
          lineHeight: textLineHeight(13, 1.5),
          numberOfLines: 2,
          textOverflow: "ellipsis",
        }}
      >
        {props.item().description || tr("common.noDescription")}
      </Text>
      <View style={{ flex: 1 }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, minWidth: 0 }}>
        <MarketGlyph shape="star" size={12} filled={() => true} color={() => palette().textMuted} />
        <Text
          style={{
            flex: 1,
            minWidth: 0,
            color: palette().textMuted,
            fontSize: textSize(12),
            fontVariant: ["tabular-nums"],
            lineHeight: textLineHeight(12, 1.4),
            numberOfLines: 1,
            textOverflow: "ellipsis",
          }}
        >
          {listingStats(props.item())}
        </Text>
      </View>
    </View>
  );
}

function MarketToolbar() {
  return (
    <View
      style={{
        flexDirection: studioCompact() ? "column" : "row",
        alignItems: studioCompact() ? "stretch" : "center",
        gap: space.sm,
        minWidth: 0,
      }}
    >
      <SearchInput
        size={compactLayout() ? "lg" : "md"}
        value={marketQuery()}
        placeholder={tr("market.searchPlaceholder")}
        accessibilityLabel="market-search"
        onChange={value => setMarketQuery(value)}
        style={{
          flex: 1,
          minWidth: 0,
          ...(compactLayout() ? { height: layout.touchTarget, minHeight: layout.touchTarget } : {}),
        }}
      />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          flexWrap: "wrap",
          gap: space.sm,
          flexShrink: 0,
          minWidth: 0,
        }}
      >
        <SelectDropdown
          options={categoryOptions()}
          value={marketCategory()}
          size="md"
          minWidth={compactLayout() ? 120 : 150}
          accessibilityLabel="market-category"
          style={compactLayout() ? { flex: 1, minWidth: 120 } : undefined}
          onChange={value => setMarketCategory(value)}
        />
        <SelectDropdown
          options={sortOptions()}
          value={marketSort()}
          size="md"
          minWidth={compactLayout() ? 120 : 140}
          accessibilityLabel="market-sort"
          style={compactLayout() ? { flex: 1, minWidth: 120 } : undefined}
          onChange={value => setMarketSort(value)}
        />
      </View>
    </View>
  );
}

export function MiniAppMarketView() {
  const hasMarketFilters = () => Boolean(marketQuery().trim()) || marketCategory() !== "all";
  return (
    <View style={{ gap: space.xl, minWidth: 0 }}>
      <MarketToolbar />

      <StudioSection
        title={tr("market.catalogTitle")}
        accessibilityLabel="market-catalog"
        trailing={
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <If when={marketLoading() && !marketInitialLoad()}>
              <Spinner size={14} />
            </If>
            <IconButton
              icon="refresh"
              size={compactLayout() ? "md" : "sm"}
              accessibilityLabel="market-refresh"
              tooltip={tr("market.refresh")}
              disabled={marketLoading()}
              style={
                compactLayout()
                  ? {
                      width: layout.touchTarget,
                      height: layout.touchTarget,
                      minWidth: layout.touchTarget,
                      minHeight: layout.touchTarget,
                    }
                  : undefined
              }
              onPress={() => void loadMarket()}
            />
          </View>
        }
      >
        <If when={marketLoading() && marketItems().length === 0 && !marketError()}>
          <GallerySkeleton count={4} height={148} minColumn={280} />
        </If>
        <If when={!marketLoading() ? marketError() : ""}>
          {error => (
            <StudioEmpty
              accessibilityLabel={marketUnsupported() ? "market-unsupported" : "market-error"}
              icon={marketUnsupported() ? "info" : "warning"}
              tone={marketUnsupported() ? "neutral" : "danger"}
              message={marketUnsupported() ? tr("market.unsupportedTitle") : tr("market.catalogFailed")}
              detail={localizeHostError(error())}
              action={
                <If when={!marketUnsupported()}>
                  <Button
                    label={tr("market.retry")}
                    variant="outline"
                    size={compactLayout() ? "md" : "sm"}
                    leadingIcon="refresh"
                    accessibilityLabel="market-retry"
                    style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
                    onPress={() => void loadMarket()}
                  />
                </If>
              }
            />
          )}
        </If>
        <If when={!marketLoading() && !marketError() && marketItems().length === 0}>
          <StudioEmpty
            accessibilityLabel="market-empty"
            icon="package"
            message={tr("market.emptyTitle")}
            detail={hasMarketFilters() ? tr("market.emptyFiltered") : tr("market.emptyDetail")}
            action={
              <If when={hasMarketFilters()}>
                <Button
                  label={tr("common.resetFilter")}
                  variant="secondary"
                  size="md"
                  accessibilityLabel="market-empty-reset"
                  style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
                  onPress={() => {
                    setMarketQuery("");
                    setMarketCategory("all");
                  }}
                />
              </If>
            }
          />
        </If>
        <If when={marketItems().length > 0 && !marketError()}>
          <View style={{ gap: 16, minWidth: 0 }}>
            <GalleryGrid minColumn={280}>
              <Each of={marketItems()} key={item => item.listingId || item.slug}>
                {item => <MarketCard item={item} />}
              </Each>
            </GalleryGrid>
            <If when={Boolean(marketNextCursor())}>
              <View style={{ alignItems: "center" }}>
                <Button
                  label={tr("market.loadMore")}
                  variant="ghost"
                  size="sm"
                  loading={marketLoadingMore()}
                  accessibilityLabel="market-load-more"
                  onPress={() => void loadMoreMarket()}
                />
              </View>
            </If>
          </View>
        </If>
      </StudioSection>

      <MarketListingModal />
    </View>
  );
}

// ── Listing detail ────────────────────────────────────────────────────────────

function RatingRow() {
  const stars = [1, 2, 3, 4, 5];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.hair, minWidth: 0 }}>
      <Each of={stars}>
        {value => (
          <View
            role="button"
            accessibilityLabel={`market-rate-${value()}`}
            tooltip={compactLayout() ? undefined : tr("market.rateTooltip", { value: value() })}
            hitSlop={touchSlop(28)}
            disabled={marketActionBusy()}
            onPress={() => void rateMarketListing(value())}
            style={{
              width: compactLayout() ? layout.touchTarget : 28,
              height: compactLayout() ? layout.touchTarget : 28,
              borderRadius: radii.sm,
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              ...pressTransition(),
            }}
            hoverStyle={compactLayout() ? undefined : { backgroundColor: palette().panelHover }}
            activeStyle={tactileActiveStyle(0.92)}
            focusVisibleStyle={focusRingStyle()}
          >
            <MarketGlyph
              shape="star"
              size={16}
              filled={() => (marketDetail()?.myRating ?? 0) >= value()}
              color={() => ((marketDetail()?.myRating ?? 0) >= value() ? stateColor("needs_you") : palette().textMuted)}
            />
          </View>
        )}
      </Each>
      <Text
        accessibilityLabel="market-rating-summary"
        style={{
          marginLeft: space.sm,
          color: palette().textSecondary,
          fontSize: textSize(13),
          fontVariant: ["tabular-nums"],
          lineHeight: textLineHeight(13, 1.4),
        }}
      >
        {tr("market.ratingSummary", {
          average: (marketDetail()?.ratingAverage ?? 0).toFixed(1),
          count: formatCount(marketDetail()?.ratingCount ?? 0),
        })}
      </Text>
    </View>
  );
}

function ReleasesList() {
  const visible = () => {
    const releases = marketDetail()?.releases ?? [];
    return marketReleasesExpanded() ? releases : releases.slice(0, MARKET_RELEASES_COLLAPSED);
  };
  const hidden = () => Math.max(0, (marketDetail()?.releases.length ?? 0) - MARKET_RELEASES_COLLAPSED);
  return (
    <View style={{ gap: 8 }}>
      <InsetGroup accessibilityLabel="market-releases">
        <Each of={visible()} key={release => release.releaseId || String(release.releaseNumber)}>
          {(release, index) => (
            <InsetRow
              first={index() === 0}
              label={`v${release().releaseNumber}`}
              detail={[
                tr("market.minVersion", { version: release().minOpenBitFunVersion }),
                release().publishedAt ? formatDate(release().publishedAt) : "",
              ]
                .filter(Boolean)
                .join(" · ")}
              value={
                release().yanked
                  ? tr("market.yanked")
                  : marketInstalled()?.origin.releaseId === release().releaseId
                    ? tr("market.installedMark")
                    : ""
              }
              accessibilityLabel={`market-release-${release().releaseNumber}`}
            />
          )}
        </Each>
      </InsetGroup>
      <If when={hidden() > 0}>
        <View style={{ alignItems: "flex-start" }}>
          <Button
            label={
              marketReleasesExpanded()
                ? tr("market.releasesCollapse")
                : tr("market.releasesExpand", { count: formatCount(hidden()) })
            }
            variant="ghost"
            size="sm"
            trailingIcon={marketReleasesExpanded() ? "chevron-up" : "chevron-down"}
            accessibilityLabel="market-releases-toggle"
            onPress={() => marketReleasesExpanded.update(value => !value)}
          />
        </View>
      </If>
    </View>
  );
}

function InstallPromptBar() {
  return (
    <If when={marketInstallPrompt()}>
      {prompt => (
        <View accessibilityLabel="market-install-prompt">
          <InlineConfirmBar
            message={
              prompt().kind === "permissions"
                ? tr("market.confirmPermissions", {
                    permissions: prompt().kind === "permissions" ? (prompt() as { detail: string }).detail : "",
                  })
                : tr("market.confirmOverwrite")
            }
            confirmLabel={prompt().kind === "permissions" ? tr("market.allowAndInstall") : tr("market.overwrite")}
            cancelLabel={tr("common.cancel")}
            danger={prompt().kind === "overwrite"}
            onConfirm={() => confirmMarketInstallPrompt()}
            onCancel={() => cancelMarketInstallPrompt()}
          />
        </View>
      )}
    </If>
  );
}

function MarketListingFooter() {
  const blocked = () => marketWorkspaceBlockedReason();
  const installed = () => marketInstalled();
  const showInstall = () => Boolean(marketDetail()) && (!installed() || marketCanUpdate());
  return (
    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm }}>
      <If when={Boolean(marketDetail())}>
        <View
          role="button"
          accessibilityLabel="market-favorite"
          accessibilityState={{ selected: marketDetail()?.isFavorited === true, disabled: marketActionBusy() }}
          tooltip={compactLayout() ? undefined : marketDetail()?.isFavorited ? tr("market.unfavorite") : tr("market.favorite")}
          hitSlop={touchSlop(32)}
          disabled={marketActionBusy()}
          onPress={() => void toggleMarketFavorite()}
          style={{
            height: compactLayout() ? layout.touchTarget : 32,
            paddingHorizontal: space.md,
            borderRadius: radii.pill,
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs,
            cursor: "pointer",
            borderWidth: 1,
            borderColor: palette().borderSubtle,
            ...pressTransition(),
          }}
          hoverStyle={compactLayout() ? undefined : { backgroundColor: palette().panelHover }}
          activeStyle={tactileActiveStyle(0.96)}
          focusVisibleStyle={focusRingStyle()}
        >
          <MarketGlyph
            shape="heart"
            filled={() => marketDetail()?.isFavorited === true}
            color={() => (marketDetail()?.isFavorited ? stateColor("failed") : palette().textSecondary)}
          />
          <Text
            style={{
              color: palette().textSecondary,
              fontSize: textSize(13),
              fontVariant: ["tabular-nums"],
              lineHeight: textLineHeight(13, 1.3),
            }}
          >
            {formatCount(marketDetail()?.favoriteCount ?? 0)}
          </Text>
        </View>
      </If>
      <View style={{ flex: 1, minWidth: space.sm }} />
      <Button
        label={tr("common.close")}
        variant="secondary"
        size="md"
        accessibilityLabel="market-close"
        style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
        onPress={() => closeMarketListing()}
      />
      <If when={Boolean(installed()) && !marketCanUpdate()}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
          <Icon name="check" size={14} color={palette().textMuted} />
          <Text
            accessibilityLabel="market-detail-installed"
            style={{ color: palette().textSecondary, fontSize: textSize(13), lineHeight: textLineHeight(13, 1.3) }}
          >
            {tr("market.installedMark")}
          </Text>
        </View>
      </If>
      <If when={Boolean(installed())}>
        <Button
          label={tr("market.open")}
          variant={marketCanUpdate() ? "outline" : "primary"}
          size="md"
          leadingIcon="external-link"
          disabled={Boolean(blocked()) || Boolean(spaceWindowBlockedReason())}
          tooltip={blocked() || spaceWindowBlockedReason() || undefined}
          accessibilityLabel="market-open"
          style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
          onPress={() => openInstalledMarketApp()}
        />
      </If>
      <If when={showInstall()}>
        <Button
          label={marketCanUpdate() ? tr("market.update") : tr("market.install")}
          variant="primary"
          size="md"
          leadingIcon={marketCanUpdate() ? "refresh" : "download"}
          loading={marketInstalling()}
          disabled={Boolean(blocked()) || marketInstalling() || Boolean(marketInstallPrompt())}
          tooltip={blocked() || undefined}
          accessibilityLabel="market-install"
          style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
          onPress={() => void installMarketListing()}
        />
      </If>
    </View>
  );
}

function MarketListingModal() {
  return (
    <ModalDialog
      open={Boolean(marketDetailSlug())}
      title={marketDetail()?.name ?? tr("market.loadingListing")}
      subtitle={
        marketDetail()
          ? [
              marketCategoryLabel(marketDetail()!.category),
              marketDetail()!.ownerLogin ? tr("market.by", { owner: marketDetail()!.ownerLogin }) : "",
              `v${marketDetail()!.latestRelease}`,
            ]
              .filter(Boolean)
              .join(" · ")
          : undefined
      }
      size="lg"
      accessibilityLabel="market-listing"
      onClose={() => closeMarketListing()}
      footer={<MarketListingFooter />}
    >
      <View style={{ gap: 20 }}>
        <If when={marketDetailLoading()}>
          <View style={{ padding: 24, alignItems: "center" }}>
            <Spinner size={18} />
          </View>
        </If>
        <If when={!marketDetailLoading() ? marketDetailError() : ""}>
          {error => <InlineBanner tone="danger" message={localizeHostError(error())} />}
        </If>
        <If when={marketSignInRequired()}>
          <InlineBanner
            tone="info"
            accessibilityLabel="market-sign-in"
            message={tr("market.signInToAct")}
            actionLabel={tr("market.signIn")}
            onAction={() =>
              openAccountAuthModal({
                autoStart: true,
                onSuccess: () => {
                  marketSignInRequired.set(false);
                  void refreshMarketListing();
                },
              })
            }
            onDismiss={() => marketSignInRequired.set(false)}
          />
        </If>
        <If when={!marketDetailLoading() ? marketDetail() : null}>
          {detail => (
            <View style={{ gap: 20, minWidth: 0 }}>
              <BodyText text={detail().description || tr("common.noDescription")} secondary />
              <If when={marketWorkspaceBlockedReason(detail())}>
                {reason => <InlineBanner tone="warning" message={reason()} accessibilityLabel="market-remote-blocked" />}
              </If>
              <If when={marketInstalled()?.localOverride === true}>
                <InlineBanner tone="warning" message={tr("market.localOverride")} />
              </If>
              <If when={marketInstalledYanked()}>
                <InlineBanner tone="warning" message={tr("market.installedYanked")} />
              </If>
              <InstallPromptBar />

              <View style={{ gap: 6 }}>
                <SectionHeader text={tr("market.permissions")} />
                <If
                  when={marketPermissionLines(detail().permissions).length > 0}
                  else={<BodyText text={tr("market.noPermissions")} secondary />}
                >
                  <View accessibilityLabel="market-permissions" style={{ gap: 4 }}>
                    <Each of={marketPermissionLines(detail().permissions)} key="index">
                      {line => <BodyText text={line()} />}
                    </Each>
                  </View>
                </If>
              </View>

              <View style={{ gap: 6 }}>
                <SectionHeader text={tr("market.rating")} />
                <RatingRow />
              </View>

              <If when={detail().changelog}>
                {changelog => (
                  <View style={{ gap: 6 }}>
                    <SectionHeader text={tr("market.changelog")} />
                    <BodyText text={changelog()} />
                  </View>
                )}
              </If>

              <If when={detail().releases.length > 0}>
                <View style={{ gap: 6 }}>
                  <SectionHeader text={tr("market.releases")} />
                  <ReleasesList />
                </View>
              </If>

              <View style={{ gap: 4 }}>
                <If when={detail().license}>
                  {license => <MutedLine text={tr("market.license", { license: license() })} />}
                </If>
                <If when={detail().tags.length > 0}>
                  <MutedLine text={detail().tags.slice(0, 8).join(" · ")} />
                </If>
                <If when={detail().repositoryUrl}>
                  {url => (
                    <View style={{ alignItems: "flex-start", marginTop: 4 }}>
                      <Button
                        label={tr("market.repository")}
                        variant="ghost"
                        size="sm"
                        leadingIcon="external-link"
                        accessibilityLabel="market-repository"
                        onPress={() => void openRepository(url())}
                      />
                    </View>
                  )}
                </If>
              </View>
            </View>
          )}
        </If>
      </View>
    </ModalDialog>
  );
}

async function openRepository(url: string): Promise<void> {
  try {
    await openUrl(url);
  } catch (error) {
    // Opening a browser is the shell's; say so instead of failing silently.
    const message = error instanceof Error ? error.message : String(error);
    pushToast(tr("market.openUrlFailed", { url, error: message }), "error");
  }
}

// ── Submissions ───────────────────────────────────────────────────────────────

function SubmissionRow(props: { item: () => MarketSubmission; first: boolean }) {
  return (
    <View>
      <InsetRow
        first={props.first}
        leading={<Icon name={spaceIconName(props.item().icon)} size={16} color={palette().textMuted} />}
        label={props.item().name}
        detail={[
          `${props.item().slug} · v${props.item().releaseNumber}`,
          props.item().updatedAt ? formatDate(props.item().updatedAt) : "",
        ]
          .filter(Boolean)
          .join(" · ")}
        accessibilityLabel={`submission-${props.item().submissionId}`}
        below={
          <If when={props.item().rejectionReason}>
            {reason => (
              <Text
                style={{
                  color: stateColor("failed"),
                  fontSize: textSize(12),
                  lineHeight: textLineHeight(12, 1.45),
                }}
              >
                {tr("market.submissions.rejection", { reason: reason() })}
              </Text>
            )}
          </If>
        }
        trailing={
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Text
              accessibilityLabel={`submission-status-${props.item().submissionId}`}
              style={{
                color: props.item().status === "rejected" ? stateColor("failed") : palette().textSecondary,
                fontSize: textSize(13),
                lineHeight: textLineHeight(13, 1.3),
              }}
            >
              {submissionStatusLabel(props.item().status)}
            </Text>
            <If when={canWithdrawSubmission(props.item().status)}>
              <Button
                label={tr("market.submissions.withdraw")}
                variant="ghost"
                size={compactLayout() ? "md" : "sm"}
                loading={withdrawingSubmissionId() === props.item().submissionId}
                disabled={Boolean(withdrawingSubmissionId())}
                accessibilityLabel={`submission-withdraw-${props.item().submissionId}`}
                style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
                onPress={() => confirmingWithdrawId.set(props.item().submissionId)}
              />
            </If>
          </View>
        }
      />
      <If when={confirmingWithdrawId() === props.item().submissionId}>
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
          <InlineConfirmBar
            danger
            message={tr("market.submissions.withdrawConfirm", { name: props.item().name })}
            confirmLabel={tr("market.submissions.withdraw")}
            cancelLabel={tr("common.cancel")}
            onConfirm={() => void withdrawSubmission(props.item().submissionId)}
            onCancel={() => confirmingWithdrawId.set(null)}
          />
        </View>
      </If>
    </View>
  );
}

export function MiniAppSubmissionsView() {
  return (
    <View style={{ gap: space.xl, minWidth: 0 }}>
      <StudioSection
        title={tr("market.submissions.title")}
        accessibilityLabel="market-submissions"
        footnote={tr("market.submissions.publishNote")}
        trailing={
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <If when={submissionsLoading() && submissionsLoaded()}>
              <Spinner size={14} />
            </If>
            <IconButton
              icon="refresh"
              size={compactLayout() ? "md" : "sm"}
              accessibilityLabel="submissions-refresh"
              tooltip={tr("market.refresh")}
              disabled={submissionsLoading()}
              style={
                compactLayout()
                  ? {
                      width: layout.touchTarget,
                      height: layout.touchTarget,
                      minWidth: layout.touchTarget,
                      minHeight: layout.touchTarget,
                    }
                  : undefined
              }
              onPress={() => void loadSubmissions()}
            />
          </View>
        }
      >
        <If when={submissionsLoading() && !submissionsLoaded()}>
          <View style={{ padding: space.x3l, alignItems: "center" }}>
            <Spinner size={18} />
          </View>
        </If>
        <If when={submissionsLoaded() && submissionsSignInRequired()}>
          <StudioEmpty
            accessibilityLabel="submissions-sign-in"
            icon="user"
            message={tr("market.submissions.signInTitle")}
            detail={tr("market.submissions.signInDetail")}
            action={
              <Button
                label={tr("market.signIn")}
                variant="primary"
                size="md"
                leadingIcon="log-in"
                accessibilityLabel="submissions-sign-in-button"
                style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
                onPress={() =>
                  openAccountAuthModal({ autoStart: true, onSuccess: () => void loadSubmissions() })
                }
              />
            }
          />
        </If>
        <If when={submissionsLoaded() && !submissionsSignInRequired() ? submissionsError() : ""}>
          {error => (
            <StudioEmpty
              accessibilityLabel="submissions-error"
              icon="warning"
              tone="danger"
              message={tr("market.submissions.loadFailed")}
              detail={localizeHostError(error())}
              action={
                <Button
                  label={tr("common.tryAgain")}
                  variant="secondary"
                  size="md"
                  leadingIcon="refresh"
                  accessibilityLabel="submissions-retry"
                  style={compactLayout() ? { minHeight: layout.touchTarget } : undefined}
                  onPress={() => void loadSubmissions()}
                />
              }
            />
          )}
        </If>
        <If
          when={
            submissionsLoaded() && !submissionsSignInRequired() && !submissionsError() && submissions().length === 0
          }
        >
          <StudioEmpty
            accessibilityLabel="submissions-empty"
            icon="inbox"
            message={tr("market.submissions.emptyTitle")}
            detail={tr("market.submissions.emptyDetail")}
          />
        </If>
        <If when={submissions().length > 0}>
          <InsetGroup accessibilityLabel="submissions-list">
            <Each of={submissions()} key={item => item.submissionId}>
              {(item, index) => <SubmissionRow item={item} first={index() === 0} />}
            </Each>
          </InsetGroup>
        </If>
      </StudioSection>
    </View>
  );
}

// ── Package import ────────────────────────────────────────────────────────────

export function PackageImportModal() {
  return (
    <ModalDialog
      open={packageImportOpen()}
      title={tr("market.import.title")}
      subtitle={tr("market.import.subtitle")}
      size="md"
      accessibilityLabel="package-import"
      onClose={() => closePackageImport()}
      footer={
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
          <Button
            label={tr("common.cancel")}
            variant="secondary"
            size="md"
            disabled={packageImportBusy()}
            accessibilityLabel="package-import-cancel"
            onPress={() => closePackageImport()}
          />
          <If
            when={Boolean(packageInspection())}
            else={
              <Button
                label={tr("market.import.inspect")}
                variant="primary"
                size="md"
                loading={packageImportBusy()}
                disabled={!packageImportPath().trim()}
                accessibilityLabel="package-import-inspect"
                onPress={() => void inspectPackage()}
              />
            }
          >
            <Button
              label={tr("market.import.install")}
              variant="primary"
              size="md"
              leadingIcon="download"
              loading={packageImportBusy()}
              accessibilityLabel="package-import-confirm"
              onPress={() => void importInspectedPackage()}
            />
          </If>
        </View>
      }
    >
      <View style={{ gap: space.lg }}>
        <InputBox
          value={packageImportPath()}
          placeholder={tr("market.import.pathPlaceholder")}
          accessibilityLabel="package-import-path"
          hint={tr("market.import.pathHint")}
          onChange={value => setPackageImportPath(value)}
          onSubmit={() => {
            if (packageImportPath().trim() && !packageImportBusy()) void inspectPackage();
          }}
        />
        <If when={packageImportError()}>
          {error => <InlineBanner tone="danger" message={localizeHostError(error())} />}
        </If>
        <If when={packageInspection()}>
          {inspection => (
            <View accessibilityLabel="package-inspection" style={{ gap: space.md }}>
              <View style={{ gap: space.xs }}>
                <Text
                  style={{
                    color: palette().text,
                    fontSize: textSize(14),
                    fontWeight: "600",
                    lineHeight: textLineHeight(14, 1.35),
                  }}
                >
                  {inspection().name}
                </Text>
                <BodyText text={inspection().description || tr("common.noDescription")} secondary />
                <MutedLine text={`sha256 ${inspection().packageSha256.slice(0, 16)}`} mono />
              </View>
              <View style={{ gap: 4 }}>
                <SectionHeader text={tr("market.permissions")} />
                <If
                  when={marketPermissionLines(inspection().permissions).length > 0}
                  else={<BodyText text={tr("market.noPermissions")} secondary />}
                >
                  <Each of={marketPermissionLines(inspection().permissions)} key="index">
                    {line => <BodyText text={line()} />}
                  </Each>
                </If>
                <If when={inspection().added.length > 0}>
                  <MutedLine text={tr("market.import.grants", { permissions: inspection().added.join(", ") })} />
                </If>
              </View>
            </View>
          )}
        </If>
      </View>
    </ModalDialog>
  );
}
