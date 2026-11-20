'use client';
// Shown instead of a blank page when the app cannot render at all (e.g. database down).
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', background: '#f5f3ef', padding: 24 }}>
        <div style={{ maxWidth: 520, margin: '10vh auto', background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: 24 }}>
          <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>The application could not load</h1>
          <p style={{ color: '#555' }}>This usually means the database is not running or not set up yet.</p>
          <p style={{ color: '#555' }}>Open <a href="/api/health">/api/health</a> to see what is wrong.</p>
          {error.digest && <p style={{ color: '#999', fontSize: 12 }}>Error reference: {error.digest}</p>}
          <button onClick={() => reset()} style={{ marginTop: 8, padding: '6px 14px' }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
