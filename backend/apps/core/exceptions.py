"""Consistent error shape for every API error.

    {"detail": "<message to show the user>", "code": "<machine code>", "errors": {"<field>": ["<msg>", ...]}}

`errors` is always present ({} when there are no field errors). Non-field validation
errors appear under the `non_field_errors` key; when that is the only error it is also
copied into `detail`. Every field maps to a list of strings, except fields holding nested
items (order `items`), which map to a list aligned with the input items:
`[{}, {"quantity": ["..."]}]` ({} = that item was fine).
"""
from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.http import Http404
from rest_framework import exceptions
from rest_framework.views import exception_handler


def _flatten(value):
    """Turn nested ErrorDetail structures into plain {field: [str]} / [str]."""
    if isinstance(value, dict):
        flat = {key: _flatten(val) for key, val in value.items()}
        if list(flat) == ["non_field_errors"]:  # a nested list-level error: same shape as any field
            return flat["non_field_errors"]
        if flat and all(str(key).isdigit() for key in flat):
            # DRF 3.18+ reports errors of a list of items as {"1": {...}} (failing items only);
            # older versions give [{}, {...}]. Always answer with the aligned list.
            aligned = [{} for _ in range(max(int(key) for key in flat) + 1)]
            for key, errors in flat.items():
                aligned[int(key)] = errors
            return aligned
        return flat
    if isinstance(value, (list, tuple)):
        flat = []
        for item in value:
            item = _flatten(item)
            flat.extend(item if isinstance(item, list) else [item])
        return flat
    return str(value)


def api_exception_handler(exc, context):
    if isinstance(exc, Http404):
        exc = exceptions.NotFound()
    elif isinstance(exc, DjangoPermissionDenied):
        exc = exceptions.PermissionDenied()

    response = exception_handler(exc, context)
    if response is None:
        return None

    if isinstance(exc, exceptions.ValidationError):
        data = _flatten(exc.detail)
        if not isinstance(data, dict):
            data = {"non_field_errors": data}
        non_field = data.get("non_field_errors", [])
        detail = non_field[0] if len(non_field) == 1 and len(data) == 1 else "Invalid input."
        body = {"detail": detail, "code": "validation_error", "errors": data}
    else:
        raw = response.data
        if isinstance(raw, dict):
            detail = str(raw.get("detail", "Request failed."))
            code = raw.get("code") or getattr(exc, "default_code", "error")
        else:
            detail, code = str(raw), getattr(exc, "default_code", "error")
        body = {"detail": detail, "code": str(code), "errors": {}}

    response.data = body
    return response
