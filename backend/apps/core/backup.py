"""Database backup / restore for SQLite and PostgreSQL (engine detected from settings.DATABASES).

SQLite uses the sqlite3 online-backup API, which gives a consistent copy even while the
server is running (a plain file copy could catch the database mid-write).
PostgreSQL shells out to pg_dump / pg_restore, which must be on PATH.
"""
import datetime
import os
import re
import shutil
import sqlite3
import subprocess
import time
from pathlib import Path

from django.conf import settings
from django.db import connection

BACKUP_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*_\d{8}_\d{6}(_\d+)?\.(sqlite3|dump)$")
SQLITE_MAGIC = b"SQLite format 3\x00"
BUSY_TIMEOUT_SECONDS = 30  # give up instead of waiting forever on a locked database


class BackupError(Exception):
    """Raised with a message that is safe to show to the user."""


def db_config():
    return settings.DATABASES["default"]


def engine():
    name = db_config()["ENGINE"]
    if name.endswith("sqlite3"):
        return "sqlite"
    if "postgresql" in name:
        return "postgres"
    raise BackupError(f"Backups are not supported for database engine '{name}'.")


def backup_dir():
    path = Path(settings.BACKUP_DIR)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _target_path(prefix, extension):
    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    directory = backup_dir()
    path = directory / f"{prefix}_{stamp}.{extension}"
    counter = 1
    while path.exists():  # two backups in the same second
        path = directory / f"{prefix}_{stamp}_{counter}.{extension}"
        counter += 1
    return path


def _open_live_sqlite():
    """A fresh connection to the project database (not Django's own, which may be mid-transaction)."""
    name = str(db_config()["NAME"])
    return sqlite3.connect(name, uri=name.startswith("file:"), timeout=BUSY_TIMEOUT_SECONDS)


def _copy_sqlite(source, destination):
    """sqlite3 online backup that raises BackupError instead of retrying forever when locked."""
    deadline = time.monotonic() + BUSY_TIMEOUT_SECONDS

    def progress(status, remaining, total):
        if status in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED) and time.monotonic() > deadline:
            raise BackupError("The database is busy right now. Try again in a moment.")

    try:
        source.backup(destination, progress=progress)
    except sqlite3.Error as exc:
        raise BackupError(f"SQLite backup failed: {exc}")


def _pg_env_args():
    cfg = db_config()
    args = [
        "-h", str(cfg.get("HOST") or "localhost"),
        "-p", str(cfg.get("PORT") or "5432"),
        "-U", str(cfg.get("USER") or "postgres"),
    ]  # fmt: skip
    env = dict(os.environ, PGPASSWORD=str(cfg.get("PASSWORD") or ""))
    return args, env


def _find_tool(name):
    tool = shutil.which(name)
    if not tool:
        raise BackupError(f"'{name}' was not found on PATH. Install the PostgreSQL client tools.")
    return tool


def _run(command, env):
    try:
        subprocess.run(command, env=env, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as exc:
        raise BackupError(f"{Path(command[0]).stem} failed: {(exc.stderr or '').strip()[:500]}")


def create_backup(prefix="backup"):
    """Write a timestamped backup into BACKUP_DIR and return its path."""
    kind = engine()
    if kind == "sqlite":
        path = _target_path(prefix, "sqlite3")
        source = _open_live_sqlite()
        destination = sqlite3.connect(path)
        try:
            _copy_sqlite(source, destination)
        except BaseException:
            destination.close()
            path.unlink(missing_ok=True)
            raise
        finally:
            source.close()
        destination.close()
        return path

    path = _target_path(prefix, "dump")
    args, env = _pg_env_args()
    try:
        _run([_find_tool("pg_dump"), *args, "-Fc", "-f", str(path), db_config()["NAME"]], env)
    except BackupError:
        path.unlink(missing_ok=True)
        raise
    return path


def describe(path):
    stat = path.stat()
    return {
        "filename": path.name,
        "size": stat.st_size,
        "created_at": datetime.datetime.fromtimestamp(stat.st_mtime, tz=datetime.timezone.utc),
        "engine": "sqlite" if path.suffix == ".sqlite3" else "postgres",
    }


def list_backups():
    files = [p for p in backup_dir().iterdir() if p.is_file() and BACKUP_NAME.match(p.name)]
    return [describe(p) for p in sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)]


def resolve_backup(filename):
    """Map a user-supplied file name to a file inside BACKUP_DIR (no paths, no traversal)."""
    if not BACKUP_NAME.match(filename or ""):
        raise BackupError("Invalid backup file name.")
    path = backup_dir() / filename
    if not path.is_file():
        raise FileNotFoundError(filename)
    return path


def _check_sqlite_file(path):
    with open(path, "rb") as handle:
        if handle.read(16) != SQLITE_MAGIC:
            raise BackupError(f"{path.name} is not a SQLite database.")
    source = sqlite3.connect(str(path))
    try:
        if source.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise BackupError(f"{path.name} failed the SQLite integrity check.")
        tables = {row[0] for row in source.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "django_migrations" not in tables:
            raise BackupError(f"{path.name} is not a backup of this application's database.")
    except sqlite3.DatabaseError as exc:
        raise BackupError(f"{path.name} is not a valid SQLite backup: {exc}")
    finally:
        source.close()


def restore_backup(path, safety_backup=True):
    """Replace the current database with the contents of `path`.

    A safety backup of the current database is taken first (prefix 'pre_restore').
    Stop the web server before restoring.
    """
    path = Path(path)
    if not path.is_file():
        raise BackupError(f"Backup file not found: {path}")
    kind = engine()
    expected = ".sqlite3" if kind == "sqlite" else ".dump"
    if path.suffix != expected:
        raise BackupError(f"A {kind} database needs a '{expected}' backup file.")

    if kind == "sqlite":
        _check_sqlite_file(path)
    safety = create_backup("pre_restore") if safety_backup else None

    if kind == "sqlite":
        source = sqlite3.connect(str(path))
        try:
            connection.ensure_connection()
            _copy_sqlite(source, connection.connection)
        finally:
            source.close()
        connection.close()
    else:
        args, env = _pg_env_args()
        _run(
            [
                _find_tool("pg_restore"), *args,
                "--clean", "--if-exists", "--no-owner",
                "-d", db_config()["NAME"], str(path),
            ],
            env,
        )  # fmt: skip
    return safety
