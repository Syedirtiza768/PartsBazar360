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

const TOKEN_KEY = "pb360_admin_access_token";

export type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
};

type AuthContextValue = {
  user: AdminUser | null;
  token: string | null;
  ready: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<AdminUser>;
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

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const persist = useCallback((nextToken: string | null, nextUser: AdminUser | null) => {
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
        if (res.ok && data.user?.role === "ADMIN") {
          persist(existing, data.user as AdminUser);
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
      const data = (await res.json()) as { user: AdminUser; accessToken: string };
      if (data.user.role !== "ADMIN") {
        throw new Error("This portal is for marketplace admins only.");
      }
      persist(data.accessToken, data.user);
      return data.user;
    },
    [persist],
  );

  const logout = useCallback(() => persist(null, null), [persist]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      ready,
      isAdmin: Boolean(user && token && user.role === "ADMIN"),
      login,
      logout,
    }),
    [user, token, ready, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAdminAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAdminAuth must be used within AdminAuthProvider");
  return ctx;
}
