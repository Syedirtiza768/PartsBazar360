"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  advertisingStatus,
  captureClickIds,
  observeAdvertisingConsent,
  setAdvertisingCustomer,
  trackAdvertising,
  updateAdvertisingConsent,
  trackAdvertisingClick,
} from "@/lib/advertising";
import { useAuth } from "@/lib/auth-context";

export function AdvertisingPreferences() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [status, setStatus] = useState({ enabled: false, granted: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const lastPage = useRef<string | null>(null);
  const { user } = useAuth();

  // Signed-in customers: hashed email/phone/name feed advanced matching.
  useEffect(() => {
    if (!status.granted || !user) return;
    setAdvertisingCustomer({
      email: user.email,
      phone: user.phone,
      name: user.name,
      externalId: user.id,
    });
  }, [status.granted, user]);

  useEffect(() => {
    const sync = () => void advertisingStatus().then(setStatus);
    const stop = observeAdvertisingConsent(sync);
    sync();
    return stop;
  }, []);

  useEffect(() => {
    if (!status.granted) {
      lastPage.current = null;
      return;
    }
    captureClickIds();
    const page = pathname + "?" + search;
    if (lastPage.current === page) return;
    lastPage.current = page;
    trackAdvertising({ name: "PageView", id: crypto.randomUUID() });
  }, [pathname, search, status.granted]);

  useEffect(() => {
    if (!status.granted) return;
    const listener = (event: MouseEvent) => {
      if (event.type === "auxclick" && event.button !== 1) return;
      const link =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("a[data-pb-ad]")
          : null;
      const action = link?.dataset.pbAd;
      if (action === "ebay") trackAdvertisingClick("EbayStoreClick");
      if (action === "whatsapp" || action === "phone") {
        trackAdvertisingClick("Contact", action);
      }
    };
    document.addEventListener("click", listener);
    document.addEventListener("auxclick", listener);
    return () => {
      document.removeEventListener("click", listener);
      document.removeEventListener("auxclick", listener);
    };
  }, [status.granted]);

  if (!status.enabled) return null;

  async function change() {
    setError("");
    setSaving(true);
    try {
      await updateAdvertisingConsent(!status.granted);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not save your preference.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="gutter mx-auto w-full max-w-wide py-3 text-sm text-graphite-700">
      <button
        type="button"
        className="font-semibold underline underline-offset-4"
        disabled={saving}
        onClick={() => void change()}
      >
        {status.granted
          ? "Opt out of Meta and TikTok advertising measurement"
          : "Allow Meta and TikTok advertising measurement"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
