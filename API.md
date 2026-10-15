# Water Refilling API — Reference for the Frontend

Deep Water Refilling Station · Django REST API · all paths start with `/api/`.
Dev base URL: `http://localhost:8000/api/` (the Vite dev origin `http://localhost:5173` is allowed by CORS).

Everything below was checked against the running code (280 backend tests + a live HTTP smoke test). Sample
responses are real output from the seeded demo database, trimmed where marked `…`.

---

## 1. Conventions

| Topic | Rule |
|---|---|
| **Auth** | JWT. Send `Authorization: Bearer <access>` on every request except the ones marked *Public*. Access token lives **30 min**, refresh token **7 days**. Refresh tokens are **not rotated**: `token/refresh/` returns only a new `access`. |
| **JWT claims** | `user_id` (string), `role`, `name` (full name), `username`, `token_type`, `exp`, `iat`, `jti`. Decode `role` to route after login. |
| **Roles** | `admin`, `staff`, `rider`, `customer`. |
| **Content type** | JSON (`Content-Type: application/json`) everywhere, **except** `POST payments/{id}/upload-proof/` and `PATCH payments/settings/` when sending a file, which are `multipart/form-data`. |
| **Money** | Always a **string with 2 decimals**: `"125.00"`. Never a number. Currency is PHP. |
| **Dates** | Date: `"2026-10-14"`. Datetime: ISO 8601 with offset, e.g. `"2026-10-14T03:30:33.833198+08:00"` (server timezone `Asia/Manila`). Datetimes from `backups/` are UTC with `Z`. |
| **Coordinates** | Latitude/longitude are JSON **numbers** (not strings) with up to 6 decimals, or `null` when not set: `7.0083`, `125.0894`. Latitude must be in [-90, 90], longitude in [-180, 180]. On input, extra decimals are **rounded** to 6 (not rejected), so you can send the raw value from a map. Always sent as a **pair**: both numbers, or both `null`/omitted. |
| **IDs** | Integers. |
| **Pagination** | List endpoints marked *paginated* return `{"count", "next", "previous", "results"}`. Query: `?page=2&page_size=50` (default 20, max 100). `next`/`previous` are absolute URLs or `null`. Endpoints marked *plain array* return a bare JSON array. |
| **Ordering** | `?ordering=field` or `?ordering=-field` where the endpoint lists `ordering` fields. |
| **Empty body actions** | `POST` actions with no body fields (e.g. `confirm`) accept an empty body. Send `{}` or nothing. |
| **Image URLs** | `proof_image` and `gcash_qr_image` are **absolute URLs** (`http://localhost:8000/media/payment_proofs/<random>.png`) or `null`. Use it directly in `<img src>`; no auth header needed. File names are random and unguessable. |
| **Trailing slash** | Every URL ends with `/`. |
| **Unknown/foreign records** | Records outside the caller's scope return **404** (not 403), so existence is not leaked. |

### 1.1 Error shape (every error, every endpoint)

```json
{ "detail": "Human readable message", "code": "machine_code", "errors": { } }
```

`errors` is always present (`{}` when there are no field errors). Show `detail` to the user; map `errors` onto form fields.

| HTTP | `code` | When |
|---|---|---|
| 400 | `validation_error` | Bad input **or** a business rule/transition violation. |
| 401 | `not_authenticated` | No token. |
| 401 | `token_not_valid` | Token invalid/expired → call `token/refresh/`, retry once, else go to login. |
| 401 | `authentication_failed` | Wrong username/password, or inactive account (login only). |
| 403 | `permission_denied` | Wrong role, or the transition exists but your role may not perform it. |
| 404 | `not_found` | Not found **or not visible to you**. |
| 503 | `backup_failed` | Backup could not run (e.g. `pg_dump` missing, DB busy). |

Validation error (`400`), field errors are arrays of strings:

```json
{
  "detail": "Invalid input.",
  "code": "validation_error",
  "errors": {
    "delivery_date": ["Delivery date cannot be in the past."],
    "payment_method": ["\"x\" is not a valid choice."],
    "items": ["This list may not be empty."]
  }
}
```

* `detail` is `"Invalid input."` when there are field errors, or the message itself when the only problem is a single non-field error (e.g. an invalid status transition: `"An order that is 'delivered' cannot be changed to 'confirmed'."`). Non-field errors also appear under `errors.non_field_errors`.
* **Nested `items`** (order creation): per-item errors are an array **aligned with the submitted items**, `{}` meaning that item was fine: `"items": [{}, {"quantity": ["Ensure this value is greater than or equal to 1."]}]`. A list-level error is a plain array of strings (as above).

```json
{ "detail": "You do not have permission to perform this action.", "code": "permission_denied", "errors": {} }
```

---

## 2. Enumerations

| Name | Values |
|---|---|
| User `role` | `admin` · `staff` · `rider` · `customer` |
| Order `order_status` | `pending` · `confirmed` · `scheduled` · `out_for_delivery` · `delivered` · `cancelled` · `rejected` · `failed` |
| Payment `payment_method` | `cod` · `gcash` |
| *(retired)* `bank_transfer` | Bank transfer was **removed**. `POST orders/` rejects it (`400`). Orders placed before the removal keep it, so it can still **appear** in responses (`payment_method: "bank_transfer"`, `payment_method_display: "Bank transfer"`) and is still accepted as a **filter** (`?payment_method=bank_transfer`). Render it as a plain label; never offer it as a choice. |
| Payment `payment_status` | `unpaid` · `pending_verification` · `paid` · `rejected` |
| Rider `status` | `available` · `on_delivery` · `off_duty` |
| *Rider status meaning* | `on_delivery` = the rider has **at least one** order `out_for_delivery` (a rider can carry several at once, a multi-stop trip). `available` = on duty with **no** order out; the rider can still hold scheduled orders. `off_duty` = not working: cannot start deliveries and cannot be assigned orders. The server sets `on_delivery`/`available` automatically from the rider's orders. |

Each enum field also has a `*_display` sibling with the human label (`order_status_display: "Out for delivery"`).

---

## 3. Order status rules (the state machine)

The server owns these rules. Every order response carries **`allowed_transitions`** (statuses *the current user* may move this order to right now) and **`can_assign_rider`** (boolean) — drive your buttons from those instead of re-implementing the table.

### 3.1 Transitions

| From | To | Who | Endpoint | Rules / side effects |
|---|---|---|---|---|
| *(new)* | `pending` | customer | `POST orders/` | Total computed server-side. Payment row created `unpaid`. Customer + all staff/admin get a notification. |
| `pending` | `confirmed` | staff, admin | `confirm/` or `update-status/` | |
| `pending` | `rejected` | staff, admin | `reject/` or `update-status/` | `remarks` (reason) **required**. |
| `pending` | `cancelled` | **customer** (own order) | `cancel/` | Customers can cancel **only while `pending`** (otherwise 400 `"Only pending orders can be cancelled."`). Staff are notified. |
| `confirmed` | `scheduled` | staff, admin | `schedule/` or `update-status/` | `delivery_date` must not be in the past. A rider may be assigned in the same call. |
| `confirmed` | `cancelled` | staff, admin | `update-status/` | `remarks` **required**. |
| `scheduled` | `scheduled` | staff, admin | `schedule/` | **Reschedule** (new date). Logged as a status change. |
| `scheduled` | `out_for_delivery` | **rider** (the assigned rider) | `deliveries/my/{id}/status/` | A rider must be assigned. The rider must **not** be `off_duty`; other deliveries may already be out (multi-stop). Rider → `on_delivery`. |
| `scheduled` | `cancelled` | staff, admin | `update-status/` | `remarks` **required**. |
| `out_for_delivery` | `delivered` | **rider** (assigned) | `deliveries/my/{id}/status/` | Rider → `available` **only if none of their other orders is still out for delivery**, otherwise stays `on_delivery`. **COD:** `cod_collected: true` is required (for each order), then payment → `paid`. |
| `out_for_delivery` | `failed` | **rider** (assigned) | `deliveries/my/{id}/status/` | `remarks` (reason) **required**. Rider → `available` unless other orders are still out (then stays `on_delivery`). Staff notified. |
| `failed` | `scheduled` | staff, admin | `schedule/` | Retry delivery with a new `delivery_date`. |
| `failed` | `cancelled` | staff, admin | `update-status/` | `remarks` **required**. |
| `delivered`, `cancelled`, `rejected` | — | nobody | | Terminal. |

### 3.2 How violations are reported

* **400** — the transition does not exist from the current status (e.g. confirm a `confirmed` order, jump `pending → delivered`), or a rule is broken (past date, missing reason, rider busy, cash not confirmed).
* **403** — the transition exists but **your role may not do it** (e.g. staff sets `delivered`; a customer calls `confirm/`; a rider calls any staff action).
* **404** — the order isn't yours / isn't assigned to you.

### 3.3 Other rules

* Every status change writes one `OrderStatusLog` row (the customer's tracking timeline) and creates a `Notification` for the customer (+ email). The rider is notified when assigned, re-assigned, rescheduled or when the order is cancelled.
* **Assigning a rider** (`assign-rider/` or `schedule/` with `rider`): order must be `confirmed`, `scheduled` or `failed`; the rider must have an **active account** and be `available` **or** `on_delivery` (a rider already on a trip can be given more orders) — an `off_duty` rider is rejected. A rider may hold at most **10** active orders (`confirmed`/`scheduled`/`out_for_delivery`; the server setting `MAX_ACTIVE_ORDERS_PER_RIDER`, `0` = no limit); beyond that → `400` with the message under `errors.rider`. Re-assigning replaces the previous rider (who is notified). Assigning the same rider again is a no-op.
* **A rider can carry several deliveries at once** (multi-stop trip): starting another delivery while some are already `out_for_delivery` is allowed. Only an `off_duty` rider cannot start (400). A rider **cannot go `off_duty` while any of their orders is out for delivery** (400, both for the rider's own `availability/` call and for an admin `PATCH`). When an order is `delivered` or `failed`, the rider returns to `available` only when no other order of theirs is still out.
* **COD** becomes `paid` only when the rider marks `delivered` with `cod_collected: true` (`verified_by` = that rider, `payment_date` = now). From then on the rider is **holding that cash** until staff record a remittance (§9A).
* **Online payments** (`gcash`; legacy `bank_transfer` orders behave the same): the customer pays to the station's GCash QR (`GET payments/settings/`). The payment starts `unpaid` → customer uploads proof → `pending_verification` → staff `verify` (→ `paid`) or `reject` (→ `rejected`, customer may upload again). Delivery is **not** blocked while an online payment is unpaid; show `payment.payment_status` to staff.
* Customers see only their orders; riders see only orders assigned to them; staff/admin see all.

---

## 4. Endpoint index

| Area | Method & URL | Roles |
|---|---|---|
| Auth | `POST auth/token/` | Public |
| | `POST auth/token/refresh/` | Public |
| | `POST auth/register/` | Public (creates a customer) |
| | `GET`, `PATCH auth/me/` | any signed-in |
| | `POST auth/change-password/` | any signed-in |
| | `GET`, `POST auth/users/` · `GET`, `PUT`, `PATCH`, `DELETE auth/users/{id}/` | admin |
| Catalog | `GET catalog/services/`, `GET catalog/services/{id}/` | Public |
| | `POST catalog/services/` · `PUT`, `PATCH`, `DELETE catalog/services/{id}/` | admin |
| Orders | `POST orders/` | customer |
| | `GET orders/`, `GET orders/{id}/`, `GET orders/{id}/timeline/` | customer (own) · rider (assigned) · staff/admin (all) |
| | `POST orders/{id}/cancel/` | customer |
| | `POST orders/{id}/confirm/` · `reject/` · `schedule/` · `assign-rider/` · `update-status/` | staff, admin |
| | `GET orders/dashboard/` | staff, admin |
| Riders | `GET deliveries/riders/`, `GET deliveries/riders/{id}/` | staff, admin |
| | `POST deliveries/riders/` · `PUT`, `PATCH`, `DELETE deliveries/riders/{id}/` | admin |
| My deliveries | `GET deliveries/my/`, `GET deliveries/my/{id}/`, `GET deliveries/my/cash/` | rider |
| | `POST deliveries/my/{id}/status/` · `POST deliveries/my/start/` · `POST deliveries/my/availability/` | rider |
| Cash (COD remittance, §9A) | `GET deliveries/cash/` · `GET deliveries/cash/remittances/` · `GET deliveries/cash/remittances/{id}/` | staff, admin |
| | `POST deliveries/cash/remit/` | staff, admin |
| Payments | `GET payments/settings/` | any signed-in user |
| | `PATCH payments/settings/` | admin |
| | `GET payments/`, `GET payments/{id}/` | customer (own) · staff/admin (all) · rider gets an empty list |
| | `POST payments/{id}/upload-proof/` | customer |
| | `POST payments/{id}/verify/` · `reject/` | staff, admin |
| Notifications | `GET notifications/` · `GET notifications/unread-count/` · `POST notifications/{id}/mark-read/` · `POST notifications/mark-all-read/` | any signed-in |
| Reports | `GET reports/sales/daily/` · `sales/monthly/` · `orders-by-status/` · `deliveries-per-rider/` · `top-services/` · `cash/` | admin |
| Backups | `GET backups/` · `POST backups/` · `GET backups/{filename}/download/` | admin |
| Health | `GET health/` | Public |

---

## 5. Auth

### `POST auth/token/` — log in *(Public)*

Body: `{ "username": "customer1", "password": "Demo@12345" }`

`200`:
```json
{
  "refresh": "eyJhbGciOiJIUzI1NiIs…",
  "access": "eyJhbGciOiJIUzI1NiIs…",
  "user": {
    "id": 7, "username": "customer1", "email": "customer1@deepwater.test",
    "first_name": "Juan", "last_name": "Dela Cruz", "full_name": "Juan Dela Cruz",
    "role": "customer", "contact_number": "09173330001",
    "address": "Purok 3, Brgy. Poblacion, Kidapawan City",
    "latitude": 7.0083, "longitude": 125.0894,
    "is_active": true, "created_at": "2026-10-14T03:28:51.095524+08:00",
    "rider_profile": null
  }
}
```
`latitude`/`longitude` are the user's saved home location (numbers, or `null` if never set). Errors: `401 authentication_failed` (`"No active account found with the given credentials"`) — also returned for deactivated accounts. `400` if a field is missing.

### `POST auth/token/refresh/` — *(Public)*

Body: `{ "refresh": "<refresh token>" }` → `200 { "access": "<new access token>" }`. Invalid/expired refresh → `401 token_not_valid` (`"Token is invalid"`) → log the user out.

### `POST auth/register/` — customer sign-up *(Public)*

| Field | Type | Required | Notes |
|---|---|---|---|
| `username` | string ≤150 | yes | unique |
| `password` | string | yes | Django validators: ≥8 chars, not common, not all digits, not similar to the user data |
| `email` | email | yes | unique (case-insensitive) |
| `first_name`, `last_name` | string | yes | |
| `contact_number` | string ≤20 | yes | |
| `address` | string ≤255 | no | default delivery address |
| `latitude`, `longitude` | number or `null` | no | saved home location; send both or neither (see *Coordinates* in §1). Only one → `400` with the error on the missing one. |

`role` is ignored — the account is always a `customer`. `201` → user object (same shape as `user` above; no tokens: call `auth/token/` next). Errors `400` with per-field arrays (a weak password lists every failed rule).

### `GET auth/me/` · `PATCH auth/me/` — own profile

`GET 200` → user object. For riders `rider_profile` is `{ "id": 1, "vehicle_type": "Motorcycle", "status": "on_delivery" }`, otherwise `null`.

`PATCH` body (all optional): `first_name`, `last_name`, `email`, `contact_number`, `address`, `latitude`, `longitude`. `role` and `username` cannot be changed. `200` → updated user object.

Location rules on `PATCH`: a request that includes one coordinate must include the other (otherwise `400`, error on the missing one). Send `{ "latitude": null, "longitude": null }` to clear the saved location. A PATCH that omits both leaves the saved location unchanged.

### `POST auth/change-password/`

Body `{ "old_password": "…", "new_password": "…" }` → `200 { "detail": "Password changed." }`. `400` if the old password is wrong or the new one fails the validators. Existing tokens stay valid until they expire.

### `auth/users/` — user management *(admin)*

| Call | Notes |
|---|---|
| `GET auth/users/` | *Paginated.* Filters: `role`, `is_active` (`true`/`false`). `search` (username, names, email, phone). `ordering`: `created_at`, `username`, `first_name`, `last_name`, `role` (default newest first). |
| `POST auth/users/` | Create any role (staff, rider, …). |
| `GET auth/users/{id}/` | |
| `PATCH auth/users/{id}/` | Partial update; also activate/deactivate with `{ "is_active": false }`. |
| `PUT auth/users/{id}/` | Full update (`username` required). Prefer `PATCH`. |
| `DELETE auth/users/{id}/` | `204`. `400` if the user has order history (deactivate instead) or is yourself. |

Create body: `username` (req), `password` (req), `role` (default `customer`), `first_name`, `last_name`, `email`, `contact_number`, `address` (all optional), `is_active` (default `true`). `password` is write-only and optional on update. Creating a user with `role: "rider"` **automatically creates their rider profile**. An admin cannot deactivate, demote or delete their own account (`400`).

Response = the user object shown above. List item sample (`rider` filter):
```json
{ "count": 3, "next": null, "previous": null,
  "results": [ { "id": 6, "username": "rider3", "email": "rider3@deepwater.test",
    "first_name": "Ramon", "last_name": "Castillo", "full_name": "Ramon Castillo",
    "role": "rider", "contact_number": "09172220003", "address": "Brgy. Singao, Kidapawan City",
    "latitude": null, "longitude": null,
    "is_active": true, "created_at": "2026-10-14T03:28:50.526741+08:00",
    "rider_profile": { "id": 3, "vehicle_type": "Tricycle", "status": "available" } } ] }
```

---

## 6. Catalog — `catalog/services/`

*Plain array, not paginated.* Public read; admin write.

* `GET catalog/services/` — non-admins get **active** services only; admins get all (filter with `?is_active=true|false`). Also `?search=`, `?ordering=` (`id`, `service_name`, `price`).
* `GET catalog/services/{id}/` — inactive services are 404 for non-admins.
* `POST catalog/services/` *(admin)* — body: `service_name` (req, unique ≤100), `description` (opt), `price` (req, string/number > 0, 2 decimals), `is_active` (opt, default `true`). `201` → service.
* `PATCH`/`PUT catalog/services/{id}/` *(admin)* — update (price changes affect **new** orders only; past orders keep their snapshot).
* `DELETE catalog/services/{id}/` *(admin)* — does **not** delete: it sets `is_active=false`. `204`.

```json
[ { "id": 1, "service_name": "Round 5-gal Refill",
    "description": "Refill of your own round 5-gallon container.",
    "price": "25.00", "is_active": true,
    "created_at": "2026-10-14T03:28:54.225335+08:00", "updated_at": "2026-10-14T03:28:54.225351+08:00" } ]
```

---

## 7. Orders — `orders/`

### The Order object (returned by every order endpoint, including actions)

```json
{
  "id": 51,
  "customer": { "id": 11, "username": "customer5", "full_name": "Mark Flores", "role": "customer",
                "contact_number": "09173330005", "email": "customer5@deepwater.test",
                "address": "Purok 2, Brgy. Singao, Kidapawan City" },
  "rider": { "id": 3, "user_id": 6, "full_name": "Ramon Castillo", "contact_number": "09172220003",
             "vehicle_type": "Tricycle", "status": "available" },
  "order_date": "2026-10-13T09:30:33.654560+08:00",
  "delivery_date": "2026-10-14",
  "delivery_address": "Purok 2, Brgy. Singao, Kidapawan City",
  "delivery_latitude": 6.9972,
  "delivery_longitude": 125.1038,
  "notes": "",
  "total_amount": "125.00",
  "order_status": "scheduled",
  "order_status_display": "Scheduled",
  "items": [ { "id": 77, "service": 1, "service_name": "Round 5-gal Refill",
               "quantity": 5, "unit_price": "25.00", "subtotal": "125.00" } ],
  "payment": {
    "id": 51, "order": 51,
    "payment_method": "cod", "payment_method_display": "Cash on delivery",
    "payment_status": "unpaid", "payment_status_display": "Unpaid",
    "reference_number": "", "proof_image": null, "amount": "125.00",
    "payment_date": null, "verified_by": null, "remarks": "",
    "remittance": null, "remitted_at": null,
    "created_at": "2026-10-14T03:30:33.833198+08:00"
  },
  "allowed_transitions": ["scheduled", "cancelled"],
  "can_assign_rider": true,
  "updated_at": "2026-10-14T03:30:33.830564+08:00"
}
```

* `delivery_latitude` / `delivery_longitude` are the map pin the customer chose at checkout: **numbers, or both `null`** when no pin was sent (every order created before this field existed, and any order from a client that does not send one). They are returned on every order endpoint and to every role that may see the order — customer (own), rider (assigned; also in the delivery object, §9), staff and admin. They cannot be edited after the order is placed.
* `rider` is `null` until assigned. `payment.verified_by` is `null` or `{ "id": 2, "full_name": "Jose Ramirez" }`.
* `allowed_transitions` is computed **for the caller** (see §3). For a staff user on a `scheduled` order it is `["scheduled", "cancelled"]` where `"scheduled"` means *reschedule*; for the customer on a `pending` order it is `["cancelled"]`.
* `payment.remittance` / `payment.remitted_at` (the cash hand-in, §9A) are present for **staff and admin only**; customers and riders do not receive them.
* **Riders** receive the same object **without** `customer.email` and without `payment.proof_image`, `reference_number`, `verified_by`, `remarks`.

### `POST orders/` — place an order *(customer)*

| Field | Type | Required | Notes |
|---|---|---|---|
| `items` | array of `{ "service": id, "quantity": int }` | yes | 1–20 lines; `quantity` 1–500; service must exist and be active. The same service listed twice is merged into one line. **Prices are never read from the client** — extra fields such as `unit_price` are ignored. |
| `delivery_date` | `YYYY-MM-DD` | yes | today or later |
| `delivery_address` | string ≤255 | no | if blank, the customer's profile address is used; if that is also empty → 400 on `delivery_address` |
| `delivery_latitude`, `delivery_longitude` | number or `null` | no | Map pin for the delivery address. **Optional**, so older clients keep working; omitted → stored as `null`. The server does **not** geocode. Send **both or neither**: only one (or one `null`) → `400` with the error on the missing field, e.g. `{"errors": {"delivery_longitude": ["Required when delivery_latitude is provided."]}}`. Out of range (lat ∉ [-90, 90], lon ∉ [-180, 180]) or non-numeric → `400` on that field. Decimals beyond 6 places are rounded. |
| `notes` | string ≤1000 | no | |
| `payment_method` | `cod` \| `gcash` | yes | `bank_transfer` is no longer accepted → `400` with `errors.payment_method: ["\"bank_transfer\" is not a valid choice."]`. |

```json
{ "items": [ { "service": 1, "quantity": 2 }, { "service": 3, "quantity": 1 } ],
  "delivery_date": "2026-10-15", "delivery_address": "Purok 9, Kidapawan City",
  "delivery_latitude": 7.0172, "delivery_longitude": 125.0961,
  "payment_method": "gcash" }
```
`201` → Order (`order_status: "pending"`, `total_amount: "300.00"` = 2×25.00 + 250.00, `payment.payment_status: "unpaid"`). For `gcash`, show the station's QR from `GET payments/settings/` (§10), and after the customer has paid, follow with `POST payments/{order.payment.id}/upload-proof/` (§10).

### `GET orders/` — list *(paginated)*

Scope: customer → own, rider → assigned to them, staff/admin → all.

| Query | Meaning |
|---|---|
| `status` | one or several, comma-separated: `?status=pending,confirmed` |
| `date_from`, `date_to` | `YYYY-MM-DD`, on the day the order was **placed** (`order_date`), inclusive |
| `delivery_date` | exact delivery day |
| `delivery_date_from`, `delivery_date_to` | delivery-day range, inclusive (use for the schedule board) |
| `customer` | customer user id |
| `rider` | rider **profile** id (`rider.id`, not `user_id`) |
| `payment_status`, `payment_method` | filter by the order's payment |
| `search` | every word must match customer username/name, rider name, delivery address, or the order number (`#12` or `12`) |
| `ordering` | `order_date`, `delivery_date`, `total_amount`, `id`, `order_status` (prefix `-` for descending). Default `-order_date,-id`. |
| `page`, `page_size` | pagination |

A bad filter value (`date_from=abc`, `customer=abc`, `customer=1.5`, or an id outside the database range) → `400 validation_error`. An unknown `status`/`payment_status` string simply matches nothing.

Schedule board example: `GET orders/?status=confirmed,scheduled,out_for_delivery&delivery_date_from=2026-10-14&delivery_date_to=2026-10-20&ordering=delivery_date&page_size=100`, then group by `delivery_date` client-side.

### `GET orders/{id}/` → Order · `GET orders/{id}/timeline/` → array

Timeline, oldest first (the creation entry has `from_status: ""`):
```json
[ { "id": 167, "from_status": "", "from_status_display": "",
    "to_status": "pending", "to_status_display": "Pending",
    "changed_by": { "id": 8, "full_name": "Rosa Aquino", "role": "customer" },
    "remarks": "Order placed", "created_at": "2026-10-11T10:15:00+08:00" },
  { "id": 168, "from_status": "pending", "from_status_display": "Pending",
    "to_status": "confirmed", "to_status_display": "Confirmed",
    "changed_by": { "id": 3, "full_name": "Ana Villanueva", "role": "staff" },
    "remarks": "", "created_at": "2026-10-11T11:15:00+08:00" } ]
```
`changed_by` can be `null` if that account was later deleted.

### Order actions — all return the updated **Order** (`200`)

| Call | Roles | Body | Notes |
|---|---|---|---|
| `POST orders/{id}/cancel/` | customer (own) | `{ "remarks"?: string }` | only from `pending` |
| `POST orders/{id}/confirm/` | staff, admin | — | `pending → confirmed` |
| `POST orders/{id}/reject/` | staff, admin | `{ "remarks": string }` **required** | `pending → rejected`; the reason is shown to the customer |
| `POST orders/{id}/schedule/` | staff, admin | `{ "delivery_date": "YYYY-MM-DD", "rider"?: riderId, "remarks"?: string }` | `confirmed`/`failed` → `scheduled`, or reschedule a `scheduled` order. If `rider` is given it is assigned in the same call; if the rider cannot take it (off duty, inactive, or over the active-order limit) **nothing changes** (400, whole call rolled back). |
| `POST orders/{id}/assign-rider/` | staff, admin | `{ "rider": riderId }` | `riderId` = `RiderProfile.id` (from `deliveries/riders/`). Status must be `confirmed`/`scheduled`/`failed`. |
| `POST orders/{id}/update-status/` | staff, admin | `{ "status": "<status>", "remarks"?: string, "delivery_date"?: date }` | Generic staff change. Staff-allowed targets: `confirmed`, `rejected`, `scheduled`, `cancelled` (see table in §3.1). Rider-only targets (`out_for_delivery`, `delivered`, `failed`) → **403**. Impossible jumps → **400**. |

Example errors:
```json
// POST orders/43/confirm/ on a delivered order → 400
{ "detail": "An order that is 'delivered' cannot be changed to 'confirmed'.", "code": "validation_error",
  "errors": { "non_field_errors": ["An order that is 'delivered' cannot be changed to 'confirmed'."] } }
// staff POST orders/49/update-status/ {"status":"delivered"} → 403
{ "detail": "Your role (staff) cannot change an order to 'delivered'.", "code": "permission_denied", "errors": {} }
// assign an off-duty rider → 400
{ "detail": "Invalid input.", "code": "validation_error",
  "errors": { "rider": ["Rider is off duty and cannot be assigned orders."] } }
```

### `GET orders/dashboard/` — counters *(staff, admin)*

```json
{
  "date": "2026-10-14",
  "today_by_status": { "pending": 0, "confirmed": 0, "scheduled": 1, "out_for_delivery": 2,
                       "delivered": 0, "cancelled": 0, "rejected": 0, "failed": 0 },
  "today_total": 3,
  "pending_orders": 4,
  "pending_payments": 2,
  "needs_rider": 4,
  "cash_outstanding": "755.00",
  "available_riders": 1
}
```
`today_by_status` counts orders whose **`delivery_date` is today** (all 8 statuses always present). `pending_orders` = all orders awaiting confirmation; `pending_payments` = payments in `pending_verification`; `needs_rider` = `confirmed`/`scheduled`/`failed` orders with no rider; `cash_outstanding` = COD cash currently held by all riders, not yet handed in (money string, §9A); `available_riders` = active riders with status `available`.

---

## 8. Riders — `deliveries/riders/`

*Plain array, not paginated.* Staff/admin read; admin write.

Rider object:
```json
{ "id": 3, "user_id": 6, "username": "rider3", "full_name": "Ramon Castillo",
  "first_name": "Ramon", "last_name": "Castillo", "email": "rider3@deepwater.test",
  "contact_number": "09172220003", "is_active": true,
  "vehicle_type": "Tricycle", "status": "available",
  "created_at": "2026-10-14T03:28:50.527350+08:00" }
```
`id` is the **RiderProfile id** — the value used by `assign-rider/`, `schedule/` and the orders `?rider=` filter. `user_id` is the login account.

* `GET deliveries/riders/` *(staff, admin)* — filters `?status=available|on_delivery|off_duty`, `?is_active=true|false`, `?assignable=true|false`, `?search=`, `?ordering=` (`id`, `status`, `user__first_name`). **Use `?assignable=true` for the assignment picker**: active riders whose status is `available` **or** `on_delivery` (so riders on a trip can be given more orders). `assignable=false` returns the opposite (off duty or inactive).
* `GET deliveries/riders/{id}/` *(staff, admin)*
* `POST deliveries/riders/` *(admin)* — creates the **login account and profile together**. Body: `username`, `password`, `first_name`, `last_name`, `contact_number` (all required); `email`, `address`, `vehicle_type` (optional). `201` → Rider object.
* `PATCH`/`PUT deliveries/riders/{id}/` *(admin)* — body (all optional): `vehicle_type`, `status` (`available` or `off_duty` only; `on_delivery` is set automatically → 400; `off_duty` while the rider has orders out for delivery → 400), `is_active` (deactivates/reactivates the login). `200` → Rider object.
* `DELETE deliveries/riders/{id}/` *(admin)* — `204`; deletes the account and profile. `400` if the rider has delivery history (deactivate instead).

---

## 9. Rider deliveries — `deliveries/my/` *(rider only)*

Delivery object = the **Order object** (§7, riders' reduced view) plus:

| Extra field | |
|---|---|
| `amount_to_collect` | `"70.00"` for an unpaid COD order, otherwise `"0.00"` |
| `rider_status` | the rider's current status (`available`/`on_delivery`/`off_duty`) |

The inherited `delivery_latitude` / `delivery_longitude` are what the rider's map/route should use. Numbers when the customer pinned the location (as in the §7 sample); `null` when no pin was sent, as for the order above — then fall back to the text `delivery_address`.

```json
{ "id": 49,
  "customer": { "id": 9, "username": "customer3", "full_name": "Carlo Reyes", "role": "customer",
                "contact_number": "09173330003", "address": "Purok 1, Brgy. Lanao, Kidapawan City" },
  "rider": { "id": 1, "user_id": 4, "full_name": "Pedro Dizon", "contact_number": "09172220001",
             "vehicle_type": "Motorcycle", "status": "on_delivery" },
  "order_date": "2026-10-13T19:30:33.654560+08:00", "delivery_date": "2026-10-14",
  "delivery_address": "Purok 1, Brgy. Lanao, Kidapawan City",
  "delivery_latitude": null, "delivery_longitude": null, "notes": "",
  "total_amount": "70.00", "order_status": "out_for_delivery", "order_status_display": "Out for delivery",
  "items": [ { "id": 73, "service": 2, "service_name": "Slim 5-gal Refill", "quantity": 2, "unit_price": "30.00", "subtotal": "60.00" },
             { "id": 74, "service": 4, "service_name": "1-gal Refill", "quantity": 1, "unit_price": "10.00", "subtotal": "10.00" } ],
  "payment": { "id": 49, "order": 49, "payment_method": "cod", "payment_method_display": "Cash on delivery",
               "payment_status": "unpaid", "payment_status_display": "Unpaid", "amount": "70.00",
               "payment_date": null, "created_at": "2026-10-14T03:30:33.813303+08:00" },
  "allowed_transitions": ["delivered", "failed"], "can_assign_rider": false,
  "updated_at": "2026-10-14T03:30:33.810064+08:00",
  "amount_to_collect": "70.00", "rider_status": "on_delivery" }
```

* `GET deliveries/my/` — *paginated.* `?scope=`:
  * `active` *(default)* — `scheduled` + `out_for_delivery`, any date. Deliveries already on the road first, then by `delivery_date`.
  * `today` — active with `delivery_date` ≤ today (includes overdue ones).
  * `upcoming` — active with `delivery_date` > today.
  * `history` — `delivered` + `failed`, newest first.
  Any other value → 400. Use `page_size=100` for a one-page list.
**Several deliveries at once.** A rider may have many orders `out_for_delivery` together; `GET deliveries/my/` still lists the ones on the road first (then by date), and `rider_status` stays `on_delivery` until the **last** one is `delivered`/`failed`. Each order is finished separately with its own `delivered`/`failed` call (COD cash and the failure reason are required per order).

* `GET deliveries/my/{id}/` — `{id}` is the **order id**. Orders not assigned to you → 404.
* `POST deliveries/my/{id}/status/` — body:

  | Field | Type | Notes |
  |---|---|---|
  | `status` | `out_for_delivery` \| `delivered` \| `failed` | anything else → 400 |
  | `remarks` | string ≤500 | **required for `failed`** (the reason); optional otherwise |
  | `cod_collected` | boolean | **must be `true` to deliver a COD order**; ignored for online payments |

  `200` → updated Delivery. Business errors (all `400`): wrong current status (e.g. deliver before starting), rider `off_duty` when starting, missing reason, `cod_collected` not true. **Starting does not require the rider to be free**: any number of orders can be `out_for_delivery` at once; send one call per order, or use `start/` below.
  ```json
  { "detail": "Invalid input.", "code": "validation_error",
    "errors": { "cod_collected": ["Confirm that the cash on delivery was collected."] } }
  ```
  Buttons: show `allowed_transitions` (it is `["out_for_delivery"]`, then `["delivered","failed"]`).
* `POST deliveries/my/start/` — **start several orders in one call** (a multi-stop trip). Body `{ "orders": [49, 54, 61] }` (1–50 order ids; repeated ids are ignored). **All or nothing**, in one transaction: if any order is not assigned to you (this also covers ids that do not exist) or is not `scheduled`, the response is `400` naming that order and **nothing changes**:
  ```json
  { "detail": "Invalid input.", "code": "validation_error",
    "errors": { "orders": ["Order #54 cannot be started (it is 'failed'; only scheduled orders can)."] } }
  ```
  `"Order #61 is not assigned to you."` is the other message. An `off_duty` rider gets a `400` too. Success → `200` with a **plain array** of the updated Delivery objects (shape above, same fields as `deliveries/my/`), in the order you sent the ids. Each order gets one status-log row and one customer notification, exactly like the single-order `status/` call, and the rider becomes `on_delivery`. COD cash is still confirmed per order when each one is later marked `delivered` (`cod_collected: true`). Not a rider → `403`.
* `POST deliveries/my/availability/` — body `{ "status": "available" | "off_duty" }` → `200` Rider object. `400` while **any** order of theirs is out for delivery (to go off duty or to change status at all).

---

## 9A. Cash-on-delivery remittance — `deliveries/cash/`

Riders collect cash on COD orders. These endpoints track how much each rider is holding and record the hand-in to staff. **Every amount is computed by the server** from the payments; no endpoint accepts an amount.

**What counts as "cash held by a rider"** — a payment with all of:
`payment_method` = `cod` · `payment_status` = `paid` · marked paid by that rider (`verified_by` = the rider's user, which happens when the rider marks the order `delivered` with `cod_collected: true`) · **not yet part of a remittance**.

Orders that were delivered before this feature existed have no remittance, so they all show as held until staff remit them.

### `GET deliveries/cash/` — who holds how much *(staff, admin; plain array)*

One row per rider **currently holding cash** (riders with nothing held are left out), largest balance first. Optional `?rider=<RiderProfile id>` (a bad or out-of-range id → `400`; an unknown id → `[]`).

```json
[ { "rider": { "id": 3, "full_name": "Ramon Castillo", "vehicle_type": "Tricycle" },
    "orders_count": 4,
    "amount_held": "610.00",
    "oldest_collected_at": "2026-09-20T10:30:00+08:00",
    "orders": [ { "order_id": 34, "amount": "300.00", "collected_at": "2026-09-20T10:30:00+08:00" },
                { "order_id": 37, "amount": "110.00", "collected_at": "2026-09-28T10:30:00+08:00" } ] } ]
```
`orders` is oldest first; `collected_at` is when the rider marked the order paid; `oldest_collected_at` is the first of them.

### `POST deliveries/cash/remit/` — take cash in *(staff, admin)*

Body:

| Field | Type | Required | Notes |
|---|---|---|---|
| `rider` | RiderProfile id | yes | the rider handing in cash |
| `orders` | array of order ids | no | which held orders to take (1–500 ids; repeats ignored). **Omit it to remit everything the rider currently holds.** An empty array → `400`. |
| `remarks` | string ≤500 | no | e.g. `"End of day"` |

```json
{ "rider": 3, "orders": [34, 37], "remarks": "End of day" }
```
`201` → the remittance:
```json
{ "id": 1,
  "rider": { "id": 3, "full_name": "Ramon Castillo" },
  "amount": "410.00",
  "orders": [ { "order_id": 34, "amount": "300.00" }, { "order_id": 37, "amount": "110.00" } ],
  "received_by": { "id": 2, "full_name": "Jose Ramirez" },
  "received_at": "2026-10-14T22:35:09.059363+08:00",
  "remarks": "End of day" }
```
* `amount` is the sum of the selected payments. `received_by` is the signed-in user and `received_at` is the server time; anything sent for those (or for `amount`) is ignored.
* **All or nothing**, in one transaction. `400` with the problem order named under `errors.orders` if an order is not held by this rider or was already remitted, and **nothing changes**:
  ```json
  { "detail": "Invalid input.", "code": "validation_error",
    "errors": { "orders": ["Order #34 was already remitted (remittance #1)."] } }
  ```
  The other message is `"Order #61 is not cash held by this rider."` (also used for unknown ids, non-COD orders and other riders' orders).
* Nothing to remit (the rider holds no cash) → `400` with `detail: "This rider is not holding any cash to hand in."`. An unknown `rider` → `400` on `errors.rider`.
* The rider gets a notification (and an email): **"Cash handed in: PHP 410.00 confirmed."** (title `Cash handed in`).
* Riders and customers → `403`.

### `GET deliveries/cash/remittances/` — history *(staff, admin; paginated)*

Item shape = the remittance above. Filters: `rider` (RiderProfile id), `date_from`, `date_to` (`YYYY-MM-DD`, on `received_at`, inclusive). `ordering`: `received_at`, `amount`, `id` (prefix `-` for descending); default `-received_at`. `GET deliveries/cash/remittances/{id}/` returns one. Remittances are **read-only**: they cannot be edited or deleted (`PUT`/`PATCH`/`DELETE`/`POST` → `405`).

```json
{ "count": 1, "next": null, "previous": null,
  "results": [ { "id": 1, "rider": { "id": 3, "full_name": "Ramon Castillo" }, "amount": "410.00",
                 "orders": [ { "order_id": 34, "amount": "300.00" }, { "order_id": 37, "amount": "110.00" } ],
                 "received_by": { "id": 2, "full_name": "Jose Ramirez" },
                 "received_at": "2026-10-14T22:35:09.059363+08:00", "remarks": "End of day" } ] }
```

### `GET deliveries/my/cash/` — the rider's own balance *(rider only)*

```json
{ "amount_held": "200.00",
  "orders": [ { "order_id": 32, "amount": "75.00", "collected_at": "2026-09-16T10:30:00+08:00" },
              { "order_id": 35, "amount": "125.00", "collected_at": "2026-09-23T10:30:00+08:00" } ],
  "recent_remittances": [ { "id": 3, "amount": "300.00", "received_at": "2026-10-13T17:00:00+08:00",
                            "received_by": "Maria Santos" } ] }
```
Only the signed-in rider's own cash and hand-ins (the latest 10, newest first). `amount_held` is `"0.00"` and `orders` is `[]` when nothing is held. Staff, admin and customers → `403`.

### Where else cash shows up
* `orders/dashboard/` has **`cash_outstanding`** — the total held by all riders, as a money string (`"755.00"`).
* **Staff and admin** also see two fields on every payment object (inside an order and on `payments/`): `remittance` (the remittance id, or `null`) and `remitted_at` (when it was handed in, or `null`). Customers and riders **do not receive these fields at all**.
* `reports/cash/` (§12, admin) gives collected / handed in / still held per rider.

---

## 10. Payments — `payments/`

### Payment settings — the station's GCash QR

One shared record (never "not found": it exists, empty, from the start).

* `GET payments/settings/` *(any signed-in user — customers read it at checkout)* → `200`:
  ```json
  { "gcash_qr_image": "http://localhost:8000/media/payment_settings/bfb172024a6a49ce821a555f58f586a1.png",
    "gcash_account_name": "Deep Water Refilling",
    "gcash_number": "09171234567" }
  ```
  `gcash_qr_image` is an absolute URL or `null` (no QR uploaded); `gcash_account_name` and `gcash_number` are strings, `""` when unset. Show the QR, plus the name and number as a fallback when it cannot be scanned. Not signed in → `401`.
* `PATCH payments/settings/` *(admin only; staff, rider and customer get `403`)* — send **any** of the three fields; omitted fields are left alone. Use `multipart/form-data` when sending a file (JSON also works for text fields):

  | Field | Type | Notes |
  |---|---|---|
  | `gcash_qr_image` | file | A real image (JPEG, PNG or similar), max **5 MB** (same rules as proof images). The file name is replaced by a random one. Uploading **replaces** the old QR and deletes the old file. |
  | `gcash_qr_image` *(to remove)* | empty value | **Remove the QR** by sending the field **empty** in multipart (`form.append('gcash_qr_image', '')`), or `null` in a JSON body (`{ "gcash_qr_image": null }`). The stored file is deleted and the response has `gcash_qr_image: null`. |
  | `gcash_account_name` | string ≤100 | may be `""` |
  | `gcash_number` | string ≤20 | digits, spaces and `+ - ( )` only; may be `""` |

  `200` → the updated settings (same shape as `GET`). Errors use the usual shape; a bad file reports under `errors.gcash_qr_image`, and a failed upload leaves the current QR untouched:
  ```json
  { "detail": "Invalid input.", "code": "validation_error",
    "errors": { "gcash_qr_image": ["Image is too large (max 5 MB)."] } }
  ```
  Other messages: `"Upload a valid image. The file you uploaded was either not an image or a corrupted image."` (not an image), `"Use digits, spaces, + - ( ) only."` (bad number).
  ```ts
  const form = new FormData();
  form.append('gcash_qr_image', file);              // or '' to remove it
  form.append('gcash_account_name', 'Deep Water Refilling');
  api.patch('/payments/settings/', form);
  ```
  `POST`, `PUT` and `DELETE` on this URL → `405`.

### Payments

Payment object (with an order summary), as returned by every `payments/` endpoint:

```json
{ "id": 58, "order": 58,
  "payment_method": "gcash", "payment_method_display": "GCash",
  "payment_status": "pending_verification", "payment_status_display": "Pending verification",
  "reference_number": "GC7003562",
  "proof_image": "http://localhost:8000/media/payment_proofs/3f3948fe0bf54a248df6a45b22aa9ae2.png",
  "amount": "300.00", "payment_date": null, "verified_by": null, "remarks": "",
  "remittance": null, "remitted_at": null,
  "created_at": "2026-10-14T03:30:33.913050+08:00",
  "order_summary": { "id": 58, "customer_id": 8, "customer_name": "Rosa Aquino",
                     "order_status": "pending", "delivery_date": "2026-10-15", "total_amount": "300.00" } }
```
`payment.id` equals the order id in practice but always read it from `order.payment.id`.

* `GET payments/` — *paginated.* Customer: own. Staff/admin: all. Rider: always an empty page. Filters: `payment_status`, `payment_method`, `order` (order id), `date_from`/`date_to` (on `created_at`), `search` (reference no., customer name/username, order number), `ordering` (`created_at`, `amount`, `id`).
  **Verification queue:** `GET payments/?payment_status=pending_verification&ordering=created_at`.
* `GET payments/{id}/`
* `POST payments/{id}/upload-proof/` *(customer, own payment)* — **`multipart/form-data`**:

  | Field | Type | Notes |
  |---|---|---|
  | `proof_image` | file | required; must be a real image (JPEG/PNG/…), max **5 MB** |
  | `reference_number` | string ≤100 | required |

  Allowed only when: method is not `cod`; status is `unpaid` or `rejected` (re-upload after a rejection replaces the old file and clears the rejection note); the order is not `cancelled`/`rejected`. Result → `payment_status: "pending_verification"`, staff are notified. `200` → Payment. Errors `400`: missing/invalid/oversized image, COD payment, already pending/paid, closed order. Other customers' payments → 404.
  ```ts
  const form = new FormData();
  form.append('proof_image', file);
  form.append('reference_number', 'GC1234567');
  api.post(`/payments/${paymentId}/upload-proof/`, form); // let the browser set the multipart boundary
  ```
* `POST payments/{id}/verify/` *(staff, admin)* — no body. Only from `pending_verification` → `paid` (`verified_by`, `payment_date` set; customer notified). `400` otherwise, or if the order is `cancelled`/`rejected`.
* `POST payments/{id}/reject/` *(staff, admin)* — body `{ "remarks": "Amount does not match" }` (**required**, ≤500). Only from `pending_verification` → `rejected`; the customer is notified with the reason and can upload again.

---

## 11. Notifications — `notifications/` *(any signed-in user; always own only)*

Notification object:
```json
{ "id": 83, "title": "Order confirmed", "message": "Your order #57 has been confirmed.",
  "order": 57, "is_read": false, "created_at": "2026-10-14T03:30:33.901034+08:00" }
```
`order` is the related order id or `null`.

* `GET notifications/` — *paginated*, newest first. Filters: `is_read=true|false`, `order=<id>`.
* `GET notifications/unread-count/` → `{ "count": 3 }` (poll this for the bell, every 15 s)
* `POST notifications/{id}/mark-read/` → the notification with `is_read: true`
* `POST notifications/mark-all-read/` → `{ "marked": 2 }`

Staff/admin also receive in-app notifications for new orders, uploaded payment proofs, customer cancellations and failed deliveries. Customers and riders additionally get an email (console in dev).

---

## 12. Reports — `reports/` *(admin only)*

| URL | Rows | Counted orders |
|---|---|---|
| `reports/sales/daily/` | one per **day** in range (zero days included, max 366 days) | `delivered` |
| `reports/sales/monthly/` | one per **month** in range (zero months included) | `delivered` |
| `reports/orders-by-status/` | one per status (all 8, zeros included) | all |
| `reports/deliveries-per-rider/` | one per rider | assigned orders in `scheduled`/`out_for_delivery`/`delivered`/`failed` |
| `reports/top-services/` | services ranked by quantity (`?limit=N`, 1–50, default 10) | `delivered` |
| `reports/cash/` | one per rider (all riders, zeros included) | paid COD payments collected by the rider (see below) |

**All reports except `cash` filter on the order's `delivery_date`.**

Query: `date_from`, `date_to` (`YYYY-MM-DD`, inclusive); defaults: last 30 days (monthly: from the first day of the month 11 months ago). `from > to` or a range over the limit → 400. `format=json` *(default)* | `pdf` | `xlsx`; anything else → 400.

JSON response (same envelope for every report — render `columns` generically, `type` is `text` | `number` | `money`):
```json
{
  "report": "sales_daily", "title": "Daily Sales",
  "note": "Counts delivered orders only, by delivery date.",
  "date_from": "2026-10-12", "date_to": "2026-10-14", "generated_at": "2026-10-14 03:30",
  "columns": [ { "key": "period", "label": "Date", "type": "text" },
               { "key": "orders", "label": "Orders", "type": "number" },
               { "key": "total_sales", "label": "Total sales (PHP)", "type": "money" } ],
  "rows": [ { "period": "2026-10-12", "orders": 0, "total_sales": "0.00" },
            { "period": "2026-10-13", "orders": 1, "total_sales": "125.00" },
            { "period": "2026-10-14", "orders": 0, "total_sales": "0.00" } ],
  "totals": { "orders": 1, "total_sales": "125.00" }
}
```
`sales/monthly/` rows use `period: "2026-10"`. Row keys per report:

| Report | Row keys | `totals` keys |
|---|---|---|
| `sales_daily`, `sales_monthly` | `period`, `orders`, `total_sales` | `orders`, `total_sales` |
| `orders_by_status` | `status`, `label`, `orders`, `total_amount` | `orders`, `total_amount` |
| `deliveries_per_rider` | `rider_id`, `rider`, `vehicle_type`, `assigned`, `delivered`, `failed`, `in_progress`, `delivered_value` | same names (`assigned`, `delivered`, `failed`, `in_progress`, `delivered_value`) |
| `top_services` | `rank`, `service_id`, `service`, `quantity`, `orders`, `revenue` | `quantity`, `revenue` |
| `cash` | `rider_id`, `rider`, `collected`, `remitted`, `outstanding` | `collected`, `remitted`, `outstanding` |

**`cash` report:** `collected` = COD cash the rider collected **in the date range** (by the time it was marked paid); `remitted` = cash handed in **during the range** (by `received_at`); `outstanding` = what the rider holds **right now**, regardless of the range (so it need not equal collected − remitted). Money strings; unlike the other reports this one filters on collection/hand-in time, not delivery date.

Money fields are strings. Chart example: `rows.map(r => ({ x: r.period, y: Number(r.total_sales) }))`.

**Export:** `GET reports/sales/daily/?format=pdf&date_from=…&date_to=…` returns the file (`application/pdf`, or `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` for `xlsx`) with `Content-Disposition: attachment; filename="sales_daily_2026-09-15_to_2026-10-14.pdf"`. Because it needs the `Authorization` header, download it with Axios and save the blob — a plain link will get a 401:
```ts
const res = await api.get(url, { params: { format: 'pdf', date_from, date_to }, responseType: 'blob' });
const link = document.createElement('a');
link.href = URL.createObjectURL(res.data);
link.download = 'sales_daily.pdf';
link.click();
```
(On an error with `responseType: 'blob'` the JSON error body arrives as a Blob; parse it with `await err.response.data.text()`.)

---

## 13. Backups — `backups/` *(admin only)*

* `GET backups/` — plain array, newest first:
  ```json
  [ { "filename": "backup_20261014_033156.sqlite3", "size": 249856,
      "created_at": "2026-10-13T19:31:56.140109Z", "engine": "sqlite" } ]
  ```
  `size` is in bytes; `engine` is `sqlite` or `postgres` (`.dump` files).
* `POST backups/` — no body. Takes a backup now. `201` → one entry as above. `503 backup_failed` when it cannot run (database busy; `pg_dump` not installed on a PostgreSQL deployment).
* `GET backups/{filename}/download/` — streams the file as an attachment (use `responseType: 'blob'` as for report exports). An unknown but well-formed name → `404`; a malformed name → `400`.

### Health check — `GET health/` *(Public)*

For deployments: can the API reach its database, and is it fully migrated?

```json
{ "status": "ok", "database": "postgresql" }
```
`200` when everything is fine. Otherwise `503` with what is wrong (never a host, user or password):

| Body | Meaning |
|---|---|
| `{ "status": "error", "database": "postgresql", "error": "OperationalError" }` | the database cannot be reached (wrong host/credentials). `error` is only the exception class. |
| `{ "status": "migrations_pending", "database": "postgresql", "pending_migrations": 3 }` | connected, but `migrate` has not been run |
| `"database": "sqlite"` | the database settings were **not picked up** and the server fell back to the development database |

Browsers can read a download's real file name: `Content-Disposition` is exposed through CORS, so `res.headers['content-disposition']` works for report and backup downloads.

There is **no restore endpoint on purpose**: restoring replaces the whole database and is a server-side step (`python manage.py restore_db <file>`, with the server stopped).

---

## 14. Which call for which screen

| Screen | Calls |
|---|---|
| Login → redirect | `POST auth/token/` → read `user.role` (or the JWT claim) |
| Register | `POST auth/register/` → then `POST auth/token/` |
| Profile | `GET/PATCH auth/me/`, `POST auth/change-password/` |
| Services catalog + cart | `GET catalog/services/` |
| Checkout | `GET payments/settings/` (show the GCash QR + name + number) → `POST orders/` → (GCash only) `POST payments/{order.payment.id}/upload-proof/` |
| My orders / detail / tracking | `GET orders/`, `GET orders/{id}/`, `GET orders/{id}/timeline/`, `POST orders/{id}/cancel/` (poll every 15 s) |
| Notification bell | `GET notifications/unread-count/` (poll), `GET notifications/`, `POST …/mark-read/`, `POST …/mark-all-read/` |
| Staff dashboard | `GET orders/dashboard/` |
| Orders table + filters | `GET orders/?status=&search=&date_from=&…` |
| Order detail + actions | `GET orders/{id}/` → buttons from `allowed_transitions` / `can_assign_rider`; `confirm/`, `reject/`, `schedule/`, `assign-rider/` with riders from `GET deliveries/riders/?assignable=true` |
| Delivery schedule board | `GET orders/?status=confirmed,scheduled,out_for_delivery&delivery_date_from=…&delivery_date_to=…&ordering=delivery_date&page_size=100` |
| Payment verification queue | `GET payments/?payment_status=pending_verification`, `POST payments/{id}/verify/` · `reject/` |
| Admin: users / riders / services | `auth/users/`, `deliveries/riders/`, `catalog/services/` |
| Admin: GCash QR settings | `GET`/`PATCH payments/settings/` |
| Admin: reports / backup | `reports/…`, `backups/` |
| Staff/admin: Cash page | `GET deliveries/cash/` (who holds how much), `POST deliveries/cash/remit/` (one-tap hand-in, omit `orders` to take everything), `GET deliveries/cash/remittances/` (history); the dashboard figure is `orders/dashboard/` → `cash_outstanding` |
| Rider: "Cash on hand" card | `GET deliveries/my/cash/` |
| Rider: today's list → detail → buttons | `GET deliveries/my/?scope=today`, `GET deliveries/my/{id}/`, `POST deliveries/my/{id}/status/`, `POST deliveries/my/start/`, `POST deliveries/my/availability/` |

---

## 15. Demo accounts (after `python manage.py seed_demo`)

Password for all: **`Demo@12345`**

| Role | Usernames |
|---|---|
| admin | `admin` |
| staff | `staff1`, `staff2` |
| rider | `rider1`, `rider2`, `rider3` |
| customer | `customer1` … `customer5` |

The seed creates 30 orders over the last 30 days covering every status, two deliveries currently `out_for_delivery`, payments waiting for verification, and unread notifications. Each customer has a saved home location, and 25 of the 30 orders carry a pin near that home (about one in six has `null` coordinates on purpose, to exercise the no-pin case). The GCash settings are pre-filled with a demo account name (`Deep Water Refilling`), the demo number `09171234567` and a placeholder QR image that is clearly labelled *DEMO - NOT A REAL QR CODE* (the seed only fills them while the admin has not entered their own). There are **no** bank-transfer orders in the demo data: online orders are all GCash. Cash: paid, not-yet-remitted COD orders exist for **two riders** (`rider1` and `rider2`, two orders each), and the cash from deliveries older than 10 days was already handed in (a few remittances in the history), so every cash screen has data. Locations are approximate points around Kidapawan City (roughly lat 6.99–7.03, lon 125.07–125.10), not exact addresses.
