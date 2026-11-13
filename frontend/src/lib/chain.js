// Pure chain helpers (no React, no JSON import) so they can be reused and tested in Node.
import { Contract, JsonRpcProvider } from "ethers";

export const ROLES = ["None", "Producer", "Transporter", "Warehouse", "Retailer"];
export const STATUS = ["Created", "In transit", "In warehouse", "At retailer", "Delivered", "Recalled"];
export const STATUS_KEY = ["created", "transit", "warehouse", "retailer", "delivered", "recalled"];
export const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
export const ZERO_HASH = "0x" + "0".repeat(64);
export const isClosed = (status) => status >= 4; // delivered or recalled: record is sealed

const ERROR_TEXT = {
  NotOwner: "Only the admin can do this.",
  NotAuthorized: "Your account isn't allowed to do this.",
  NotCustodian: "Only the product's current custodian can do this.",
  NotReceiver: "Only the address this product was sent to can accept it.",
  UnknownProduct: "That product doesn't exist.",
  InvalidAddress: "That address isn't valid for this action.",
  InvalidRole: "Choose a role for this participant.",
  StringTooLong: "Text is too long. The limit is 128 characters.",
  EmptyString: "A required field is empty.",
  ProductClosed: "This record is sealed (delivered or recalled) and can't change.",
  NotRegistered: "That address isn't an active participant.",
  TransferPending: "A handover is already waiting to be accepted.",
  NoPendingTransfer: "There is no pending handover for this product.",
  ContractPaused: "The system is paused by the admin. Only recalls and admin changes work.",
  NotPaused: "The system isn't paused.",
};

export const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
export const shortHash = (h) => `${h.slice(0, 10)}…${h.slice(-6)}`;
export const hasEvidence = (h) => !!h && h !== ZERO_HASH;
export const fmtDate = (ts) =>
  new Date(ts * 1000).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function createReader(cfg) {
  const provider = new JsonRpcProvider(cfg.rpcUrl, cfg.chainId, { staticNetwork: true });
  provider.pollingInterval = 1500;
  const contract = new Contract(cfg.address, cfg.abi, provider);
  return { provider, contract };
}

export function decodeError(err, iface) {
  if (err?.code === "ACTION_REJECTED" || err?.info?.error?.code === 4001) return "You cancelled the transaction in your wallet.";
  let name = err?.revert?.name;
  if (!name) {
    const data = [err?.data, err?.error?.data, err?.info?.error?.data, err?.info?.error?.data?.data].find(
      (d) => typeof d === "string" && d.startsWith("0x")
    );
    if (data) {
      try {
        name = iface.parseError(data)?.name;
      } catch {
        /* not one of our errors */
      }
    }
  }
  if (name && ERROR_TEXT[name]) return ERROR_TEXT[name];
  return err?.shortMessage || err?.reason || err?.message || "The transaction failed.";
}

const toProduct = (p) => ({
  id: Number(p.id), name: p.name, origin: p.origin, producer: p.producer,
  custodian: p.custodian, status: Number(p.status), createdAt: Number(p.createdAt),
});
const toCheckpoint = (h) => ({
  handler: h.handler, location: h.location, note: h.note, evidence: h.evidence,
  status: Number(h.status), timestamp: Number(h.timestamp),
});

export async function fetchProducts(contract, ids) {
  return Promise.all(ids.map(async (id) => toProduct(await contract.getProduct(id))));
}

export async function fetchRecent(contract, limit = 12) {
  const count = Number(await contract.productCount());
  const ids = [];
  for (let i = count; i >= 1 && ids.length < limit; i--) ids.push(i);
  return { count, products: await fetchProducts(contract, ids) };
}

export async function fetchProduct(contract, id) {
  const [p, h, t] = await Promise.all([contract.getProduct(id), contract.getHistory(id), contract.pendingTransfer(id)]);
  const pending = t.to === ZERO_ADDR ? null : { to: t.to, location: t.location, note: t.note, evidence: t.evidence };
  return { product: toProduct(p), history: h.map(toCheckpoint), pending };
}

export async function fetchParticipants(contract) {
  const list = await contract.getParticipants();
  return list.map((p) => ({ account: p.account, role: Number(p.role), active: p.active, name: p.name }));
}

export async function sha256File(file) {
  if (!globalThis.crypto?.subtle) throw new Error("Hashing needs a secure page (https or localhost).");
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return "0x" + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
