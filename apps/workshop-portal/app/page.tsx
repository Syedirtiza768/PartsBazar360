export default function Home() {
  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Workshop Portal</h1>
        <p className="text-zinc-400 mt-1">Purpose-built tools for repair workshops and installers are on the way.</p>
      </header>

      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-8 backdrop-blur-sm space-y-4">
        <div className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-purple-500/10 text-purple-300">
          Coming soon
        </div>
        <h2 className="text-xl font-semibold text-white">Manage customer vehicles and job orders in one place</h2>
        <p className="text-sm text-zinc-400 max-w-2xl">
          The Workshop Portal will let repair shops look up fitment-verified parts for a customer's vehicle,
          track job orders, and reorder parts directly from PartsBazar360 sellers. In the meantime, you can
          use the Buyer Marketplace to search parts by vehicle configuration.
        </p>
        <a
          href="/buyer/"
          className="inline-flex items-center gap-2 text-sm font-medium text-purple-300 hover:text-purple-200 transition-colors"
        >
          Go to Buyer Marketplace →
        </a>
      </div>
    </div>
  );
}
