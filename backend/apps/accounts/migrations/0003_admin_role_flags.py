from django.db import migrations


def flag_admins(apps, schema_editor):
    """Existing admin-role accounts get access to the Django admin site; everyone else loses it."""
    User = apps.get_model("accounts", "User")
    User.objects.filter(role="admin").update(is_staff=True, is_superuser=True)
    User.objects.exclude(role="admin").update(is_staff=False, is_superuser=False)


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0002_user_latitude_user_longitude"),
    ]

    operations = [migrations.RunPython(flag_admins, migrations.RunPython.noop)]
