import assert from "assert";
import fs from "fs";
import Module from "module";
import path from "path";
import ts from "typescript";

const originalLoad = Module._load;
let connectCount = 0;
let closeCount = 0;
let failNextListToolsWith = null;
let failNextCallToolWith = null;

Module._load = function load(request, parent, isMain) {
  if (request.endsWith("../adapters/mcp-transports")) {
    return {
      connectMcpServer: async () => {
        connectCount += 1;
        const connection = {
          closed: false,
          listTools: async () => {
            if (failNextListToolsWith) {
              const error = failNextListToolsWith;
              failNextListToolsWith = null;
              throw error;
            }
            return [{ name: "lookup_wiki", description: "Lookup", inputSchema: { type: "object" } }];
          },
          callTool: async () => {
            if (failNextCallToolWith) {
              const error = failNextCallToolWith;
              failNextCallToolWith = null;
              throw error;
            }
            return { ok: true };
          },
          close: async () => {
            if (!connection.closed) {
              connection.closed = true;
              closeCount += 1;
            }
          },
        };
        return connection;
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

Module._extensions[".ts"] = function compileTypescript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  module._compile(output, filename);
};

const require = Module.createRequire(import.meta.url);
const { McpService } = require(path.resolve("src/services/mcp-service.ts"));

const now = new Date("2026-05-11T00:00:00.000Z").toISOString();
const server = {
  id: "mcp_stdio",
  name: "Local Tools",
  transport: "stdio",
  enabled: true,
  command: "node",
  args: ["server.js"],
  env: { TOKEN: "secret" },
  status: "idle",
  updatedAt: now,
};

const service = new McpService();

await Promise.all([service.discover(server), service.discover(server)]);
assert.equal(connectCount, 1, "concurrent discovery for the same config should share one connection attempt");
assert.equal(closeCount, 0, "shared discovery should not close the live connection");

await service.discover(server);
assert.equal(connectCount, 1, "re-discovery with unchanged config should reuse the existing connection");
assert.equal(service.getTools().length, 1, "reused discovery should keep tools available");

failNextListToolsWith = new Error(
  'Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32000,"message":"Bad Request: Server not initialized"},"id":null}',
);
await service.discover(server);
assert.equal(connectCount, 2, "recoverable streamable HTTP session errors should reconnect during discovery");
assert.equal(closeCount, 1, "recoverable streamable HTTP session errors should close the stale discovery connection");
assert.equal(service.getTools().length, 1, "reconnected discovery should republish tools");

const [tool] = service.getTools();
failNextCallToolWith = new Error("Bad Request: Server not initialized");
const call = await service.callTool(tool, { query: "wiki" }, "gen_1");
assert.equal(call.status, "success", "recoverable callTool session errors should reconnect and retry once");
assert.equal(connectCount, 3, "recoverable callTool session errors should create a replacement connection");
assert.equal(closeCount, 2, "recoverable callTool session errors should close the stale call connection");

await service.discover({ ...server, args: ["server-v2.js"] });
assert.equal(connectCount, 4, "changed stdio config should create one replacement connection");
assert.equal(closeCount, 3, "changed stdio config should close the replaced connection");

await service.closeServer(server.id);
assert.equal(closeCount, 4, "closing a server should close the active connection");
assert.deepEqual(service.getTools(), [], "closing a server should clear its tools");

await service.closeAll();
assert.equal(closeCount, 4, "closeAll should be idempotent when no connections remain");
console.log("ok mcp lifecycle");
