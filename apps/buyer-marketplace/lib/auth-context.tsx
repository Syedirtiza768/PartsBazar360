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
import { API_BASE_URL } from "@/lib/api";

const TOKEN_KEY = "pb360_access_token";

export type AuthUser = {
  id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  role: string;
  memberships: Array<{ sellerId: string; sellerName: string; role: string }>;
};

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  ready: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  register: (input: { email: string; password: string; name?: string }) => Promise<AuthUser>;
  sendPhoneOtp: (phone: string) => Promise<{ exists: boolean }>;
  verifyPhoneOtp: (phone: string, code: string, password?: string) => Promise<AuthUser>;
  sendEmailOtp: (email: string) => Promise<{ exists: boolean }>;
  verifyEmailOtp: (email: string, code: string, phone?: string, password?: string) => Promise<AuthUser>;
  logout: () => void;
  authHeaders: () => HeadersInit;
};

const AuthContext = createContext<AuthContextValue | null>(null);

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const persist = useCallback((nextToken: string | null, nextUser: AuthUser | null) => {
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
        if (res.ok && data.user) {
          persist(existing, data.user as AuthUser);
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
      const data = (await res.json()) as { user: AuthUser; accessToken: string };
      persist(data.accessToken, data.user);
      return data.user;
    },
    [persist],
  );

  const register = useCallback(
    async (input: { email: string; password: string; name?: string }) => {
      const res = await fetch(`${API_BASE_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(await parseError(res));
      const data = (await res.json()) as { user: AuthUser; accessToken: string };
      persist(data.accessToken, data.user);
      return data.user;
    },
    [persist],
  );

  const sendPhoneOtp = useCallback(async (phone: string) => {
    const res = await fetch(`${API_BASE_URL}/auth/phone/otp/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    if (!res.ok) throw new Error(await parseError(res));
    return (await res.json()) as { exists: boolean };
  }, []);

  const verifyPhoneOtp = useCallback(
    async (phone: string, code: string, password?: string) => {
      const res = await fetch(`${API_BASE_URL}/auth/phone/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code, password }),
      });
      if (!res.ok) throw new Error(await parseError(res));
      const data = (await res.json()) as { user: AuthUser; accessToken: string };
      persist(data.accessToken, data.user);
      return data.user;
    },
    [persist],
  );

  const sendEmailOtp = useCallback(async (email: string) => {
    const res = await fetch(`${API_BASE_URL}/auth/email/otp/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) throw new Error(await parseError(res));
    return (await res.json()) as { exists: boolean };
  }, []);

  const verifyEmailOtp = useCallback(
    async (email: string, code: string, phone?: string, password?: string) => {
      const res = await fetch(`${API_BASE_URL}/auth/email/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, phone, password }),
      });
      if (!res.ok) throw new Error(await parseError(res));
      const data = (await res.json()) as { user: AuthUser; accessToken: string };
      persist(data.accessToken, data.user);
      return data.user;
    },
    [persist],
  );

  const logout = useCallback(() => persist(null, null), [persist]);

  const authHeaders = useCallback((): HeadersInit => {
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }, [token]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      ready,
      isAuthenticated: Boolean(user && token),
      login,
      register,
      sendPhoneOtp,
      verifyPhoneOtp,
      sendEmailOtp,
      verifyEmailOtp,
      logout,
      authHeaders,
    }),
    [
      user,
      token,
      ready,
      login,
      register,
      sendPhoneOtp,
      verifyPhoneOtp,
      sendEmailOtp,
      verifyEmailOtp,
      logout,
      authHeaders,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
