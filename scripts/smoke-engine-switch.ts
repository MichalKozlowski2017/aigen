/**
 * Panelowy przełącznik — bez child_process i bez startu usług na Legionie.
 * Sprawdza, że brak LEGION_ENGINE_URL nie woła sieci, a wywołanie niesie Bearer.
 */
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  getEngineSwitchView,
  legionEngineAvailability,
  postEngineSwitch,
} from "../src/lib/studio/engine-switch";

const root = process.cwd();

function expect(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

async function testGuardDoesNotFetch() {
  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    throw new Error("nie wolno wołać Legionu");
  };
  const view = await getEngineSwitchView({ env: {}, fetchImpl });
  expect(view.available === false, "unset url available");
  expect(view.unavailableReason?.includes("LEGION_ENGINE_URL"), view.unavailableReason ?? "");
  expect(view.side === null, "no fake side");
  const posted = await postEngineSwitch(
    { target: "coder", confirmActiveJob: true },
    { env: {}, fetchImpl }
  );
  expect(posted.httpStatus === 403, `status ${posted.httpStatus}`);
  expect(posted.body.ok === false, "post ok");
  expect(called === false, "fetch was called without URL");

  const noSecret = await postEngineSwitch(
    { target: "comfy", confirmActiveJob: false },
    {
      env: { LEGION_ENGINE_URL: "https://engine.example.com" },
      fetchImpl,
    }
  );
  expect(noSecret.httpStatus === 403, "missing secret");
  expect(noSecret.body.error?.includes("LEGION_ENGINE_SECRET"), noSecret.body.error ?? "");
  expect(called === false, "fetch without secret");

  const creds = legionEngineAvailability({
    LEGION_ENGINE_URL: "https://user:secret@engine.example.com",
    LEGION_ENGINE_SECRET: "x",
  });
  expect(creds.ok === false, "credentials in URL");
}

async function testBearerAndConfirm() {
  const secret = "panel-secret-nie-w-body";
  const hits: { auth: string; body: string; url: string }[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const auth = String(req.headers.authorization ?? "");
      hits.push({ auth, body, url: req.url ?? "" });
      if (auth !== `Bearer ${secret}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
        return;
      }
      if (req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            side: "comfy",
            comfyOnline: true,
            coderOnline: false,
            comfyQueueRunning: true,
            switching: false,
            switchError: null,
            switchTarget: null,
          })
        );
        return;
      }
      const parsed = JSON.parse(body || "{}") as { confirmActiveJob?: boolean };
      if (!parsed.confirmActiveJob) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            needsConfirm: true,
            error: "ComfyUI ma aktywne zadanie w kolejce.",
          })
        );
        return;
      }
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, switching: true, target: "coder" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  const env = {
    LEGION_ENGINE_URL: `http://127.0.0.1:${address.port}`,
    LEGION_ENGINE_SECRET: secret,
  };
  try {
    const view = await getEngineSwitchView({ env });
    expect(view.available && view.side === "comfy", JSON.stringify(view));
    expect(view.comfyQueueRunning === true, "queue");
    const denied = await postEngineSwitch(
      { target: "coder", confirmActiveJob: false },
      { env }
    );
    expect(denied.httpStatus === 409 && denied.body.needsConfirm, JSON.stringify(denied));
    const accepted = await postEngineSwitch(
      { target: "coder", confirmActiveJob: true },
      { env }
    );
    expect(accepted.httpStatus === 200 && accepted.body.switching, JSON.stringify(accepted));
    expect(hits.length === 3, `hits ${hits.length}`);
    for (const hit of hits) {
      expect(hit.url === "/engine", hit.url);
      expect(hit.auth === `Bearer ${secret}`, "auth header");
      expect(!hit.body.includes(secret), "secret leaked into body");
    }
    const postBody = hits[2]?.body ?? "";
    expect(postBody.includes('"confirmActiveJob":true'), postBody);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

function testSources() {
  const panel = read("src/lib/studio/engine-switch.ts");
  const route = read("src/app/api/engine-switch/route.ts");
  const proxy = read("src/proxy.ts");
  const spawns = /from ["']node:child_process["']|require\(["']child_process["']\)/;
  expect(!spawns.test(panel), "panel spawns processes");
  expect(!spawns.test(route), "route spawns processes");
  expect(route.includes("requireStudioApiAuth"), "route auth");
  expect(!proxy.includes("/api/engine-switch"), "route left public");
  expect(read("scripts/legion/engine-control.py").includes("LEGION_ENGINE_SECRET"), "legion secret");
  expect(
    read("scripts/legion/engine-control.py").includes("stop-port-listener.ps1"),
    "stop by port script"
  );
}

async function main() {
  testSources();
  await testGuardDoesNotFetch();
  await testBearerAndConfirm();
  console.log("smoke-engine-switch ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
