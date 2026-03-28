const BASE = "http://localhost:8080";

const headers = () => ({
  "Content-Type": "application/json",
  "Authorization": `Bearer ${localStorage.getItem("accessToken")}`,
});

// ── AUTH ──────────────────────────────────────────────────────────────────
export const login = async (email, password) => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Login failed");
  return data;
};

export const getMe = () =>
  fetch(`${BASE}/api/auth/me`, { headers: headers() }).then(r => r.json());

// ── ANALYTICS ────────────────────────────────────────────────────────────
export const getAnalytics = () =>
  fetch(`${BASE}/api/admin/analytics`, { headers: headers() }).then(r => r.json());

// ── USERS ─────────────────────────────────────────────────────────────────
export const getUsers = (page = 0) =>
  fetch(`${BASE}/api/admin/users?page=${page}&size=20`, { headers: headers() }).then(r => r.json());

export const toggleUser = (id) =>
  fetch(`${BASE}/api/admin/users/${id}/toggle`, {
    method: "PATCH",
    headers: headers(),
  }).then(r => r.json());

export const changeRole = (id, role) =>
  fetch(`${BASE}/api/admin/users/${id}/role`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ role }),
  }).then(r => r.json());

export const deleteUser = (id) =>
  fetch(`${BASE}/api/admin/users/${id}`, {
    method: "DELETE",
    headers: headers(),
  });

// ── SESSIONS ──────────────────────────────────────────────────────────────
export const getSessions = (status = "", page = 0) =>
  fetch(`${BASE}/api/admin/sessions?status=${status}&page=${page}&size=20`, {
    headers: headers(),
  }).then(r => r.json());