"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/field";
import { SEO_EDITOR_ROLE, useAdminAuth } from "@/lib/auth-context";

export default function AdminLoginPage() {
  const { login, ready, isAdmin, user } = useAdminAuth();
  const router = useRouter();
  const [email, setEmail] = useState("admin@partsbazar360.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (ready && isAdmin)
      router.replace(user?.role === SEO_EDITOR_ROLE ? "/blog" : "/");
  }, [ready, isAdmin, user, router]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const loggedInUser = await login(email.trim(), password);
      router.replace(loggedInUser.role === SEO_EDITOR_ROLE ? "/blog" : "/");
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
        <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
          PartsBazar360 CMS
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
          Sign in
        </h1>
        <p className="mt-2 text-sm text-graphite-600">
          Sign in with your marketplace admin or SEO content account. SEO
          accounts are limited to Blog CMS functionality.
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
