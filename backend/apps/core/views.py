from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.http import FileResponse
from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsAdmin

from . import backup


class BackupListCreateView(APIView):
    """GET: list backup files (newest first). POST: take a new backup now."""

    permission_classes = [IsAdmin]

    def get(self, request):
        return Response(backup.list_backups())

    def post(self, request):
        try:
            path = backup.create_backup()
        except backup.BackupError as exc:
            return Response(
                {"detail": str(exc), "code": "backup_failed", "errors": {}},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        return Response(backup.describe(path), status=status.HTTP_201_CREATED)


class BackupDownloadView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request, filename):
        try:
            path = backup.resolve_backup(filename)
        except backup.BackupError as exc:
            raise ValidationError(str(exc))
        except FileNotFoundError:
            raise NotFound("Backup file not found.")
        return FileResponse(open(path, "rb"), as_attachment=True, filename=path.name)


class HealthView(APIView):
    """Public deployment check: can the API reach its database, and is it fully migrated?

    200 {"status": "ok"} when yes. Otherwise 503 with what is wrong, without revealing hosts,
    names or passwords: "error" (database unreachable; `error` is only the exception class) or
    "migrations_pending". `database` is the engine in use ("postgresql" or "sqlite"), which shows at a glance whether the
    DB_* / DATABASE_URL settings were picked up (it says "sqlite" if they were not).
    """

    permission_classes = [AllowAny]
    authentication_classes: list = []

    def get(self, request):
        body = {"status": "ok", "database": connection.vendor}
        try:
            connection.ensure_connection()
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
            executor = MigrationExecutor(connection)
            pending = executor.migration_plan(executor.loader.graph.leaf_nodes())
        except Exception as exc:  # noqa: BLE001 - report any failure, never crash the check
            body.update(status="error", error=type(exc).__name__)
            return Response(body, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        if pending:
            body.update(status="migrations_pending", pending_migrations=len(pending))
            return Response(body, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response(body)
