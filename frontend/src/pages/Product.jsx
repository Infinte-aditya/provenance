import { useState } from "react";
import { fetchProduct, fmtDate } from "../lib/chain.js";
import { useAsync } from "../lib/useAsync.js";
import { useApp } from "../state.jsx";
import Actions from "../components/Actions.jsx";
import { EvidenceVerifier } from "../components/Evidence.jsx";
import QR from "../components/QR.jsx";
import Timeline from "../components/Timeline.jsx";
import { Badge, Empty, Notice, Who } from "../components/ui.jsx";

export default function Product({ id }) {
  const { reader, tick } = useApp();
  const [matched, setMatched] = useState(null);
  const valid = Number.isInteger(id) && id > 0;
  const { data, error, loading } = useAsync(() => (valid ? fetchProduct(reader.contract, id) : Promise.reject(new Error("bad id"))), [id, tick]);

  if (loading && !data) return <Empty>Loading product…</Empty>;
  if (error || !data)
    return (
      <Notice kind="warn">
        There is no product with number {String(id)}. <a href="#/">Search again</a>.
      </Notice>
    );

  const { product, history, pending } = data;
  return (
    <div className="product">
      <header className="phead">
        <div>
          <p className="muted">Product #{product.id}</p>
          <h1>{product.name}</h1>
          <p className="muted">Origin: {product.origin}</p>
        </div>
        <Badge status={product.status} />
      </header>

      {product.status === 5 && <Notice kind="danger">This product was recalled. Do not use or sell it. See the last entry for the reason.</Notice>}
      {product.status === 4 && <Notice kind="ok">Delivered. This record is sealed and can't be changed.</Notice>}
      {pending && (
        <Notice kind="info">
          Handover to <Who address={pending.to} /> is waiting to be accepted.
        </Notice>
      )}

      <div className="cols">
        <div>
          <section className="panel facts">
            <dl>
              <dt>Producer</dt><dd><Who address={product.producer} /></dd>
              <dt>Currently with</dt><dd><Who address={product.custodian} /></dd>
              <dt>Registered</dt><dd>{fmtDate(product.createdAt)}</dd>
              <dt>Checkpoints</dt><dd>{history.length}</dd>
            </dl>
          </section>
          <h2>Journey</h2>
          <Timeline history={history} matched={matched} />
        </div>
        <aside>
          <QR id={product.id} />
          <EvidenceVerifier history={history} onMatch={setMatched} />
          <Actions product={product} pending={pending} />
        </aside>
      </div>
    </div>
  );
}
