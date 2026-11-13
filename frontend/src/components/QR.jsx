import { useEffect, useState } from "react";
import QRCode from "qrcode";

export default function QR({ id }) {
  const [src, setSrc] = useState("");
  const url = `${window.location.origin}${window.location.pathname}#/product/${id}`;
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 200, color: { dark: "#10252f", light: "#ffffff" } }).then(setSrc);
  }, [url]);
  return (
    <section className="panel qr">
      {src && <img src={src} width="140" height="140" alt={`QR code linking to product ${id}`} />}
      <div>
        <h3>Label this product</h3>
        <p className="muted">Print this code on the package. Anyone who scans it sees this page.</p>
        {src && (
          <a className="btn ghost" href={src} download={`product-${id}-qr.png`}>
            Download QR code
          </a>
        )}
      </div>
    </section>
  );
}
