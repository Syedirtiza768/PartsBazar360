"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/field";
import { useAuth } from "@/lib/auth-context";

function SignupForm() {
  const { register, isAuthenticated, ready } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/account";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);

  useEffect(() => {
    if (ready && isAuthenticated) router.replace(next);
  }, [ready, isAuthenticated, router, next]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await register({
        email: email.trim(),
        password,
        name: name.trim() || undefined,
      });
      setVerificationSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (verificationSent) {
    return (
      <div className="mx-auto max-w-md gutter py-10 sm:py-16">
        <p className="eyebrow">Buyer account</p>
        <h1 className="mt-2 font-display text-display-sm font-black tracking-tight text-graphite-950">
          Check your email
        </h1>
        <p className="mt-2 text-sm text-graphite-600">
          We&apos;ve sent a verification link to <strong>{email}</strong>.
          Please check your inbox and click the link to activate your account.
        </p>
        <p className="mt-4 text-sm text-graphite-600">
          Once verified, you can{" "}
          <Link
            href="/login"
            className="font-semibold text-brand-700 underline-offset-2 hover:text-brand-800 hover:underline"
          >
            sign in
          </Link>{" "}
          and start shopping.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md gutter py-10 sm:py-16">
      <p className="eyebrow">Buyer account</p>
      <h1 className="mt-2 font-display text-display-sm font-black tracking-tight text-graphite-950">
        Create account
      </h1>
      <p className="mt-2 text-sm text-graphite-600">
        Register to place orders. You&apos;ll pay on Stripe&apos;s secure checkout — we never see your card.
      </p>

      <form onSubmit={onSubmit} className="mt-7 space-y-4 border-2 border-graphite-950 bg-white p-4 sm:mt-8 sm:p-6">
        <Input
          label="Full name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          label="Email"
          type="email"
          // Keeps the on-screen keyboard on the e-mail layout and stops iOS
          // capitalising / autocorrecting the local part into a word.
          inputMode="email"
          autoComplete="email"
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
          autoComplete="new-password"
          required
          hint="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
        />
        {error && (
          <p className="text-sm font-medium text-red-600" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" fullWidth loading={submitting}>
          Create account
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-graphite-600">
        Already have an account?{" "}
        <Link
          href={`/login${next !== "/account" ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="font-semibold text-brand-700 underline-offset-2 hover:text-brand-800 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-md px-4 py-16 text-sm text-graphite-600">Loading…</div>}>
      <SignupForm />
    </Suspense>
  );
}
