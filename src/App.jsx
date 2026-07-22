import React, { Suspense, lazy } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";

import SurveyMap from "./component/SurveyMap";

const LoginPage      = lazy(() => import("./pages/LoginPage"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const AdminUsers     = lazy(() => import("./pages/AdminUsers"));
const AdminSessions  = lazy(() => import("./pages/AdminSessions"));

function Loader() {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "#060e1a",
      display: "flex", alignItems: "center", justifyContent: "center",
      flexDirection: "column", gap: 12, fontFamily: "sans-serif",
    }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <div style={{
        width: 32, height: 32, borderRadius: "50%",
        border: "3px solid rgba(74,158,255,0.2)",
        borderTopColor: "#4a9eff",
        animation: "spin 0.7s linear infinite",
      }} />
      <div style={{ color: "rgba(200,225,255,0.4)", fontSize: 12 }}>Loading…</div>
    </div>
  );
}

function Protected({ children }) {
  const role = localStorage.getItem("role");
  if (role !== "ADMIN") return <Navigate to="/login" replace />;
  return children;
}

class PageErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { crashed: false, error: null };
  }
  static getDerivedStateFromError(e) {
    return { crashed: true, error: e };
  }
  render() {
    if (this.state.crashed) {
      return (
        <div style={{
          position: "fixed", inset: 0, background: "#060e1a",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexDirection: "column", gap: 16, fontFamily: "sans-serif", padding: 24,
        }}>
          <div style={{ fontSize: 36 }}>⚠️</div>
          <div style={{ color: "#f87171", fontWeight: 700, fontSize: 16 }}>Page Error</div>
          <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 12, maxWidth: 400, textAlign: "center" }}>
            {this.state.error?.message}
          </div>
          <a href="/" style={{
            padding: "10px 24px", background: "rgba(74,158,255,0.18)",
            border: "1px solid rgba(74,158,255,0.4)", borderRadius: 10,
            color: "#80c4ff", textDecoration: "none", fontWeight: 700,
          }}>← Back to Map</a>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <HashRouter>
      <Routes>

        {/* PUBLIC — map */}
        <Route path="/" element={<SurveyMap />} />

        {/* PUBLIC — login */}
        <Route path="/login" element={
          <PageErrorBoundary>
            <Suspense fallback={<Loader />}>
              <LoginPage />
            </Suspense>
          </PageErrorBoundary>
        } />

        {/* PROTECTED — admin dashboard */}
        <Route path="/admin" element={
          <Protected>
            <PageErrorBoundary>
              <Suspense fallback={<Loader />}>
                <AdminDashboard />
              </Suspense>
            </PageErrorBoundary>
          </Protected>
        } />

        {/* PROTECTED — admin users */}
        <Route path="/admin/users" element={
          <Protected>
            <PageErrorBoundary>
              <Suspense fallback={<Loader />}>
                <AdminUsers />
              </Suspense>
            </PageErrorBoundary>
          </Protected>
        } />

        {/* PROTECTED — admin sessions */}
        <Route path="/admin/sessions" element={
          <Protected>
            <PageErrorBoundary>
              <Suspense fallback={<Loader />}>
                <AdminSessions />
              </Suspense>
            </PageErrorBoundary>
          </Protected>
        } />

        {/* Catch-all → map */}
        <Route path="/*splat" element={<Navigate to="/" replace />} />

      </Routes>
    </HashRouter>
  );
}