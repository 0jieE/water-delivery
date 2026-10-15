import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Card, FieldShell, Spinner, TextField } from "@/components/ui";
import { useToast } from "@/components/Toast";
import GcashPay from "@/components/GcashPay";
import { api, errorMessage, fieldErrors, parseApiError } from "@/lib/api";
import { money } from "@/lib/format";
import { invalidateOrderData } from "@/lib/queries";
import type { Order, Payment } from "@/lib/types";

const MAX_BYTES = 5 * 1024 * 1024;

export function validateProof(file: File | null, reference: string): Record<string, string> {
  const e: Record<string, string> = {};
  if (!file) e.proof_image = "Attach a screenshot or photo of your payment.";
  else if (!file.type.startsWith("image/")) e.proof_image = "The file must be an image (JPEG, PNG, …).";
  else if (file.size > MAX_BYTES) e.proof_image = "The image must be 5 MB or smaller.";
  if (!reference.trim()) e.reference_number = "Enter the payment reference number.";
  return e;
}

/** POST payments/{id}/upload-proof/ as multipart (the browser sets the boundary). */
export async function uploadProof(paymentId: number, file: File, reference: string) {
  const form = new FormData();
  form.append("proof_image", file);
  form.append("reference_number", reference.trim());
  return (await api.post<Payment>(`/payments/${paymentId}/upload-proof/`, form)).data;
}

export function ProofFields({
  file,
  onFile,
  reference,
  onReference,
  errors,
}: {
  file: File | null;
  onFile: (f: File | null) => void;
  reference: string;
  onReference: (v: string) => void;
  errors: Record<string, string>;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="space-y-4">
      <TextField
        label="Reference number"
        required
        value={reference}
        onChange={(e) => onReference(e.target.value)}
        error={errors.reference_number}
        maxLength={100}
        hint="The transaction / reference number shown on your payment receipt."
      />
      <FieldShell label="Proof of payment" required error={errors.proof_image} hint="JPEG or PNG, up to 5 MB.">
        <input
          type="file"
          accept="image/*"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-water-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-water-700 hover:file:bg-water-100"
        />
      </FieldShell>
      {preview && <img src={preview} alt="Selected proof preview" className="max-h-48 rounded-lg border border-slate-200 object-contain" />}
    </div>
  );
}

/** Shown on the order page while an online payment still needs (or was refused) a proof. */
export function ProofUploadCard({ order }: { order: Order }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [reference, setReference] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");

  const upload = useMutation({
    mutationFn: () => uploadProof(order.payment.id, file as File, reference),
    onSuccess: async () => {
      await invalidateOrderData(qc);
      setFile(null);
      setReference("");
      setErrors({});
      setFormError("");
      toast.success("Proof uploaded. We'll verify your payment shortly.");
    },
    onError: (err) => {
      const info = parseApiError(err);
      setErrors(fieldErrors(info));
      setFormError(Object.keys(fieldErrors(info)).length ? "" : errorMessage(err, info));
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const v = validateProof(file, reference);
    setErrors(v);
    setFormError("");
    if (Object.keys(v).length) return;
    upload.mutate();
  }

  const rejected = order.payment.payment_status === "rejected";
  return (
    <Card title={rejected ? "Upload a new proof of payment" : "Upload proof of payment"}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {order.payment.payment_method === "gcash" ? (
          <GcashPay amount={money(order.payment.amount)} />
        ) : (
          <p className="text-sm text-slate-600">
            Pay <span className="font-semibold">{order.payment.payment_method_display}</span>, then upload your receipt so our
            staff can verify it.
          </p>
        )}
        {formError && <Alert>{formError}</Alert>}
        <ProofFields file={file} onFile={setFile} reference={reference} onReference={setReference} errors={errors} />
        <button className="btn-primary" disabled={upload.isPending}>
          {upload.isPending && <Spinner className="h-4 w-4 text-white" />} Upload proof
        </button>
      </form>
    </Card>
  );
}
