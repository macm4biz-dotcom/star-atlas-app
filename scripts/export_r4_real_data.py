#!/usr/bin/env python3
"""
Export real R4 metrics from Star Atlas API endpoint to JSON/CSV.

This script is intended as a stable fallback when direct public RPC scans hit
rate limits. It fetches `/api/bridge/resources-r4` and writes a reproducible
snapshot with the fields used by the dashboard.

Usage:
  python3 scripts/export_r4_real_data.py \
    --api-base https://star-atlasapi-production.up.railway.app \
    --out-json /tmp/r4-real-data.json \
    --out-csv /tmp/r4-real-data.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List
from urllib import error as url_error
from urllib import request as url_request


DEFAULT_API_BASE = "https://star-atlasapi-production.up.railway.app"
RESOURCE_ORDER = ("food", "fuel", "ammunition", "toolkits")
RESOURCE_KEY_ALIASES = {
    "food": ("food",),
    "fuel": ("fuel",),
    "ammunition": ("ammunition", "ammo"),
    "toolkits": ("toolkits", "toolkit"),
}


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export real R4 data from API")
    parser.add_argument(
        "--api-base",
        default=DEFAULT_API_BASE,
        help="Base API URL (without trailing slash)",
    )
    parser.add_argument(
        "--timeout-sec",
        type=int,
        default=20,
        help="HTTP timeout in seconds",
    )
    parser.add_argument(
        "--out-json",
        type=Path,
        default=Path("/tmp/r4-real-data.json"),
        help="Output JSON snapshot path",
    )
    parser.add_argument(
        "--out-csv",
        type=Path,
        default=Path("/tmp/r4-real-data.csv"),
        help="Output CSV path",
    )
    return parser.parse_args(argv)


def fetch_json(url: str, timeout_sec: int) -> Dict[str, Any]:
    req = url_request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "star-atlas-r4-export/1.0"},
        method="GET",
    )
    try:
        with url_request.urlopen(req, timeout=timeout_sec) as response:
            raw = response.read().decode("utf-8")
    except (url_error.URLError, url_error.HTTPError, TimeoutError) as exc:
        raise RuntimeError(f"Request failed for {url}: {exc}") from exc

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON from {url}: {exc}") from exc

    if not isinstance(data, dict):
        raise RuntimeError("Unexpected response shape: root is not object")
    return data


def validate_payload(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    resources = payload.get("resources")
    if not isinstance(resources, list):
        raise RuntimeError("Payload missing resources[]")

    by_key: Dict[str, Dict[str, Any]] = {}
    for item in resources:
        if not isinstance(item, dict):
            continue
        key = item.get("key")
        if isinstance(key, str):
            by_key[key] = item

    ordered_rows: List[Dict[str, Any]] = []
    missing: List[str] = []
    for canonical_key in RESOURCE_ORDER:
        aliases = RESOURCE_KEY_ALIASES[canonical_key]
        match = next((by_key[alias] for alias in aliases if alias in by_key), None)
        if match is None:
            missing.append(canonical_key)
        else:
            ordered_rows.append(match)

    if missing:
        raise RuntimeError(f"Payload missing R4 resources: {', '.join(missing)}")

    return ordered_rows


def write_csv(path: Path, rows: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(
            [
                "key",
                "label",
                "mint",
                "mintSource",
                "totalCreated",
                "totalCreatedIsLowerBound",
                "createdToday",
                "totalConsumed",
                "playerBalance",
                "playerBalanceKnown",
                "developerBalance",
                "totalSupply",
                "dailyConsumption",
                "avgDailyConsumption7d",
                "avgDailyConsumption30d",
                "daysOfCover",
                "signal",
                "signalReason",
                "priceUsd",
                "priceChange24hPct",
                "priceChange7dPct",
                "buyOrderVolume",
                "sellOrderVolume",
            ]
        )
        for row in rows:
            writer.writerow(
                [
                    row.get("key", ""),
                    row.get("label", ""),
                    row.get("mint", ""),
                    row.get("mintSource", ""),
                    row.get("totalCreated", 0),
                    row.get("totalCreatedIsLowerBound", ""),
                    row.get("createdToday", 0),
                    row.get("totalConsumed", 0),
                    row.get("playerBalance", 0),
                    row.get("playerBalanceKnown", ""),
                    row.get("developerBalance", 0),
                    row.get("totalSupply", 0),
                    row.get("dailyConsumption", 0),
                    row.get("avgDailyConsumption7d", 0),
                    row.get("avgDailyConsumption30d", 0),
                    row.get("daysOfCover", ""),
                    row.get("signal", ""),
                    row.get("signalReason", ""),
                    row.get("priceUsd", 0),
                    row.get("priceChange24hPct", ""),
                    row.get("priceChange7dPct", ""),
                    row.get("buyOrderVolume", 0),
                    row.get("sellOrderVolume", 0),
                ]
            )


def build_export_payload(source: Dict[str, Any], rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    summary = source.get("summary") if isinstance(source.get("summary"), dict) else {}
    return {
        "updatedAt": source.get("updatedAt"),
        "source": source.get("source"),
        "programIds": source.get("programIds", {}),
        "summary": summary,
        "resources": rows,
    }


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    api_base = args.api_base.rstrip("/")
    url = f"{api_base}/api/bridge/resources-r4"

    payload = fetch_json(url, args.timeout_sec)
    rows = validate_payload(payload)
    export_payload = build_export_payload(payload, rows)

    args.out_json.parent.mkdir(parents=True, exist_ok=True)
    with args.out_json.open("w", encoding="utf-8") as fh:
        json.dump(export_payload, fh, ensure_ascii=False, indent=2)

    write_csv(args.out_csv, rows)

    summary = export_payload.get("summary")
    if isinstance(summary, dict):
        created = summary.get("totalCreated", 0)
        consumed = summary.get("totalConsumed", 0)
        balance = summary.get("totalPlayerBalance", 0)
        print("R4 Summary:")
        print(f"  totalCreated:      {created}")
        print(f"  totalConsumed:     {consumed}")
        print(f"  totalPlayerBalance:{balance}")

    print(f"Fetched from: {url}")
    print(f"JSON saved:   {args.out_json}")
    print(f"CSV saved:    {args.out_csv}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
