import Link from "next/link";
import { buttonClasses } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { MessageIcon, SearchIcon, ShieldCheckIcon } from "@repo/ui/icons";

export default function MessagesPage() {
  return (
    <section>
      <div className="border-b-2 border-slate-950 pb-3"><p className="eyebrow">Seller communication</p><h2 className="mt-1 font-display text-2xl font-black uppercase text-slate-950 sm:text-3xl">Messages</h2><p className="mt-2 max-w-2xl text-sm text-slate-600">Ask about fitment, condition, photographs, dispatch, or a purchase. Starting from a listing or order automatically carries the right context.</p></div>
      <div className="mt-6 border-2 border-slate-950 bg-white">
        <EmptyState variant="page" icon={<MessageIcon />} title="No message threads on this device" description="Open a listing and choose Contact seller, or open a purchase and choose Contact seller / support.">
          <Link href="/search" className={buttonClasses()}><SearchIcon className="h-4 w-4" />Find a listing</Link>
        </EmptyState>
      </div>
      <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-graphite-600"><ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" />Keep payment and delivery conversations inside the marketplace support flow so the order context remains available if an issue needs review.</p>
    </section>
  );
}
