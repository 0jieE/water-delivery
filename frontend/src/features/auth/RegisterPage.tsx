import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import AuthLayout from "@/components/AuthLayout";
import { Alert, PasswordField, Spinner, TextField } from "@/components/ui";
import { api, errorMessage, fieldErrors, parseApiError } from "@/lib/api";
import { homePathFor, setSession, useSession } from "@/lib/auth";
import type { LoginResponse } from "@/lib/types";

const EMPTY = {
  username: "",
  email: "",
  first_name: "",
  last_name: "",
  contact_number: "",
  address: "",
  password: "",
  confirm: "",
};

export default function RegisterPage() {
  const session = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  if (session.role && !busy) return <Navigate to={homePathFor(session.role)} replace />;

  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  function validate() {
    const e: Record<string, string> = {};
    if (!form.username.trim()) e.username = "Choose a username.";
    if (!form.first_name.trim()) e.first_name = "Enter your first name.";
    if (!form.last_name.trim()) e.last_name = "Enter your last name.";
    if (!form.email.trim()) e.email = "Enter your email address.";
    else if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) e.email = "Enter a valid email address.";
    if (!form.contact_number.trim()) e.contact_number = "Enter your mobile number.";
    if (!form.password) e.password = "Choose a password.";
    else if (form.password.length < 8) e.password = "Use at least 8 characters.";
    if (form.confirm !== form.password) e.confirm = "Passwords do not match.";
    return e;
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    const clientErrors = validate();
    setErrors(clientErrors);
    setFormError("");
    if (Object.keys(clientErrors).length) return;

    setBusy(true);
    const { confirm: _confirm, ...payload } = form;
    void _confirm;
    try {
      await api.post("/auth/register/", {
        ...payload,
        username: payload.username.trim(),
        email: payload.email.trim(),
        first_name: payload.first_name.trim(),
        last_name: payload.last_name.trim(),
        contact_number: payload.contact_number.trim(),
        address: payload.address.trim(),
      });
    } catch (err) {
      const info = parseApiError(err);
      setErrors(fieldErrors(info));
      setFormError(Object.keys(fieldErrors(info)).length ? "Please fix the highlighted fields." : errorMessage(err, info));
      setBusy(false);
      return;
    }

    // Registration returns no tokens, so sign in right away.
    try {
      const { data } = await api.post<LoginResponse>("/auth/token/", {
        username: form.username.trim(),
        password: form.password,
      });
      qc.clear();
      setSession(data);
      navigate(homePathFor(data.user.role), { replace: true });
    } catch {
      navigate("/login", { replace: true, state: { notice: "Account created. Please sign in." } });
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Order water refills for delivery to your door."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-water-700 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <TextField label="First name" required autoComplete="given-name" value={form.first_name} onChange={set("first_name")} error={errors.first_name} />
          <TextField label="Last name" required autoComplete="family-name" value={form.last_name} onChange={set("last_name")} error={errors.last_name} />
        </div>
        <TextField label="Username" required autoComplete="username" value={form.username} onChange={set("username")} error={errors.username} />
        <TextField label="Email" required type="email" autoComplete="email" value={form.email} onChange={set("email")} error={errors.email} />
        <TextField label="Mobile number" required type="tel" autoComplete="tel" value={form.contact_number} onChange={set("contact_number")} error={errors.contact_number} />
        <TextField
          label="Default delivery address"
          autoComplete="street-address"
          value={form.address}
          onChange={set("address")}
          error={errors.address}
          hint="Optional. You can change it for each order."
        />
        <PasswordField label="Password" required autoComplete="new-password" value={form.password} onChange={set("password")} error={errors.password} hint="At least 8 characters." />
        <PasswordField label="Confirm password" required autoComplete="new-password" value={form.confirm} onChange={set("confirm")} error={errors.confirm} />
        <button className="btn-primary btn-lg w-full" disabled={busy}>
          {busy && <Spinner className="h-5 w-5 text-white" />} Create account
        </button>
      </form>
    </AuthLayout>
  );
}

