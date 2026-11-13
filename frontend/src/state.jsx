import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { BrowserProvider } from "ethers";
import cfg from "./config.js";
import { createReader, decodeError, fetchParticipants, same, short } from "./lib/chain.js";

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

// ── tiny hash router: #/  #/product/3  #/dashboard  #/admin ──
const parseHash = () => {
  const [page, arg] = window.location.hash.replace(/^#\/?/, "").split("/");
  return { page: page || "home", arg };
};
export function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

const EVENT_TEXT = {
  ProductRegistered: (a) => `Product #${a.id} was registered`,
  TransferInitiated: (a) => `Handover proposed for product #${a.id}`,
  TransferCancelled: (a) => `Handover cancelled for product #${a.id}`,
  CustodyTransferred: (a) => `Product #${a.id} changed hands`,
  CheckpointAdded: (a) => `New checkpoint on product #${a.id}`,
  ProductRecalled: (a) => `Product #${a.id} was recalled`,
  ParticipantSet: () => "A participant was added or updated",
  ParticipantRemoved: () => "A participant was deactivated",
  Paused: () => "The system was paused",
  Unpaused: () => "The system was resumed",
};

export function AppProvider({ children }) {
  const deployed = !!cfg.address;
  const reader = useMemo(() => (deployed ? createReader(cfg) : null), [deployed]);

  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);
  const [session, setSession] = useState({ mode: "public", account: null, signer: null });
  const [demoAccounts, setDemoAccounts] = useState([]);
  const [chain, setChain] = useState({ owner: null, paused: false, count: 0, participants: [], error: null, ready: false });
  const [toasts, setToasts] = useState([]);
  const lastOwnTx = useRef(0);
  const toastId = useRef(0);

  // ── toasts ──
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (kind, text) => {
      const id = ++toastId.current;
      setToasts((t) => [...t, { id, kind, text }]);
      if (kind !== "pending") setTimeout(() => dismiss(id), kind === "err" ? 8000 : 4500);
      return id;
    },
    [dismiss]
  );
  const updateToast = useCallback(
    (id, kind, text) => {
      setToasts((t) => t.map((x) => (x.id === id ? { ...x, kind, text } : x)));
      setTimeout(() => dismiss(id), kind === "err" ? 8000 : 4500);
    },
    [dismiss]
  );

  // ── on-chain state shared by every page; reloads on each new tick ──
  useEffect(() => {
    if (!reader) return;
    let dead = false;
    (async () => {
      try {
        const c = reader.contract;
        const [owner, paused, count, participants] = await Promise.all([c.owner(), c.paused(), c.productCount(), fetchParticipants(c)]);
        if (!dead) setChain({ owner, paused, count: Number(count), participants, error: null, ready: true });
      } catch {
        if (!dead) setChain((s) => ({ ...s, ready: true, error: `Can't reach the blockchain at ${cfg.rpcUrl}. Is the node running and the contract deployed?` }));
      }
    })();
    return () => {
      dead = true;
    };
  }, [reader, tick]);

  // ── live updates: refresh whenever a block contains one of this contract's events ──
  useEffect(() => {
    if (!reader) return;
    const iface = reader.contract.interface;
    const onBlock = async (n) => {
      try {
        const logs = await reader.provider.getLogs({ address: cfg.address, fromBlock: n, toBlock: n });
        if (!logs.length) return;
        bump();
        if (Date.now() - lastOwnTx.current < 4000) return; // our own transaction already showed a toast
        const seen = new Set();
        for (const log of logs) {
          const ev = iface.parseLog(log);
          const text = ev && EVENT_TEXT[ev.name]?.(ev.args);
          if (text && !seen.has(text)) {
            seen.add(text);
            toast("info", text);
          }
        }
      } catch {
        /* a missed block is harmless; the next one refreshes */
      }
    };
    reader.provider.on("block", onBlock);
    return () => {
      reader.provider.off("block", onBlock);
    };
  }, [reader, bump, toast]);

  // ── demo accounts (only when the deploy script seeded a local chain) ──
  useEffect(() => {
    if (!reader || !cfg.demo) return;
    reader.provider
      .send("eth_accounts", [])
      .then((a) => setDemoAccounts(a.slice(0, 6)))
      .catch(() => {});
  }, [reader]);

  const selectDemo = useCallback(
    async (index) => {
      if (index < 0) return setSession({ mode: "public", account: null, signer: null });
      const addr = demoAccounts[index];
      const signer = await reader.provider.getSigner(addr);
      setSession({ mode: "demo", account: addr, signer });
    },
    [demoAccounts, reader]
  );

  // ── wallet (MetaMask or any injected wallet) ──
  const connectWallet = useCallback(async () => {
    try {
      if (!window.ethereum) throw new Error("No wallet found. Install MetaMask, or use the demo accounts.");
      let bp = new BrowserProvider(window.ethereum);
      await bp.send("eth_requestAccounts", []);
      const net = await bp.getNetwork();
      if (Number(net.chainId) !== cfg.chainId) {
        const chainId = "0x" + cfg.chainId.toString(16);
        try {
          await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
        } catch (e) {
          if (e?.code !== 4902 && !/unrecognized|not added/i.test(e?.message || "")) throw e;
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{ chainId, chainName: cfg.networkName, rpcUrls: [cfg.rpcUrl], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } }],
          });
        }
        bp = new BrowserProvider(window.ethereum); // network changed: rebuild the provider
      }
      const signer = await bp.getSigner();
      setSession({ mode: "wallet", account: await signer.getAddress(), signer });
    } catch (e) {
      toast("err", decodeError(e, reader?.contract.interface));
    }
  }, [reader, toast]);

  useEffect(() => {
    if (session.mode !== "wallet" || !window.ethereum?.on) return;
    const onAccounts = () => connectWallet();
    const onChain = () => window.location.reload();
    window.ethereum.on("accountsChanged", onAccounts);
    window.ethereum.on("chainChanged", onChain);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", onAccounts);
      window.ethereum.removeListener?.("chainChanged", onChain);
    };
  }, [session.mode, connectWallet]);

  const disconnect = useCallback(() => setSession({ mode: "public", account: null, signer: null }), []);

  // ── run a write transaction with pending / success / error feedback ──
  const tx = useCallback(
    async (label, fn) => {
      if (!session.signer) {
        toast("err", "Connect a wallet or pick a demo account first.");
        return false;
      }
      const id = toast("pending", `${label}…`);
      try {
        const sent = await fn(reader.contract.connect(session.signer));
        await sent.wait();
        lastOwnTx.current = Date.now();
        updateToast(id, "ok", `${label}: confirmed`);
        bump();
        return true;
      } catch (e) {
        updateToast(id, "err", decodeError(e, reader.contract.interface));
        return false;
      }
    },
    [session.signer, reader, toast, updateToast, bump]
  );

  const directory = useMemo(() => new Map(chain.participants.map((p) => [p.account.toLowerCase(), p])), [chain.participants]);
  const label = useCallback((addr) => directory.get(addr?.toLowerCase())?.name || short(addr), [directory]);
  const account = session.account;
  const me = account ? directory.get(account.toLowerCase()) || null : null;
  const isOwner = same(account, chain.owner);

  const value = {
    cfg, deployed, reader, session, account, me, isOwner, chain, directory, label,
    demoAccounts, selectDemo, connectWallet, disconnect, tick, bump, tx, toasts, dismiss,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
