import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
  Pill,
  Spinner,
  TextAreaField,
  TextField,
} from "@/components/ui";
import { useToast } from "@/components/Toast";
import { api, errorMessage, fieldErrors, parseApiError } from "@/lib/api";
import { formatDate, money } from "@/lib/format";
import { useServices } from "@/lib/queries";
import type { Service } from "@/lib/types";

function ServiceModal({ service, open, onClose }: { service: Service | null; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const editing = service !== null;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [active, setActive] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(service?.service_name ?? "");
    setDescription(service?.description ?? "");
    setPrice(service?.price ?? "");
    setActive(service?.is_active ?? true);
    setErrors({});
    setFormError("");
  }, [open, service]);

  const save = useMutation({
    mutationFn: async () => {
      const body = { service_name: name.trim(), description: description.trim(), price, is_active: active };
      return editing
        ? (await api.patch<Service>(`/catalog/services/${service.id}/`, body)).data
        : (await api.post<Service>("/catalog/services/", body)).data;
    },
    onSuccess: async (s) => {
      await qc.invalidateQueries({ queryKey: ["services"] });
      toast.success(editing ? `${s.service_name} updated.` : `${s.service_name} created.`);
      onClose();
    },
    onError: (err) => {
      const info = parseApiError(err);
      const fe = fieldErrors(info);
      setErrors(fe);
      setFormError(Object.keys(fe).length ? "" : errorMessage(err, info));
    },
  });

  function submit() {
    const v: Record<string, string> = {};
    if (!name.trim()) v.service_name = "Enter a service name.";
    const n = Number(price);
    if (!price.trim()) v.price = "Enter a price.";
    else if (!Number.isFinite(n) || n <= 0) v.price = "Price must be greater than zero.";
    else if (!/^\d+(\.\d{1,2})?$/.test(price.trim())) v.price = "Use at most 2 decimal places.";
    setErrors(v);
    setFormError("");
    if (Object.keys(v).length) return;
    save.mutate();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${service.service_name}` : "New service"}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={save.isPending}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={save.isPending}>
            {save.isPending && <Spinner className="h-4 w-4 text-white" />} {editing ? "Save changes" : "Create service"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <TextField label="Service name" required value={name} onChange={(e) => setName(e.target.value)} error={errors.service_name} maxLength={100} />
        <TextAreaField label="Description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} error={errors.description} />
        <TextField
          label="Price (PHP)"
          required
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          error={errors.price}
          hint={editing ? "Price changes apply to new orders only. Past orders keep their price." : undefined}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Available to customers
        </label>
      </div>
    </Modal>
  );
}

export default function ServicesAdminPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const services = useServices();
  const [editing, setEditing] = useState<Service | null>(null);
  const [creating, setCreating] = useState(false);

  const toggle = useMutation({
    mutationFn: async (s: Service) =>
      // DELETE does not remove a service, it just sets is_active=false (API.md §6).
      s.is_active ? api.delete(`/catalog/services/${s.id}/`) : api.patch(`/catalog/services/${s.id}/`, { is_active: true }),
    onSuccess: async (_r, s) => {
      await qc.invalidateQueries({ queryKey: ["services"] });
      toast.success(`${s.service_name} is now ${s.is_active ? "hidden from customers" : "available again"}.`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div>
      <PageHeader
        title="Services & pricing"
        subtitle="Manage the water refill services customers can order."
        actions={<button className="btn-primary" onClick={() => setCreating(true)}>New service</button>}
      />

      {services.isPending ? (
        <LoadingState label="Loading services…" />
      ) : services.isError ? (
        <ErrorState message={errorMessage(services.error)} onRetry={() => services.refetch()} />
      ) : services.data.length === 0 ? (
        <div className="card"><EmptyState title="No services yet" hint="Create the first service to let customers order." /></div>
      ) : (
        <>
          <ul className="grid gap-3 md:grid-cols-2 lg:hidden">
            {services.data.map((s) => (
              <li key={s.id} className={`card p-4 ${s.is_active ? "" : "bg-slate-50"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`text-[15px] font-bold ${s.is_active ? "text-slate-900" : "text-slate-400"}`}>{s.service_name}</p>
                    {s.description && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{s.description}</p>}
                  </div>
                  <p className="tabular flex-none text-lg font-bold text-water-700">{money(s.price)}</p>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                  <Pill tone={s.is_active ? "green" : "slate"}>{s.is_active ? "Active" : "Hidden"}</Pill>
                  <span className="flex-1" />
                  <button className="btn-secondary btn-sm" onClick={() => setEditing(s)}>Edit</button>
                  <button className="btn-secondary btn-sm" disabled={toggle.isPending} onClick={() => toggle.mutate(s)}>
                    {s.is_active ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </li>
            ))}
          </ul>

        <div className="table-wrap hidden lg:block">
          <table className="table">
            <thead>
              <tr><th>Service</th><th className="text-right">Price</th><th>Status</th><th>Updated</th><th className="text-right">Actions</th></tr>
            </thead>
            <tbody>
              {services.data.map((s) => (
                <tr key={s.id} className={s.is_active ? "" : "text-slate-400"}>
                  <td>
                    <div className="font-medium">{s.service_name}</div>
                    <div className="max-w-md truncate text-xs text-slate-500">{s.description}</div>
                  </td>
                  <td className="text-right font-medium">{money(s.price)}</td>
                  <td><Pill tone={s.is_active ? "green" : "slate"}>{s.is_active ? "Active" : "Hidden"}</Pill></td>
                  <td className="whitespace-nowrap">{formatDate(s.updated_at)}</td>
                  <td className="whitespace-nowrap text-right">
                    <button className="btn-ghost btn-sm" onClick={() => setEditing(s)}>Edit</button>
                    <button className="btn-ghost btn-sm" disabled={toggle.isPending} onClick={() => toggle.mutate(s)}>
                      {s.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      <ServiceModal open={creating || editing !== null} service={editing} onClose={() => { setCreating(false); setEditing(null); }} />
    </div>
  );
}
