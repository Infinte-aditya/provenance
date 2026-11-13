// One command: start a local chain, deploy + seed demo data, start the frontend.
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const frontend = path.join(root, "frontend");
const RPC = "http://127.0.0.1:8545";
const children = [];
const isWin = process.platform === "win32";

function run(cmd, cwd, env = {}) {
  const child = spawn(cmd, { cwd, shell: true, stdio: "inherit", detached: !isWin, env: { ...process.env, ...env } });
  children.push(child);
  return child;
}

function stopAll() {
  for (const c of children) {
    try {
      if (isWin) spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"]);
      else process.kill(-c.pid, "SIGTERM");
    } catch {}
  }
}
process.on("SIGINT", () => { stopAll(); process.exit(0); });
process.on("SIGTERM", () => { stopAll(); process.exit(0); });
process.on("exit", stopAll);

async function rpcUp() {
  try {
    const r = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

(async () => {
  if (await rpcUp()) {
    console.error("Port 8545 is already in use by another node. Stop it and run `npm run demo` again.");
    process.exit(1);
  }
  if (!fs.existsSync(path.join(frontend, "node_modules"))) {
    console.log("Installing frontend dependencies (first run only)...");
    const r = spawnSync("npm install --no-audit --no-fund", { cwd: frontend, shell: true, stdio: "inherit" });
    if (r.status !== 0) process.exit(1);
  }

  console.log("Starting local blockchain...");
  const node = run("npx hardhat node", root);
  node.on("exit", (code) => { if (code) { console.error("Local node stopped."); process.exit(1); } });

  for (let i = 0; i < 60 && !(await rpcUp()); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await rpcUp())) { console.error("Local node did not start."); process.exit(1); }

  console.log("Deploying contract and seeding demo data...");
  const d = spawnSync("npx hardhat run scripts/deploy.js --network localhost", {
    cwd: root, shell: true, stdio: "inherit", env: { ...process.env, SEED: "1" },
  });
  if (d.status !== 0) process.exit(1);

  console.log("\nStarting the web app. Open the URL below. Press Ctrl+C to stop everything.\n");
  run("npm run dev", frontend);
})();
