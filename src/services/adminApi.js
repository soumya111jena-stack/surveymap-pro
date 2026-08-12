import { BASE_URL } from "./apiConfig";

const BASE = BASE_URL;

// ── Attach stored token to every authenticated request ─────────────────────
const headers = () => {
  const token = localStorage.getItem("accessToken");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

// ── AUTH ──────────────────────────────────────────────────────────────────
export const login = async (email, password) => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Login failed");

  // ✅ Store token + user info so future requests are authenticated
  if (data.accessToken)  localStorage.setItem("accessToken", data.accessToken);
  if (data.refreshToken) localStorage.setItem("refreshToken", data.refreshToken);
  if (data.username)     localStorage.setItem("username", data.username);
  if (data.email)        localStorage.setItem("email", data.email);
  if (data.role)         localStorage.setItem("role", data.role);

  return data;
};

export const logoutUser = () => {
  localStorage.removeItem("accessToken");
  localStorage.removeItem("refreshToken");
  localStorage.removeItem("username");
  localStorage.removeItem("email");
  localStorage.removeItem("role");
  return Promise.resolve({ ok: true });
};

export const getMe = () =>
  fetch(`${BASE}/api/auth/me`, {
    headers: headers(),
    cache: "no-store",
  }).then(async (r) => {
    if (!r.ok) throw new Error("Not authenticated");
    return r.json();
  });

// ── ANALYTICS ────────────────────────────────────────────────────────────
export const getAnalytics = () =>
  fetch(`${BASE}/api/admin/analytics`, {
    headers: headers(),
    cache: "no-store",
  }).then(async (r) => {
    if (!r.ok) throw new Error("Failed to fetch analytics");
    return r.json();
  });

// ── USERS ─────────────────────────────────────────────────────────────────
export const getUsers = (page = 0) =>
  fetch(`${BASE}/api/admin/users?page=${page}&size=20`, {
    headers: headers(),
    cache: "no-store",
  }).then(async (r) => {
    if (!r.ok) throw new Error("Failed to fetch users");
    return r.json();
  });

export const toggleUser = (id) =>
  fetch(`${BASE}/api/admin/users/${id}/toggle`, {
    method: "PATCH",
    headers: headers(),
  }).then(async (r) => {
    if (!r.ok) throw new Error("Failed to toggle user");
    return r.json();
  });

export const changeRole = (id, role) =>
  fetch(`${BASE}/api/admin/users/${id}/role`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ role }),
  }).then(async (r) => {
    if (!r.ok) throw new Error("Failed to change role");
    return r.json();
  });

export const deleteUser = (id) =>
  fetch(`${BASE}/api/admin/users/${id}`, {
    method: "DELETE",
    headers: headers(),
  }).then(async (r) => {
    if (!r.ok) throw new Error("Failed to delete user");
    return r;
  });

// ── SESSIONS ──────────────────────────────────────────────────────────────
export const getSessions = (status = "", page = 0) =>
  fetch(`${BASE}/api/admin/sessions?status=${status}&page=${page}&size=20`, {
    headers: headers(),
    cache: "no-store",
  }).then(async (r) => {
    if (!r.ok) throw new Error("Failed to fetch sessions");
    return r.json();
  });