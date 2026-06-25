"""Tests for ``scripts/security_helpers.normalize_https_url`` (100% line+branch)."""

from __future__ import annotations

import pytest

from security_helpers import normalize_https_url


def test_accepts_plain_https_url() -> None:
    assert normalize_https_url("https://example.com/path") == "https://example.com/path"


def test_strips_surrounding_whitespace() -> None:
    assert normalize_https_url("  https://example.com/  ") == "https://example.com/"


def test_none_input_rejected_as_non_https() -> None:
    # ``(raw_url or "")`` turns None into "" -> empty scheme -> not https.
    with pytest.raises(ValueError, match="Only https URLs are allowed"):
        normalize_https_url(None)  # pyright: ignore[reportArgumentType]


def test_non_https_scheme_rejected() -> None:
    with pytest.raises(ValueError, match="Only https URLs are allowed"):
        normalize_https_url("http://example.com/")


def test_missing_hostname_rejected() -> None:
    with pytest.raises(ValueError, match="missing a hostname"):
        normalize_https_url("https:///just-a-path")


def test_embedded_username_rejected() -> None:
    with pytest.raises(ValueError, match="credentials are not allowed"):
        normalize_https_url("https://user@example.com/")


def test_embedded_password_rejected() -> None:
    with pytest.raises(ValueError, match="credentials are not allowed"):
        normalize_https_url("https://:secret@example.com/")


def test_allowed_hosts_match() -> None:
    assert (
        normalize_https_url(
            "https://API.Example.com/x", allowed_hosts={"api.example.com"}
        )
        == "https://API.Example.com/x"
    )


def test_allowed_hosts_reject() -> None:
    with pytest.raises(ValueError, match="not in allowlist"):
        normalize_https_url("https://evil.com/", allowed_hosts={"good.com"})


def test_allowed_host_suffixes_match_exact() -> None:
    assert (
        normalize_https_url(
            "https://codacy.com/x", allowed_host_suffixes={"codacy.com"}
        )
        == "https://codacy.com/x"
    )


def test_allowed_host_suffixes_match_subdomain() -> None:
    assert (
        normalize_https_url(
            "https://api.codacy.com/x", allowed_host_suffixes={"codacy.com"}
        )
        == "https://api.codacy.com/x"
    )


def test_allowed_host_suffixes_reject() -> None:
    with pytest.raises(ValueError, match="not in suffix allowlist"):
        normalize_https_url(
            "https://api.evil.com/x", allowed_host_suffixes={"codacy.com"}
        )


def test_allowed_host_suffixes_empty_set_is_noop() -> None:
    # A suffix set that contains only dot-strippable entries collapses to empty
    # and is treated as "no suffix restriction".
    assert (
        normalize_https_url("https://anything.com/", allowed_host_suffixes={"."})
        == "https://anything.com/"
    )


def test_private_ip_rejected() -> None:
    with pytest.raises(ValueError, match="Private or local addresses"):
        normalize_https_url("https://10.0.0.1/")


def test_loopback_ip_rejected() -> None:
    with pytest.raises(ValueError, match="Private or local addresses"):
        normalize_https_url("https://127.0.0.1/")


def test_public_ip_allowed() -> None:
    # A genuinely public IP is not private/loopback/etc. -> allowed.
    assert normalize_https_url("https://8.8.8.8/") == "https://8.8.8.8/"


def test_localhost_name_rejected() -> None:
    with pytest.raises(ValueError, match="Localhost URLs are not allowed"):
        normalize_https_url("https://localhost/")


def test_strip_query_true_removes_query() -> None:
    assert (
        normalize_https_url("https://example.com/x?a=1#frag", strip_query=True)
        == "https://example.com/x"
    )


def test_strip_query_false_keeps_query_drops_fragment() -> None:
    assert (
        normalize_https_url("https://example.com/x?a=1#frag")
        == "https://example.com/x?a=1"
    )
