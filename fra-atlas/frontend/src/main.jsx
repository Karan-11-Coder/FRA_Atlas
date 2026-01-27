import React, { useEffect } from "react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { getToken } from "./libs/apiClient";


function Boot() {
  useEffect(() => {
    // ✅ STEP 1: capture token from URL (after login redirect)
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get("token");

    if (tokenFromUrl) {
      localStorage.setItem("fra_access_token", tokenFromUrl);
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // ✅ STEP 2: normal auth guard
    const token = getToken();
    if (!token && window.location.pathname !== "/") {
      const loginUrl =
        process.env.NEXT_PUBLIC_LOGIN_URL || "http://localhost:3000/login";
      window.location.href = loginUrl;
    }
  }, []);

  return <App />;
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Boot />
  </StrictMode>
);