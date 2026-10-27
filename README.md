# CodeSafe - Blockchain-Based Software Source Code Escrow System

**Student:** Anika Sharma (23100BTCSAII14269) - Group 20
**Dept:** AI & DS, 4th Year, 7th Semester, SVVV Indore

## What it does
When a company (client) buys custom software from a developer, it usually gets only the
running app, not the source code. If the developer shuts down or stops responding,
the client gets stuck. CodeSafe fixes this with a smart contract:

1. Developer creates an escrow deal and uploads the source code. The code is **encrypted
   in the browser (AES-256-GCM)** and its **SHA-256 fingerprint is stored on the blockchain**.
2. Client pays and the payment is **locked in the smart contract**.
3. The developer must send a **heartbeat** ("I am active") before every deadline (e.g. every 30 days).
4. If the developer misses the deadline, the client can **claim the source code**. The contract
   refunds the payment, and the key vault releases the decryption key.
5. The client downloads the code and the system verifies it against the blockchain hash.
6. If everything goes well, the client marks the deal **Completed** and the payment goes to the developer.

## Tech stack
Solidity 0.8.24, Hardhat (local Ethereum blockchain), ethers.js v6, Node.js,
HTML/CSS/JavaScript, WebCrypto (AES-GCM, SHA-256).

## How to run
Requirement: Node.js 18 or later (https://nodejs.org)

```
cd CodeSafe          (the folder that contains package.json)
npm install          (only the first time)
npm start
```
Then open **http://localhost:3000** in your browser. Keep the terminal open.

> If you get `ENOENT package.json`, you are in the wrong folder. Open the inner CodeSafe folder
> that contains package.json.

## Demo wallets (ready-made, no MetaMask needed)
| Name | Role |
|---|---|
| CodeCraft Solutions | Developer |
| Pixel Apps Studio | Developer |
| Shree Infotech Pvt. Ltd. | Client |
| Global Retail Ltd. | Client |
| Unknown Person | Other |

## Demo flow
1. **Developer tab**: create a deal, e.g. "Billing Software", 2 ETH, 30 days.
2. **Client tab**: click Pay & Lock.
3. **Developer tab**: upload a zip file, then click Encrypt & Deposit. The deal becomes Active.
4. Send a heartbeat.
5. **Client tab**: click Claim Source Code. It is rejected: "Developer is still active".
6. **Dashboard**, Time Machine: skip 31 days. The status changes to Developer Inactive.
7. **Client tab**: click Claim Source Code. The deal is Released and the payment is refunded.
8. Click Download. The code is decrypted and verified.
9. **Verify Code tab**: upload the original file to see VERIFIED, then a modified file to see NOT MATCHING.

## Sample files for demo
`demo_files/billing_software_v1.zip` - upload this as the developer's code.
`demo_files/billing_software_MODIFIED.zip` - use this on the Verify page to show NOT MATCHING.

## Project structure
```
contracts/CodeSafe.sol     Smart contract
scripts/compile.js         Compiles the contract
start.js                   Starts blockchain, deploys contract, runs web server + key vault
frontend/                  Website (index.html, style.css, app.js)
```
Note: data resets every time you restart `npm start` (local test blockchain).
