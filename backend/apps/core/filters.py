import django_filters
from django import forms

MAX_ID = 2**63 - 1  # largest value a BigAutoField / foreign key column can hold


class IdFilter(django_filters.NumberFilter):
    """Filter by a primary/foreign key.

    Accepts whole numbers in the database's integer range only; anything else is a clean
    400 instead of an OverflowError from the database driver.
    """

    field_class = forms.IntegerField

    def __init__(self, *args, **kwargs):
        kwargs.setdefault("min_value", 1)
        kwargs.setdefault("max_value", MAX_ID)
        super().__init__(*args, **kwargs)


def search_id(term):
    """The order number in a search word like '12' or '#12', else None."""
    digits = term.lstrip("#")
    return int(digits) if digits.isdigit() and len(digits) <= 18 else None
