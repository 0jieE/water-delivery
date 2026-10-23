"""Colours for the status badges shown in the admin tables and on the dashboard.

Unfold understands: primary, info, success, warning, danger; anything else is grey.
"""

ORDER_STATUS_COLORS = {
    "pending": "warning",
    "confirmed": "info",
    "scheduled": "info",
    "out_for_delivery": "primary",
    "delivered": "success",
    "rejected": "danger",
    "failed": "danger",
    "cancelled": "base",
}
PAYMENT_STATUS_COLORS = {
    "unpaid": "base",
    "pending_verification": "warning",
    "paid": "success",
    "rejected": "danger",
}
RIDER_STATUS_COLORS = {"available": "success", "on_delivery": "primary", "off_duty": "base"}
ROLE_COLORS = {"admin": "danger", "staff": "info", "rider": "warning", "customer": "base"}
