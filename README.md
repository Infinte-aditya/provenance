# Supply Chain Provenance on Blockchain

Track a product from producer to retailer on a tamper-proof ledger. Anyone can scan a QR code
and see the full journey; only verified participants can add to it.

**Stack:** Solidity 0.8.24 · Hardhat · React + Vite · ethers v6

## Run the demo (about 2 minutes)

Requires Node.js 18 or newer.

```bash
npm run setup     # installs contract and frontend dependencies (once)
npm run demo      # starts a local chain, deploys, seeds sample data, opens the web app
```

Open the URL Vite prints (usually http://localhost:5173). Use the **Viewing as** menu in the top bar to
switch between the admin and the farm, truck, warehouse and shop accounts. No MetaMask is needed.
Press Ctrl+C to stop everything.

Suggested walkthrough:
1. As a visitor, open product **#1** to see a finished journey, its QR code, and the document check.
2. Switch to **Thanjavur Farms**, register a product, then propose a handover to **Kaveri Logistics**.
3. Switch to **Kaveri Logistics**, accept it, add a checkpoint, and hand over to the warehouse.
4. Continue to the shop, **confirm delivery** (this seals the record), or recall a product as the producer.
5. As **Admin**, add or deactivate participants and try the emergency pause.

## Other commands

| Command | What it does |
|---|---|
| `npm test` | 29 contract tests (access control, handover, recall, pause, lifecycle) |
| `npm run gas` | Same tests with a gas report |
| `npm run node` + `npm run deploy:local` | Persistent local chain, then deploy (no seed data) |
| `npm run frontend` | Start only the web app |
| `npm run deploy:sepolia` | Deploy to the Sepolia testnet (see below) |

## Features

**Contract (`contracts/ProvenanceTracker.sol`)**
- Permissioned roles: Producer, Transporter, Warehouse, Retailer, managed by the admin.
- **Two-step handover:** the sender proposes, the receiver must accept. A wrong address can never take custody, and the sender can cancel until it is accepted.
- **Deactivation and emergency pause:** the admin can remove a participant or freeze the system. Recalls, admin actions and reads still work while paused.
- **Evidence hash:** a checkpoint can carry the SHA-256 of a certificate or photo. The file never leaves your device.
- **Enumeration:** list products by producer or by current custodian.
- **Sealing and recall:** delivery seals a record; a producer or the admin can recall an unsealed one, which freezes it.
- Custom errors, input length limits, no external calls (no reentrancy surface), Solidity 0.8 overflow checks.

**Web app (`frontend/`)**
- Wallet connection (MetaMask) or demo accounts, with the interface adapting to the signed-in role.
- **Public verify page:** product number lookup, route-style timeline, status badges, QR code to print.
- **Document check:** drop a file and see whether it matches a fingerprint recorded on-chain.
- **Dashboard:** register products, accept incoming handovers, see what you hold or created, add checkpoints, hand over, deliver, recall.
- **Admin panel:** add participants, change roles, deactivate and reactivate, pause and resume.
- **Live updates** from contract events, with transaction progress and plain-language error messages.
- Light and dark mode, responsive layout, keyboard-accessible.

## Using a real network (Sepolia testnet)

1. Copy `.env.example` to `.env` and fill in `SEPOLIA_RPC_URL` and `PRIVATE_KEY` (a throwaway test wallet with test ETH).
2. `npm run deploy:sepolia` deploys and writes the address into `frontend/src/contract.json`.
3. `npm run frontend` and connect MetaMask on Sepolia.

## Privacy note

Everything on a public chain is readable by anyone. Store product numbers, hashes and non-sensitive
labels, not confidential business data or personal information.

## Project layout

```
contracts/ProvenanceTracker.sol   the smart contract
test/                             Hardhat tests
scripts/deploy.js                 deploys and writes frontend/src/contract.json
scripts/demo.js                   one-command local demo
frontend/src/                     React app (pages, components, lib/chain.js)
demo-files/                       sample certificate used by the seed data
```
# provenance
