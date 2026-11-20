import Link from 'next/link';
export default function Forbidden() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card max-w-md text-center">
        <h1 className="h1 mb-2">Access denied</h1>
        <p className="muted mb-4">Your role does not allow access to this page.</p>
        <Link href="/" className="btn btn-primary">Go home</Link>
      </div>
    </div>
  );
}
