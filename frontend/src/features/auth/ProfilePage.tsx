import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Card, ErrorState, LoadingState, PageHeader, Spinner, TextAreaField, TextField } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { api, errorMessage, fieldErrors, parseApiError } from "@/lib/api";
import { setUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { round6, toPin, type LatLng } from "@/lib/geo";
import { LocationPicker } from "@/components/map";
import type { User } from "@/lib/types";

const ROLE_LABEL = { admin: "Administrator", staff: "Staff", rider: "Rider", customer: "Customer" } as const;

function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => (await api.get<User>("/auth/me/")).data,
  });
}

function ProfileForm({ user }: { user: User }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
    contact_number: user.contact_number,
    address: user.address,
  });
  // Saved home location is a customer feature; it prefills the checkout pin.
  const isCustomer = user.role === "customer";
  const [pin, setPin] = useState<LatLng | null>(() => toPin(user.latitude, user.longitude));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      // Coordinates travel as a pair: both numbers, or both null to clear (API.md §5).
      const body = isCustomer
        ? { ...form, latitude: pin ? round6(pin.lat) : null, longitude: pin ? round6(pin.lng) : null }
        : form;
      return (await api.patch<User>("/auth/me/", body)).data;
    },
    onSuccess: (updated) => {
      setUser(updated);
      qc.setQueryData(["me"], updated);
      setErrors({});
      setFormError("");
      toast.success("Profile updated.");
    },
    onError: (err) => {
      const info = parseApiError(err);
      setErrors(fieldErrors(info));
      setFormError(Object.keys(fieldErrors(info)).length ? "" : errorMessage(err, info));
    },
  });

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const v: Record<string, string> = {};
    if (!form.first_name.trim()) v.first_name = "Enter your first name.";
    if (!form.last_name.trim()) v.last_name = "Enter your last name.";
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) v.email = "Enter a valid email address.";
    if (!form.contact_number.trim()) v.contact_number = "Enter your mobile number.";
    setErrors(v);
    if (Object.keys(v).length) return;
    save.mutate();
  }

  return (
    <Card title="Your details">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <div className="grid gap-4 sm:wide:grid-cols-2">
          <TextField label="Username" value={user.username} disabled readOnly hint="Usernames cannot be changed." />
          <TextField label="Role" value={ROLE_LABEL[user.role]} disabled readOnly />
          <TextField label="First name" required value={form.first_name} onChange={set("first_name")} error={errors.first_name} />
          <TextField label="Last name" required value={form.last_name} onChange={set("last_name")} error={errors.last_name} />
          <TextField label="Email" required type="email" value={form.email} onChange={set("email")} error={errors.email} />
          <TextField label="Mobile number" required type="tel" value={form.contact_number} onChange={set("contact_number")} error={errors.contact_number} />
        </div>
        <TextAreaField label="Address" value={form.address} onChange={set("address")} error={errors.address} rows={2} />
        {isCustomer && (
          <div>
            <p className="label">Home location on the map</p>
            <LocationPicker
              pin={pin}
              onPin={setPin}
              address={form.address}
              onAddress={(address) => setForm((f) => ({ ...f, address }))}
            />
            {(errors.latitude || errors.longitude) && (
              <p className="mt-2 text-xs text-red-600" role="alert">{errors.latitude || errors.longitude}</p>
            )}
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">Member since {formatDate(user.created_at)}</span>
          <button className="btn-primary" disabled={save.isPending}>
            {save.isPending && <Spinner className="h-4 w-4 text-white" />} Save changes
          </button>
        </div>
      </form>
    </Card>
  );
}

function PasswordForm() {
  const toast = useToast();
  const [form, setForm] = useState({ old_password: "", new_password: "", confirm: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");

  const change = useMutation({
    mutationFn: async () =>
      api.post("/auth/change-password/", { old_password: form.old_password, new_password: form.new_password }),
    onSuccess: () => {
      setForm({ old_password: "", new_password: "", confirm: "" });
      setErrors({});
      setFormError("");
      toast.success("Password changed.");
    },
    onError: (err) => {
      const info = parseApiError(err);
      setErrors(fieldErrors(info));
      setFormError(Object.keys(fieldErrors(info)).length ? "" : errorMessage(err, info));
    },
  });

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const v: Record<string, string> = {};
    if (!form.old_password) v.old_password = "Enter your current password.";
    if (!form.new_password) v.new_password = "Enter a new password.";
    else if (form.new_password.length < 8) v.new_password = "Use at least 8 characters.";
    if (form.confirm !== form.new_password) v.confirm = "Passwords do not match.";
    setErrors(v);
    if (Object.keys(v).length) return;
    change.mutate();
  }

  return (
    <Card title="Change password">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <TextField label="Current password" type="password" autoComplete="current-password" value={form.old_password} onChange={set("old_password")} error={errors.old_password} />
        <div className="grid gap-4 sm:wide:grid-cols-2">
          <TextField label="New password" type="password" autoComplete="new-password" value={form.new_password} onChange={set("new_password")} error={errors.new_password} />
          <TextField label="Confirm new password" type="password" autoComplete="new-password" value={form.confirm} onChange={set("confirm")} error={errors.confirm} />
        </div>
        <div className="flex justify-end">
          <button className="btn-secondary" disabled={change.isPending}>
            {change.isPending && <Spinner className="h-4 w-4" />} Change password
          </button>
        </div>
      </form>
    </Card>
  );
}

export default function ProfilePage() {
  const me = useMe();

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="Profile" subtitle="Manage your account details and password." />
      {me.isPending ? (
        <LoadingState />
      ) : me.isError ? (
        <ErrorState message={errorMessage(me.error)} onRetry={() => me.refetch()} />
      ) : (
        <>
          <ProfileForm key={me.data.id} user={me.data} />
          <PasswordForm />
        </>
      )}
    </div>
  );
}
