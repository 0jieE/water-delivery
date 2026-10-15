import { useEffect, useRef, useState, type DragEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Icon from "@/components/Icon";
import { Alert, Card, ErrorState, LoadingState, PageHeader, Spinner, TextField } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { api, errorMessage, fieldErrors, parseApiError } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { usePaymentSettings } from "@/lib/queries";
import type { PaymentSettings } from "@/lib/types";

const MAX_BYTES = 5 * 1024 * 1024;
const NUMBER_RE = /^[0-9 +\-()]*$/;

function imageProblem(file: File): string {
  if (!file.type.startsWith("image/")) return "That file isn't an image. Use a JPEG or PNG.";
  if (file.size > MAX_BYTES) return "The image must be 5 MB or smaller.";
  return "";
}

/** Choose, drag in, or paste (Ctrl+V) an image. Returns it via `onFile`. */
function ImageDrop({ onFile, preview, disabled }: { onFile: (f: File) => void; preview: string | null; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  // Paste anywhere on this page (e.g. a QR copied from a screenshot tool or a chat app).
  useEffect(() => {
    if (disabled) return;
    function onPaste(e: ClipboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName) && (target as HTMLInputElement).type !== "file") return;
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) {
        e.preventDefault();
        onFile(file);
      }
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [onFile, disabled]);

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/")) ?? e.dataTransfer.files[0];
    if (file) onFile(file);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Choose, drop or paste a GCash QR code image"
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !disabled && (e.preventDefault(), input.current?.click())}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`flex min-h-64 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-5 text-center transition ${
        over ? "border-water-500 bg-water-50" : "border-slate-300 bg-slate-50/60 hover:border-water-400 hover:bg-water-50/40"
      }`}
    >
      {preview ? (
        <img src={preview} alt="GCash QR code preview" className="max-h-56 w-auto rounded-xl border border-slate-200 bg-white object-contain p-2 shadow-soft" />
      ) : (
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-water-50 text-water-500 ring-8 ring-water-50/60">
          <Icon name="camera" className="h-7 w-7" strokeWidth={1.5} />
        </span>
      )}
      <div>
        <p className="text-sm font-semibold text-slate-800">{preview ? "Replace the QR code" : "Add your GCash QR code"}</p>
        <p className="mt-0.5 text-xs text-slate-500">Click to choose, drag an image here, or press Ctrl+V to paste.</p>
        <p className="mt-0.5 text-xs text-slate-400">JPEG or PNG, up to 5 MB.</p>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = ""; // allow picking the same file again
        }}
      />
    </div>
  );
}

function SettingsForm({ settings }: { settings: PaymentSettings }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [removed, setRemoved] = useState(false);
  const [name, setName] = useState(settings.gcash_account_name);
  const [number, setNumber] = useState(settings.gcash_number);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const shownImage = preview ?? (removed ? null : settings.gcash_qr_image);
  const dirty = file !== null || removed || name !== settings.gcash_account_name || number !== settings.gcash_number;

  function pick(f: File) {
    const problem = imageProblem(f);
    if (problem) {
      setErrors((e) => ({ ...e, gcash_qr_image: problem }));
      return;
    }
    setErrors((e) => ({ ...e, gcash_qr_image: "" }));
    setFile(f);
    setRemoved(false);
  }

  const save = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append("gcash_account_name", name.trim());
      form.append("gcash_number", number.trim());
      if (file) form.append("gcash_qr_image", file);
      else if (removed) form.append("gcash_qr_image", ""); // empty value removes the QR
      // The browser sets the multipart boundary itself.
      return (await api.patch<PaymentSettings>("/payments/settings/", form)).data;
    },
    onSuccess: (updated) => {
      qc.setQueryData(["payment-settings"], updated);
      setFile(null);
      setRemoved(false);
      setErrors({});
      setFormError("");
      toast.success("Payment settings saved.");
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
    if (name.trim().length > 100) v.gcash_account_name = "Use 100 characters or fewer.";
    if (number.trim().length > 20) v.gcash_number = "Use 20 characters or fewer.";
    else if (!NUMBER_RE.test(number)) v.gcash_number = "Use digits, spaces and + - ( ) only.";
    setErrors(v);
    setFormError("");
    if (Object.keys(v).length) return;
    save.mutate();
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card title="GCash QR code">
        <div className="space-y-3">
          <ImageDrop onFile={pick} preview={shownImage} disabled={save.isPending} />
          {errors.gcash_qr_image && (
            <p className="flex items-center gap-1 text-xs font-medium text-red-600" role="alert">
              <Icon name="warning" className="h-3.5 w-3.5" /> {errors.gcash_qr_image}
            </p>
          )}
          {file && (
            <p className="flex items-center justify-between gap-2 rounded-xl bg-water-50 px-3 py-2 text-xs text-water-900">
              <span className="truncate">New image: {file.name || "pasted image"} · {formatBytes(file.size)}</span>
              <button type="button" className="font-semibold hover:underline" onClick={() => setFile(null)}>Undo</button>
            </p>
          )}
          {shownImage && !file && (
            <button type="button" className="btn-ghost btn-sm text-red-700" onClick={() => setRemoved(true)} disabled={save.isPending}>
              <Icon name="x" className="h-4 w-4" /> Remove QR code
            </button>
          )}
          {removed && !file && (
            <p className="flex items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <span>The QR code will be removed when you save.</span>
              <button type="button" className="font-semibold hover:underline" onClick={() => setRemoved(false)}>Undo</button>
            </p>
          )}
        </div>
      </Card>

      <div className="space-y-5">
        <Card title="Account details">
          <div className="space-y-4">
            {formError && <Alert>{formError}</Alert>}
            <TextField
              label="Account name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={errors.gcash_account_name}
              maxLength={100}
              hint="The name customers see in GCash, so they know they're paying the right account."
            />
            <TextField
              label="GCash number"
              type="tel"
              inputMode="tel"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              error={errors.gcash_number}
              maxLength={20}
              hint="Shown under the QR code as a fallback if it can't be scanned."
            />
          </div>
        </Card>

        <div className="flex items-center justify-end gap-3">
          {dirty && <span className="text-xs text-slate-500">You have unsaved changes</span>}
          <button className="btn-primary" onClick={submit} disabled={!dirty || save.isPending}>
            {save.isPending && <Spinner className="h-4 w-4 text-white" />} Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PaymentSettingsPage() {
  const settings = usePaymentSettings();
  return (
    <div>
      <PageHeader title="Payment settings" subtitle="The GCash QR code and account details customers see at checkout." />
      {settings.isPending ? (
        <LoadingState />
      ) : settings.isError ? (
        <ErrorState message={errorMessage(settings.error)} onRetry={() => settings.refetch()} />
      ) : (
        <SettingsForm settings={settings.data} />
      )}
    </div>
  );
}
