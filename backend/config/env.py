"""Reading deployment settings from environment variables (kept out of settings.py so it is testable)."""
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse


def csv(value):
    """'a, b,,c' -> ['a', 'b', 'c']"""
    return [item.strip() for item in (value or "").split(",") if item.strip()]


def allowed_hosts(env):
    """DJANGO_ALLOWED_HOSTS plus the host Render announces for this service (RENDER_EXTERNAL_HOSTNAME)."""
    hosts = csv(env.get("DJANGO_ALLOWED_HOSTS", "localhost"))
    render_host = env.get("RENDER_EXTERNAL_HOSTNAME")
    if render_host and render_host not in hosts:
        hosts.append(render_host)
    return hosts


def csrf_trusted_origins(env):
    origins = csv(env.get("CSRF_TRUSTED_ORIGINS"))
    render_host = env.get("RENDER_EXTERNAL_HOSTNAME")
    if render_host and f"https://{render_host}" not in origins:
        origins.append(f"https://{render_host}")
    return origins


def database_from_env(env, base_dir):
    """Database settings.

    Order: DATABASE_URL (postgres://user:pass@host:5432/name?sslmode=require), then DB_ENGINE=postgres
    with DB_NAME/DB_USER/DB_PASSWORD/DB_HOST/DB_PORT, otherwise SQLite (development).
    """
    url = env.get("DATABASE_URL")
    if url:
        parsed = urlparse(url)
        if parsed.scheme in ("postgres", "postgresql"):
            query = parse_qs(parsed.query)
            return _postgres(
                env,
                name=unquote(parsed.path.lstrip("/")),
                user=unquote(parsed.username or ""),
                password=unquote(parsed.password or ""),
                host=parsed.hostname or "localhost",
                port=str(parsed.port or 5432),
                sslmode=(query.get("sslmode") or [None])[0],
            )
        raise ValueError("DATABASE_URL must start with postgres:// or postgresql://")

    if env.get("DB_ENGINE", "sqlite") == "postgres":
        return _postgres(
            env,
            name=env.get("DB_NAME", "water_refilling"),
            user=env.get("DB_USER", "postgres"),
            password=env.get("DB_PASSWORD", ""),
            host=env.get("DB_HOST", "localhost"),
            port=env.get("DB_PORT", "5432"),
            sslmode=None,
        )
    return {"ENGINE": "django.db.backends.sqlite3", "NAME": Path(base_dir) / "db.sqlite3"}


def _postgres(env, *, name, user, password, host, port, sslmode):
    config = {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": name,
        "USER": user,
        "PASSWORD": password,
        "HOST": host,
        "PORT": port,
        "CONN_MAX_AGE": int(env.get("DB_CONN_MAX_AGE", "60")),
        "CONN_HEALTH_CHECKS": True,
    }
    sslmode = sslmode or env.get("DB_SSLMODE")
    if sslmode:
        config["OPTIONS"] = {"sslmode": sslmode}
    return config


def storages_from_env(env):
    """Django STORAGES. Uploaded files (payment proofs, GCash QR) go to local disk by default.

    Set CLOUDINARY_URL (cloudinary://<api_key>:<api_secret>@<cloud_name>) to keep them on Cloudinary,
    which survives redeploys on hosts with a temporary disk such as Render.
    """
    storages = {
        "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
        "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
    }
    if env.get("CLOUDINARY_URL"):
        storages["default"] = {"BACKEND": "config.cloudinary_storage.CloudinaryStorage"}
    return storages
