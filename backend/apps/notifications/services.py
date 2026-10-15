"""Creating notifications (in-app + email). Used by orders and payments."""
import logging

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.db import transaction

from .models import Notification

logger = logging.getLogger(__name__)


def notify(recipient, title, message, order=None, email=True):
    """Create an in-app notification and (optionally) email the recipient.

    The email goes out only after the surrounding transaction commits, and a mail
    failure never breaks the request.
    """
    notification = Notification.objects.create(
        recipient=recipient, title=title, message=message, order=order
    )
    if email and recipient.email:
        transaction.on_commit(lambda: _send_email(recipient.email, title, message))
    return notification


def notify_staff(title, message, order=None):
    """In-app only notification for every active staff/admin account."""
    User = get_user_model()
    recipients = User.objects.filter(role__in=["staff", "admin"], is_active=True)
    return Notification.objects.bulk_create(
        [Notification(recipient=u, title=title, message=message, order=order) for u in recipients]
    )


def _send_email(address, subject, body):
    try:
        send_mail(
            subject=f"[Deep Water Refilling Station] {subject}",
            message=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[address],
            fail_silently=False,
        )
    except Exception:  # noqa: BLE001 - email is best effort
        logger.exception("Could not send email to %s", address)
