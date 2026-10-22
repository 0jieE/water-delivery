import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Avatar,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
  Pill,
  RiderStatusBadge,
  SelectField,
  Spinner,
  TextField,
} from "@/components/ui";
import { useToast } from "@/components/Toast";
import { api, errorMessage, fieldErrors, parseApiError } from "@/lib/api";
import { RIDER_STATUS_LABEL } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { useRiders } from "@/lib/queries";
import type { Rider, RiderStatus } from "@/lib/types";

interface CreateForm {
  username: string;
  password: string;
  first_name: string;
  last_name: string;
  contact_number: string;
  email: string;
  address: string;
  vehicle_type: string;
}
const blank: CreateForm = {
  username: "",
  password: "",
  first_name: "",
  last_name: "",
  contact_number: "",
  email: "",
  address: "",
  vehicle_type: "",
};

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([qc.invalidateQueries({ queryKey: ["riders"] }), qc.invalidateQueries({ queryKey: ["users"] })]);
}

function CreateRiderModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (open) {
      setForm(blank);
      setErrors({});
      setFormError("");
    }
  }, [open]);

  const create = useMutation({
    mutationFn: async () => (await api.post<Rider>("/deliveries/riders/", form)).data,
    onSuccess: async (r) => {
      await invalidate(qc);
      toast.success(`Rider ${r.full_name} created.`);
      onClose();
    },
    onError: (err) => {
      const info = parseApiError(err);
      const fe = fieldErrors(info);
      setErrors(fe);
      setFormError(Object.keys(fe).length ? "Please fix the highlighted fields." : errorMessage(err, info));
    },
  });

  const set = (k: keyof CreateForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function submit() {
    const v: Record<string, string> = {};
    if (!form.username.trim()) v.username = "Enter a username.";
    if (!form.password) v.password = "Enter a password.";
    else if (form.password.length < 8) v.password = "Use at least 8 characters.";
    if (!form.first_name.trim()) v.first_name = "Enter a first name.";
    if (!form.last_name.trim()) v.last_name = "Enter a last name.";
    if (!form.contact_number.trim()) v.contact_number = "Enter a mobile number.";
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) v.email = "Enter a valid email address.";
    setErrors(v);
    setFormError("");
    if (Object.keys(v).length) return;
    create.mutate();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Add rider"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={create.isPending}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={create.isPending}>
            {create.isPending && <Spinner className="h-4 w-4 text-white" />} Create rider
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <p className="text-sm text-slate-600">This creates the rider's login account and delivery profile together.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="First name" required value={form.first_name} onChange={set("first_name")} error={errors.first_name} />
          <TextField label="Last name" required value={form.last_name} onChange={set("last_name")} error={errors.last_name} />
          <TextField label="Username" required value={form.username} onChange={set("username")} error={errors.username} />
          <TextField label="Password" required type="password" autoComplete="new-password" value={form.password} onChange={set("password")} error={errors.password} />
          <TextField label="Mobile number" required type="tel" value={form.contact_number} onChange={set("contact_number")} error={errors.contact_number} />
          <TextField label="Vehicle type" value={form.vehicle_type} onChange={set("vehicle_type")} error={errors.vehicle_type} placeholder="Motorcycle, Tricycle…" />
          <TextField label="Email" type="email" value={form.email} onChange={set("email")} error={errors.email} />
          <TextField label="Address" value={form.address} onChange={set("address")} error={errors.address} />
        </div>
      </div>
    </Modal>
  );
}

function EditRiderModal({ rider, onClose }: { rider: Rider | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [vehicle, setVehicle] = useState("");
  const [status, setStatus] = useState<RiderStatus>("available");
  const [active, setActive] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (rider) {
      setVehicle(rider.vehicle_type);
      setStatus(rider.status);
      setActive(rider.is_active);
      setErrors({});
      setFormError("");
    }
  }, [rider]);

  const onDelivery = rider?.status === "on_delivery";
  const save = useMutation({
    mutationFn: async () => {
      // `on_delivery` is set by the system and the API refuses it; only send status when it can change.
      const body: Record<string, unknown> = { vehicle_type: vehicle.trim(), is_active: active };
      if (!onDelivery) body.status = status;
      return (await api.patch<Rider>(`/deliveries/riders/${rider!.id}/`, body)).data;
    },
    onSuccess: async (r) => {
      await invalidate(qc);
      toast.success(`${r.full_name} updated.`);
      onClose();
    },
    onError: (err) => {
      const info = parseApiError(err);
      const fe = fieldErrors(info);
      setErrors(fe);
      setFormError(Object.keys(fe).length ? "" : errorMessage(err, info));
    },
  });

  return (
    <Modal
      open={rider !== null}
      onClose={onClose}
      title={rider ? `Edit ${rider.full_name}` : "Edit rider"}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={save.isPending}>Cancel</button>
          <button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Spinner className="h-4 w-4 text-white" />} Save changes
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <TextField label="Vehicle type" value={vehicle} onChange={(e) => setVehicle(e.target.value)} error={errors.vehicle_type} />
        {onDelivery ? (
          <Alert kind="info">This rider is on a delivery. Their status updates automatically when it ends.</Alert>
        ) : (
          <SelectField label="Availability" value={status} onChange={(e) => setStatus(e.target.value as RiderStatus)} error={errors.status}>
            <option value="available">{RIDER_STATUS_LABEL.available}</option>
            <option value="off_duty">{RIDER_STATUS_LABEL.off_duty}</option>
          </SelectField>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Account is active (can sign in and be assigned)
        </label>
        {errors.is_active && <p className="text-xs text-red-600">{errors.is_active}</p>}
      </div>
    </Modal>
  );
}

export default function RidersPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [active, setActive] = useState("");
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const riders = useRiders({ status, is_active: active, search: debounced.trim() });

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Rider | null>(null);
  const [deleting, setDeleting] = useState<Rider | null>(null);
  const [deleteError, setDeleteError] = useState("");

  const remove = useMutation({
    mutationFn: async (r: Rider) => api.delete(`/deliveries/riders/${r.id}/`),
    onSuccess: async () => {
      await invalidate(qc);
      toast.success("Rider deleted.");
      setDeleting(null);
    },
    onError: (e) => setDeleteError(errorMessage(e)),
  });

  return (
    <div>
      <PageHeader
        title="Riders"
        subtitle="Delivery riders and their availability."
        actions={<button className="btn-primary" onClick={() => setCreating(true)}>Add rider</button>}
      />

      <div className="card mb-4 grid grid-cols-2 gap-3 p-4 md:grid-cols-3">
        <div className="col-span-2 md:col-span-1">
          <label className="label" htmlFor="rq">Search</label>
          <input id="rq" className="input" placeholder="Name, username or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="rs">Availability</label>
          <select id="rs" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any</option>
            {(Object.keys(RIDER_STATUS_LABEL) as RiderStatus[]).map((s) => <option key={s} value={s}>{RIDER_STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ra">Account</label>
          <select id="ra" className="input" value={active} onChange={(e) => setActive(e.target.value)}>
            <option value="">Active and inactive</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>
      </div>

      {riders.isPending ? (
        <LoadingState label="Loading riders…" />
      ) : riders.isError ? (
        <ErrorState message={errorMessage(riders.error)} onRetry={() => riders.refetch()} />
      ) : riders.data.length === 0 ? (
        <div className="card"><EmptyState title="No riders found" hint="Add a rider to start assigning deliveries." /></div>
      ) : (
        <>
          {/* Phones and tablets: cards. Large screens: the table. */}
          <ul className="grid gap-3 md:grid-cols-2 lg:hidden">
            {riders.data.map((r) => (
              <li key={r.id} className="card p-4">
                <div className="flex items-start gap-3">
                  <Avatar name={r.full_name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-bold text-slate-900">{r.full_name}</p>
                    <p className="text-xs text-slate-400">@{r.username} · {r.vehicle_type || "No vehicle"}</p>
                  </div>
                  <RiderStatusBadge status={r.status} />
                </div>
                <p className="mt-3 text-sm text-slate-700">{r.contact_number}</p>
                <p className="truncate text-xs text-slate-500">{r.email || "No email"}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                  <Pill tone={r.is_active ? "green" : "slate"}>{r.is_active ? "Active" : "Inactive"}</Pill>
                  <span className="flex-1" />
                  <button className="btn-secondary btn-sm" onClick={() => setEditing(r)}>Edit</button>
                  <button className="btn-secondary btn-sm text-red-700" onClick={() => { setDeleteError(""); setDeleting(r); }}>Delete</button>
                </div>
              </li>
            ))}
          </ul>

        <div className="table-wrap hidden lg:block">
          <table className="table">
            <thead>
              <tr><th>Rider</th><th>Vehicle</th><th>Contact</th><th>Availability</th><th>Account</th><th className="text-right">Actions</th></tr>
            </thead>
            <tbody>
              {riders.data.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <Avatar name={r.full_name} size="sm" />
                      <div>
                        <div className="font-medium text-slate-900">{r.full_name}</div>
                        <div className="text-xs text-slate-400">@{r.username}</div>
                      </div>
                    </div>
                  </td>
                  <td>{r.vehicle_type || "—"}</td>
                  <td>
                    <div>{r.contact_number}</div>
                    <div className="text-xs text-slate-500">{r.email}</div>
                  </td>
                  <td><RiderStatusBadge status={r.status} /></td>
                  <td><Pill tone={r.is_active ? "green" : "slate"}>{r.is_active ? "Active" : "Inactive"}</Pill></td>
                  <td className="whitespace-nowrap text-right">
                    <button className="btn-ghost btn-sm" onClick={() => setEditing(r)}>Edit</button>
                    <button className="btn-ghost btn-sm text-red-700" onClick={() => { setDeleteError(""); setDeleting(r); }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      <CreateRiderModal open={creating} onClose={() => setCreating(false)} />
      <EditRiderModal rider={editing} onClose={() => setEditing(null)} />

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete rider?"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setDeleting(null)} disabled={remove.isPending}>Cancel</button>
            <button className="btn-danger" disabled={remove.isPending} onClick={() => deleting && remove.mutate(deleting)}>
              {remove.isPending && <Spinner className="h-4 w-4 text-white" />} Delete
            </button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-600">
          {deleteError && <Alert>{deleteError}</Alert>}
          <p>
            Permanently delete <span className="font-medium text-slate-900">{deleting?.full_name}</span> and their login? Riders with delivery
            history can't be deleted. Mark them inactive instead.
          </p>
        </div>
      </Modal>
    </div>
  );
}
