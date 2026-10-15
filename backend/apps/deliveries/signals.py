from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import RiderProfile


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def ensure_rider_profile(sender, instance, **kwargs):
    """Every user with role=rider always has a RiderProfile (API, Django admin and seed alike)."""
    if instance.role == "rider":
        RiderProfile.objects.get_or_create(user=instance)
