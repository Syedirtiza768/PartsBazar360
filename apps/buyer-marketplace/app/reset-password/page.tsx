"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/field";
import { API_BASE_URL } from "@/lib/api";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (!token) {
      setError("Invalid or missing reset token. Please request a new link.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(
          typeof data.message === "string"
            ? data.message
            : "Request failed. Please try again.",
        );
      }
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="mx-auto max-w-md gutter py-10 sm:py-16">
        <p className="eyebrow">Password reset</p>
        <h1 className="mt-2 font-display text-display-sm font-black tracking-tight text-graphite-950">
          Password reset!
        </h1>
        <p className="mt-2 text-sm text-graphite-600">
          Your password has been updated. You can now sign in with your new
          password.
        </p>
        <Button
          size="lg"
          fullWidth
          className="mt-6"
          onClick={() => router.push("/login")}
        >
          Sign in
        </Button>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="mx-auto max-w-md gutter py-10 sm:py-16">
        <p className="eyebrow">Password reset</p>
        <h1 className="mt-2 font-display text-display-sm font-black tracking-tight text-graphite-950">
          Invalid link
        </h1>
        <p className="mt-2 text-sm text-graphite-600">
          This password reset link is invalid or has expired. Please request a
          new one.
        </p>
        <Button
          size="lg"
          fullWidth
          className="mt-6"
          onClick={() => router.push("/forgot-password")}
        >
          Request new link
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md gutter py-10 sm:py-16">
      <p className="eyebrow">Password reset</p>
      <h1 className="mt-2 font-display text-display-sm font-black tracking-tight text-graphite-950">
        Set new password
      </h1>
      <p className="mt-2 text-sm text-graphite-600">
        Choose a new password for your PartsBazar360 account.
      </p>

      <form
        onSubmit={onSubmit}
        className="mt-7 space-y-4 border-2 border-graphite-950 bg-white p-4 sm:mt-8 sm:p-6"
      >
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          hint="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
        />
        <Input
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          minLength={8}
        />
        {error && (
          <p className="text-sm font-medium text-red-600" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" fullWidth loading={submitting}>
          Reset password
        </Button>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-md px-4 py-16 text-sm text-graphite-600">
          Loading…
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
