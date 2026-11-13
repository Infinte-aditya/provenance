import { useState } from "react";
import { ROLES } from "../lib/chain.js";
import { useApp } from "../state.jsx";
import { Field, Notice } from "../components/ui.jsx";
import { isAddress } from "ethers";

function AddForm() {
  const { tx } = useApp();
  const [account, setAccount] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState(1);
  const bad = account && !isAddress(account);
  async function submit(e) {
    e.preventDefault();
    if (await tx("Participant saved", (c) => c.setParticipant(account.trim(), role, name.trim()))) {
      setAccount("");
      setName("");
    }
  }
  return (
    <form className="panel" onSubmit={submit}>
      <h3>Add a participant</h3>
      <Field label="Wallet address" hint={bad ? "That isn't a valid address." : undefined}>
        <input required placeholder="0x…" value={account} onChange={(e) => setAccount(e.target.value)} aria-invalid={!!bad} />
      </Field>
      <div className="row">
        <Field label="Organisation name"><input required maxLength={128} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Role">
          <select value={role} onChange={(e) => setRole(Number(e.target.value))}>
            {[1, 2, 3, 4].map((r) => <option key={r} value={r}>{ROLES[r]}</option>)}
          </select>
        </Field>
      </div>
      <button className="btn" disabled={!!bad}>Add participant</button>
    </form>
  );
}

function Row({ p }) {
  const { tx } = useApp();
  const [role, setRole] = useState(p.role);
  return (
    <tr className={p.active ? "" : "off"}>
      <td><strong>{p.name}</strong><br /><code title={p.account}>{p.account.slice(0, 10)}…{p.account.slice(-6)}</code></td>
      <td>
        <select value={role} onChange={(e) => setRole(Number(e.target.value))} aria-label={`Role for ${p.name}`}>
          {[1, 2, 3, 4].map((r) => <option key={r} value={r}>{ROLES[r]}</option>)}
        </select>
      </td>
      <td>{p.active ? "Active" : "Deactivated"}</td>
      <td className="acts">
        {role !== p.role && <button className="btn small" onClick={() => tx("Role changed", (c) => c.setParticipant(p.account, role, p.name))}>Save role</button>}
        {p.active ? (
          <button className="btn small ghost" onClick={() => tx("Participant deactivated", (c) => c.removeParticipant(p.account))}>Deactivate</button>
        ) : (
          <button className="btn small" onClick={() => tx("Participant reactivated", (c) => c.setParticipant(p.account, p.role, p.name))}>Reactivate</button>
        )}
      </td>
    </tr>
  );
}

export default function Admin() {
  const { isOwner, account, chain, tx } = useApp();
  if (!account) return <Notice kind="info">Sign in as the admin to manage participants.</Notice>;
  if (!isOwner) return <Notice kind="warn">Only the admin account can manage participants.</Notice>;

  return (
    <>
      <header className="phead"><div><h1>Participants</h1><p className="muted">Only people listed here can register or move products.</p></div></header>

      <section className={`panel ${chain.paused ? "danger" : ""}`}>
        <h3>{chain.paused ? "System is paused" : "Emergency pause"}</h3>
        <p className="muted">
          {chain.paused
            ? "Registrations and handovers are frozen. Recalls and admin changes still work."
            : "Freezes registrations, handovers and checkpoints if something goes wrong. Recalls still work."}
        </p>
        {chain.paused ? (
          <button className="btn" onClick={() => tx("System resumed", (c) => c.unpause())}>Resume system</button>
        ) : (
          <button className="btn danger" onClick={() => tx("System paused", (c) => c.pause())}>Pause system</button>
        )}
      </section>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Participant</th><th>Role</th><th>Status</th><th><span className="sr">Actions</span></th></tr></thead>
          <tbody>
            {chain.participants.map((p) => <Row key={p.account + p.role + p.active} p={p} />)}
            {!chain.participants.length && <tr><td colSpan="4" className="empty">No participants yet. Add the first one below.</td></tr>}
          </tbody>
        </table>
      </div>
      <AddForm />
    </>
  );
}
