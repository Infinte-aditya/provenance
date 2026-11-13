import { STATUS, STATUS_KEY, ROLES, short } from "../lib/chain.js";
import { useApp } from "../state.jsx";

export const Badge = ({ status }) => <span className={`badge s-${STATUS_KEY[status]}`}>{STATUS[status]}</span>;

export const Notice = ({ kind = "info", children }) => <div className={`notice ${kind}`}>{children}</div>;

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Who({ address }) {
  const { directory, label } = useApp();
  const p = directory.get(address?.toLowerCase());
  return (
    <span className="who" title={address}>
      {label(address)}
      {p && <small>{ROLES[p.role]}{p.active ? "" : ", deactivated"}</small>}
      {!p && <small>unregistered</small>}
    </span>
  );
}

export function ProductCard({ product }) {
  const { label } = useApp();
  return (
    <a className="pcard" href={`#/product/${product.id}`}>
      <span className="pid">#{product.id}</span>
      <strong>{product.name}</strong>
      <span className="muted">{product.origin}</span>
      <span className="pfoot">
        <Badge status={product.status} />
        <span className="muted">with {label(product.custodian)}</span>
      </span>
    </a>
  );
}

export function Toasts() {
  const { toasts, dismiss } = useApp();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.kind === "pending" && <i className="spin" aria-hidden="true" />}
          {t.text}
        </div>
      ))}
    </div>
  );
}

export const Empty = ({ children }) => <p className="empty">{children}</p>;
export { short };
