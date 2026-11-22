import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openMainSession: vi.fn(),
  ensurePersistedSessionMetadata: vi.fn(),
  getSession: vi.fn(),
  applyWorkspace: vi.fn(),
  dispatchHistorySessionOpenIntent: vi.fn(),
}));

vi.mock('@/flow_chat/services/sessionActivation', () => ({ openMainSession: mocks.openMainSession }));
vi.mock('@/flow_chat/services/sessionOpenIntent', () => ({
  dispatchHistorySessionOpenIntent: mocks.dispatchHistorySessionOpenIntent,
}));
vi.mock('@/flow_chat/store/FlowChatStore', () => ({
  flowChatStore: {
    ensurePersistedSessionMetadata: mocks.ensurePersistedSessionMetadata,
    getState: () => ({ sessions: { get: mocks.getSession } }),
  },
}));
vi.mock('@/app/services/AppManager', () => ({ appManager: { updateLayout: vi.fn() } }));
vi.mock('@/app/stores/sceneStore', () => ({ useSceneStore: { getState: () => ({ openScene: vi.fn() }) } }));
vi.mock('@/app/scenes/settings/settingsStore', () => ({ useSettingsStore: { getState: () => ({ openDestination: vi.fn() }) } }));
vi.mock('@/infrastructure/event-bus', () => ({ globalEventBus: { emit: vi.fn() } }));
vi.mock('@/shared/utils/tabUtils', () => ({ openFileInBestTarget: vi.fn() }));
vi.mock('./productActionActivator', () => ({ activateProductAction: vi.fn() }));
vi.mock('./interactiveCapabilityActivator', () => ({ activateInteractiveCapability: vi.fn() }));

import { activateGlobalSearchTarget } from './globalSearchActivator';
import type { GlobalSearchActivationContext } from './globalSearchActivator';

function context(): GlobalSearchActivationContext {
  return {
    setActiveWorkspace: mocks.applyWorkspace,
    selectAssistantWorkspace: vi.fn(),
    openAssistant: vi.fn(),
    tCommon: (key: string) => key,
  };
}

describe('activateGlobalSearchTarget session navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applyWorkspace.mockResolvedValue(undefined);
    mocks.ensurePersistedSessionMetadata.mockResolvedValue(true);
    mocks.openMainSession.mockResolvedValue(undefined);
    mocks.getSession.mockReturnValue({ title: 'target' });
  });

  it('starts workspace activation and session metadata loading together', async () => {
    let releaseWorkspace!: () => void;
    let releaseMetadata!: () => void;
    const workspacePending = new Promise<void>(resolve => { releaseWorkspace = resolve; });
    const metadataPending = new Promise<boolean>(resolve => { releaseMetadata = resolve; });
    mocks.applyWorkspace.mockImplementation(async () => { await workspacePending; });
    let metadataStarted = false;
    mocks.ensurePersistedSessionMetadata.mockImplementation(async () => {
      metadataStarted = true;
      await metadataPending;
      return true;
    });

    const navigation = activateGlobalSearchTarget({
      kind: 'session', sessionId: 'target', workspaceId: 'workspace', workspacePath: '/workspace',
    }, context());
    await Promise.resolve();
    await Promise.resolve();
    expect(metadataStarted).toBe(true);
    releaseMetadata();
    releaseWorkspace();
    await navigation;

    expect(mocks.applyWorkspace).toHaveBeenCalledWith('workspace');
    expect(mocks.ensurePersistedSessionMetadata).toHaveBeenCalledWith('target', 'workspace');
    expect(mocks.openMainSession).toHaveBeenCalledWith('target');
  });

  it('reports an unavailable session without opening it', async () => {
    mocks.applyWorkspace.mockResolvedValue(undefined);
    mocks.ensurePersistedSessionMetadata.mockResolvedValue(false);

    await expect(activateGlobalSearchTarget({
      kind: 'session', sessionId: 'missing', workspaceId: 'workspace', workspacePath: '/workspace',
    }, context())).rejects.toThrow('nav.search.errors.sessionUnavailable');
    expect(mocks.openMainSession).not.toHaveBeenCalled();
  });
});
