"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// Distinct key from admin-portal's token: in production both portals share
// the partsbazar360.com origin (different basePaths), so localStorage is
// shared across them — a colliding key would let one portal's session leak
// into the other.
const TOKEN_KEY = "pb360_seller_access_token";

export type SellerMembership = { sellerId: string; sellerName: string; role: string };

export type SellerUser = {
  id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  role: string;
  memberships: SellerMembership[];
};

type AuthContextValue = {
  user: SellerUser | null;
  token: string | null;
  ready: boolean;
  isSeller: boolean;
  /** The active seller account. Sellers are single-membership today; this is the first membership. */
  sellerId: string | null;
  sellerName: string | null;
  login: (email: string, password: string) => Promise<SellerUser>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api";

async function parseError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data.message === "string") return data.message;
    if (Array.isArray(data.message)) return data.message.join(", ");
  } catch {
    /* ignore */
  }
  return "Request failed. Please try again.";
}

export function SellerAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SellerUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const persist = useCallback((nextToken: string | null, nextUser: SellerUser | null) => {
    setToken(nextToken);
    setUser(nextUser);
    if (typeof window === "undefined") return;
    if (nextToken) localStorage.setItem(TOKEN_KEY, nextToken);
    else localStorage.removeItem(TOKEN_KEY);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const existing = localStorage.getItem(TOKEN_KEY);
    if (!existing) {
      setReady(true);
      return;
    }

    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${existing}` },
        });
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && data.user?.role === "SELLER") {
          persist(existing, data.user as SellerUser);
        } else {
          persist(null, null);
        }
      } catch {
        if (!cancelled) persist(null, null);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [persist]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) throw new Error(await parseError(res));
      const data = (await res.json()) as { user: SellerUser; accessToken: string };
      if (data.user.role !== "SELLER") {
        throw new Error("This portal is for marketplace sellers only.");
      }
      if (data.user.memberships.length === 0) {
        throw new Error("This account isn't linked to a seller yet.");
      }
      persist(data.accessToken, data.user);
      return data.user;
    },
    [persist],
  );

  const logout = useCallback(() => persist(null, null), [persist]);

  const value = useMemo<AuthContextValue>(() => {
    const membership = user?.memberships[0];
    const isSeller = Boolean(user && token && user.role === "SELLER" && membership);
    return {
      user,
      token,
      ready,
      isSeller,
      sellerId: isSeller ? membership!.sellerId : null,
      sellerName: isSeller ? membership!.sellerName : null,
      login,
      logout,
    };
  }, [user, token, ready, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useSellerAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useSellerAuth must be used within SellerAuthProvider");
  return ctx;
}
