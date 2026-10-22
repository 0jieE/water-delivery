import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, EmptyState, ErrorState, LoadingState, PageHeader, Pill, Spinner } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { api, downloadFile, errorMessage, parseApiError } from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/format";
import type { BackupFile } from "@/lib/types";

export default function BackupsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [downloading, setDownloading] = useState<string | null>(null);

  const backups = useQuery({
    queryKey: ["backups"],
    queryFn: async () => (await api.get<BackupFile[]>("/backups/")).data,
  });

  const create = useMutation({
    mutationFn: async () => (await api.post<BackupFile>("/backups/")).data,
    onSuccess: async (b) => {
      await qc.invalidateQueries({ queryKey: ["backups"] });
      toast.success(`Backup created: ${b.filename}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  // Some hosts (e.g. Render) have no pg_dump, so the API answers 503 `backup_failed` with an explanation.
  // That is a property of the deployment, not a bug, so show it as information instead of a red error.
  const unavailable = [backups.error, create.error].find((e) => e && parseApiError(e).code === "backup_failed");

  async function download(file: BackupFile) {
    setDownloading(file.filename);
    try {
      await downloadFile(`/backups/${encodeURIComponent(file.filename)}/download/`, {}, file.filename);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Database backups"
        subtitle="Take a backup now and download copies for safekeeping."
        actions={
          <button className="btn-primary" onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending && <Spinner className="h-4 w-4 text-white" />} Back up now
          </button>
        }
      />

      <div className="mb-4">
        <Alert kind="info">
          Restoring replaces the whole database, so it is done on the server with the app stopped:{" "}
          <code className="rounded bg-white/70 px-1">python manage.py restore_db &lt;file&gt;</code>
        </Alert>
      </div>

      {unavailable ? (
        <div className="card">
          <EmptyState
            icon="db"
            title="Backups aren't available on this server"
            hint={`${parseApiError(unavailable).detail} Use your database provider's own backups instead (for example, the scheduled backups in the hosting dashboard).`}
          />
        </div>
      ) : backups.isPending ? (
        <LoadingState label="Loading backups…" />
      ) : backups.isError ? (
        <ErrorState message={errorMessage(backups.error)} onRetry={() => backups.refetch()} />
      ) : backups.data.length === 0 ? (
        <div className="card"><EmptyState title="No backups yet" hint="Click “Back up now” to create the first one." /></div>
      ) : (
        <>
          <ul className="grid gap-3 md:grid-cols-2 lg:hidden">
            {backups.data.map((b) => (
              <li key={b.filename} className="card p-4">
                <p className="break-all font-mono text-xs text-slate-700">{b.filename}</p>
                <p className="mt-1 text-xs text-slate-500">{formatDateTime(b.created_at)} · {formatBytes(b.size)}</p>
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  <Pill>{b.engine}</Pill>
                  <button className="btn-secondary btn-sm" disabled={downloading === b.filename} onClick={() => download(b)}>
                    {downloading === b.filename && <Spinner className="h-3 w-3" />} Download
                  </button>
                </div>
              </li>
            ))}
          </ul>

        <div className="table-wrap hidden lg:block">
          <table className="table">
            <thead>
              <tr><th>File</th><th>Created</th><th>Engine</th><th className="text-right">Size</th><th className="text-right">Download</th></tr>
            </thead>
            <tbody>
              {backups.data.map((b) => (
                <tr key={b.filename}>
                  <td className="font-mono text-xs">{b.filename}</td>
                  <td className="whitespace-nowrap">{formatDateTime(b.created_at)}</td>
                  <td><Pill>{b.engine}</Pill></td>
                  <td className="whitespace-nowrap text-right">{formatBytes(b.size)}</td>
                  <td className="text-right">
                    <button className="btn-secondary btn-sm" disabled={downloading === b.filename} onClick={() => download(b)}>
                      {downloading === b.filename && <Spinner className="h-3 w-3" />} Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
