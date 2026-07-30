"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { API_BASE_URL } from "@/lib/api";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token") || "";

  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading",
  );
  const [message, setMessage] = useState("Verifying your email…");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("Invalid or missing verification token.");
      return;
    }

    (async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/auth/verify-email?token=${encodeURIComponent(token)}`,
        );
        const data = await res.json();
        if (res.ok) {
          setStatus("success");
          setMessage(data.message || "Email verified successfully!");
        } else {
          setStatus("error");
          setMessage(
            typeof data.message === "string"
              ? data.message
              : "Verification failed.",
          );
        }
      } catch {
        setStatus("error");
        setMessage("Something went wrong. Please try again.");
      }
    })();
  }, [token]);

  return (
    <div className="mx-auto max-w-md gutter py-10 sm:py-16">
      <p className="eyebrow">Email verification</p>
      <h1 className="mt-2 font-display text-display-sm font-black tracking-tight text-graphite-950">
        {status === "loading"
          ? "Verifying…"
          : status === "success"
            ? "Email verified!"
            : "Verification failed"}
      </h1>
      <p className="mt-2 text-sm text-graphite-600">{message}</p>

      {status === "success" && (
        <p className="mt-4 text-sm text-graphite-600">
          Your account is now fully activated. You can start shopping on
          PartsBazar360.
        </p>
      )}

      <div className="mt-6">
        {status === "success" ? (
          <button
            onClick={() => router.push("/account")}
            className="w-full rounded-md bg-graphite-950 px-6 py-3 text-sm font-semibold text-white hover:bg-graphite-800"
          >
            Go to my account
          </button>
        ) : status === "error" ? (
          <Link
            href="/signup"
            className="block w-full rounded-md bg-graphite-950 px-6 py-3 text-center text-sm font-semibold text-white hover:bg-graphite-800"
          >
            Try again
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-md px-4 py-16 text-sm text-graphite-600">
          Loading…
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
