import { useRef, useState } from "react";
import { ZERO_HASH, hasEvidence, sha256File, shortHash } from "../lib/chain.js";

// Pick an optional file; its SHA-256 fingerprint (not the file) is what goes on-chain.
export function EvidencePicker({ value, onChange }) {
  const input = useRef(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  async function pick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setError("");
      onChange(await sha256File(file));
      setName(file.name);
    } catch (err) {
      setError(err.message);
    }
  }
  function clear() {
    onChange(ZERO_HASH);
    setName("");
    if (input.current) input.current.value = "";
  }
  return (
    <div className="field">
      <span>Supporting document (optional)</span>
      <input ref={input} type="file" onChange={pick} aria-label="Supporting document" />
      {hasEvidence(value) && (
        <small>
          {name}: fingerprint <code>{shortHash(value)}</code> will be saved on-chain. The file stays on your device.{" "}
          <button type="button" className="link" onClick={clear}>Remove</button>
        </small>
      )}
      {error && <small className="err-text">{error}</small>}
    </div>
  );
}

// Anyone can drop a file here to check it against the fingerprints recorded for this product.
export function EvidenceVerifier({ history, onMatch }) {
  const [result, setResult] = useState(null);
  const recorded = history.filter((h) => hasEvidence(h.evidence));

  async function check(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const hash = await sha256File(file);
      const hit = recorded.find((h) => h.evidence === hash);
      setResult({ file: file.name, hash, hit });
      onMatch(hit ? hash : null);
    } catch (err) {
      setResult({ error: err.message });
      onMatch(null);
    }
  }

  return (
    <section className="panel">
      <h3>Check a document</h3>
      {recorded.length === 0 ? (
        <p className="muted">No documents were fingerprinted for this product.</p>
      ) : (
        <>
          <p className="muted">
            Choose a certificate or photo. If its fingerprint matches one recorded below, the file is the same one the handler attached.
          </p>
          <input type="file" onChange={check} aria-label="Document to check" />
        </>
      )}
      {result?.error && <p className="err-text">{result.error}</p>}
      {result?.hit && (
        <p className="ok-text">
          <b>Match.</b> {result.file} is identical to the document recorded at “{result.hit.location}”.
        </p>
      )}
      {result && !result.hit && !result.error && (
        <p className="err-text">
          <b>No match.</b> {result.file} (<code>{shortHash(result.hash)}</code>) differs from every recorded document.
        </p>
      )}
    </section>
  );
}
