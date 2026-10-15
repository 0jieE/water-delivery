from rest_framework.permissions import BasePermission


def role_permission(*roles):
    class _HasRole(BasePermission):
        def has_permission(self, request, view):
            return bool(
                request.user and request.user.is_authenticated and request.user.role in roles
            )

    _HasRole.__name__ = "Is" + "Or".join(r.capitalize() for r in roles)
    return _HasRole


IsAdmin = role_permission("admin")
IsStaffOrAdmin = role_permission("staff", "admin")
IsRider = role_permission("rider")
IsCustomer = role_permission("customer")
