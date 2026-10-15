# Backend — Django REST API

Water Refilling Delivery and Logistic System · Deep Water Refilling Station (Kidapawan City).
The endpoint reference for the frontend is **[../API.md](../API.md)**.

## Setup (Windows PowerShell)

```powershell
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
python manage.py migrate
python manage.py seed_demo
python manage.py runserver
```

* API: http://localhost:8000/api/ · Django admin: http://localhost:8000/admin/
* Migrations are already in the repo — do not run `makemigrations` unless you change a model.
* If PowerShell blocks `activate`: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
* `python manage.py createsuperuser` creates a user with the **admin** role automatically.
* Set a long random `DJANGO_SECRET_KEY` in `.env` (the sample value is for development only).
* `MAX_ACTIVE_ORDERS_PER_RIDER` (default 10, `0` = no limit) caps how many active orders staff can give one rider; riders can carry several deliveries at once (multi-stop trips).
* Emails print to the console while `DJANGO_DEBUG=True`; with `False` they go through the Gmail SMTP settings in `.env`.

## Demo accounts

`python manage.py seed_demo` creates 1 admin, 2 staff, 3 riders, 5 customers, the four services and 30 orders over
the last 30 days (every status, payments awaiting verification, unread notifications).
Password for every account: **`Demo@12345`**

| Role | Usernames |
|---|---|
| admin | `admin` |
| staff | `staff1`, `staff2` |
| rider | `rider1`, `rider2`, `rider3` |
| customer | `customer1` … `customer5` |

Re-running it is safe: existing accounts and orders are left alone. `python manage.py seed_demo --reset` deletes **all
orders and notifications**, restores the demo passwords and rebuilds the demo orders.

## Management commands

| Command | What it does |
|---|---|
| `python manage.py seed_demo [--reset]` | Demo data (above). |
| `python manage.py backup_db` | Timestamped backup into `backend/backups/`. SQLite: a consistent copy via SQLite's online-backup API (safe while the server runs). PostgreSQL: `pg_dump -Fc` (needs the PostgreSQL client tools on `PATH`). |
| `python manage.py restore_db <file> [--yes]` | Replaces the current database with a backup (name inside `backups/` or a path). Asks for confirmation, and first saves the current database as `pre_restore_*`. **Stop the server before restoring.** PostgreSQL uses `pg_restore --clean`. |

The same backup is available to admins through `POST /api/backups/` (list/download too); restoring is deliberately CLI-only.

## Tests

```powershell
python manage.py check
python manage.py test apps
```

251 tests: status-transition rules, role permissions and per-user visibility (a customer cannot see another
customer's order, a rider cannot see unassigned orders), server-side totals and price snapshots, rider
availability rules, COD collection, payment proof upload and verification, notifications and email, reports
(JSON/PDF/XLSX), backup/restore round-trip, delivery map pins and saved home locations, the admin-managed GCash QR settings, GCash-only checkout, COD cash remittance, the demo seed, and the uniform error shape.

## Switching to PostgreSQL

```powershell
pip install -r requirements-prod.txt
# in .env: DB_ENGINE=postgres and the DB_* values (docker compose up -d starts a local server)
python manage.py migrate
python manage.py seed_demo      # optional
```

All code uses the ORM only (no raw SQL, no PostgreSQL-only fields), so only `migrate` is needed.
**Honest caveat:** this build was developed and tested on SQLite. The PostgreSQL backup/restore commands are covered
by unit tests that check the exact `pg_dump`/`pg_restore` calls, but they have not been run against a real
PostgreSQL server — try `backup_db` and `restore_db` on your PostgreSQL setup before relying on them.

## Layout

```
config/            settings, root URLs
apps/accounts/     User (role), JWT login, register, profile, admin user management
apps/catalog/      WaterRefillService
apps/orders/       Order, OrderDetail, OrderStatusLog; services.py = the state machine
apps/deliveries/   RiderProfile, rider management, the rider's own deliveries
apps/payments/     Payment, proof upload, verify/reject
apps/notifications/ Notification model/API; services.py creates notifications + emails
apps/reports/      JSON / PDF / XLSX reports
apps/core/         error shape, pagination, backup service + API, seed_demo, test helpers
```

Business rules live in `apps/orders/services.py` and `apps/payments/services.py`; views stay thin.

## Notes for deployment

* Uploaded proofs are served from `/media/` by Django **only when `DJANGO_DEBUG=True`**. In production serve `media/` from the web server (nginx etc.). File names are random, so URLs cannot be guessed.
* Set `DJANGO_ALLOWED_HOSTS` and `CORS_ALLOWED_ORIGINS` for the real domains.
* `media/`, `backups/`, `db.sqlite3` and `.env` are git-ignored.
