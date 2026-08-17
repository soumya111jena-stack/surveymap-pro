import { BASE_URL } from "./apiConfig";

const BASE = BASE_URL;

const headers = () => ({
  "Content-Type": "application/json",
});

const persistSession = (data) => {
  if (!data) return;
  if (data.role)     localStorage.setItem("role", data.role);
  if (data.username) localStorage.setItem("username", data.username);
  if (data.email)    localStorage.setItem("email", data.email);
};

const clearSession = () => {
  localStorage.removeItem("role");
  localStorage.removeItem("username");
  localStorage.removeItem("email");
};

// ── AUTH ──────────────────────────────────────────────────────────────────
export const login = async (email, password) => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Login failed");
  persistSession(data);
  return data;
};

export const logoutUser = async () => {
  clearSession();
  return fetch(`${BASE}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
    headers: headers(),
  }).then(r => r.json());
};

export const getMe = () =>
  fetch(`${BASE}/api/auth/me`, {
    credentials: "include",
    headers: headers(),
  }).then(r => r.json());

// ── ANALYTICS ────────────────────────────────────────────────────────────
export const getAnalytics = () =>
  fetch(`${BASE}/api/admin/analytics`, {
    credentials: "include",
    headers: headers(),
  }).then(r => r.json());

// ── USERS ─────────────────────────────────────────────────────────────────
export const getUsers = (page = 0) =>
  fetch(`${BASE}/api/admin/users?page=${page}&size=20`, {
    credentials: "include",
    headers: headers(),
  }).then(r => r.json());

export const toggleUser = (id) =>
  fetch(`${BASE}/api/admin/users/${id}/toggle`, {
    method: "PATCH",
    credentials: "include",
    headers: headers(),
  }).then(r => r.json());

export const changeRole = (id, role) =>
  fetch(`${BASE}/api/admin/users/${id}/role`, {
    method: "PATCH",
    credentials: "include",
    headers: headers(),
    body: JSON.stringify({ role }),
  }).then(r => r.json());

export const deleteUser = (id) =>
  fetch(`${BASE}/api/admin/users/${id}`, {
    method: "DELETE",
    credentials: "include",
    headers: headers(),
  });

// ── SESSIONS ──────────────────────────────────────────────────────────────
export const getSessions = (status = "", page = 0) =>
  fetch(`${BASE}/api/admin/sessions?status=${status}&page=${page}&size=20`, {
    credentials: "include",
    headers: headers(),
  }).then(r => r.json());