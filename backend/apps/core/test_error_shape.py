from django.test import SimpleTestCase

from apps.core.exceptions import _flatten


class ListItemErrorShapeTests(SimpleTestCase):
    """The API promises `items: [{}, {"quantity": [...]}]` whatever DRF version is installed."""

    def test_older_drf_list_of_dicts_is_kept(self):
        errors = [{}, {"quantity": ["too small"]}]
        self.assertEqual(_flatten(errors), [{}, {"quantity": ["too small"]}])

    def test_newer_drf_index_keyed_dict_becomes_the_aligned_list(self):
        self.assertEqual(_flatten({"1": {"quantity": ["too small"]}}), [{}, {"quantity": ["too small"]}])
        self.assertEqual(_flatten({"0": {"service": ["bad"]}, "2": {"quantity": ["x"]}}), [{"service": ["bad"]}, {}, {"quantity": ["x"]}])

    def test_regular_field_errors_are_untouched(self):
        self.assertEqual(_flatten({"delivery_date": ["past"], "items": {"1": {"quantity": ["x"]}}}), {"delivery_date": ["past"], "items": [{}, {"quantity": ["x"]}]})
        self.assertEqual(_flatten({"non_field_errors": ["only this"]}), ["only this"])
