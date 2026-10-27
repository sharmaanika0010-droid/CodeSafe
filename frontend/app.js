/* CodeSafe frontend - connects the website with the CodeSafe smart contract using ethers.js */

const STATUS = ["Created", "Active", "Released", "Completed"];
let cfg, provider, readC, wallets = [], current = null, chainNow = 0;
const nameCache = {};

const $ = (id) => document.getElementById(id);
const short = (a) => (a ? a.slice(0, 6) + "..." + a.slice(-4) : "-");
const fmtTime = (s) => (Number(s) ? new Date(Number(s) * 1000).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "-");
const eth = (w) => ethers.formatEther(w) + " ETH";
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const same = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();

function toast(msg, type = "") {
  const d = document.createElement("div");
  d.className = type;
  d.textContent = msg;
  $("toast").appendChild(d);
  setTimeout(() => d.remove(), 6500);
}

function errMsg(e) {
  const s = JSON.stringify(e) + " " + (e && e.message);
  const m = s.match(/reverted with reason string '([^']+)'/) || s.match(/reason="([^"]+)"/);
  if (m) return m[1];
  return (e && (e.reason || e.shortMessage || e.message)) || "Transaction failed";
}

// ---------- base64 / hash helpers ----------
function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s) {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
async function sha256(buf) {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return "0x" + Array.from(new Uint8Array(h), (x) => x.toString(16).padStart(2, "0")).join("");
}

// ---------- setup ----------
async function init() {
  cfg = await (await fetch("config.json")).json();
  provider = new ethers.JsonRpcProvider(location.origin + "/rpc", undefined, { staticNetwork: ethers.Network.from(cfg.chainId) });
  provider.pollingInterval = 400;
  readC = new ethers.Contract(cfg.address, cfg.abi, provider);
  wallets = cfg.wallets;

  $("walletSelect").innerHTML = wallets.map((w, i) => `<option value="${i}">${esc(w.label)} (${w.role})</option>`).join("");
  $("walletSelect").onchange = async () => { await setWallet(Number($("walletSelect").value)); refresh(); };
  document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => openTab(b.dataset.tab)));
  $("dClient").innerHTML = wallets.filter((w) => w.role === "client").map((w) => `<option value="${w.address}">${esc(w.label)}</option>`).join("");

  bindEvents();
  await setWallet(0);
  $("netInfo").textContent = `Connected to local Hardhat blockchain (Chain ID ${cfg.chainId}) | Contract: ${cfg.address}`;
  refresh();
}

async function setWallet(i) {
  current = wallets[i];
  $("walletSelect").value = i;
  $("walletAddr").textContent = short(current.address);
  $("walletBal").textContent = Number(ethers.formatEther(await provider.getBalance(current.address))).toFixed(4) + " ETH";
}

function activeTab() { return document.querySelector(".tabs button.active").dataset.tab; }

async function openTab(tab) {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + tab));
  if ((tab === "developer" || tab === "client") && current.role !== tab) {
    await setWallet(wallets.findIndex((w) => w.role === tab));
  }
  refresh();
}

async function signer() { return provider.getSigner(current.address); }

async function sendTx(label, fn, btn) {
  if (btn) btn.disabled = true;
  try {
    const c = new ethers.Contract(cfg.address, cfg.abi, await signer());
    const tx = await fn(c);
    const rc = await tx.wait();
    logTx(label, rc);
    toast(label + " - saved on blockchain (block #" + rc.blockNumber + ")", "ok");
    return true;
  } catch (e) {
    console.error(e);
    toast("Error: " + errMsg(e), "err");
    return false;
  } finally {
    if (btn) btn.disabled = false;
  }
}

const txs = [];
function logTx(label, rc) {
  txs.unshift(`<div class="tx"><b>&#10004; ${esc(label)}</b> | Block #${rc.blockNumber} | From ${short(rc.from)} | Tx ${rc.hash.slice(0, 18)}... | Gas ${rc.gasUsed}</div>`);
  $("txLog").innerHTML = txs.slice(0, 12).join("");
}

async function nameOf(a) {
  if (!nameCache[a]) nameCache[a] = (await readC.names(a)) || short(a);
  return nameCache[a];
}

// ---------- data ----------
async function loadDeals() {
  const n = Number(await readC.dealCount());
  const block = await provider.getBlock("latest");
  chainNow = Number(block.timestamp);
  $("chainTime").textContent = fmtTime(chainNow);
  const list = [];
  for (let i = 1; i <= n; i++) {
    const d = await readC.getDeal(i);
    const v = await readC.getVersions(i);
    const status = Number(d.status);
    const due = Number(d.lastHeartbeat) + Number(d.heartbeatInterval);
    const inactive = status === 1 && chainNow > due;
    list.push({ d, v, status, due, inactive, id: i, devName: await nameOf(d.developer), clientName: await nameOf(d.client) });
  }
  return list;
}

function pill(x) {
  if (x.status === 0) return `<span class="pill created">Waiting (${!x.d.funded ? "payment" : ""}${!x.d.funded && !x.v.length ? " + " : ""}${!x.v.length ? "code" : ""})</span>`;
  if (x.status === 1) return x.inactive ? `<span class="pill inactive">&#9888; Developer Inactive</span>` : `<span class="pill active">&#9679; Active</span>`;
  if (x.status === 2) return `<span class="pill released">&#128275; Code Released</span>`;
  return `<span class="pill completed">&#10004; Completed</span>`;
}

function dueText(x) {
  if (x.status !== 1) return "-";
  const days = (x.due - chainNow) / 86400;
  if (days < 0) return `<span style="color:#c0392b">Missed ${Math.ceil(-days)} day(s) ago</span>`;
  return `${fmtTime(x.due)}<br/><small class="muted">${days.toFixed(1)} days left</small>`;
}

// ---------- refresh ----------
async function refresh() {
  try {
    const deals = await loadDeals();
    await setWallet(wallets.indexOf(current));
    const tab = activeTab();
    if (tab === "dashboard") renderDashboard(deals);
    if (tab === "developer") renderDeals(deals.filter((x) => same(x.d.developer, current.address)), "devDeals", "developer");
    if (tab === "client") renderDeals(deals.filter((x) => same(x.d.client, current.address)), "clientDeals", "client");
  } catch (e) { console.error(e); }
}

function renderDashboard(deals) {
  $("stTotal").textContent = deals.length;
  $("stActive").textContent = deals.filter((x) => x.status === 1 && !x.inactive).length;
  $("stInactive").textContent = deals.filter((x) => x.inactive).length;
  $("stReleased").textContent = deals.filter((x) => x.status === 2).length;
  $("stCompleted").textContent = deals.filter((x) => x.status === 3).length;
  $("dealsTable").innerHTML = deals.map((x) => `<tr><td>${x.id}</td><td><b>${esc(x.d.title)}</b></td><td>${esc(x.devName)}</td><td>${esc(x.clientName)}</td>
    <td>${x.status === 2 ? "Refunded" : x.status === 3 ? "Paid to dev" : eth(x.d.amount)}${x.d.funded ? "" : "<br/><small class='muted'>not paid</small>"}</td><td>${x.v.length}</td><td>${dueText(x)}</td><td>${pill(x)}</td></tr>`).join("")
    || `<tr><td colspan="8" class="muted">No deals yet. Go to the Developer tab to create one.</td></tr>`;
}

function versionsTable(x, role) {
  if (!x.v.length) return `<p class="muted">No code deposited yet.</p>`;
  return `<table><thead><tr><th>Ver.</th><th>File</th><th>Note</th><th>Deposited On</th><th>SHA-256 Fingerprint (on blockchain)</th>${role === "client" && x.status === 2 ? "<th></th>" : ""}</tr></thead><tbody>
    ${x.v.map((v) => `<tr><td>v${v.number}</td><td>${esc(v.fileName)}</td><td>${esc(v.note)}</td><td>${fmtTime(v.time)}</td><td class="mono">${v.codeHash}</td>
      ${role === "client" && x.status === 2 ? `<td><button class="btn green" data-download="${x.id}" data-ver="${v.number}">Download</button></td>` : ""}</tr>`).join("")}
  </tbody></table>`;
}

function renderDeals(deals, el, role) {
  if (!deals.length) { $(el).innerHTML = `<div class="card muted">No deals for this wallet yet.</div>`; return; }
  $(el).innerHTML = deals.map((x) => {
    let alert = "", actions = "";
    if (x.status === 0) {
      alert = `<div class="alert grey">Deal will become <b>Active</b> when the client pays and the developer uploads the first code version.</div>`;
    } else if (x.status === 1 && !x.inactive) {
      alert = `<div class="alert green">Developer is active. Next heartbeat due by <b>${fmtTime(x.due)}</b>.</div>`;
    } else if (x.inactive) {
      alert = `<div class="alert red"><b>Developer missed the heartbeat deadline.</b> The client can now claim the source code and get the payment back.</div>`;
    } else if (x.status === 2) {
      alert = `<div class="alert blue">Source code has been <b>released to the client</b> and the payment was refunded to the client.</div>`;
    } else {
      alert = `<div class="alert green">Deal completed. Payment released to the developer.</div>`;
    }

    if (role === "developer" && x.status <= 1) {
      actions = `${x.status === 1 ? `<button class="btn green" data-heartbeat="${x.id}">&#10084; Send Heartbeat (I am active)</button>` : ""}
        <div class="upload"><b>Upload ${x.v.length ? "new" : "first"} code version</b> <span class="muted">(file is encrypted in your browser before upload)</span>
          <div class="row"><input type="file" id="file-${x.id}" /><input id="note-${x.id}" placeholder="Note e.g. v1.0 first release" />
          <button class="btn primary" data-upload="${x.id}">Encrypt &amp; Deposit</button></div></div>`;
    }
    if (role === "client") {
      if (!x.d.funded) actions += `<button class="btn primary" data-fund="${x.id}">Pay &amp; Lock ${eth(x.d.amount)}</button> `;
      if (x.status === 1) actions += `<button class="btn danger" data-claim="${x.id}">Claim Source Code</button> <button class="btn" data-complete="${x.id}">Mark Completed (pay developer)</button>`;
    }
    return `<div class="deal">
      <div class="dhead"><h3>#${x.id} ${esc(x.d.title)}</h3>${pill(x)}</div>
      <div class="dbody">
        <div class="info">
          <div><small>Developer</small><b>${esc(x.devName)}</b></div>
          <div><small>Client</small><b>${esc(x.clientName)}</b></div>
          <div><small>Locked Payment</small><b>${x.status === 2 ? "Refunded to client" : x.status === 3 ? "Paid to developer" : x.d.funded ? eth(x.d.amount) : "Not paid yet (" + eth(x.d.amount) + ")"}</b></div>
          <div><small>Heartbeat Every</small><b>${Number(x.d.heartbeatInterval) / 86400} days</b></div>
          <div><small>Last Heartbeat</small><b>${fmtTime(x.d.lastHeartbeat)}</b></div>
          <div><small>Next Due</small><b>${dueText(x)}</b></div>
          <div><small>Code Versions</small><b>${x.v.length}</b></div>
          <div><small>Created</small><b>${fmtTime(x.d.createdAt)}</b></div>
        </div>
        ${alert}
        ${versionsTable(x, role)}
        <div>${actions}</div>
      </div></div>`;
  }).join("");
}

// ---------- actions ----------
async function uploadVersion(id, btn) {
  const file = $("file-" + id).files[0];
  if (!file) return toast("Choose a source code file (e.g. project.zip)", "err");
  if (file.size > 20 * 1024 * 1024) return toast("File too large (max 20 MB)", "err");
  btn.disabled = true;
  try {
    toast("Encrypting file in browser...");
    const raw = await file.arrayBuffer();
    const codeHash = await sha256(raw);
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, raw);
    const keyB64 = b64(await crypto.subtle.exportKey("raw", key));
    const keyHash = ethers.keccak256(ethers.toUtf8Bytes(keyB64));

    const r = await fetch("/api/store", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, iv: b64(iv), data: b64(enc) }) });
    const st = await r.json();
    if (!r.ok) throw new Error(st.error);

    const note = $("note-" + id).value.trim() || "Code update";
    const ok = await sendTx(`depositCode (deal #${id}, ${file.name})`, (c) => c.depositCode(id, file.name, st.fileId, codeHash, keyHash, note));
    if (!ok) return;

    const version = (await readC.getVersions(id)).length;
    const sig = await (await signer()).signMessage(`CodeSafe: store key for deal ${id} version ${version}`);
    const kr = await fetch("/api/key", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealId: id, version, key: keyB64, signature: sig }) });
    if (!kr.ok) throw new Error((await kr.json()).error);
    toast("Decryption key locked in vault. It will be released only if the smart contract allows.", "ok");
    refresh();
  } catch (e) {
    console.error(e);
    toast("Error: " + errMsg(e), "err");
  } finally {
    btn.disabled = false;
  }
}

async function downloadVersion(id, ver, btn) {
  btn.disabled = true;
  try {
    const v = (await readC.getVersions(id))[ver - 1];
    const sig = await (await signer()).signMessage(`CodeSafe: request key for deal ${id} version ${ver}`);
    const kr = await fetch("/api/release-key", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealId: id, version: ver, signature: sig }) });
    const kj = await kr.json();
    if (!kr.ok) throw new Error(kj.error);
    if (ethers.keccak256(ethers.toUtf8Bytes(kj.key)) !== v.keyHash) throw new Error("Key does not match blockchain record");

    const f = await (await fetch("/api/file/" + v.fileId)).json();
    const key = await crypto.subtle.importKey("raw", unb64(kj.key), "AES-GCM", false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(f.iv) }, key, unb64(f.data));
    const hash = await sha256(plain);
    if (hash !== v.codeHash) throw new Error("Hash mismatch - file was changed!");

    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([plain]));
    a.download = v.fileName;
    a.click();
    toast(`Verified: ${v.fileName} matches the SHA-256 fingerprint stored on blockchain. Download started.`, "ok");
  } catch (e) {
    console.error(e);
    toast("Error: " + errMsg(e), "err");
  } finally {
    btn.disabled = false;
  }
}

async function verifyFile(file) {
  const hash = await sha256(await file.arrayBuffer());
  const deals = await loadDeals();
  const matches = [];
  for (const x of deals) for (const v of x.v) if (v.codeHash === hash) matches.push({ x, v });
  $("verifyResult").innerHTML = `<div class="result">
    <p><b>File:</b> ${esc(file.name)}<br/><b>SHA-256:</b> <span class="mono">${hash}</span></p>
    ${matches.length
      ? matches.map((m) => `<div class="alert green">&#10004; <b>VERIFIED ORIGINAL CODE</b> - matches <b>Deal #${m.x.id} (${esc(m.x.d.title)})</b>, version v${m.v.number}, deposited by <b>${esc(m.x.devName)}</b> on ${fmtTime(m.v.time)}.</div>`).join("")
      : `<div class="alert red">&#10006; <b>NOT MATCHING</b> - this file does not match any code version stored on the blockchain. It may be modified or a different file.</div>`}
  </div>`;
}

function bindEvents() {
  $("createDealBtn").onclick = async () => {
    const title = $("dTitle").value.trim();
    if (!title) return toast("Enter project name", "err");
    const amt = $("dAmount").value, days = Number($("dDays").value);
    if (!(Number(amt) > 0)) return toast("Enter a valid amount", "err");
    if (await sendTx(`createDeal (${title})`, (c) => c.createDeal(title, $("dClient").value, days, ethers.parseEther(String(amt))), $("createDealBtn"))) {
      $("dTitle").value = "";
      refresh();
    }
  };

  document.body.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.dataset.heartbeat) { if (await sendTx(`heartbeat (deal #${t.dataset.heartbeat})`, (c) => c.heartbeat(t.dataset.heartbeat), t)) refresh(); }
    if (t.dataset.upload) uploadVersion(Number(t.dataset.upload), t);
    if (t.dataset.fund) {
      const d = await readC.getDeal(t.dataset.fund);
      if (await sendTx(`fundDeal (deal #${t.dataset.fund}, ${eth(d.amount)})`, (c) => c.fundDeal(t.dataset.fund, { value: d.amount }), t)) refresh();
    }
    if (t.dataset.claim) { if (await sendTx(`claimCode (deal #${t.dataset.claim})`, (c) => c.claimCode(t.dataset.claim), t)) refresh(); }
    if (t.dataset.complete) { if (await sendTx(`completeDeal (deal #${t.dataset.complete})`, (c) => c.completeDeal(t.dataset.complete), t)) refresh(); }
    if (t.dataset.download) downloadVersion(Number(t.dataset.download), Number(t.dataset.ver), t);
  });

  $("skipBtn").onclick = async () => {
    const days = Number($("skipDays").value);
    if (!(days > 0)) return;
    await provider.send("evm_increaseTime", [Math.round(days * 86400)]);
    await provider.send("evm_mine", []);
    toast(`Blockchain time moved forward by ${days} days`, "ok");
    refresh();
  };

  $("verifyFile").onchange = (e) => { if (e.target.files[0]) verifyFile(e.target.files[0]); e.target.value = ""; };
}

init().catch((e) => {
  console.error(e);
  $("netInfo").textContent = "Could not connect to blockchain. Start the project with: npm start";
});
