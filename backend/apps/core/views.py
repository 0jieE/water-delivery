from django.http import FileResponse
from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
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
