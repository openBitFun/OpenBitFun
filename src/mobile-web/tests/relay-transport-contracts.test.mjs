// Subject: src/shared/relay-transport/{ClientBuild,RelayFailure,RelayEndpoint}.ts, whose
// remaining consumer is mobile-web. Moved from the retired React desktop UI's
// clientBuild.contract, relayFailure.contract and relayEndpoint tests.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import ts from 'typescript';

const read = async relativePath => (await readFile(new URL(relativePath, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
async function load(relativePath, imports = {}) {
  let code = ts.transpileModule(await read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  code = code.replace(/from (['"])([^'"]+)\1/g, (_, quote, specifier) => (
    `from ${JSON.stringify(imports[specifier] ?? import.meta.resolve(specifier))}`
  ));
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

// The shared build module reads the workspace version from package.json; the
// transpile loader cannot import JSON, so hand it an equivalent JS module.
const workspacePackage = JSON.parse(await read('../../../package.json'));
const packageJsonStub = `data:text/javascript;base64,${Buffer.from(
  `export const version = ${JSON.stringify(workspacePackage.version)};`,
).toString('base64')}`;
const { CLIENT_PROTOCOL_VERSION, CLIENT_VERSION } = await load('../../shared/relay-transport/ClientBuild.ts', { '../../../package.json': packageJsonStub });
const { RELAY_VERSION_RETIRED_CODE, classifyRelayFailure, isRetryableRelayFailure, relayFailureAction } = await load('../../shared/relay-transport/RelayFailure.ts');
const { OFFICIAL_RELAY_URL, relayEndpointBase, relayEndpointVersion, relayPageUrl, sameRelayDeployment } = await load('../../shared/relay-transport/RelayEndpoint.ts');

describe('client build contract single source', () => {
  // The Relay gates remote control on the reported protocol number, so the Rust
  // owner and the shared TS constant must agree. A bump that misses one side
  // fails here instead of silently mis-gating control between builds.
  it('pins the control protocol number to the shared Rust contract', async () => {
    const accountContract = await read('../../crates/contracts/product-domains/src/account.rs');
    assert.ok(accountContract.includes(`pub const CLIENT_PROTOCOL_VERSION: u32 = ${CLIENT_PROTOCOL_VERSION};`));
  });

  it('reports a well-formed diagnostic build string', () => {
    // Derived from the workspace package.json (which release-please bumps in
    // step with Cargo.toml), so it cannot silently rot. Pin only the shape the
    // Relay accepts: non-empty semver under its 64 UTF-8 byte cap.
    assert.match(CLIENT_VERSION, /^\d+\.\d+\.\d+/);
    assert.ok(CLIENT_VERSION.length <= 64);
  });

  it('reports the build on both the handshake and the login body', async () => {
    const realtime = await read('../../shared/relay-transport/AccountRealtime.ts');
    assert.ok(realtime.includes('clientVersion: CLIENT_VERSION'));
    assert.ok(realtime.includes('clientProtocol: CLIENT_PROTOCOL_VERSION'));
    const login = await read('../src/services/CloudAccountClient.ts');
    assert.ok(login.includes('clientVersion: CLIENT_VERSION'));
    assert.ok(login.includes('clientProtocol: CLIENT_PROTOCOL_VERSION'));
  });
});

describe('relay failure classification', () => {
  it('separates a retired Relay version from a network fault', () => {
    // The retirement answer arrives before authentication, so a bare 410 on an
    // account route must never be explained as this device's network.
    const retired = Object.assign(new Error('List devices failed: HTTP 410'), { status: 410 });
    assert.equal(classifyRelayFailure(retired), 'relay-version-retired');
    assert.equal(relayFailureAction('relay-version-retired'), 'check-updates');
    const offline = new TypeError('Failed to fetch');
    assert.equal(classifyRelayFailure(offline), 'network');
    assert.equal(relayFailureAction('network'), 'retry');
  });

  it('treats a temporary Relay outage as retryable, not as a client problem', () => {
    for (const status of [408, 425, 429, 500, 502, 503, 504]) {
      const failure = new Error(`List devices failed: HTTP ${status}`);
      assert.equal(classifyRelayFailure(failure), 'relay-unavailable');
      assert.equal(isRetryableRelayFailure('relay-unavailable'), true);
    }
  });

  it('keeps authentication failures on the sign-in path', () => {
    assert.equal(classifyRelayFailure(new Error('List devices failed: HTTP 401')), 'auth');
    assert.equal(classifyRelayFailure(new Error('Sign in with GitHub to continue')), 'auth');
    assert.equal(relayFailureAction('auth'), 'sign-in');
  });

  it('classifies a refused client build as an update, whatever it is reported by', () => {
    assert.equal(classifyRelayFailure(new Error('relay_session_history_retired')), 'client-outdated');
    assert.equal(classifyRelayFailure(new Error('incompatible client build: remote control requires matching client versions')), 'client-outdated');
    assert.equal(classifyRelayFailure(new Error(`Relay error: ${RELAY_VERSION_RETIRED_CODE}`)), 'client-outdated');
  });

  it('never blames the user for an unrecognized failure', () => {
    assert.equal(classifyRelayFailure(new Error('List devices failed: HTTP 404')), 'unknown');
    assert.equal(classifyRelayFailure('something else entirely'), 'unknown');
    assert.equal(relayFailureAction('unknown'), 'retry');
  });

  it('accepts the shapes surfaces actually hold', () => {
    assert.equal(classifyRelayFailure(Object.assign(new Error('x'), { status: 503 })), 'relay-unavailable');
    assert.equal(classifyRelayFailure({ message: 'WebSocket connection failed' }), 'network');
    assert.equal(classifyRelayFailure(undefined), 'unknown');
  });
});

describe('relay endpoint identity', () => {
  it('carries the service version as a query parameter', () => {
    assert.equal(OFFICIAL_RELAY_URL, 'https://remote.openbitfun.com/relay?v=1.0.10');
    assert.equal(relayEndpointVersion(OFFICIAL_RELAY_URL), '1.0.10');
  });

  it('strips the version so paths are never appended to a query', () => {
    assert.equal(relayEndpointBase(OFFICIAL_RELAY_URL), 'https://remote.openbitfun.com/relay');
    assert.equal(relayEndpointBase('https://remote.openbitfun.com/relay/?v=1.0.9'), 'https://remote.openbitfun.com/relay');
    assert.equal(relayEndpointBase('https://remote.openbitfun.com/v/1.0.2/'), 'https://remote.openbitfun.com/v/1.0.2');
  });

  it('rejects credentials, fragments, and unknown query content', () => {
    for (const invalid of [
      'https://user@remote.openbitfun.com/relay',
      'https://remote.openbitfun.com/relay#/pair',
      'https://remote.openbitfun.com/relay?v=1.0.9&x=1',
      'https://remote.openbitfun.com/relay?next=https://evil.example',
      'ftp://remote.openbitfun.com/relay',
      '',
    ]) {
      assert.equal(relayEndpointBase(invalid), null);
    }
  });

  it('treats both live aliases as one deployment and other releases as different', () => {
    assert.equal(sameRelayDeployment(OFFICIAL_RELAY_URL, 'https://remote.openbitfun.com/v/1.0.2'), true);
    assert.equal(sameRelayDeployment(OFFICIAL_RELAY_URL, 'https://other.example.com/relay'), false);
    assert.equal(sameRelayDeployment(OFFICIAL_RELAY_URL, 'https://remote.openbitfun.com/v/1.0.1'), false);
    assert.equal(sameRelayDeployment('http://remote.openbitfun.com/relay', OFFICIAL_RELAY_URL), false);
  });

  it('keeps the version before the fragment in user-facing links', () => {
    assert.equal(relayPageUrl(OFFICIAL_RELAY_URL, '#/pair?did=abc'), 'https://remote.openbitfun.com/relay/?v=1.0.10#/pair?did=abc');
    assert.equal(relayPageUrl('https://remote.openbitfun.com/v/1.0.2', '#/pair?did=abc'), 'https://remote.openbitfun.com/v/1.0.2/#/pair?did=abc');
  });
});
