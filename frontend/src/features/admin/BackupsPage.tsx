import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, EmptyState, ErrorState, LoadingState, PageHeader, Pill, Spinner } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { api, downloadFile, errorMessage } from "@/lib/api";
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

      {backups.isPending ? (
        <LoadingState label="Loading backups…" />
      ) : backups.isError ? (
        <ErrorState message={errorMessage(backups.error)} onRetry={() => backups.refetch()} />
      ) : backups.data.length === 0 ? (
        <div className="card"><EmptyState title="No backups yet" hint="Click “Back up now” to create the first one." /></div>
      ) : (
        <div className="table-wrap">
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
      )}
    </div>
  );
}
