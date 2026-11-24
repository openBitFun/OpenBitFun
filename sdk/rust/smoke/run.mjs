// Run from the independent consumer directory after building its binary.
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const binary = resolve(process.argv[2]);
const root = await mkdtemp(join(tmpdir(), "openbitfun-export-smoke-"));
const workspace = join(root, "workspace");
const proof = join(workspace, "proof.txt");
const marker = randomUUID();
const callId = "export-read";
await mkdir(workspace);
await writeFile(proof, marker);

let mode, requests, fault;
function modelReply(body) {
  assert.equal(body.model, "local-fixture");
  if (++requests === 1 && mode !== "resume") {
    assert.ok(body.tools.some(tool => tool.function.name === "Read"));
    assert.ok(!JSON.stringify(body.messages).includes(marker));
    const call = {
      index: 0, id: callId, type: "function",
      function: { name: "Read", arguments: JSON.stringify({ file_path: "proof.txt" }) },
    };
    return [{ role: "assistant", tool_calls: [call] }, "tool_calls"];
  }
  assert.equal(requests, mode === "resume" ? 1 : 2);
  const result = body.messages.find(m => m.role === "tool" && m.tool_call_id === callId);
  assert.ok(result, "missing correlated tool result");
  assert.equal(JSON.stringify(result.content).includes(marker), mode !== "reject");
  if (mode === "reject") assert.match(JSON.stringify(result.content), /Read rejected/);
  return [{ role: "assistant", content: `verified ${mode}` }, "stop"];
}

const server = createServer(async (req, res) => {
  try {
    assert.equal(req.url, "/v1/chat/completions");
    let wire = "";
    for await (const chunk of req) wire += chunk;
    const [delta, finish] = modelReply(JSON.parse(wire));
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const [part, reason] of [[delta, null], [{}, finish]]) {
      const chunk = {
        id: "reply", object: "chat.completion.chunk", model: "local-fixture",
        choices: [{ index: 0, delta: part, finish_reason: reason }],
      };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    res.end("data: [DONE]\n\n");
  } catch (error) {
    fault = error;
    res.writeHead(500);
    res.end(String(error));
  }
});

function runConsumer(config) {
  const child = spawn(binary, [], {
    cwd: workspace, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, OPENBITFUN_USER_ROOT: root, HOME: root, USERPROFILE: root },
  });
  return new Promise((resolve, reject) => {
    let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (fault) reject(fault);
      else if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `exit ${code}/${signal}`));
    });
    child.stdin.end(JSON.stringify(config));
  });
}

try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}/v1`;
  const model = {
    name: "local-fixture", model: "local-fixture", format: "openai",
    base_url: url, request_url: url + "/chat/completions", api_key: "local-fixture",
    context_window: 65536, inline_think_in_text: false, skip_ssl_verify: false,
  };
  let previous;
  for (mode of ["allow", "resume", "reject", "cancel"]) {
    requests = 0;
    // The positive control checks that this volume records reads. Backdating
    // only atime also works on relatime mounts. No fixture code reads the file.
    await utimes(proof, new Date("2000-01-01"), new Date());
    const before = (await stat(proof)).atimeMs;
    const reply = JSON.parse(await runConsumer({
      model, workspace, data: join(root, "data"), mode,
      restore: mode === "resume" ? previous : null,
    }));
    const accessed = (await stat(proof)).atimeMs !== before;
    assert.equal(accessed, mode === "allow", "unexpected file access or unavailable access timestamps");
    assert.equal(reply.asked, mode === "resume" ? 0 : 1);
    assert.equal(reply.answer, mode === "cancel" ? "" : `verified ${mode}`);
    assert.equal(requests, ["resume", "cancel"].includes(mode) ? 1 : 2);
    if (mode === "allow") previous = reply.session;
    if (mode === "resume") assert.equal(reply.session, previous);
    console.log(`export consumer (${mode}): PASS`);
  }
} finally {
  server.close();
  await rm(root, { recursive: true, force: true });
}
