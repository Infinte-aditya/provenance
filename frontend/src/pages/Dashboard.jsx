import { useState } from "react";
import { ROLES, fetchProducts, isClosed } from "../lib/chain.js";
import { useAsync } from "../lib/useAsync.js";
import { useApp } from "../state.jsx";
import { Empty, Field, Notice, ProductCard } from "../components/ui.jsx";

function Register() {
  const { tx } = useApp();
  const [name, setName] = useState("");
  const [origin, setOrigin] = useState("");
  async function submit(e) {
    e.preventDefault();
    if (await tx("Product registered", (c) => c.registerProduct(name.trim(), origin.trim()))) {
      setName("");
      setOrigin("");
    }
  }
  return (
    <form className="panel" onSubmit={submit}>
      <h3>Register a new product</h3>
      <div className="row">
        <Field label="Product name"><input required maxLength={128} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Origin"><input required maxLength={128} value={origin} onChange={(e) => setOrigin(e.target.value)} /></Field>
      </div>
      <button className="btn">Register product</button>
    </form>
  );
}

function Section({ title, hint, items, children }) {
  return (
    <section>
      <h2>{title}</h2>
      {hint && <p className="muted">{hint}</p>}
      {items.length ? <div className="grid">{items.map((p) => <ProductCard key={p.id} product={p} />)}</div> : <Empty>{children}</Empty>}
    </section>
  );
}

export default function Dashboard() {
  const { account, me, isOwner, reader, tick, session, tx } = useApp();
  const { data } = useAsync(async () => {
    if (!account) return null;
    const c = reader.contract;
    const [held, made, incoming] = await Promise.all([c.productsHeldBy(account), c.productsMadeBy(account), c.incomingFor(account)]);
    const all = [...new Set([...held, ...made, ...incoming].map(Number))];
    const byId = new Map((await fetchProducts(c, all)).map((p) => [p.id, p]));
    const pick = (ids) => ids.map((i) => byId.get(Number(i))).filter(Boolean).sort((a, b) => b.id - a.id);
    return { held: pick(held), made: pick(made), incoming: pick(incoming) };
  }, [account, tick]);

  if (!account)
    return (
      <Notice kind="info">
        Choose who you are acting as. {session.mode === "public" && "Use “Viewing as” in the header, or connect your wallet."}
      </Notice>
    );

  if (!me?.active && !isOwner)
    return <Notice kind="warn">This account isn't a registered participant{me ? " any more" : ""}. Ask the admin to add it before you can take part.</Notice>;

  const inCustody = (data?.held || []).filter((p) => !isClosed(p.status));
  const closed = (data?.held || []).filter((p) => isClosed(p.status));

  return (
    <>
      <header className="phead">
        <div>
          <h1>{me ? me.name : "Admin"}</h1>
          <p className="muted">{me ? `Signed in as ${ROLES[me.role]}` : "Signed in as admin"}{isOwner && me ? " and admin" : ""}</p>
        </div>
        {isOwner && <a className="btn ghost" href="#/admin">Manage participants</a>}
      </header>

      {me?.active && me.role === 1 && <Register />}

      {me?.active && (
        <Section title="Waiting for you to accept" items={data?.incoming || []}>
          Nothing is waiting. When someone proposes a handover to you, it appears here.
        </Section>
      )}
      {me?.active && data?.incoming.length > 0 && (
        <div className="accept-row">
          {data.incoming.map((p) => (
            <button key={p.id} className="btn" onClick={() => tx(`Accepted #${p.id}`, (c) => c.acceptTransfer(p.id))}>
              Accept #{p.id} {p.name}
            </button>
          ))}
        </div>
      )}
      {me?.active && (
        <Section title="In your custody" items={inCustody}>
          You don't hold any products right now.
        </Section>
      )}
      {me?.active && me.role === 1 && (
        <Section title="Created by you" hint="Follow where your products are, and recall one if there's a problem." items={data?.made || []}>
          You haven't registered a product yet.
        </Section>
      )}
      {closed.length > 0 && <Section title="Completed or recalled" items={closed} />}
    </>
  );
}
