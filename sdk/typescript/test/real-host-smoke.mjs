import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import { AgentClient, SdkError } from "../dist/sdk/typescript/src/index.js";

const scriptPath = resolve(process.argv[1]);
const MAX_CAPTURED_OUTPUT_BYTES = 1024 * 1024;
const WORKER_TIMEOUT_MS = 120_000;

if (process.argv.includes("--worker")) {
  await runWorker();
} else {
  for (const outcome of ["allow", "reject", "missing"]) {
    await runParent(outcome);
  }
}

async function runParent(outcome) {
  const isolatedRoot = await mkdtemp(join(tmpdir(), "openbitfun-sdk-real-host-"));
  const workspace = join(isolatedRoot, "workspace");
  const userRoot = join(isolatedRoot, "user-root");
  const home = join(isolatedRoot, "home");
  const configRoot = join(isolatedRoot, "config-root");
  await Promise.all(
    [workspace, userRoot, home, configRoot].map((directory) =>
      mkdir(directory, { recursive: true }),
    ),
  );

  const embedded = outcome === "allow" && Boolean(process.env.OPENBITFUN_SMOKE_RUST_CONSUMER);
  const embeddedMarker = randomBytes(18).toString("hex");
  const fileMarker = randomBytes(18).toString("hex");
  const fixtureFile = "sdk-smoke.txt";
  const apiKey = `openbitfun-sdk-${randomBytes(24).toString("hex")}`;
  let requestCount = 0;
  const requestTraces = [];
  let fixtureFailure;
  const server = createServer(async (request, response) => {
    const index = ++requestCount;
    try {
      if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
        throw new Error("SSE fixture received an unexpected request target");
      }
      if (request.headers.authorization !== `Bearer ${apiKey}`) {
        throw new Error("SSE fixture received invalid authorization");
      }
      const body = await readRequestJson(request);
      if (body.model !== "fixture-model" || body.stream !== true) {
        throw new Error("SSE fixture received an invalid model request");
      }
      requestTraces.push(summarizeModelRequest(index, request.url, body));

      assert.ok(index <= (embedded ? 5 : 4), "unexpected model request");
      let chunks;
      if (index === 1) {
        await writeFile(join(workspace, fixtureFile), fileMarker);
        const configDir = join(workspace, ".openbitfun", "config");
        await mkdir(configDir, { recursive: true });
        await writeFile(join(configDir, "tool_permissions.json"), JSON.stringify({
          rules: [{ action: "read", resource: "*", effect: "ask" }],
        }));
      }
      const embeddedRead = embedded && index === 4;
      if (embeddedRead) {
        const previousRead = body.messages.find((message) => message.role === "tool" && message.tool_call_id === "call_sdk_read");
        assert.ok(JSON.stringify(previousRead?.content ?? "").includes(fileMarker), "Rust must restore the previous Host tool result");
        await writeFile(join(workspace, "embedded-smoke.txt"), embeddedMarker);
      }
      if (index === 2 || embeddedRead) {
        assert.ok(body.tools.some((tool) => tool.function?.name === "Read"), "Read must be offered");
        assert.ok(!JSON.stringify(body.messages).includes(embeddedRead ? embeddedMarker : fileMarker));
        const readPath = embeddedRead ? "embedded-smoke.txt" : outcome === "missing" ? "missing-sdk-fixture.txt" : fixtureFile;
        chunks = [{
          delta: {
            role: "assistant",
            tool_calls: [{
              index: 0,
              id: embeddedRead ? "call_embedded_read" : "call_sdk_read",
              type: "function",
              function: { name: "Read", arguments: JSON.stringify({ file_path: readPath }) },
            }],
          },
          finish_reason: "tool_calls",
        }];
      } else {
        if (index >= 3) {
          const toolReply = body.messages.find((message) =>
            message.role === "tool" && message.tool_call_id === "call_sdk_read");
          assert.ok(toolReply, "model must receive the result for the requested tool call");
          const content = JSON.stringify(toolReply.content);
          if (outcome === "allow") {
            assert.ok(content.includes(fileMarker), "Read must return the file contents");
          } else {
            assert.ok(!content.includes(fileMarker), "a failed or rejected call exposed file contents");
            assert.match(content, outcome === "reject" ? /user rejected this tool call/i : /file does not exist: .*missing-sdk-fixture\.txt/i);
          }
        }
        if (embedded && index === 5) {
          const read = body.messages.find((message) => message.role === "tool" && message.tool_call_id === "call_embedded_read");
          assert.ok(JSON.stringify(read?.content ?? "").includes(embeddedMarker), "Rust must deliver its own approved read to the model");
        }
        const text = { 1: "fixture response", 3: "read completed", 4: "session resumed", 5: "session resumed" }[index];
        chunks = [
          { delta: { role: "assistant", content: "OpenBitFun SDK " }, finish_reason: null },
          { delta: { content: text }, finish_reason: null },
          { delta: {}, finish_reason: "stop" },
        ];
      }
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      for (const choice of chunks) {
        const event = {
          id: "fixture",
          object: "chat.completion.chunk",
          model: "fixture-model",
          choices: [{ index: 0, ...choice }],
        };
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      response.end("data: [DONE]\n\n");
    } catch (error) {
      fixtureFailure ??= error;
      response.writeHead(400, { "content-type": "text/plain" });
      response.end("SSE fixture rejected the request");
    }
  });

  let worker;
  try {
    const address = await listenLocalhost(server);
    const workerEnvironment = {
      OPENBITFUN_SDK_SMOKE_READ_OUTCOME: outcome,
      OPENBITFUN_SDK_SMOKE_BASE_URL: `http://127.0.0.1:${String(address.port)}/v1`,
      OPENBITFUN_SDK_SMOKE_WORKSPACE: workspace,
      OPENBITFUN_E2E_STORAGE_GUARD: "1",
      OPENBITFUN_E2E_USER_ROOT: userRoot,
      OPENBITFUN_E2E_HOME: home,
      APPDATA: configRoot,
      XDG_CONFIG_HOME: configRoot,
      HOME: home,
      USERPROFILE: home,
    };
    if (embedded) {
      workerEnvironment.OPENBITFUN_SMOKE_RUST_CONSUMER = resolve(process.env.OPENBITFUN_SMOKE_RUST_CONSUMER);
    }
    assert.equal(Object.values(workerEnvironment).includes(apiKey), false);

    worker = spawn(process.execPath, [scriptPath, "--worker"], {
      cwd: isolatedRoot,
      env: workerEnvironment,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const output = captureWorkerOutput(worker);
    worker.stdin.end(`${apiKey}\n`);
    let exit;
    try {
      exit = await waitForWorker(worker, WORKER_TIMEOUT_MS);
    } catch (error) {
      const captured = output();
      const phase = lastWorkerPhase(captured.stdout);
      throw new Error(
        [
          `real Host smoke worker failed at ${phase} after ${String(requestCount)} model requests`,
          formatRequestTraces(requestTraces, apiKey),
        ].join("\n"),
        { cause: error },
      );
    }
    const captured = output();

    assert.equal(exit.signal, null, "real Host smoke worker was terminated");
    assert.equal(captured.stdout.includes(apiKey), false, "API key leaked to worker stdout");
    assert.equal(captured.stderr.includes(apiKey), false, "API key leaked to worker stderr");
    if (fixtureFailure !== undefined) {
      throw fixtureFailure;
    }
    assert.equal(
      exit.code,
      0,
      `real Host smoke worker failed: ${captured.stderr}`,
    );
    assert.equal(requestCount, embedded ? 5 : 4);
    const catalog = JSON.parse(await readFile(join(userRoot, "data", "workspace_data.json"), "utf8"));
    const workspacePath = await realpath(workspace);
    const records = Object.values(catalog.workspaces).filter((record) => record.rootPath === workspacePath);
    assert.equal(records.length, 1, "the SDK workspace must retain one catalog identity after restart");
    const [{ id }] = records;
    assert.ok(!catalog.recent_workspaces.includes(id));
    assert.ok(!catalog.opened_workspace_ids.includes(id));
    assert.notEqual(catalog.current_workspace_id, id);
    await assertTreeDoesNotContain(isolatedRoot, apiKey);
    process.stdout.write(`real-host-smoke (${outcome}): PASS\n`);
  } finally {
    if (worker !== undefined && worker.exitCode === null) {
      worker.kill();
    }
    await closeServer(server);
    await rm(isolatedRoot, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    });
  }
}

async function runWorker() {
  const apiKey = await readApiKeyFromStdin();
  const outcome = requiredEnvironment("OPENBITFUN_SDK_SMOKE_READ_OUTCOME");
  const workspace = requiredEnvironment("OPENBITFUN_SDK_SMOKE_WORKSPACE");
  const baseUrl = requiredEnvironment("OPENBITFUN_SDK_SMOKE_BASE_URL");
  const missingHost = join(workspace, "missing-openbitfun-sdk-host");

  const validModel = {
    provider: "openai",
    model: "fixture-model",
    apiKey,
    baseUrl,
  };
  const invalidOptions = [
    { cwd: workspace, hostPath: missingHost },
    { cwd: workspace, hostPath: missingHost, model: { ...validModel, model: " " } },
    { cwd: workspace, hostPath: missingHost, model: { ...validModel, apiKey: " " } },
    {
      cwd: workspace,
      hostPath: missingHost,
      model: { ...validModel, provider: "unsupported" },
    },
    {
      cwd: workspace,
      hostPath: missingHost,
      model: { ...validModel, baseUrl: "not an absolute URL" },
    },
  ];
  for (const options of invalidOptions) {
    await assert.rejects(AgentClient.start(options), (error) => {
      assert.ok(error instanceof SdkError);
      assert.equal(error.code, "invalid_request");
      assert.equal(error.stage, "initialize");
      assert.equal(error.outcomeCertainty, "not_started");
      assert.equal(renderError(error).includes(apiKey), false);
      return true;
    });
  }
  process.stdout.write("phase:validation_complete\n");

  const client = await AgentClient.start({
    cwd: relative(process.cwd(), workspace),
    model: validModel,
  });
  process.stdout.write("phase:client_started\n");
  let query;
  let sessionId;
  try {
    query = await client.query({ prompt: "Return the fixture response" });
    process.stdout.write("phase:query_started\n");
    const items = [];
    for await (const item of query) {
      items.push(item);
    }
    const result = await query.result();
    const deltas = items.filter((item) => item.type === "assistant_text_delta");
    const terminalResults = items.filter((item) => item.type === "result");

    assert.equal(deltas.map((item) => item.text).join(""), "OpenBitFun SDK fixture response");
    assert.equal(terminalResults.length, 1);
    assert.deepEqual(terminalResults[0], result);
    assert.equal(result.status, "completed");
    assert.equal(result.outputText, "OpenBitFun SDK fixture response");
    assert.equal(JSON.stringify(items).includes(apiKey), false);
    process.stdout.write("phase:result_received\n");

    const session = await client.sessions.create({ sessionName: "SDK file read" });
    sessionId = session.id;
    const read = await session.startTurn({ prompt: "Read sdk-smoke.txt and report completion" });
    const readEvents = [];
    for await (const item of read) {
      readEvents.push(item);
      if (item.type === "permission_request") {
        await read.respondPermission(item.requestId, { decision: outcome === "reject" ? "reject" : "allow_once" });
      }
    }
    const readResult = await read.result();
    assert.equal(readResult.status, "completed");
    assert.equal(readResult.outputText, "OpenBitFun SDK read completed");
    assert.equal(readEvents.filter((item) => item.type === "permission_request").length, outcome === "missing" ? 0 : 1);
    const toolEvents = readEvents.filter((item) => item.type === "tool_event" && item.toolName === "Read");
    if (outcome === "reject") {
      assert.ok(!toolEvents.some((item) => item.status === "completed"));
    } else {
      const expectedStatus = outcome === "missing" ? "failed" : "completed";
      assert.equal(toolEvents.filter((item) => item.status === expectedStatus).length, 1);
    }
    assert.equal(readEvents.filter((item) => item.type === "result").length, 1);
    assert.equal(JSON.stringify(readEvents).includes(apiKey), false);
    if (process.env.OPENBITFUN_SMOKE_RUST_CONSUMER) {
      await runRustConsumer("conflict", sessionId, apiKey);
    }
    await read.close();
    await session.close();
  } finally {
    if (query !== undefined) {
      await query.close();
      process.stdout.write("phase:query_closed\n");
    }
    await client.close();
    process.stdout.write("phase:client_closed\n");
  }

  if (process.env.OPENBITFUN_SMOKE_RUST_CONSUMER) {
    await runRustConsumer("resume", sessionId, apiKey);
    return;
  }
  const next = await AgentClient.start({ cwd: workspace, model: validModel });
  try {
    const resumed = await next.sessions.resume(sessionId);
    assert.equal(resumed.id, sessionId);
    const followup = await resumed.startTurn({ prompt: "Confirm the previous read" });
    const result = await followup.result();
    assert.equal(result.status, "completed");
    assert.equal(result.outputText, "OpenBitFun SDK session resumed");
  } finally {
    await next.close();
  }
}

async function readRequestJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > 4 * 1024 * 1024) {
      throw new Error("SSE fixture request exceeded its size limit");
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function listenLocalhost(server) {
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectPromise);
      resolvePromise();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("SSE fixture did not bind a TCP address");
  }
  return address;
}

async function runRustConsumer(action, sessionId, apiKey) {
  const consumer = spawn(requiredEnvironment("OPENBITFUN_SMOKE_RUST_CONSUMER"), [action, sessionId], {
    cwd: requiredEnvironment("OPENBITFUN_SDK_SMOKE_WORKSPACE"),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const output = captureWorkerOutput(consumer);
  const exited = waitForWorker(consumer, 45_000);
  consumer.stdin.end(apiKey);
  const { code, signal } = await exited;
  const { stderr, stdout } = output();
  assert.ok(!stderr.includes(apiKey) && !stdout.includes(apiKey));
  assert.equal(signal, null);
  assert.equal(code, 0, stderr);
}

function captureWorkerOutput(worker) {
  let stdout = "";
  let stderr = "";
  let captureFailure;
  worker.stdout.setEncoding("utf8");
  worker.stderr.setEncoding("utf8");
  worker.stdout.on("data", (chunk) => {
    try {
      stdout = appendBounded(stdout, chunk);
    } catch (error) {
      captureFailure ??= error;
      worker.kill();
    }
  });
  worker.stderr.on("data", (chunk) => {
    try {
      stderr = appendBounded(stderr, chunk);
    } catch (error) {
      captureFailure ??= error;
      worker.kill();
    }
  });
  return () => {
    if (captureFailure !== undefined) {
      throw captureFailure;
    }
    return { stdout, stderr };
  };
}

function appendBounded(current, chunk) {
  const next = current + chunk;
  if (Buffer.byteLength(next, "utf8") > MAX_CAPTURED_OUTPUT_BYTES) {
    throw new Error("real Host smoke worker output exceeded its size limit");
  }
  return next;
}

async function waitForWorker(worker, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    let timedOut = false;
    let terminationTimeout;
    const timeout = setTimeout(() => {
      timedOut = true;
      worker.kill();
      terminationTimeout = setTimeout(() => {
        rejectPromise(new Error("real Host smoke worker did not exit after its deadline"));
      }, 5_000);
    }, timeoutMs);
    worker.once("error", (error) => {
      clearTimeout(timeout);
      clearTimeout(terminationTimeout);
      rejectPromise(error);
    });
    worker.once("exit", (code, signal) => {
      clearTimeout(timeout);
      clearTimeout(terminationTimeout);
      if (timedOut) {
        rejectPromise(new Error("real Host smoke worker exceeded its deadline"));
      } else {
        resolvePromise({ code, signal });
      }
    });
  });
}

function lastWorkerPhase(stdout) {
  const phases = [...stdout.matchAll(/^phase:([a-z_]+)$/gm)];
  return phases.at(-1)?.[1] ?? "worker_start";
}

function summarizeModelRequest(index, path, body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const lastMessage = messages.at(-1);
  const tools = Array.isArray(body.tools) ? body.tools : [];
  return {
    index,
    path,
    model: typeof body.model === "string" ? body.model : typeof body.model,
    lastMessage: {
      role:
        typeof lastMessage?.role === "string"
          ? lastMessage.role
          : typeof lastMessage?.role,
      text: summarizeMessageContent(lastMessage?.content),
    },
    tools: {
      count: tools.length,
      names: tools.map((tool) =>
        typeof tool?.function?.name === "string"
          ? tool.function.name
          : typeof tool?.name === "string"
            ? tool.name
            : "<unnamed>",
      ),
    },
    toolChoice: summarizeToolChoice(body.tool_choice),
    stream: body.stream,
  };
}

function summarizeMessageContent(content) {
  if (typeof content === "string") {
    return summarizeText(content);
  }
  if (!Array.isArray(content)) {
    return `<${typeof content}>`;
  }
  return summarizeText(
    content
      .map((part) =>
        typeof part?.text === "string"
          ? part.text
          : typeof part?.content === "string"
            ? part.content
            : `<${String(part?.type ?? typeof part)}>`,
      )
      .join(" "),
  );
}

function summarizeText(value) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= 160 ? compact : `${compact.slice(0, 157)}...`;
}

function summarizeToolChoice(toolChoice) {
  if (toolChoice === undefined) {
    return "<undefined>";
  }
  if (typeof toolChoice === "string") {
    return toolChoice;
  }
  const functionName = toolChoice?.function?.name;
  if (typeof functionName === "string") {
    return { type: toolChoice.type ?? "function", functionName };
  }
  return `<${typeof toolChoice}>`;
}

function formatRequestTraces(traces, apiKey) {
  return `secret-safe request trace:\n${JSON.stringify(traces, null, 2).replaceAll(apiKey, "[redacted]")}`;
}

async function readApiKeyFromStdin() {
  let value = "";
  for await (const chunk of process.stdin) {
    value += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    if (Buffer.byteLength(value, "utf8") > 512) {
      throw new Error("real Host smoke credential exceeded its size limit");
    }
  }
  const apiKey = value.trimEnd();
  if (apiKey.length === 0) {
    throw new Error("real Host smoke credential is unavailable");
  }
  return apiKey;
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`real Host smoke environment is missing ${name}`);
  }
  return value;
}

function renderError(error) {
  const values = [];
  let current = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
    values.push(current.name, current.message, current.stack ?? "");
    current = current.cause;
  }
  return values.join("\n");
}

async function assertTreeDoesNotContain(directory, secret) {
  const entries = await readdir(directory, { withFileTypes: true });
  const secretBytes = Buffer.from(secret, "utf8");
  for (const entry of entries) {
    const path = join(directory, entry.name);
    assert.equal(path.includes(secret), false, "API key leaked to an isolated path");
    if (entry.isDirectory()) {
      await assertTreeDoesNotContain(path, secret);
    } else if (entry.isFile()) {
      const contents = await readFile(path);
      assert.equal(contents.includes(secretBytes), false, "API key leaked to an isolated file");
    }
  }
}

async function closeServer(server) {
  if (!server.listening) {
    return;
  }
  await new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => {
      if (error === undefined) {
        resolvePromise();
      } else {
        rejectPromise(error);
      }
    });
  });
}
