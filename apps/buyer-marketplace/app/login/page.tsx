"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/field";
import { useAuth } from "@/lib/auth-context";

function LoginForm() {
  const { login, isAuthenticated, ready } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/account";

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (ready && isAuthenticated) router.replace(next);
  }, [ready, isAuthenticated, router, next]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(identifier.trim(), password);
      router.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-md gutter py-10 sm:py-16">
      <p className="eyebrow">Buyer account</p>
      <h1 className="mt-2 font-display text-display-sm font-black tracking-tight text-graphite-950">
        Sign in
      </h1>
      <p className="mt-2 text-sm text-graphite-600">
        View your orders and account. You never need to sign in just to check
        out.
      </p>

      <form
        onSubmit={onSubmit}
        className="mt-7 space-y-4 border-2 border-graphite-950 bg-white p-4 sm:mt-8 sm:p-6"
      >
        <Input
          label="Email or mobile number"
          type="text"
          // Keeps the on-screen keyboard on the e-mail layout and stops iOS
          // capitalising / autocorrecting the local part into a word.
          inputMode="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="text-right">
          <Link
            href="/forgot-password"
            className="text-sm font-medium text-brand-700 underline-offset-2 hover:text-brand-800 hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        {error && (
          <p className="text-sm font-medium text-red-600" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" fullWidth loading={submitting}>
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-graphite-600">
        New here?{" "}
        <Link
          href={`/signup${next !== "/account" ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="font-semibold text-brand-700 underline-offset-2 hover:text-brand-800 hover:underline"
        >
          Create a buyer account
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-md px-4 py-16 text-sm text-graphite-600">
          Loading…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
