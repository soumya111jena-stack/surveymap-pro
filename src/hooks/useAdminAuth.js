import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Reads localStorage for accessToken + role.
 * Redirects to /login if not authenticated as ADMIN.
 * Call this at the top of every admin page.
 */
export default function useAdminAuth() {
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    const role  = localStorage.getItem("role");
    if (!token || role !== "ADMIN") {
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  return {
    token:    localStorage.getItem("accessToken"),
    role:     localStorage.getItem("role"),
    username: localStorage.getItem("username"),
    email:    localStorage.getItem("email"),
  };
}