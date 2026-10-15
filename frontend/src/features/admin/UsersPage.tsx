import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Avatar,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
  Pagination,
  Pill,
  SelectField,
  Spinner,
  TextAreaField,
  TextField,
} from "@/components/ui";
import { useToast } from "@/components/Toast";
import { api, errorMessage, fieldErrors, parseApiError } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { cleanParams } from "@/lib/queries";
import type { Paginated, Role, User } from "@/lib/types";

const PAGE_SIZE = 20;
const ROLES: Role[] = ["customer", "rider", "staff", "admin"];
const ROLE_LABEL: Record<Role, string> = { admin: "Admin", staff: "Staff", rider: "Rider", customer: "Customer" };

interface FormState {
  username: string;
  password: string;
  role: Role;
  first_name: string;
  last_name: string;
  email: string;
  contact_number: string;
  address: string;
  is_active: boolean;
}

const blank: FormState = {
  username: "",
  password: "",
  role: "staff",
  first_name: "",
  last_name: "",
  email: "",
  contact_number: "",
  address: "",
  is_active: true,
};

function UserFormModal({ user, open, onClose }: { user: User | null; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const editing = user !== null;
  const [form, setForm] = useState<FormState>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setFormError("");
    setForm(
      user
        ? {
            username: user.username,
            password: "",
            role: user.role,
            first_name: user.first_name,
            last_name: user.last_name,
            email: user.email,
            contact_number: user.contact_number,
            address: user.address,
            is_active: user.is_active,
          }
        : blank
    );
  }, [open, user]);

  const save = useMutation({
    mutationFn: async () => {
      const { username, password, ...rest } = form;
      if (editing) {
        const body: Record<string, unknown> = { ...rest };
        if (password) body.password = password;
        return (await api.patch<User>(`/auth/users/${user.id}/`, body)).data;
      }
      return (await api.post<User>("/auth/users/", { username: username.trim(), password, ...rest })).data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["users"] });
      await qc.invalidateQueries({ queryKey: ["riders"] });
      toast.success(editing ? "User updated." : "User created.");
      onClose();
    },
    onError: (err) => {
      const info = parseApiError(err);
      const fe = fieldErrors(info);
      setErrors(fe);
      setFormError(Object.keys(fe).length ? "Please fix the highlighted fields." : errorMessage(err, info));
    },
  });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  function submit() {
    const v: Record<string, string> = {};
    if (!editing && !form.username.trim()) v.username = "Enter a username.";
    if (!editing && !form.password) v.password = "Enter a password.";
    else if (form.password && form.password.length < 8) v.password = "Use at least 8 characters.";
    if (!form.first_name.trim()) v.first_name = "Enter a first name.";
    if (!form.last_name.trim()) v.last_name = "Enter a last name.";
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) v.email = "Enter a valid email address.";
    setErrors(v);
    setFormError("");
    if (Object.keys(v).length) return;
    save.mutate();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? `Edit ${user.username}` : "Create user"}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={save.isPending}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={save.isPending}>
            {save.isPending && <Spinner className="h-4 w-4 text-white" />} {editing ? "Save changes" : "Create user"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Username" required value={form.username} disabled={editing} onChange={(e) => set("username", e.target.value)} error={errors.username} />
          <SelectField label="Role" value={form.role} onChange={(e) => set("role", e.target.value as Role)} error={errors.role}
            hint={!editing && form.role === "rider" ? "A rider profile is created automatically." : undefined}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </SelectField>
          <TextField label="First name" required value={form.first_name} onChange={(e) => set("first_name", e.target.value)} error={errors.first_name} />
          <TextField label="Last name" required value={form.last_name} onChange={(e) => set("last_name", e.target.value)} error={errors.last_name} />
          <TextField label="Email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} error={errors.email} />
          <TextField label="Mobile number" type="tel" value={form.contact_number} onChange={(e) => set("contact_number", e.target.value)} error={errors.contact_number} />
        </div>
        <TextAreaField label="Address" rows={2} value={form.address} onChange={(e) => set("address", e.target.value)} error={errors.address} />
        <TextField
          label={editing ? "New password" : "Password"}
          required={!editing}
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={(e) => set("password", e.target.value)}
          error={errors.password}
          hint={editing ? "Leave blank to keep the current password." : undefined}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.is_active} onChange={(e) => set("is_active", e.target.checked)} />
          Account is active (can sign in)
        </label>
      </div>
    </Modal>
  );
}

export default function UsersPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const me = useSession().user;
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);

  const [search, setSearch] = useState(get("search"));
  const debounced = useDebounced(search);
  const [editing, setEditing] = useState<User | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<User | null>(null);
  const [deleteError, setDeleteError] = useState("");

  function update(next: Record<string, string | undefined>) {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) (v ? p.set(k, v) : p.delete(k));
    if (!("page" in next)) p.delete("page");
    setParams(p, { replace: true });
  }
  useEffect(() => {
    if (debounced.trim() !== get("search")) update({ search: debounced.trim() || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const query = cleanParams({ role: get("role"), is_active: get("is_active"), search: get("search"), page, page_size: PAGE_SIZE });
  const users = useQuery({
    queryKey: ["users", query],
    queryFn: async () => (await api.get<Paginated<User>>("/auth/users/", { params: query })).data,
    placeholderData: keepPreviousData,
  });

  const toggle = useMutation({
    mutationFn: async (u: User) => (await api.patch<User>(`/auth/users/${u.id}/`, { is_active: !u.is_active })).data,
    onSuccess: async (u) => {
      await qc.invalidateQueries({ queryKey: ["users"] });
      await qc.invalidateQueries({ queryKey: ["riders"] });
      toast.success(`${u.username} is now ${u.is_active ? "active" : "inactive"}.`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: async (u: User) => api.delete(`/auth/users/${u.id}/`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["users"] });
      await qc.invalidateQueries({ queryKey: ["riders"] });
      toast.success("User deleted.");
      setDeleting(null);
    },
    onError: (e) => setDeleteError(errorMessage(e)),
  });

  const filtered = ["role", "is_active", "search"].some((k) => get(k));

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Create staff and rider accounts, and activate or deactivate anyone."
        actions={<button className="btn-primary" onClick={() => setCreating(true)}>Create user</button>}
      />

      <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="uq">Search</label>
          <input id="uq" className="input" placeholder="Username, name, email or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="ur">Role</label>
          <select id="ur" className="input" value={get("role")} onChange={(e) => update({ role: e.target.value || undefined })}>
            <option value="">All roles</option>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ua">Status</label>
          <select id="ua" className="input" value={get("is_active")} onChange={(e) => update({ is_active: e.target.value || undefined })}>
            <option value="">Active and inactive</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>
      </div>

      {users.isPending ? (
        <LoadingState label="Loading users…" />
      ) : users.isError ? (
        <ErrorState message={errorMessage(users.error)} onRetry={() => users.refetch()} />
      ) : users.data.results.length === 0 ? (
        <div className="card"><EmptyState title="No users found" hint={filtered ? "Try clearing the filters." : undefined} /></div>
      ) : (
        <>
          <div className={`table-wrap ${users.isPlaceholderData ? "opacity-60" : ""}`}>
            <table className="table">
              <thead>
                <tr><th>User</th><th>Role</th><th>Contact</th><th>Joined</th><th>Status</th><th className="text-right">Actions</th></tr>
              </thead>
              <tbody>
                {users.data.results.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <Avatar name={u.full_name || u.username} size="sm" />
                        <div>
                          <div className="font-medium text-slate-900">{u.full_name || u.username}</div>
                          <div className="text-xs text-slate-400">@{u.username}</div>
                        </div>
                      </div>
                    </td>
                    <td>{ROLE_LABEL[u.role]}</td>
                    <td>
                      <div>{u.contact_number || "—"}</div>
                      <div className="text-xs text-slate-500">{u.email}</div>
                    </td>
                    <td className="whitespace-nowrap">{formatDate(u.created_at)}</td>
                    <td><Pill tone={u.is_active ? "green" : "slate"}>{u.is_active ? "Active" : "Inactive"}</Pill></td>
                    <td className="whitespace-nowrap text-right">
                      <button className="btn-ghost btn-sm" onClick={() => setEditing(u)}>Edit</button>
                      <button className="btn-ghost btn-sm" disabled={u.id === me?.id || toggle.isPending} onClick={() => toggle.mutate(u)}
                        title={u.id === me?.id ? "You can't deactivate your own account" : undefined}>
                        {u.is_active ? "Deactivate" : "Activate"}
                      </button>
                      <button className="btn-ghost btn-sm text-red-700" disabled={u.id === me?.id} onClick={() => { setDeleteError(""); setDeleting(u); }}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} count={users.data.count} pageSize={PAGE_SIZE} onPage={(p) => update({ page: p > 1 ? String(p) : undefined })} />
        </>
      )}

      <UserFormModal open={creating || editing !== null} user={editing} onClose={() => { setCreating(false); setEditing(null); }} />

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete user?"
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
            Permanently delete <span className="font-medium text-slate-900">{deleting?.username}</span>? Users with order history can't be
            deleted. Deactivate them instead.
          </p>
        </div>
      </Modal>
    </div>
  );
}
