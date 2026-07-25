import { PageBody } from "@repo/ui/container";
import { ArrowRightIcon } from "@repo/ui/icons";

export default function Home() {
  return (
    <PageBody size="narrow" className="space-y-6 sm:space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-purple-400">Workshop</p>
        <h1 className="mt-1.5 text-balance text-2xl font-bold tracking-tight text-white sm:text-3xl">
          Workshop Portal
        </h1>
        <p className="mt-1.5 text-pretty text-sm text-zinc-400 sm:text-base">
          Purpose-built tools for repair workshops and installers are on the way.
        </p>
      </header>

      <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 sm:p-8">
        <span className="inline-flex items-center rounded-full bg-purple-500/10 px-2.5 py-1 text-xs font-medium text-purple-300">
          Coming soon
        </span>
        <h2 className="text-balance text-lg font-semibold text-white sm:text-xl">
          Manage customer vehicles and job orders in one place
        </h2>
        <p className="max-w-2xl text-pretty text-sm text-zinc-400">
          The Workshop Portal will let repair shops look up fitment-verified parts for a
          customer&apos;s vehicle, track job orders, and reorder parts directly from PartsBazar360
          sellers. In the meantime, you can use the Buyer Marketplace to search parts by vehicle
          configuration.
        </p>
        <a
          href="/buyer/"
          className="inline-flex min-h-touch items-center gap-2 text-sm font-medium text-purple-300 transition-colors hover:text-purple-200"
        >
          Go to Buyer Marketplace
          <ArrowRightIcon className="h-4 w-4" />
        </a>
      </div>
    </PageBody>
  );
}
