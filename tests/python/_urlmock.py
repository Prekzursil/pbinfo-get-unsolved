"""Shared helpers for mocking ``urllib.request.urlopen`` in the gate-script tests."""

from __future__ import annotations

import io
import json
from contextlib import contextmanager
from typing import Any


class FakeResponse:
    """Minimal context-manager stand-in for ``http.client.HTTPResponse``."""

    def __init__(self, body: Any, headers: dict[str, str] | None = None) -> None:
        self._raw = (body if isinstance(body, str) else json.dumps(body)).encode(
            "utf-8"
        )
        # ``http.client.HTTPResponse.headers`` is a Message that supports
        # ``.items()``; a plain dict matches that surface for our callers.
        self.headers: dict[str, str] = dict(headers or {})

    def read(self) -> bytes:
        return self._raw

    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, *_exc: object) -> None:
        return None


class FakeUrlopen:
    """Callable stand-in for ``urllib.request.urlopen``.

    Yields the queued ``responses`` in order (raising any ``Exception`` element)
    and records each requested URL on the typed ``.calls`` list.
    """

    def __init__(self, responses: list[Any]) -> None:
        self._responses = responses
        self.calls: list[str] = []

    def __call__(self, req: Any, timeout: int | None = None) -> FakeResponse:
        url = getattr(req, "full_url", req)
        self.calls.append(url)
        item = self._responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def make_urlopen(responses: list[Any]) -> FakeUrlopen:
    """Return a :class:`FakeUrlopen` seeded with ``responses``."""

    return FakeUrlopen(responses)


@contextmanager
def captured_text(value: str):
    """Yield an ``io.StringIO`` seeded with ``value`` (for stdin-style stubs)."""

    yield io.StringIO(value)
