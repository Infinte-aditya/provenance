import { STATUS_KEY, fmtDate, hasEvidence, shortHash } from "../lib/chain.js";
import { Badge, Who } from "./ui.jsx";

// The journey drawn as a route: one stop per checkpoint, joined by a line.
export default function Timeline({ history, matched }) {
  return (
    <ol className="route">
      {history.map((h, i) => (
        <li key={i} className={`stop s-${STATUS_KEY[h.status]} ${i === history.length - 1 ? "last" : ""}`}>
          <i className="dot" aria-hidden="true" />
          <div className="stop-body">
            <div className="stop-head">
              <strong>{h.location || "Recall notice"}</strong>
              <Badge status={h.status} />
            </div>
            <div className="muted">
              <Who address={h.handler} /> · {fmtDate(h.timestamp)}
            </div>
            {h.note && <p className="note">{h.note}</p>}
            {hasEvidence(h.evidence) && (
              <p className={`evidence ${matched === h.evidence ? "match" : ""}`} title={h.evidence}>
                Document fingerprint <code>{shortHash(h.evidence)}</code>
                {matched === h.evidence && <b> matches your file</b>}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
