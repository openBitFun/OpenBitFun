import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { componentRegistry } from '@openbitfun/ui/registry';
import { compatibilityToolPresentationOwners, dedicatedToolNames, genericToolNames, productOwnedToolNames, toolPresentationRegistry, toolsForComponent } from '../src/registry';
import { execScenarios } from '../src/scenarios';
import { FlowChatComponentPreview, flowChatPreviewRegistry } from '../../../design-system/apps/design-lab/src/preview/FlowChatPreviewRegistry';
import { I18nContext } from '../../../design-system/apps/design-lab/src/i18n/I18nProvider';
import { messages } from '../../../design-system/apps/design-lab/src/i18n/messages';
import { translateFromCatalog } from '../../../design-system/apps/design-lab/src/i18n/core.mjs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

// The React desktop UI (src/web-ui) that held the production tool-card adapter registries was retired;
// Design Lab is now this catalog's only renderer, so consistency is checked against it and the public exports.
it('the catalog matches its owners, Design Lab specimens and real public exports', () => {
  const standard = Object.entries(toolPresentationRegistry).filter(([, entry]) => entry.owner === 'standard');
  const compatibility = Object.entries(compatibilityToolPresentationOwners);
  expect(compatibility.map(([name]) => name).filter(name => dedicatedToolNames.has(name))).toEqual([]);
  expect([...dedicatedToolNames].sort()).toEqual([...standard.map(([name]) => name), ...productOwnedToolNames].sort());
  const published = new Set(componentRegistry.map(({ name }) => name));
  for (const entry of Object.values(toolPresentationRegistry)) {
    if (entry.component) expect(published.has(entry.component)).toBe(true);
  }
  const labTools = flowChatPreviewRegistry.flatMap(({ definition }) => definition.specimens.map(({ tool }) => tool));
  expect(labTools.sort()).toEqual(standard.map(([name]) => name).sort());
  expect(new Set(labTools).size).toBe(labTools.length);
  expect([...new Set(execScenarios.map(({ toolName }) => toolName))].sort()).toEqual(toolsForComponent('CommandToolCard').sort());
});

it('every built-in backend tool has a current, compatibility, generic or deferred gateway presentation', () => {
  const backend = read('../../../src/crates/assembly/core/src/agentic/tools/product_runtime/materialization.rs');
  const registry = backend.match(/const PRODUCT_TOOL_REGISTRATION_ORDER:[\s\S]*?= &\[([\s\S]*?)\];/);
  expect(registry).not.toBeNull();
  const names = [...registry![1].matchAll(/"([^\"]+)"/g)].map(match => match[1]);
  expect(names.length).toBeGreaterThan(50);
  const compatibilityNames = new Set(Object.keys(compatibilityToolPresentationOwners));
  expect([...genericToolNames].filter(name => dedicatedToolNames.has(name) || compatibilityNames.has(name))).toEqual([]);
  expect(names.filter(name => !dedicatedToolNames.has(name) && !compatibilityNames.has(name)).sort())
    .toEqual([...genericToolNames, 'CallDeferredTool'].sort());
});

it('the private presentation layer has no application, store or transport dependency', () => {
  for (const path of ['exec/ExecProcessPresentation.tsx', 'exec/model.ts', 'thinking.ts', 'explore.ts', 'terminal/TerminalOutputRenderer.tsx', 'registry.ts']) {
    expect(read(`../src/${path}`)).not.toMatch(/from\s+['"](?:@\/|.*src\/(?:apps|nsh-ui)\/|.*tauri|zustand)/);
  }
  expect(read('../../../design-system/apps/design-lab/src/preview/FlowChatScenarios.tsx')).toContain('<ExecProcessPresentation');
  expect(read('../src/terminal/LazyTerminalOutputRenderer.tsx')).toContain("import('./TerminalOutputRenderer')");
});

describe.each(['en-US', 'zh-CN', 'zh-TW'] as const)('public component fixture coverage (%s)', (locale) => {
  it.each(toolsForComponent('ImageAnalysisToolCard'))('%s has a localized image-tool action', (tool) => {
    const key = `flowChat.builtin.tools.${tool}`;
    const label = messages[locale][key as keyof typeof messages[typeof locale]];
    expect(label).toBeTruthy();
    const html = renderToString(<I18nContext.Provider value={{ locale, setLocale: () => {}, t: (message, params) => translateFromCatalog(messages, locale, message, params) }}>
      <FlowChatComponentPreview componentName="ImageAnalysisToolCard" state="default" specimen={{ tool }} />
    </I18nContext.Provider>);
    expect(html).toContain(label);
    expect(html).not.toContain(key);
  });

  for (const { component, definition } of flowChatPreviewRegistry) {
    it.each(component.states)(`${component.name} / %s renders the actual registered component`, (state) => {
      const error = console.error;
      const spy = vi.spyOn(console, 'error').mockImplementation((message, ...args) => {
        if (typeof message !== 'string' || !message.includes('useLayoutEffect does nothing on the server')) error(message, ...args);
      });
      try {
        const html = renderToString(<I18nContext.Provider value={{ locale, setLocale: () => {}, t: (key, params) => translateFromCatalog(messages, locale, key, params) }}>
          <FlowChatComponentPreview componentName={component.name} state={state} specimen={definition.specimens[0]} />
        </I18nContext.Provider>);
        expect(html).toContain('data-openbitfun-');
        expect(html).not.toContain('undefined');
        if (component.name === 'CommandToolCard' && state === 'hover') {
          expect(html).toContain('data-openbitfun-preview-state="hover"');
        }
      } finally { spy.mockRestore(); }
    });
  }
});
