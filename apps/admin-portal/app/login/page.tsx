"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/field";
import { useAdminAuth } from "@/lib/auth-context";

export default function AdminLoginPage() {
  const { login, ready, isAdmin } = useAdminAuth();
  const router = useRouter();
  const [email, setEmail] = useState("admin@partsbazar360.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (ready && isAdmin) router.replace("/");
  }, [ready, isAdmin, router]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email.trim(), password);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    /*
      `min-h-dvh` with `items-center` centres on tall screens but lets the card
      scroll normally on short/landscape ones. The vertical padding is what
      keeps the card off the notch when the virtual keyboard shrinks the
      viewport; `justify-center` alone would clip its top edge.
    */
    <main
      id="main-content"
      className="flex min-h-dvh flex-col items-center justify-center bg-slate-100 gutter py-10"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-card sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Admin console</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">Sign in</h1>
        <p className="mt-2 text-sm text-graphite-600">
          Use the seeded admin account from marketplace seed (
          <span className="break-anywhere font-medium text-slate-800">admin@partsbazar360.com</span>).
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <Input
            label="Email"
            type="email"
            // inputMode/autocapitalize keep the on-screen keyboard on the
            // e-mail layout and stop iOS capitalising the local part.
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error ?? undefined}
          />
          <Button type="submit" fullWidth size="lg" loading={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </main>
  );
}
