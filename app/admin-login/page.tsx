"use client";

import { FormEvent, useState } from "react";

export default function AdminLoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (response.ok) {
      window.location.href = "/";
      return;
    }
    const result = await response.json().catch(() => ({}));
    setError(result.error ?? "Sign-in failed.");
    setLoading(false);
  };

  return (
    <main className="admin-login-page">
      <form onSubmit={signIn}>
        <img src="/red-court-invitational-logo.png" alt="Red Court Invitational" />
        <p>TOURNAMENT CONTROL</p>
        <h1>Admin sign in</h1>
        <span>Enter the tournament admin passcode.</span>
        <label>
          <small>ADMIN PASSCODE</small>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
            required
          />
        </label>
        {error && <em>{error}</em>}
        <button disabled={loading}>{loading ? "Signing in…" : "Open dashboard"}</button>
        <a href="/">Back to player page</a>
      </form>
    </main>
  );
}
