from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from apps.core import backup


class Command(BaseCommand):
    help = (
        "Restore the database from a backup file made by backup_db. "
        "This REPLACES the current data; stop the web server first."
    )

    def add_arguments(self, parser):
        parser.add_argument("file", help="Path to the backup, or just its name inside backend/backups/")
        parser.add_argument("--yes", action="store_true", help="Do not ask for confirmation")
        parser.add_argument(
            "--no-safety-backup",
            action="store_true",
            help="Skip the automatic 'pre_restore' backup of the current database",
        )

    def handle(self, *args, **options):
        path = Path(options["file"])
        if not path.is_file():
            path = backup.backup_dir() / options["file"]
        if not path.is_file():
            raise CommandError(f"Backup file not found: {options['file']}")

        if not options["yes"]:
            answer = input(
                f"This will REPLACE the current {backup.engine()} database with {path.name}. Type 'yes' to continue: "
            )
            if answer.strip().lower() != "yes":
                raise CommandError("Restore cancelled.")
        try:
            safety = backup.restore_backup(path, safety_backup=not options["no_safety_backup"])
        except backup.BackupError as exc:
            raise CommandError(str(exc))
        if safety:
            self.stdout.write(f"Previous database saved as {safety.name}")
        self.stdout.write(self.style.SUCCESS(f"Database restored from {path.name}"))
