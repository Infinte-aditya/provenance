import { ROLES, short } from "./lib/chain.js";
import { AppProvider, useApp, useRoute } from "./state.jsx";
import { Notice, Toasts } from "./components/ui.jsx";
import Admin from "./pages/Admin.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Home from "./pages/Home.jsx";
import Product from "./pages/Product.jsx";

function Session() {
  const { session, account, me, isOwner, demoAccounts, selectDemo, connectWallet, disconnect, label } = useApp();
  const role = me ? ROLES[me.role] : isOwner ? "Admin" : "Not registered";
  return (
    <div className="session">
      {account ? (
        <>
          <span className="who-now">
            <strong>{me?.name || (isOwner ? "Admin" : short(account))}</strong>
            <small>{role}{isOwner && me ? " + Admin" : ""}</small>
          </span>
          <button className="btn small ghost" onClick={disconnect}>Sign out</button>
        </>
      ) : (
        <>
          {demoAccounts.length > 0 && (
            <label className="demo">
              <span>Viewing as</span>
              <select value={-1} onChange={(e) => selectDemo(Number(e.target.value))}>
                <option value={-1}>Public visitor</option>
                {demoAccounts.map((a, i) => (
                  <option key={a} value={i}>{i === 0 ? "Admin" : label(a)}</option>
                ))}
              </select>
            </label>
          )}
          <button className="btn small" onClick={connectWallet}>Connect wallet</button>
        </>
      )}
      {session.mode === "demo" && demoAccounts.length > 0 && (
        <label className="demo">
          <span className="sr">Switch demo account</span>
          <select value={demoAccounts.indexOf(account)} onChange={(e) => selectDemo(Number(e.target.value))}>
            {demoAccounts.map((a, i) => (
              <option key={a} value={i}>{i === 0 ? "Admin" : label(a)}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function Shell() {
  const { deployed, chain, account, isOwner, cfg } = useApp();
  const { page, arg } = useRoute();

  let body;
  if (!deployed) {
    body = (
      <Notice kind="warn">
        The contract hasn't been deployed yet. Run <code>npm run demo</code> from the project folder for a local demo, or{" "}
        <code>npm run deploy:local</code> to deploy to a running local node.
      </Notice>
    );
  } else if (page === "product") body = <Product id={parseInt(arg, 10)} />;
  else if (page === "dashboard") body = <Dashboard />;
  else if (page === "admin") body = <Admin />;
  else body = <Home />;

  const link = (hash, text, p) => (
    <a href={hash} aria-current={page === p ? "page" : undefined}>{text}</a>
  );

  return (
    <>
      <header className="top">
        <a className="brand" href="#/">
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="currentColor" /><path d="M8 22V10m0 0 8 6 8-6m-8 6v8" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Provenance
        </a>
        <nav aria-label="Main">
          {link("#/", "Verify", "home")}
          {account && link("#/dashboard", "Dashboard", "dashboard")}
          {isOwner && link("#/admin", "Admin", "admin")}
        </nav>
        {deployed && <Session />}
      </header>
      <main>
        {chain.error && <Notice kind="danger">{chain.error}</Notice>}
        {chain.paused && <Notice kind="warn">The system is paused by the admin. Records can be viewed, but handovers and registrations are frozen.</Notice>}
        {body}
      </main>
      <footer>
        {deployed && <span>{cfg.networkName} · contract {short(cfg.address)}</span>}
      </footer>
      <Toasts />
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
