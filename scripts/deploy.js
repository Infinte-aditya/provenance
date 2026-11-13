// Deploys ProvenanceTracker and writes frontend/src/contract.json (address + ABI + network).
// SEED=1 also registers demo participants and sample products (used by `npm run demo`).
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const { ethers, network, artifacts } = hre;
const Role = { Producer: 1, Transporter: 2, Warehouse: 3, Retailer: 4 };
const PUBLIC_RPC = { 11155111: "https://ethereum-sepolia-rpc.publicnode.com" };
const wait = async (p) => (await p).wait();

async function seed(c, signers) {
  const [, farm, truck, wh, shop, tea] = signers;
  const none = ethers.ZeroHash;
  const cert = ethers.sha256(fs.readFileSync(path.join(__dirname, "..", "demo-files", "organic-certificate.txt")));

  await wait(c.setParticipant(farm.address, Role.Producer, "Thanjavur Farms"));
  await wait(c.setParticipant(truck.address, Role.Transporter, "Kaveri Logistics"));
  await wait(c.setParticipant(wh.address, Role.Warehouse, "Chennai Central Warehouse"));
  await wait(c.setParticipant(shop.address, Role.Retailer, "T Nagar Fresh Mart"));
  await wait(c.setParticipant(tea.address, Role.Producer, "Nilgiri Tea Estates"));

  const handover = async (id, from, to, loc, note = "", ev = none) => {
    await wait(c.connect(from).initiateTransfer(id, to.address, loc, note, ev));
    await wait(c.connect(to).acceptTransfer(id));
  };

  // 1) Rice: complete journey, delivered (carries the organic certificate hash)
  await wait(c.connect(farm).registerProduct("Organic Basmati Rice (25 kg)", "Thanjavur, Tamil Nadu"));
  await handover(1, farm, truck, "Thanjavur farm gate", "Loaded, sealed bags", cert);
  await wait(c.connect(truck).addCheckpoint(1, "Trichy toll plaza", "On schedule", none));
  await handover(1, truck, wh, "Chennai Central Warehouse", "Unloaded, 24 pallets");
  await handover(1, wh, shop, "Chennai warehouse dock 3", "Cold chain intact");
  await wait(c.connect(shop).confirmDelivery(1, "T Nagar store, aisle 4", none));

  // 2) Tea: currently in transit
  await wait(c.connect(tea).registerProduct("Nilgiri Orange Pekoe Tea", "Coonoor, Nilgiris"));
  await handover(2, tea, truck, "Coonoor auction centre", "Vacuum packed");
  await wait(c.connect(truck).addCheckpoint(2, "Mettupalayam", "Ghat road crossing, no delay", none));

  // 3) Coffee: handover waiting for the warehouse to accept
  await wait(c.connect(farm).registerProduct("Arabica Coffee Beans (50 kg)", "Yercaud, Salem"));
  await wait(c.connect(farm).initiateTransfer(3, wh.address, "Yercaud estate", "Ready for pickup", none));

  // 4) Mango pulp: recalled
  await wait(c.connect(farm).registerProduct("Mango Pulp (batch 7)", "Salem, Tamil Nadu"));
  await wait(c.connect(farm).recall(4, "Failed moisture test at lab"));
}

async function main() {
  const signers = await ethers.getSigners();
  console.log(`Deploying to "${network.name}" as ${signers[0].address}`);
  const c = await (await ethers.getContractFactory("ProvenanceTracker")).deploy();
  await c.waitForDeployment();
  const address = await c.getAddress();
  console.log("ProvenanceTracker:", address);

  const doSeed = process.env.SEED === "1";
  if (doSeed) {
    await seed(c, signers);
    console.log("Seeded demo participants and products.");
  }

  if (network.name === "hardhat") return; // in-process network: nothing for the frontend to connect to

  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const local = network.name === "localhost";
  // Never expose a keyed RPC URL in the browser bundle: use a public RPC for live networks.
  const rpcUrl = local ? network.config.url : process.env.FRONTEND_RPC_URL || PUBLIC_RPC[chainId];
  if (!rpcUrl) throw new Error("Set FRONTEND_RPC_URL to a public RPC for this network.");

  const config = {
    address,
    chainId,
    networkName: local ? "Hardhat Local" : network.name,
    rpcUrl,
    demo: doSeed && local,
    abi: (await artifacts.readArtifact("ProvenanceTracker")).abi,
  };
  const out = path.join(__dirname, "..", "frontend", "src", "contract.json");
  fs.writeFileSync(out, JSON.stringify(config, null, 2));
  console.log("Wrote", path.relative(process.cwd(), out));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
