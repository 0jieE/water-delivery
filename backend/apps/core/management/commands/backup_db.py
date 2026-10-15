from django.core.management.base import BaseCommand, CommandError

from apps.core import backup


class Command(BaseCommand):
    help = (
        "Write a timestamped backup of the database into backend/backups/ "
        "(SQLite: consistent file copy; PostgreSQL: pg_dump)."
    )

    def handle(self, *args, **options):
        try:
            path = backup.create_backup()
        except backup.BackupError as exc:
            raise CommandError(str(exc))
        size_kb = path.stat().st_size / 1024
        self.stdout.write(self.style.SUCCESS(f"Backup written: {path} ({size_kb:,.0f} KB)"))
