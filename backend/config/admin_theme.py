"""Look and navigation of the Django admin site (django-unfold)."""
from django.urls import reverse_lazy

# Tailwind "sky": the same water-blue family the frontend uses.
WATER_BLUE = {
    "50": "oklch(97.7% .013 236.62)",
    "100": "oklch(95.1% .026 236.824)",
    "200": "oklch(90.1% .058 230.902)",
    "300": "oklch(82.8% .111 230.318)",
    "400": "oklch(74.6% .16 232.661)",
    "500": "oklch(68.5% .169 237.323)",
    "600": "oklch(58.8% .158 241.966)",
    "700": "oklch(50% .134 242.749)",
    "800": "oklch(44.3% .11 240.79)",
    "900": "oklch(39.1% .09 240.876)",
    "950": "oklch(29.3% .066 243.157)",
}


def _link(model_page):
    return reverse_lazy(f"admin:{model_page}")


def build_unfold(frontend_url=None):
    return {
        "SITE_TITLE": "Deep Water Admin",
        "SITE_HEADER": "Deep Water Refilling",
        "SITE_SUBHEADER": "Kidapawan City",
        "SITE_SYMBOL": "water_drop",
        "SITE_URL": frontend_url or "/admin/",
        "SHOW_VIEW_ON_SITE": bool(frontend_url),  # "View site" opens the web app when its address is known
        "SITE_FAVICONS": [
            {"rel": "icon", "sizes": "32x32", "type": "image/svg+xml", "href": "/static/favicon.svg"},
        ],
        "ENVIRONMENT": "apps.core.dashboard.environment_callback",
        "DASHBOARD_CALLBACK": "apps.core.dashboard.dashboard_callback",
        "COLORS": {"primary": WATER_BLUE},
        "SIDEBAR": {
            "show_search": True,
            "show_all_applications": False,
            "navigation": [
                {
                    "title": "Overview",
                    "items": [{"title": "Dashboard", "icon": "dashboard", "link": _link("index")}],
                },
                {
                    "title": "Operations",
                    "separator": True,
                    "items": [
                        {"title": "Orders", "icon": "receipt_long", "link": _link("orders_order_changelist")},
                        {"title": "Payments", "icon": "payments", "link": _link("payments_payment_changelist")},
                        {
                            "title": "Cash hand-ins",
                            "icon": "savings",
                            "link": _link("deliveries_cashremittance_changelist"),
                        },
                        {
                            "title": "Order history",
                            "icon": "history",
                            "link": _link("orders_orderstatuslog_changelist"),
                        },
                    ],
                },
                {
                    "title": "People",
                    "separator": True,
                    "items": [
                        {"title": "Users", "icon": "group", "link": _link("accounts_user_changelist")},
                        {"title": "Riders", "icon": "two_wheeler", "link": _link("deliveries_riderprofile_changelist")},
                    ],
                },
                {
                    "title": "Store",
                    "separator": True,
                    "items": [
                        {
                            "title": "Services & prices",
                            "icon": "water_drop",
                            "link": _link("catalog_waterrefillservice_changelist"),
                        },
                        {
                            "title": "GCash settings",
                            "icon": "qr_code_2",
                            "link": _link("payments_paymentsettings_changelist"),
                        },
                        {
                            "title": "Notifications",
                            "icon": "notifications",
                            "link": _link("notifications_notification_changelist"),
                        },
                    ],
                },
            ],
        },
    }
