import { useState } from "react";
import { fetchRecent } from "../lib/chain.js";
import { useAsync } from "../lib/useAsync.js";
import { useApp } from "../state.jsx";
import { Empty, ProductCard } from "../components/ui.jsx";

export default function Home() {
  const { reader, tick, chain } = useApp();
  const [id, setId] = useState("");
  const { data, loading } = useAsync(() => fetchRecent(reader.contract, 12), [tick]);
  const active = chain.participants.filter((p) => p.active).length;

  function go(e) {
    e.preventDefault();
    const n = parseInt(id, 10);
    if (n > 0) window.location.hash = `#/product/${n}`;
  }

  return (
    <>
      <section className="hero">
        <h1>Where did this product come from?</h1>
        <p>Every handover is recorded on a public ledger. Look up a product by its number, or scan the code on its package.</p>
        <form onSubmit={go} className="search">
          <input inputMode="numeric" pattern="[0-9]*" placeholder="Product number, e.g. 1" value={id} onChange={(e) => setId(e.target.value)} aria-label="Product number" />
          <button className="btn">Show journey</button>
        </form>
        <p className="stats muted">
          {chain.count} products tracked by {active} verified {active === 1 ? "participant" : "participants"}
        </p>
      </section>

      <section>
        <h2>Recently registered</h2>
        {loading && !data ? (
          <Empty>Loading products…</Empty>
        ) : data?.products.length ? (
          <div className="grid">{data.products.map((p) => <ProductCard key={p.id} product={p} />)}</div>
        ) : (
          <Empty>No products yet. A registered producer can add the first one from the Dashboard.</Empty>
        )}
      </section>
    </>
  );
}
