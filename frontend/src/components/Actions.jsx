import { useState } from "react";
import { ZERO_HASH, ROLES, isClosed, same } from "../lib/chain.js";
import { useApp } from "../state.jsx";
import { EvidencePicker } from "./Evidence.jsx";
import { Field, Notice, Who } from "./ui.jsx";

const LIMIT = 128;

function CheckpointForm({ product }) {
  const { tx } = useApp();
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  const [ev, setEv] = useState(ZERO_HASH);
  async function submit(e) {
    e.preventDefault();
    if (await tx("Checkpoint added", (c) => c.addCheckpoint(product.id, location.trim(), note.trim(), ev))) {
      setLocation(""); setNote(""); setEv(ZERO_HASH);
    }
  }
  return (
    <form className="panel" onSubmit={submit}>
      <h3>Add a checkpoint</h3>
      <p className="muted">Record something that happened while the product is with you, such as a temperature check or border crossing.</p>
      <Field label="Location"><input required maxLength={LIMIT} value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
      <Field label="Note (optional)"><input maxLength={LIMIT} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <EvidencePicker value={ev} onChange={setEv} />
      <button className="btn">Add checkpoint</button>
    </form>
  );
}

function HandoverForm({ product }) {
  const { tx, chain, account } = useApp();
  const options = chain.participants.filter((p) => p.active && !same(p.account, account));
  const [to, setTo] = useState("");
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  const [ev, setEv] = useState(ZERO_HASH);
  async function submit(e) {
    e.preventDefault();
    if (await tx("Handover proposed", (c) => c.initiateTransfer(product.id, to, location.trim(), note.trim(), ev))) {
      setTo(""); setLocation(""); setNote(""); setEv(ZERO_HASH);
    }
  }
  return (
    <form className="panel" onSubmit={submit}>
      <h3>Hand over to the next party</h3>
      <p className="muted">Custody moves only after they accept, so a wrong address can never take the product.</p>
      <Field label="Hand over to">
        <select required value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Choose a participant</option>
          {options.map((p) => (
            <option key={p.account} value={p.account}>{p.name} ({ROLES[p.role]})</option>
          ))}
        </select>
      </Field>
      <Field label="Handover location"><input required maxLength={LIMIT} value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
      <Field label="Note (optional)"><input maxLength={LIMIT} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <EvidencePicker value={ev} onChange={setEv} />
      <button className="btn">Propose handover</button>
    </form>
  );
}

function DeliveryForm({ product }) {
  const { tx } = useApp();
  const [location, setLocation] = useState("");
  const [ev, setEv] = useState(ZERO_HASH);
  return (
    <form
      className="panel"
      onSubmit={async (e) => {
        e.preventDefault();
        await tx("Delivery confirmed", (c) => c.confirmDelivery(product.id, location.trim(), ev));
      }}
    >
      <h3>Confirm delivery</h3>
      <p className="muted">This seals the record. Nothing can be added or changed afterwards.</p>
      <Field label="Delivered at"><input required maxLength={LIMIT} value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
      <EvidencePicker value={ev} onChange={setEv} />
      <button className="btn">Confirm delivery</button>
    </form>
  );
}

function RecallForm({ product }) {
  const { tx } = useApp();
  const [reason, setReason] = useState("");
  return (
    <form
      className="panel danger"
      onSubmit={async (e) => {
        e.preventDefault();
        await tx("Product recalled", (c) => c.recall(product.id, reason.trim()));
      }}
    >
      <h3>Recall this product</h3>
      <p className="muted">The record is frozen and marked as recalled for everyone. This can't be undone.</p>
      <Field label="Reason"><input required maxLength={LIMIT} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <button className="btn danger">Recall product</button>
    </form>
  );
}

// Shows only what the connected account is allowed to do for this product right now.
export default function Actions({ product, pending }) {
  const { account, me, isOwner, chain, tx } = useApp();
  if (!account) return null;

  const open = !isClosed(product.status);
  const active = !!me?.active;
  const isCustodian = open && active && same(product.custodian, account);
  const isReceiver = open && active && pending && same(pending.to, account);
  const canRecall = open && (isOwner || (active && same(product.producer, account)));
  const paused = chain.paused;

  const panels = [];
  if (paused && (isCustodian || isReceiver)) panels.push(<Notice key="p" kind="warn">The system is paused. Handovers and checkpoints resume when the admin unpauses.</Notice>);

  if (isReceiver && !paused) {
    panels.push(
      <section className="panel" key="accept">
        <h3>Accept this product</h3>
        <p className="muted">
          Handover proposed at “{pending.location}”{pending.note ? `: ${pending.note}` : ""}. Accepting makes you the custodian and records the checkpoint.
        </p>
        <button className="btn" onClick={() => tx("Custody accepted", (c) => c.acceptTransfer(product.id))}>Accept custody</button>
      </section>
    );
  }
  if (isCustodian && !paused) {
    if (pending) {
      panels.push(
        <section className="panel" key="cancel">
          <h3>Handover waiting</h3>
          <p className="muted">Waiting for <Who address={pending.to} /> to accept. You can withdraw it until they do.</p>
          <button className="btn ghost" onClick={() => tx("Handover cancelled", (c) => c.cancelTransfer(product.id))}>Cancel handover</button>
        </section>
      );
    } else {
      panels.push(<CheckpointForm key="cp" product={product} />, <HandoverForm key="ho" product={product} />);
      if (me.role === 4) panels.push(<DeliveryForm key="dl" product={product} />);
    }
  }
  if (canRecall) panels.push(<RecallForm key="rc" product={product} />);
  if (!panels.length) return null;

  return (
    <div className="actions">
      <h2>Your actions</h2>
      {panels}
    </div>
  );
}
