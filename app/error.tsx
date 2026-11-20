'use client';
import Link from 'next/link';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto mt-16 max-w-lg rounded-lg border bg-white p-6">
      <h1 className="mb-2 text-lg font-bold">Something went wrong</h1>
      <p className="text-sm text-gray-600">The page could not be loaded. If this keeps happening, check <a className="underline" href="/api/health">/api/health</a>.</p>
      {error.digest && <p className="mt-2 text-xs text-gray-400">Error reference: {error.digest}</p>}
      <div className="mt-4 flex gap-2"><button className="btn btn-primary" onClick={() => reset()}>Try again</button><Link className="btn" href="/">Home</Link></div>
    </div>
  );
}
