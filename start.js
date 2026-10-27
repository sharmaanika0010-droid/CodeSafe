/**
 * CodeSafe - one command starter
 *  1. Starts a local Hardhat blockchain (http://127.0.0.1:8545)
 *  2. Deploys the CodeSafe smart contract and sets demo names
 *  3. Starts the website + storage + key vault at http://localhost:3000
 */
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ethers } = require("ethers");

const RPC_PORT = 8545;
const WEB_PORT = process.env.PORT || 3000;
const RPC_URL = `http://127.0.0.1:${RPC_PORT}`;
const FRONTEND = path.join(__dirname, "frontend");
const STORAGE = path.join(__dirname, "storage");

let hardhat = null;
let contract = null; // read-only contract used by the key vault
const keys = {};     // key vault: "dealId-version" -> key (released only when contract allows)

function rpcAlive() {
  return new Promise((resolve) => {
    const req = http.request(RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" } }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }));
  });
}

async function startBlockchain() {
  if (await rpcAlive()) {
    console.log("> Blockchain already running on port 8545, using it.");
    return;
  }
  console.log("> Starting local Hardhat blockchain...");
  hardhat = spawn("npx", ["hardhat", "node", "--hostname", "127.0.0.1", "--port", String(RPC_PORT)], {
    cwd: __dirname,
    shell: true,
    env: { ...process.env, HARDHAT_DISABLE_TELEMETRY_PROMPT: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  hardhat.stdout.on("data", () => {});
  hardhat.stderr.on("data", (d) => process.stderr.write("[hardhat] " + d));
  for (let i = 0; i < 90; i++) {
    if (await rpcAlive()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Hardhat node did not start. Try running: npx hardhat node");
}

async function deploy() {
  const provider = new ethers.JsonRpcProvider(RPC_URL, undefined, { staticNetwork: ethers.Network.from(31337) });
  const accounts = await provider.listAccounts();
  const artifact = JSON.parse(fs.readFileSync(path.join(__dirname, "artifacts", "CodeSafe.json"), "utf8"));

  console.log("> Deploying CodeSafe smart contract...");
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, accounts[0]);
  const c = await factory.deploy();
  await c.waitForDeployment();
  const address = await c.getAddress();
  console.log("  Contract address:", address);

  const wallets = [
    { label: "CodeCraft Solutions", role: "developer", address: accounts[1].address },
    { label: "Pixel Apps Studio", role: "developer", address: accounts[2].address },
    { label: "Shree Infotech Pvt. Ltd.", role: "client", address: accounts[3].address },
    { label: "Global Retail Ltd.", role: "client", address: accounts[4].address },
    { label: "Unknown Person", role: "other", address: accounts[5].address },
  ];
  for (let i = 0; i < wallets.length; i++) {
    const signer = await provider.getSigner(wallets[i].address);
    await (await c.connect(signer).setName(wallets[i].label)).wait();
  }
  console.log("  Demo wallets ready.");

  contract = new ethers.Contract(address, artifact.abi, provider);
  fs.writeFileSync(path.join(FRONTEND, "config.json"),
    JSON.stringify({ address, abi: artifact.abi, chainId: 31337, wallets }, null, 1));
}

// ---------------- helpers ----------------
function readBody(req, limit = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("File too large (max 20 MB)")); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

// ---------------- API ----------------
async function api(req, res, url) {
  try {
    // store encrypted file (works like IPFS: id = hash of content)
    if (req.method === "POST" && url.pathname === "/api/store") {
      const body = JSON.parse((await readBody(req)).toString());
      const buf = Buffer.from(body.data, "base64");
      const id = "cs" + crypto.createHash("sha256").update(buf).digest("hex").slice(0, 44);
      fs.writeFileSync(path.join(STORAGE, id + ".json"), JSON.stringify({ name: body.name, iv: body.iv, data: body.data }));
      return json(res, 200, { fileId: id });
    }
    // get encrypted file (anyone can download, but it is useless without the key)
    if (req.method === "GET" && url.pathname.startsWith("/api/file/")) {
      const id = url.pathname.split("/").pop().replace(/[^a-z0-9]/gi, "");
      const f = path.join(STORAGE, id + ".json");
      if (!fs.existsSync(f)) return json(res, 404, { error: "File not found" });
      res.writeHead(200, { "Content-Type": "application/json" });
      return fs.createReadStream(f).pipe(res);
    }
    // developer gives the decryption key to the vault (signed by developer)
    if (req.method === "POST" && url.pathname === "/api/key") {
      const b = JSON.parse((await readBody(req)).toString());
      const signer = ethers.verifyMessage(`CodeSafe: store key for deal ${b.dealId} version ${b.version}`, b.signature);
      const deal = await contract.getDeal(b.dealId);
      if (signer.toLowerCase() !== deal.developer.toLowerCase()) return json(res, 403, { error: "Only the developer can store the key" });
      const vers = await contract.getVersions(b.dealId);
      const v = vers[Number(b.version) - 1];
      if (!v || ethers.keccak256(ethers.toUtf8Bytes(b.key)) !== v.keyHash) return json(res, 400, { error: "Key does not match the hash on blockchain" });
      keys[`${b.dealId}-${b.version}`] = b.key;
      return json(res, 200, { ok: true });
    }
    // client asks for the key - vault checks the SMART CONTRACT before releasing
    if (req.method === "POST" && url.pathname === "/api/release-key") {
      const b = JSON.parse((await readBody(req)).toString());
      const signer = ethers.verifyMessage(`CodeSafe: request key for deal ${b.dealId} version ${b.version}`, b.signature);
      const deal = await contract.getDeal(b.dealId);
      if (signer.toLowerCase() !== deal.client.toLowerCase()) return json(res, 403, { error: "Only the client of this deal can get the key" });
      if (Number(deal.status) !== 2) return json(res, 403, { error: "Smart contract has not released the code yet" });
      const k = keys[`${b.dealId}-${b.version}`];
      if (!k) return json(res, 404, { error: "Key not found in vault" });
      return json(res, 200, { key: k });
    }
    json(res, 404, { error: "Unknown API" });
  } catch (e) {
    json(res, 500, { error: e.shortMessage || e.message });
  }
}

function startWeb() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/rpc")) {
      const body = await readBody(req).catch(() => Buffer.alloc(0));
      const p = http.request(RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" } }, (r) => {
        res.writeHead(r.statusCode, { "Content-Type": "application/json" });
        r.pipe(res);
      });
      p.on("error", () => { res.writeHead(502); res.end("blockchain not reachable"); });
      return p.end(body);
    }
    if (url.pathname.startsWith("/api/")) return api(req, res, url);

    let file = decodeURIComponent(url.pathname);
    if (file === "/") file = "/index.html";
    const full = path.join(FRONTEND, path.normalize(file));
    if (!full.startsWith(FRONTEND) || !fs.existsSync(full)) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(full).pipe(res);
  });
  server.listen(WEB_PORT, "0.0.0.0", () => {
    console.log("\n==============================================");
    console.log("  CodeSafe is running!");
    console.log(`  Open in browser:  http://localhost:${WEB_PORT}`);
    console.log("  (Keep this window open. Press Ctrl+C to stop)");
    console.log("==============================================\n");
  });
}

(async () => {
  try {
    fs.rmSync(STORAGE, { recursive: true, force: true });
    fs.mkdirSync(STORAGE, { recursive: true });
    await startBlockchain();
    await deploy();
    startWeb();
  } catch (e) {
    console.error("ERROR:", e.message);
    if (hardhat) hardhat.kill();
    process.exit(1);
  }
})();

process.on("SIGINT", () => { if (hardhat) hardhat.kill(); process.exit(0); });
