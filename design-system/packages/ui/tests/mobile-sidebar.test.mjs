import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MobileSidebar,
  MobileSidebarChildRow,
  MobileSidebarEntryRow,
  MobileSidebarHeader,
  MobileSidebarSectionLabel,
  MobileSidebarSessionRow,
  MobileSidebarToolsFooter,
  MobileSidebarWorkspaceRow,
} from "../dist/mobile.js";

const e = createElement;

test("mobile sidebar container stacks header, scroll body and footer", () => {
  const markup = renderToStaticMarkup(e(MobileSidebar, {
    header: e("div", null, "header"),
    footer: e("div", null, "footer"),
  }, e("p", null, "body")));

  assert.match(markup, /data-openbitfun-component="mobile-sidebar"/);
  assert.match(markup, /data-openbitfun-part="header"/);
  assert.match(markup, /data-openbitfun-part="scroll"/);
  assert.match(markup, /data-openbitfun-part="footer"/);
});

test("mobile sidebar header renders brand and trailing slots", () => {
  const markup = renderToStaticMarkup(e(MobileSidebarHeader, {
    brand: "OpenBitFun",
    trailing: e("button", { "aria-label": "Search" }),
  }));

  assert.match(markup, /data-openbitfun-component="mobile-sidebar-header"/);
  assert.match(markup, /data-openbitfun-part="brand"/);
  assert.match(markup, /data-openbitfun-part="trailing"/);
});

test("mobile sidebar section label renders action slot", () => {
  const markup = renderToStaticMarkup(e(MobileSidebarSectionLabel, {
    action: e("button", { "aria-label": "Add workspace" }),
  }, "Workspaces"));

  assert.match(markup, /data-openbitfun-component="mobile-sidebar-section-label"/);
  assert.match(markup, /data-openbitfun-part="label"/);
  assert.match(markup, /data-openbitfun-part="action"/);
});

test("mobile sidebar workspace row exposes controlled expansion state", () => {
  const markup = renderToStaticMarkup(e(MobileSidebarWorkspaceRow, {
    expanded: true,
    label: "DevEco",
    onExpandChange: () => undefined,
  }, e(MobileSidebarChildRow, { label: "Remote session" })));

  assert.match(markup, /data-openbitfun-component="mobile-sidebar-workspace-row"/);
  assert.match(markup, /data-expanded="true"/);
  assert.match(markup, /aria-expanded="true"/);
});

test("mobile sidebar child row renders dot and selection state", () => {
  const markup = renderToStaticMarkup(e(MobileSidebarChildRow, {
    label: "Local draft",
    selected: true,
  }));

  assert.match(markup, /data-openbitfun-component="mobile-sidebar-child-row"/);
  assert.match(markup, /data-selected="true"/);
  assert.match(markup, /data-openbitfun-part="dot"/);
  assert.match(markup, /aria-current="true"/);
});

test("mobile sidebar session row renders status dot and time", () => {
  const running = renderToStaticMarkup(e(MobileSidebarSessionRow, {
    label: "https://github.com/openbitfun",
    status: "running",
    time: "2m",
  }));
  const error = renderToStaticMarkup(e(MobileSidebarSessionRow, {
    label: "demo layout",
    status: "error",
  }));

  assert.match(running, /data-openbitfun-component="mobile-sidebar-session-row"/);
  assert.match(running, /data-status="running"/);
  assert.match(running, /data-openbitfun-part="time"/);
  assert.match(error, /data-status="error"/);
});

test("mobile sidebar entry row renders icon slot", () => {
  const markup = renderToStaticMarkup(e(MobileSidebarEntryRow, {
    icon: e("img", { alt: "", src: "mascot.svg" }),
    label: "Assistant",
  }));

  assert.match(markup, /data-openbitfun-component="mobile-sidebar-entry-row"/);
  assert.match(markup, /data-openbitfun-part="icon"/);
  assert.match(markup, /data-openbitfun-part="label"/);
});

test("mobile sidebar tools footer wires tools and settings actions", () => {
  const markup = renderToStaticMarkup(e(MobileSidebarToolsFooter, {
    leading: "Tools",
    onSettingsClick: () => undefined,
    onToolsClick: () => undefined,
    settingsLabel: "Settings",
  }));

  assert.match(markup, /data-openbitfun-component="mobile-sidebar-tools-footer"/);
  assert.match(markup, /data-openbitfun-part="tools"/);
  assert.match(markup, /data-openbitfun-part="settings"/);
  assert.match(markup, /aria-label="Settings"/);
});
