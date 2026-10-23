from datetime import timedelta
from pathlib import Path
import os
import sys

from dotenv import load_dotenv

from config.admin_theme import build_unfold
from config.env import (
    allowed_hosts,
    csrf_trusted_origins,
    csv,
    database_from_env,
    storages_from_env,
)

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "dev-insecure-key")
DEBUG = os.getenv("DJANGO_DEBUG", "False") == "True"
ALLOWED_HOSTS = allowed_hosts(os.environ)  # + Render's own host automatically
CSRF_TRUSTED_ORIGINS = csrf_trusted_origins(os.environ)
# Render terminates HTTPS at its proxy and forwards plain HTTP; trust its header so Django knows the
# request was secure and builds https:// links (images, pagination) instead of http://.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

INSTALLED_APPS = [
    "unfold",  # the admin theme; must come before django.contrib.admin
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # third-party
    "rest_framework",
    "rest_framework_simplejwt",
    "corsheaders",
    "django_filters",
    # local
    "apps.core",
    "apps.accounts",
    "apps.catalog",
    "apps.orders",
    "apps.deliveries",
    "apps.payments",
    "apps.notifications",
    "apps.reports",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    # serves the static files (admin and API CSS/JS) when DEBUG is off, e.g. on Render
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]

# SQLite for development. For deployment set DATABASE_URL, or DB_ENGINE=postgres with the DB_* values.
DATABASES = {"default": database_from_env(os.environ, BASE_DIR)}

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Manila"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [BASE_DIR / "static"]  # our own files (favicon)
# Also look in the apps' own static folders, so styling works even if `collectstatic` was not run.
WHITENOISE_USE_FINDERS = "test" not in sys.argv  # off in tests: scanning on every test client is slow
MEDIA_URL = "media/"
# MEDIA_ROOT can point at a persistent disk (e.g. /var/data/media on Render).
MEDIA_ROOT = Path(os.getenv("MEDIA_ROOT", BASE_DIR / "media"))

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

STORAGES = storages_from_env(os.environ)
# On local disk (e.g. a persistent disk) Django itself serves /media/; with Cloudinary it does not. (small deployments with a persistent disk).
SERVE_MEDIA_FILES = os.getenv("SERVE_MEDIA_FILES", "False" if os.getenv("CLOUDINARY_URL") else "True") == "True"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.StandardPagination",
    "PAGE_SIZE": 20,
    "EXCEPTION_HANDLER": "apps.core.exceptions.api_exception_handler",
    # Reports use ?format=pdf|xlsx themselves, so DRF must not treat it as a renderer override.
    "URL_FORMAT_OVERRIDE": None,
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=30),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
}

CORS_ALLOWED_ORIGINS = csv(os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173"))
# lets the browser read the real file name of report/backup downloads
CORS_EXPOSE_HEADERS = ["Content-Disposition"]

EMAIL_BACKEND = (
    "django.core.mail.backends.console.EmailBackend"
    if DEBUG
    else "django.core.mail.backends.smtp.EmailBackend"
)
DEFAULT_FROM_EMAIL = "Deep Water Refilling Station <noreply@deepwater.local>"
EMAIL_HOST = "smtp.gmail.com"
EMAIL_PORT = 587
EMAIL_USE_TLS = True
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")

# Where backup_db / the admin backup API write files (override in tests).
BACKUP_DIR = Path(os.getenv("BACKUP_DIR", BASE_DIR / "backups"))
MAX_PROOF_IMAGE_BYTES = 5 * 1024 * 1024
# Most active (confirmed/scheduled/out for delivery) orders one rider can hold; 0 = no limit.
MAX_ACTIVE_ORDERS_PER_RIDER = int(os.getenv("MAX_ACTIVE_ORDERS_PER_RIDER", "10"))

# Cheap password hashing keeps the test suite fast. Never applies to runserver.
if "test" in sys.argv:
    PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

# Print request errors (with the traceback) to the console, which is where Render shows logs.
# Django's default only does this when DEBUG is on.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"plain": {"format": "%(levelname)s %(name)s: %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "plain"}},
    "root": {"handlers": ["console"], "level": "WARNING"},
    "loggers": {"django.request": {"handlers": ["console"], "level": "ERROR", "propagate": False}},
}

# Admin site theme. "View site" links to the web app: the first non-localhost CORS origin.
UNFOLD = build_unfold(frontend_url=next((o for o in CORS_ALLOWED_ORIGINS if "localhost" not in o), None))
