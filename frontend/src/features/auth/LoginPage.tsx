import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import AuthLayout from "@/components/AuthLayout";
import { Alert, PasswordField, Spinner, TextField } from "@/components/ui";
import { api, errorMessage, fieldErrors, parseApiError } from "@/lib/api";
import { homePathFor, setSession, useSession } from "@/lib/auth";
import type { LoginResponse } from "@/lib/types";

export default function LoginPage() {
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  const notice = (location.state as { notice?: string } | null)?.notice;

  if (session.role && !busy) return <Navigate to={homePathFor(session.role)} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!username.trim()) next.username = "Enter your username.";
    if (!password) next.password = "Enter your password.";
    setErrors(next);
    setFormError("");
    if (Object.keys(next).length) return;

    setBusy(true);
    try {
      const { data } = await api.post<LoginResponse>("/auth/token/", {
        username: username.trim(),
        password,
      });
      qc.clear(); // never show the previous user's cached data
      setSession(data);
      // Role-based redirect; honour the page they were sent from only if it belongs to their role.
      const home = homePathFor(data.user.role);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from.startsWith(home) ? from : home, { replace: true });
    } catch (err) {
      const info = parseApiError(err);
      if (info.status === 401) setFormError("Incorrect username or password, or the account is inactive.");
      else {
        setErrors(fieldErrors(info));
        setFormError(errorMessage(err, info));
      }
      setBusy(false);
    }
  }


  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to order water or manage deliveries."
      footer={
        <>
          New customer?{" "}
          <Link to="/register" className="font-semibold text-water-700 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {notice && <Alert kind="success">{notice}</Alert>}
        {formError && <Alert>{formError}</Alert>}
        <TextField
          label="Username"
          name="username"
          autoComplete="username"
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          error={errors.username}
        />
        <PasswordField
          label="Password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        <button className="btn-primary btn-lg w-full" disabled={busy}>
          {busy && <Spinner className="h-5 w-5 text-white" />} Sign in
        </button>
      </form>
    </AuthLayout>
  );
}

