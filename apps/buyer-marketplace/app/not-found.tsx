import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-32 text-center">
      <p className="text-sm font-semibold text-blue-600">404</p>
      <h1 className="mt-2 text-3xl font-bold text-slate-900">We couldn't find that page</h1>
      <p className="mt-3 text-slate-500">
        The part or page you're looking for may have been removed, sold out, or the link is incorrect.
      </p>
      <div className="mt-8 flex items-center justify-center gap-4">
        <Link href="/search" className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 transition-colors">
          Browse all parts
        </Link>
        <Link href="/" className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 transition-colors">
          Go home
        </Link>
      </div>
    </div>
  );
}
