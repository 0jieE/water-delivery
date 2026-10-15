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
    """Django STORAGES. Uploaded files go to local disk by default; set AWS_STORAGE_BUCKET_NAME (and the
    other AWS_* values) to keep them in any S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze B2...),
    which survives redeploys on hosts with a temporary disk such as Render."""
    storages = {
        "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
        "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
    }
    bucket = env.get("AWS_STORAGE_BUCKET_NAME")
    if bucket:
        options = {
            "bucket_name": bucket,
            "access_key": env.get("AWS_ACCESS_KEY_ID"),
            "secret_key": env.get("AWS_SECRET_ACCESS_KEY"),
            "endpoint_url": env.get("AWS_S3_ENDPOINT_URL") or None,
            "region_name": env.get("AWS_S3_REGION_NAME") or None,
            "signature_version": "s3v4",
            # private bucket + time-limited https links, so payment proofs are not public
            "querystring_auth": env.get("AWS_QUERYSTRING_AUTH", "True") == "True",
            "querystring_expire": int(env.get("AWS_QUERYSTRING_EXPIRE", "86400")),
            "file_overwrite": False,
            "default_acl": None,
        }
        storages["default"] = {
            "BACKEND": "storages.backends.s3.S3Storage",
            "OPTIONS": {key: value for key, value in options.items() if value is not None},
        }
    return storages
