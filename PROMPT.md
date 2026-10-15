# Build Prompt — Web-Based Water Refilling Delivery and Logistic System

Paste everything below the line into Claude Code, opened at the project root (`Water-refilling/`).

---

You are building a capstone system: **Web-Based Water Refilling Delivery and Logistic System** for **Deep Water Refilling Station** (Kidapawan City). A scaffold already exists in this folder — read `README.md`, `backend/`, and `frontend/` before writing code. Do not re-scaffold; extend what is there.

## Architecture (must keep)

Three-tier, API-first. Not monolithic.

```
[ React SPA: frontend/ ]  --HTTPS/JSON (JWT)-->  [ Django REST API: backend/ ]  -->  [ SQLite (dev) / PostgreSQL (deploy) ]
```

- The frontend talks ONLY to the REST API under `/api/`. No Django templates for app pages.
- Only the API connects to the database. All business rules, validation, and permission checks live in the API, never only in the frontend.
- Backend: Django 5.1, Django REST Framework, SimpleJWT, django-filter, django-cors-headers, SQLite during development; PostgreSQL 16 at deployment (switched by `DB_ENGINE` in `.env`, already wired in `settings.py`). Write database-agnostic code: Django ORM only, no raw SQL, no PostgreSQL-only fields (e.g. `ArrayField`, `JSONField` lookups specific to Postgres), so the switch needs only `migrate`.
- Frontend: React 18 + TypeScript (Vite), React Router 6, TanStack Query 5, Axios, Tailwind CSS 3. Mobile-responsive (riders use phones).
- The custom user model `apps.accounts.User` with a `role` field (`admin`, `staff`, `rider`, `customer`) already exists. Role permission classes are in `apps/accounts/permissions.py`. Use them on every endpoint.

## Users and what each can do

| Role | Capabilities |
|---|---|
| Customer | Register, log in, browse water refill services, place orders (multiple items), choose delivery date and payment method, upload proof of payment for online payments, track order and delivery status, view order history, cancel an order while still `pending`. |
| Staff | View and process orders (confirm/reject), schedule delivery dates, assign available riders, update order and delivery status, confirm or reject payments, monitor transactions. |
| Admin | Everything Staff can do, plus manage user accounts (create staff/rider accounts, activate/deactivate), manage water refill services and prices, generate and export reports, run database backups. |
| Rider | Log in, see only deliveries assigned to them, view customer name/address/contact and order items, update delivery status (`out_for_delivery`, `delivered`, `failed` with reason), mark COD as collected. |

## Data model (based on the paper's data dictionary; improve types)

Use `DecimalField(max_digits=10, decimal_places=2)` for all money (the paper used Float — do not). Use `TextChoices` for every status.

1. **User** (exists) — fullname via first/last name, `address`, `contact_number`, `email`, `username`, `password` (hashed by Django), `role`, `created_at`.
2. **RiderProfile** (`deliveries` app) — `user` OneToOne → User (role=rider), `vehicle_type`, `status` (`available`, `on_delivery`, `off_duty`), `created_at`. Riders log in through their User account.
3. **WaterRefillService** (`catalog` app) — `service_name`, `description`, `price`, `is_active`, timestamps. Seed sample data: Round 5-gal Refill, Slim 5-gal Refill, New Container + Refill, 1-gal Refill.
4. **Order** (`orders` app) — `customer` FK User, `rider` FK RiderProfile (nullable), `order_date`, `delivery_date` (Date), `delivery_address`, `notes`, `total_amount`, `order_status`:
   `pending → confirmed → scheduled → out_for_delivery → delivered`, plus `cancelled`, `rejected`, `failed`.
5. **OrderDetail** (`orders` app) — `order` FK, `service` FK, `quantity`, `unit_price` (snapshot of price at order time), `subtotal`.
6. **Payment** (`payments` app) — `order` OneToOne, `payment_method` (`cod`, `gcash`, `bank_transfer`), `payment_status` (`unpaid`, `pending_verification`, `paid`, `rejected`), `reference_number`, `proof_image` (ImageField, required for non-COD), `amount`, `payment_date`, `verified_by` FK User (nullable).
7. **OrderStatusLog** (`orders` app) — `order`, `from_status`, `to_status`, `changed_by`, `remarks`, `created_at`. Write one row on every status change; customers see it as a tracking timeline.
8. **Notification** (`notifications` app) — `recipient` FK User, `title`, `message`, `order` FK (nullable), `is_read`, `created_at`.

## Business rules (enforce in the API)

- `total_amount` and each `subtotal` are computed server-side from current service prices. Never trust prices sent by the client.
- Status transitions follow an allowed-transition map. Reject invalid transitions with HTTP 400. Each role may only perform its own transitions (e.g. only riders set `delivered`; only staff/admin set `confirmed`/`scheduled`).
- Assigning a rider requires the rider to be `available`. When a delivery goes `out_for_delivery`, the rider becomes `on_delivery`. When it is `delivered` or `failed`, the rider goes back to `available`.
- `delivery_date` cannot be in the past.
- Customers can only see their own orders. Riders can only see orders assigned to them.
- COD payment becomes `paid` when the rider marks the delivery `delivered` and collected. Online payment starts as `pending_verification` after the proof is uploaded. Staff confirm or reject it.
- Every status change creates an `OrderStatusLog` and a `Notification` for the customer (and for the rider when assigned). Also send an email (console backend in dev).
- Out of scope (per the paper): real-time GPS tracking, automatic route optimization, payment gateway integration.

## API (DRF ViewSets + routers; prefix `/api/`)

- `auth/`: `token/`, `token/refresh/` (exist), `register/` (customers only), `me/` (GET/PATCH profile; include `role` in the response), `users/` (admin CRUD, filter by role).
- Add the user's `role` and name to the JWT claims via a custom `TokenObtainPairSerializer` so the frontend can route after login.
- `catalog/services/`: public list of active services; admin create/update/deactivate.
- `orders/`: customer create (nested items) / list own / cancel; staff/admin list all with filters (status, date range, customer, rider) and search; actions `confirm`, `reject`, `schedule`, `assign-rider`, `update-status`; `orders/{id}/timeline/`.
- `deliveries/riders/`: admin CRUD rider profiles; staff list available riders. `deliveries/my/` for a rider's assigned deliveries (today + upcoming) and the rider's status actions.
- `payments/`: customer upload proof (multipart); staff `verify` / `reject`.
- `notifications/`: list own, unread count, mark-read, mark-all-read.
- `reports/`: JSON summaries plus `?format=pdf` (xhtml2pdf) and `?format=xlsx` (openpyxl) exports for: daily/monthly sales, orders by status, deliveries per rider, and top services. All accept a date range.
- Pagination, filtering and search on list endpoints. Consistent error shape.

## Frontend pages

Build under `src/features/<role>/`, shared UI in `src/components/`, API hooks with TanStack Query.

- **Auth:** Login (redirect by role), Customer Registration, Profile.
- **Customer:** Services catalog with cart → Checkout (delivery address, delivery date, payment method, proof upload if online) → My Orders list → Order Detail with status timeline. Notification bell.
- **Staff:** Dashboard (today's orders by status, pending payments), Orders table with filters, Order detail with actions (confirm/reject/schedule/assign rider), Delivery schedule board grouped by date, Payment verification queue with proof image preview.
- **Admin:** Everything Staff has, plus User management, Rider management, Services and pricing, Reports page with date range and PDF/Excel export buttons, Backup page.
- **Rider (mobile-first):** Today's deliveries list → delivery detail (address, contact tap-to-call, items, amount to collect) → big status buttons.
- Refresh order and notification data by polling every 15 s with TanStack Query `refetchInterval`.
- Implement the 401 → refresh-token → retry flow in `src/lib/api.ts`. Store the role from JWT claims and use the existing `ProtectedRoute`.
- Clean, simple UI: a water-blue accent, readable tables, loading and empty states, and form validation messages.

## Disaster recovery (from the paper's DRP)

- Management command `python manage.py backup_db` that writes a timestamped backup into `backend/backups/`: copy the `.sqlite3` file when on SQLite, run `pg_dump` when on PostgreSQL. Plus `restore_db <file>` for both. Detect the engine from `settings.DATABASES`.
- Admin-only API endpoint to trigger a backup and list or download backup files.

## Seed and test

- Management command `seed_demo`: 1 admin, 2 staff, 3 riders, 5 customers, the services above, and ~30 orders across all statuses and the last 30 days (so the reports have data). Print the demo credentials.
- Tests: status-transition rules, role permissions (a customer cannot see another customer's order; a rider cannot see unassigned orders), server-side total calculation, and payment verification.

## Working style

- Work in phases and finish each one before starting the next: (1) models + migrations + admin, (2) auth + permissions, (3) catalog + orders API, (4) deliveries + payments, (5) notifications, (6) reports + backup, (7) frontend auth + layout, (8) customer pages, (9) staff/admin pages, (10) rider pages, (11) seed + tests + README update.
- After each backend phase run `python manage.py check` and the tests. After frontend phases run `npm run build`.
- The developer is on Windows. Give PowerShell commands.
- Keep secrets in `.env` (never commit). Update `README.md` with the final setup steps and demo accounts.
