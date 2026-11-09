'use client';

import { useEffect } from 'react';

export default function ErroGlobal({ error, reset }: { readonly error: Error & { digest?: string }; readonly reset: () => void }) {
  useEffect(() => {
    fetch('/api/erros', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: error.message, digest: error.digest, stack: error.stack }),
      keepalive: true,
    }).catch(() => {});
  }, [error]);

  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: '100svh',
          display: 'grid',
          placeItems: 'center',
          padding: 32,
          background: '#f4f4f2',
          color: '#232325',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 14 }}>
          <img src="/orla/icone.png" alt="" width={44} height={44} />
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em' }}>A orla parou de responder</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#5b5b5e', lineHeight: 1.6 }}>
            Isso não devia ter acontecido. Tente de novo — se continuar, avise quem administra a Orla.
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              type="button"
              onClick={reset}
              style={{
                height: 38,
                padding: '0 16px',
                borderRadius: 6,
                border: '1px solid #1468b0',
                background: '#1468b0',
                color: '#fff',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Tentar de novo
            </button>
          </div>
          {error.digest ? (
            <p style={{ marginTop: 2, fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#848486' }}>
              código {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
