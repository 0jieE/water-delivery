"""Demo data: 1 admin, 2 staff, 3 riders, 5 customers, the services and 30 orders over the last 30 days."""
import datetime
import io
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone
from PIL import Image, ImageDraw

from apps.catalog.models import WaterRefillService
from apps.deliveries import cash
from apps.deliveries.models import CashRemittance, RiderProfile
from apps.notifications.models import Notification
from apps.notifications.services import notify
from apps.orders.models import Order, OrderDetail, OrderStatusLog
from apps.payments.models import Payment, PaymentSettings

User = get_user_model()
PASSWORD = "Demo@12345"

S = Order.Status
P = Payment.Status

ADMIN = ("admin", "Maria", "Santos", "09171110001", "Poblacion, Kidapawan City")
STAFF = [
    ("staff1", "Jose", "Ramirez", "09171110002", "Poblacion, Kidapawan City"),
    ("staff2", "Ana", "Villanueva", "09171110003", "Poblacion, Kidapawan City"),
]
RIDERS = [
    ("rider1", "Pedro", "Dizon", "09172220001", "Brgy. Sudapin, Kidapawan City", "Motorcycle"),
    ("rider2", "Luis", "Mercado", "09172220002", "Brgy. Lanao, Kidapawan City", "Motorcycle"),
    ("rider3", "Ramon", "Castillo", "09172220003", "Brgy. Singao, Kidapawan City", "Tricycle"),
]
CUSTOMERS = [
    ("customer1", "Juan", "Dela Cruz", "09173330001", "Purok 3, Brgy. Poblacion, Kidapawan City"),
    ("customer2", "Rosa", "Aquino", "09173330002", "Purok 5, Brgy. Sudapin, Kidapawan City"),
    ("customer3", "Carlo", "Reyes", "09173330003", "Purok 1, Brgy. Lanao, Kidapawan City"),
    ("customer4", "Liza", "Bautista", "09173330004", "Purok 7, Brgy. Amas, Kidapawan City"),
    ("customer5", "Mark", "Flores", "09173330005", "Purok 2, Brgy. Singao, Kidapawan City"),
]
SERVICES = [
    ("Round 5-gal Refill", "Refill of your own round 5-gallon container.", "25.00"),
    ("Slim 5-gal Refill", "Refill of your own slim 5-gallon container.", "30.00"),
    ("New Container + Refill", "Brand-new 5-gallon container with its first refill.", "250.00"),
    ("1-gal Refill", "Refill of a 1-gallon container.", "10.00"),
]

# Saved home locations, approximate points in the matching Kidapawan City barangays
# (good enough to draw believable pins on a map; not survey-accurate).
HOME_LOCATIONS = {
    "customer1": ("7.008300", "125.089400"),  # Poblacion (city centre)
    "customer2": ("7.017200", "125.096100"),  # Sudapin
    "customer3": ("7.028600", "125.081300"),  # Lanao
    "customer4": ("7.010400", "125.075200"),  # Amas
    "customer5": ("6.998700", "125.101800"),  # Singao
}
REMITTED_BEFORE_DAYS = 10  # COD cash from deliveries older than this was already handed in
NO_PIN_EVERY = 6  # every 6th order has no pin, like an order from an older client

# (final status, delivery day offset from today, payment method, customer #, rider #, payment status)
ORDERS = [
    (S.DELIVERED, -28, "cod", 0, 0, P.PAID),
    (S.DELIVERED, -26, "gcash", 1, 1, P.PAID),
    (S.DELIVERED, -24, "cod", 2, 2, P.PAID),
    (S.DELIVERED, -21, "cod", 3, 0, P.PAID),
    (S.DELIVERED, -19, "gcash", 4, 1, P.PAID),
    (S.DELIVERED, -16, "cod", 0, 2, P.PAID),
    (S.DELIVERED, -13, "gcash", 1, 0, P.PAID),
    (S.DELIVERED, -10, "cod", 2, 1, P.PAID),
    (S.DELIVERED, -7, "cod", 3, 2, P.PAID),
    (S.DELIVERED, -5, "cod", 4, 1, P.PAID),
    (S.DELIVERED, -3, "cod", 0, 1, P.PAID),
    (S.DELIVERED, -1, "cod", 1, 2, P.PAID),
    (S.FAILED, -9, "cod", 2, 0, P.UNPAID),
    (S.FAILED, -2, "gcash", 3, 1, P.PAID),
    (S.CANCELLED, -12, "cod", 4, None, P.UNPAID),
    (S.CANCELLED, -6, "gcash", 0, None, P.UNPAID),
    (S.REJECTED, -15, "gcash", 1, None, P.UNPAID),
    (S.OUT_FOR_DELIVERY, 0, "cod", 2, 0, P.UNPAID),
    (S.OUT_FOR_DELIVERY, 0, "gcash", 3, 1, P.PAID),
    (S.SCHEDULED, 0, "cod", 4, 2, P.UNPAID),
    (S.SCHEDULED, 1, "gcash", 0, 2, P.PAID),
    (S.SCHEDULED, 1, "cod", 1, None, P.UNPAID),  # scheduled but still needs a rider
    (S.SCHEDULED, 2, "gcash", 2, 0, P.PAID),
    (S.CONFIRMED, 1, "gcash", 3, None, P.PENDING_VERIFICATION),
    (S.CONFIRMED, 2, "cod", 4, None, P.UNPAID),
    (S.CONFIRMED, 3, "gcash", 0, None, P.PAID),
    (S.PENDING, 1, "gcash", 1, None, P.PENDING_VERIFICATION),
    (S.PENDING, 1, "cod", 2, None, P.UNPAID),
    (S.PENDING, 2, "gcash", 3, None, P.REJECTED),
    (S.PENDING, 4, "gcash", 4, None, P.UNPAID),
]

# line items cycle through these so totals vary: [(service index, quantity), ...]
BASKETS = [
    [(0, 3)],
    [(1, 2), (3, 1)],
    [(2, 1), (0, 2)],
    [(0, 5)],
    [(1, 4)],
    [(0, 2), (1, 2)],
    [(2, 2)],
    [(3, 3), (0, 1)],
]


def _pin(customer, index):
    """A delivery pin near the customer's home (small deterministic offset), or (None, None)."""
    if customer.latitude is None or index % NO_PIN_EVERY == NO_PIN_EVERY - 1:
        return None, None
    step = Decimal("0.0005")
    lat = customer.latitude + step * ((index * 37) % 9 - 4)
    lon = customer.longitude + step * ((index * 53) % 9 - 4)
    return lat.quantize(Decimal("0.000001")), lon.quantize(Decimal("0.000001"))


def _placeholder_qr():
    """A QR-looking picture that is clearly a demo (it does not encode anything)."""
    cells, size = 25, 12
    image = Image.new("RGB", (cells * size + 2 * size, cells * size + 5 * size), "white")
    draw = ImageDraw.Draw(image)
    state = 12345
    for row in range(cells):
        for col in range(cells):
            state = (state * 1103515245 + 12345) % 2**31  # tiny deterministic generator
            in_corner = (row < 8 or row >= cells - 8) and (col < 8 or col >= cells - 8) and not (
                row >= cells - 8 and col >= cells - 8
            )
            if not in_corner and state % 3 == 0:
                x, y = size + col * size, size + row * size
                draw.rectangle([x, y, x + size - 1, y + size - 1], fill="black")
    for row, col in ((0, 0), (0, cells - 7), (cells - 7, 0)):  # the three finder squares
        x, y = size + col * size, size + row * size
        draw.rectangle([x, y, x + 7 * size - 1, y + 7 * size - 1], fill="black")
        draw.rectangle([x + size, y + size, x + 6 * size - 1, y + 6 * size - 1], fill="white")
        draw.rectangle([x + 2 * size, y + 2 * size, x + 5 * size - 1, y + 5 * size - 1], fill="black")
    draw.text((size, cells * size + 2 * size), "DEMO - NOT A REAL QR CODE", fill="#b91c1c")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _at(day, hour, minute=0):
    """Aware datetime on a local calendar day."""
    return timezone.make_aware(datetime.datetime.combine(day, datetime.time(hour, minute)))


def _proof_image(label, reference, amount):
    image = Image.new("RGB", (360, 480), "#f0f9ff")
    draw = ImageDraw.Draw(image)
    draw.rectangle([0, 0, 360, 70], fill="#0369a1")
    draw.text((20, 25), f"{label} - DEMO RECEIPT", fill="white")
    draw.text((20, 110), "Payment sent", fill="#0f172a")
    draw.text((20, 150), f"Amount: PHP {amount}", fill="#0f172a")
    draw.text((20, 190), f"Reference: {reference}", fill="#0f172a")
    draw.text((20, 260), "Deep Water Refilling Station", fill="#475569")
    draw.text((20, 440), "Sample image generated by seed_demo", fill="#94a3b8")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


class Command(BaseCommand):
    help = "Create demo accounts, services and ~30 orders (use --reset to rebuild the orders)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete all existing orders/notifications, reset demo passwords, and rebuild the demo orders",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        reset = options["reset"]
        if reset:
            self._wipe_orders()

        users = self._users(reset)
        services = self._services()
        self._payment_settings()
        if Order.objects.exists():
            self.stdout.write(
                "Orders already exist - skipping order generation (run with --reset to rebuild them)."
            )
            self._backfill_pins()
        else:
            self._orders(users, services)
        self._summary()

    # ------------------------------------------------------------------ users / services

    def _user(self, reset, username, role, first, last, phone, address, **extra):
        user, created = User.objects.get_or_create(
            username=username,
            defaults={
                "role": role,
                "first_name": first,
                "last_name": last,
                "email": f"{username}@deepwater.test",
                "contact_number": phone,
                "address": address,
                **extra,
            },
        )
        if created or reset:
            user.set_password(PASSWORD)
            user.is_active = True
            user.save()
        self.stdout.write(f"  {role:<8} {username:<10} {'created' if created else 'exists'}")
        return user, created or reset

    def _users(self, reset):
        users = {"staff": [], "riders": [], "customers": []}
        self.stdout.write("Accounts:")
        username, first, last, phone, address = ADMIN
        users["admin"], _ = self._user(
            reset, username, "admin", first, last, phone, address, is_staff=True, is_superuser=True
        )
        for username, first, last, phone, address in STAFF:
            users["staff"].append(self._user(reset, username, "staff", first, last, phone, address)[0])
        for username, first, last, phone, address, vehicle in RIDERS:
            user, _ = self._user(reset, username, "rider", first, last, phone, address)
            profile = user.rider_profile  # created automatically for role=rider
            profile.vehicle_type = profile.vehicle_type or vehicle
            profile.save(update_fields=["vehicle_type"])
            users["riders"].append(user)
        for username, first, last, phone, address in CUSTOMERS:
            user, _ = self._user(reset, username, "customer", first, last, phone, address)
            if user.latitude is None:  # also fills in accounts seeded before locations existed
                user.latitude, user.longitude = (Decimal(v) for v in HOME_LOCATIONS[username])
                user.save(update_fields=["latitude", "longitude"])
            users["customers"].append(user)
        return users

    def _backfill_pins(self):
        """Give pins to demo orders seeded before coordinates existed (never touches real orders)."""
        if Order.objects.filter(delivery_latitude__isnull=False).exists():
            return
        stale = Order.objects.filter(customer__username__in=HOME_LOCATIONS).select_related("customer")
        for index, order in enumerate(stale.order_by("id")):
            lat, lon = _pin(order.customer, index)
            if lat is not None:
                Order.objects.filter(pk=order.pk).update(delivery_latitude=lat, delivery_longitude=lon)

    def _services(self):
        services = []
        for name, description, price in SERVICES:
            service, _ = WaterRefillService.objects.get_or_create(
                service_name=name, defaults={"description": description, "price": Decimal(price)}
            )
            services.append(service)
        return services

    def _payment_settings(self):
        """Demo GCash details, only while the admin has not entered their own."""
        row = PaymentSettings.load()
        if row.gcash_qr_image or row.gcash_account_name or row.gcash_number:
            return
        row.gcash_account_name = "Deep Water Refilling"
        row.gcash_number = "09171234567"
        row.gcash_qr_image.save("demo_qr.png", ContentFile(_placeholder_qr()), save=False)
        row.save()

    def _wipe_orders(self):
        for payment in Payment.objects.exclude(proof_image=""):
            payment.proof_image.delete(save=False)
        Notification.objects.all().delete()
        Order.objects.all().delete()  # removes the payments, which frees the remittances
        CashRemittance.objects.all().delete()
        RiderProfile.objects.update(status=RiderProfile.Status.AVAILABLE)

    # ------------------------------------------------------------------ orders

    def _orders(self, users, services):
        today = timezone.localdate()
        now = timezone.now()
        staff, riders, customers = users["staff"], users["riders"], users["customers"]
        busy_riders = set()

        for index, (status, offset, method, c_idx, r_idx, pay_status) in enumerate(ORDERS):
            customer = customers[c_idx]
            rider_user = riders[r_idx] if r_idx is not None else None
            actor = staff[index % len(staff)]
            delivery_date = today + datetime.timedelta(days=offset)

            if offset <= 0:  # already due: placed the day before, so it precedes the 09:00 pickup
                placed = _at(delivery_date - datetime.timedelta(days=1 + index % 2), 8 + index % 9, 15)
            else:
                placed = now - datetime.timedelta(hours=3 + (index * 5) % 40)

            lat, lon = _pin(customer, index)
            order = Order.objects.create(
                customer=customer,
                rider=rider_user.rider_profile if rider_user else None,
                order_date=placed,
                delivery_date=delivery_date,
                delivery_address=customer.address,
                delivery_latitude=lat,
                delivery_longitude=lon,
                notes="Please call when you arrive." if index % 4 == 0 else "",
                order_status=status,
            )
            total = Decimal("0.00")
            for service_index, quantity in BASKETS[index % len(BASKETS)]:
                service = services[service_index]
                subtotal = service.price * quantity
                OrderDetail.objects.create(
                    order=order,
                    service=service,
                    quantity=quantity,
                    unit_price=service.price,
                    subtotal=subtotal,
                )
                total += subtotal
            order.total_amount = total
            order.save()

            self._logs(order, status, placed, delivery_date, customer, actor, rider_user)
            self._payment(order, method, pay_status, total, placed, actor, rider_user, index)
            self._notifications(order, status, customer, staff, rider_user, delivery_date)

            if status == S.OUT_FOR_DELIVERY:
                busy_riders.add(order.rider_id)
        RiderProfile.objects.filter(pk__in=busy_riders).update(status=RiderProfile.Status.ON_DELIVERY)
        self._remittances(staff, today)

    def _remittances(self, staff, today):
        """Riders handed in the cash of deliveries up to 10 days old; newer COD cash is still held."""
        cutoff = today - datetime.timedelta(days=REMITTED_BEFORE_DAYS)
        now = timezone.now()
        by_rider = {}
        for payment in (
            Payment.objects.filter(
                payment_method="cod",
                payment_status=P.PAID,
                remittance__isnull=True,
                order__delivery_date__lte=cutoff,
            )
            .select_related("order", "verified_by__rider_profile")
            .order_by("order__delivery_date", "id")
        ):
            by_rider.setdefault(payment.verified_by.rider_profile, []).append(payment)
        for number, (rider, payments) in enumerate(by_rider.items()):
            last_day = max(p.order.delivery_date for p in payments)
            remittance = CashRemittance.objects.create(
                rider=rider,
                amount=sum((p.amount for p in payments), Decimal("0.00")),
                received_by=staff[number % len(staff)],
                remarks="Hand-in of collected cash",
            )
            # backdate: handed in the evening after the last delivery
            when = min(_at(last_day + datetime.timedelta(days=1), 17, 0), now)
            CashRemittance.objects.filter(pk=remittance.pk).update(received_at=when)
            Payment.objects.filter(pk__in=[p.pk for p in payments]).update(remittance=remittance)

    def _logs(self, order, status, placed, delivery_date, customer, staff, rider):
        confirmed_at = placed + datetime.timedelta(hours=1)
        scheduled_at = placed + datetime.timedelta(hours=2)
        started_at = _at(delivery_date, 9, 0)
        finished_at = _at(delivery_date, 10, 30)
        confirm = (S.CONFIRMED, staff, "", confirmed_at)
        schedule = (S.SCHEDULED, staff, "", scheduled_at)
        start = (S.OUT_FOR_DELIVERY, rider, "", started_at)
        path = {
            S.PENDING: [],
            S.CONFIRMED: [confirm],
            S.SCHEDULED: [confirm, schedule],
            S.OUT_FOR_DELIVERY: [confirm, schedule, start],
            S.DELIVERED: [confirm, schedule, start, (S.DELIVERED, rider, "", finished_at)],
            S.FAILED: [confirm, schedule, start, (S.FAILED, rider, "Customer was not home.", finished_at)],
            S.CANCELLED: [(S.CANCELLED, customer, "Changed my mind.", confirmed_at)],
            S.REJECTED: [(S.REJECTED, staff, "Address is outside our delivery area.", confirmed_at)],
        }[status]

        rows, previous = [("", S.PENDING, customer, "Order placed", placed)], S.PENDING
        for to_status, who, remarks, when in path:
            rows.append((previous, to_status, who, remarks, when))
            previous = to_status
        now = timezone.now()
        for from_status, to_status, who, remarks, when in rows:
            when = min(when, now)
            log = OrderStatusLog.objects.create(
                order=order, from_status=from_status, to_status=to_status, changed_by=who, remarks=remarks
            )
            OrderStatusLog.objects.filter(pk=log.pk).update(created_at=when)

    def _payment(self, order, method, pay_status, total, placed, staff, rider, index):
        payment = Payment(order=order, payment_method=method, payment_status=pay_status, amount=total)
        if method != "cod" and pay_status in (P.PAID, P.PENDING_VERIFICATION, P.REJECTED):
            label = "GCASH"
            payment.reference_number = f"GC{7000000 + index * 137:07d}"
            payment.proof_image.save(
                f"demo_{order.pk}.png",
                ContentFile(_proof_image(label, payment.reference_number, total)),
                save=False,
            )
        if pay_status == P.PAID:
            if method == "cod":
                payment.payment_date = _at(order.delivery_date, 10, 30)
                payment.verified_by = rider
            else:
                payment.payment_date = placed + datetime.timedelta(hours=2)
                payment.verified_by = staff
        elif pay_status == P.REJECTED:
            payment.verified_by = staff
            payment.remarks = "The reference number does not match the receipt."
        payment.save()

    def _notifications(self, order, status, customer, staff, rider, delivery_date):
        titles = {
            S.CONFIRMED: ("Order confirmed", f"Your order #{order.pk} has been confirmed."),
            S.SCHEDULED: (
                "Delivery scheduled",
                f"Your order #{order.pk} is scheduled for delivery on {delivery_date:%B %d, %Y}.",
            ),
            S.OUT_FOR_DELIVERY: ("Out for delivery", f"Your order #{order.pk} is on its way."),
            S.DELIVERED: ("Order delivered", f"Your order #{order.pk} has been delivered. Thank you!"),
            S.FAILED: ("Delivery failed", f"We could not deliver order #{order.pk}. Customer was not home."),
            S.CANCELLED: ("Order cancelled", f"Your order #{order.pk} was cancelled."),
            S.REJECTED: ("Order rejected", f"Sorry, your order #{order.pk} was rejected."),
        }
        recent = delivery_date >= timezone.localdate() - datetime.timedelta(days=3)
        if status in titles:
            note = notify(customer, *titles[status], order=order, email=False)
            note.is_read = not recent
            note.save(update_fields=["is_read"])
        if status == S.PENDING:
            for user in staff:
                notify(user, "New order", f"Order #{order.pk} from {customer.full_name} is waiting.", order=order, email=False)
        if rider and status in (S.SCHEDULED, S.OUT_FOR_DELIVERY):
            notify(
                rider,
                "New delivery assigned",
                f"Order #{order.pk} is assigned to you for {delivery_date:%B %d, %Y}.",
                order=order,
                email=False,
            )

    # ------------------------------------------------------------------ output

    def _summary(self):
        counts = {value: Order.objects.filter(order_status=value).count() for value, _ in Order.Status.choices}
        self.stdout.write(self.style.SUCCESS("\nDemo data ready."))
        held = ", ".join(
            f"{g['name']} PHP {cash.money(cash.total_held(g['payments']))}" for g in cash.held_by_rider()
        )
        self.stdout.write(f"COD cash still held by riders: {held or 'none'}")
        self.stdout.write("Orders by status: " + ", ".join(f"{k}={v}" for k, v in counts.items() if v))
        self.stdout.write(f"\nDemo logins (password for every account: {PASSWORD})")
        self.stdout.write(f"  {'role':<9}{'username'}")
        for username, *_ in [ADMIN]:
            self.stdout.write(f"  {'admin':<9}{username}")
        for username, *_ in STAFF:
            self.stdout.write(f"  {'staff':<9}{username}")
        for username, *_ in RIDERS:
            self.stdout.write(f"  {'rider':<9}{username}")
        for username, *_ in CUSTOMERS:
            self.stdout.write(f"  {'customer':<9}{username}")
        self.stdout.write(
            "Existing accounts keep their current password unless you run with --reset."
        )
