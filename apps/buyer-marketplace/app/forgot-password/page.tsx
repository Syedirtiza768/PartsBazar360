"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/field";
import { API_BASE_URL } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Request failed. Please try again.",
        );
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <div className="mx-auto max-w-md gutter py-10 sm:py-16">
        <p className="eyebrow">Password reset</p>
        <h1 className="mt-2 font-display text-display-sm font-black tracking-tight text-graphite-950">
          Check your email
        </h1>
        <p className="mt-2 text-sm text-graphite-600">
          If an account exists for <strong>{email}</strong>, we&apos;ve sent a
          password reset link. Check your inbox and spam folder.
        </p>
        <p className="mt-6 text-center text-sm text-graphite-600">
          <Link
            href="/login"
            className="font-semibold text-brand-700 underline-offset-2 hover:text-brand-800 hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md gutter py-10 sm:py-16">
      <p className="eyebrow">Password reset</p>
      <h1 className="mt-2 font-display text-display-sm font-black tracking-tight text-graphite-950">
        Forgot your password?
      </h1>
      <p className="mt-2 text-sm text-graphite-600">
        Enter the email address associated with your account and we&apos;ll send
        a link to reset your password.
      </p>

      <form
        onSubmit={onSubmit}
        className="mt-7 space-y-4 border-2 border-graphite-950 bg-white p-4 sm:mt-8 sm:p-6"
      >
        <Input
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {error && (
          <p className="text-sm font-medium text-red-600" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" fullWidth loading={submitting}>
          Send reset link
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-graphite-600">
        Remember your password?{" "}
        <Link
          href="/login"
          className="font-semibold text-brand-700 underline-offset-2 hover:text-brand-800 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
