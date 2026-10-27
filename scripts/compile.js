// Compiles contracts/CodeSafe.sol -> artifacts/CodeSafe.json (ABI + bytecode)
// Usage: npm run compile
const solc = require("solc");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "contracts", "CodeSafe.sol"), "utf8");
const input = {
  language: "Solidity",
  sources: { "CodeSafe.sol": { content: src } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
let failed = false;
(out.errors || []).forEach((e) => { console.log(e.formattedMessage); if (e.severity === "error") failed = true; });
if (failed) process.exit(1);
const c = out.contracts["CodeSafe.sol"].CodeSafe;
fs.mkdirSync(path.join(__dirname, "..", "artifacts"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "..", "artifacts", "CodeSafe.json"),
  JSON.stringify({ abi: c.abi, bytecode: "0x" + c.evm.bytecode.object }, null, 1));
console.log("CodeSafe.sol compiled successfully -> artifacts/CodeSafe.json");
