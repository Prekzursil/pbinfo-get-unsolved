from __future__ import annotations

import ipaddress
import json
from pathlib import Path
from typing import Any, Dict, Iterable, Mapping, NamedTuple, Optional, Set, Tuple, cast
from urllib import error as urllib_error
from urllib import request as urllib_request
from urllib.parse import urlparse, urlunparse


class HttpsStatusError(RuntimeError):
    def __init__(self, url: str, status_code: int, reason: str, body: str):
        super().__init__(f"HTTPS {status_code} for {url}: {reason}")
        self.url = url
        self.status_code = status_code
        self.reason = reason
        self.body = body


class _RequestOptions(NamedTuple):
    headers: Dict[str, str]
    method: str
    data: Any
    timeout: int
    allowed_hosts: Optional[Set[str]]
    allowed_host_suffixes: Optional[Set[str]]
    strip_query: bool


_LOCALHOST_ALIASES = {"localhost", "localhost.localdomain"}
_DISALLOWED_IP_FLAGS = (
    "is_private",
    "is_loopback",
    "is_link_local",
    "is_reserved",
    "is_multicast",
)
_REQUEST_OPTION_KEYS = {
    "headers",
    "method",
    "data",
    "timeout",
    "allowed_hosts",
    "allowed_host_suffixes",
    "strip_query",
}


def _normalize_hostname(raw_hostname: str) -> str:
    return (raw_hostname or "").lower().strip(".")


def _normalize_allowlist(values: Optional[Set[str]]) -> Set[str]:
    if not values:
        return set()
    return {_normalize_hostname(value) for value in values if str(value or "").strip(".")}


def _assert_https_basics(parsed_url: Any, raw_url: str) -> None:
    if parsed_url.scheme != "https":
        raise ValueError(f"Only https URLs are allowed: {raw_url!r}")
    if not parsed_url.hostname:
        raise ValueError(f"URL is missing a hostname: {raw_url!r}")
    if parsed_url.username or parsed_url.password:
        raise ValueError(f"URL credentials are not allowed: {raw_url!r}")


def _assert_hostname_allowlists(
    hostname: str,
    *,
    allowed_hosts: Optional[Set[str]],
    allowed_host_suffixes: Optional[Set[str]],
) -> None:
    hosts = _normalize_allowlist(allowed_hosts)
    suffixes = _normalize_allowlist(allowed_host_suffixes)

    if hosts and hostname not in hosts:
        raise ValueError(f"URL host is not in allowlist: {hostname}")

    if suffixes and not any(hostname == suffix or hostname.endswith(f".{suffix}") for suffix in suffixes):
        raise ValueError(f"URL host is not in suffix allowlist: {hostname}")


def _parse_ip_or_none(hostname: str) -> Any:
    try:
        return ipaddress.ip_address(hostname)
    except ValueError:
        return None


def _attribute_truthy(value: Any, attribute: str) -> bool:
    attr_value = getattr(value, attribute, False)
    if callable(attr_value):
        try:
            return bool(attr_value())
        except TypeError:
            return bool(attr_value)
    return bool(attr_value)


def _is_disallowed_ip(ip_value: Any) -> bool:
    return any(_attribute_truthy(ip_value, attr_name) for attr_name in _DISALLOWED_IP_FLAGS)


def normalize_https_url(
    raw_url: str,
    *,
    allowed_hosts: Optional[Set[str]] = None,
    allowed_host_suffixes: Optional[Set[str]] = None,
    strip_query: bool = False,
) -> str:
    """Validate user-provided URLs for CLI scripts.

    Rules:
    - https scheme only,
    - no embedded credentials,
    - reject localhost/private/link-local IP targets,
    - optional hostname allowlist.
    - optional hostname suffix allowlist.
    """

    parsed = urlparse((raw_url or "").strip())
    _assert_https_basics(parsed, raw_url)

    hostname = _normalize_hostname(parsed.hostname or "")
    _assert_hostname_allowlists(
        hostname,
        allowed_hosts=allowed_hosts,
        allowed_host_suffixes=allowed_host_suffixes,
    )

    ip_value = _parse_ip_or_none(hostname)
    if ip_value is not None and _is_disallowed_ip(ip_value):
        raise ValueError(f"Private or local addresses are not allowed: {hostname}")

    if hostname in _LOCALHOST_ALIASES:
        raise ValueError("Localhost URLs are not allowed.")

    sanitized = parsed._replace(fragment="", params="")
    if strip_query:
        sanitized = sanitized._replace(query="")
    return urlunparse(sanitized)


def safe_output_path(raw: str, fallback: str, *, base: Path | None = None) -> Path:
    root = (base or Path.cwd()).resolve()
    candidate = Path((raw or "").strip() or fallback).expanduser()
    if not candidate.is_absolute():
        candidate = root / candidate
    resolved = candidate.resolve(strict=False)
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"Output path escapes workspace root: {candidate}") from exc
    return resolved


def _encode_request_body(data: Any, headers: Dict[str, str]) -> Optional[bytes]:
    if data is None:
        return None
    if isinstance(data, bytes):
        return data
    if isinstance(data, str):
        return data.encode("utf-8")
    headers.setdefault("Content-Type", "application/json")
    return json.dumps(data).encode("utf-8")


def _coerce_status_code(raw_status: Any, default: int) -> int:
    if isinstance(raw_status, int):
        return raw_status
    try:
        return int(raw_status)
    except (TypeError, ValueError):
        return default


def _decode_body_text(raw_body: Any) -> str:
    if isinstance(raw_body, bytes):
        return raw_body.decode("utf-8", errors="replace")
    return str(raw_body or "")


def _normalize_host_collection(raw_hosts: Any, *, option_name: str, function_name: str) -> Optional[Set[str]]:
    if raw_hosts is None:
        return None
    try:
        return {str(host) for host in cast(Iterable[Any], raw_hosts)}
    except TypeError as exc:
        raise TypeError(f"{function_name}() {option_name} must be iterable") from exc


def _raise_unexpected_option(function_name: str, option_name: str) -> None:
    raise TypeError(f"{function_name}() got an unexpected keyword argument '{option_name}'")


def _coerce_request_options(function_name: str, options: Mapping[str, Any]) -> _RequestOptions:
    for option_name in options:
        if option_name not in _REQUEST_OPTION_KEYS:
            _raise_unexpected_option(function_name, option_name)

    headers = dict(cast(Mapping[str, str], options.get("headers") or {}))
    method = str(options.get("method") or "GET")
    timeout_value = options.get("timeout", 30)
    try:
        timeout = int(timeout_value)
    except (TypeError, ValueError) as exc:
        raise TypeError(f"{function_name}() timeout must be an integer") from exc

    return _RequestOptions(
        headers=headers,
        method=method,
        data=options.get("data"),
        timeout=timeout,
        allowed_hosts=_normalize_host_collection(
            options.get("allowed_hosts"),
            option_name="allowed_hosts",
            function_name=function_name,
        ),
        allowed_host_suffixes=_normalize_host_collection(
            options.get("allowed_host_suffixes"),
            option_name="allowed_host_suffixes",
            function_name=function_name,
        ),
        strip_query=bool(options.get("strip_query", False)),
    )


def _raise_https_status_from_error(safe_url: str, error: urllib_error.HTTPError) -> None:
    try:
        error_body = error.read()
    finally:
        error.close()
    raise HttpsStatusError(
        safe_url,
        _coerce_status_code(getattr(error, "code", None), 500),
        str(getattr(error, "reason", "") or ""),
        _decode_body_text(error_body),
    ) from error


def _open_https_response(
    request_obj: urllib_request.Request,
    *,
    safe_url: str,
    timeout: int,
):
    try:
        return getattr(urllib_request, "urlopen")(request_obj, timeout=timeout)
    except urllib_error.HTTPError as error:
        _raise_https_status_from_error(safe_url, error)
    except urllib_error.URLError as error:
        reason = str(getattr(error, "reason", "") or "request failed")
        raise RuntimeError(f"HTTPS request failed for {safe_url}: {reason}") from error


def _read_response_payload(response: Any) -> Tuple[int, str, str, Dict[str, str]]:
    try:
        response_headers = {
            str(key).lower(): str(value) for key, value in response.headers.items()
        }
        response_reason_value = getattr(response, "reason", "")
        response_reason = str(response_reason_value or "")
        response_status_value = getattr(response, "status", None)
        if response_status_value is None:
            response_status_value = getattr(response, "code", None)
        response_status = _coerce_status_code(response_status_value, 200)
        response_text = _decode_body_text(response.read())
    finally:
        response.close()

    return response_status, response_reason, response_text, response_headers


def request_json_with_headers(raw_url: str, **kwargs: Any) -> Tuple[Any, Dict[str, str]]:
    options = _coerce_request_options("request_json_with_headers", kwargs)
    safe_url = normalize_https_url(
        raw_url,
        allowed_hosts=options.allowed_hosts,
        allowed_host_suffixes=options.allowed_host_suffixes,
        strip_query=options.strip_query,
    )
    request_headers = dict(options.headers)
    body = _encode_request_body(options.data, request_headers)
    request_obj = urllib_request.Request(
        safe_url,
        data=body,
        headers=request_headers,
        method=options.method,
    )
    response = _open_https_response(request_obj, safe_url=safe_url, timeout=options.timeout)
    response_status, response_reason, response_text, response_headers = _read_response_payload(response)

    if response_status >= 400:
        raise HttpsStatusError(safe_url, response_status, response_reason, response_text)

    payload = json.loads(response_text)
    return payload, response_headers


def request_json(raw_url: str, **kwargs: Any) -> Any:
    payload, _ = request_json_with_headers(raw_url, **kwargs)
    return payload
