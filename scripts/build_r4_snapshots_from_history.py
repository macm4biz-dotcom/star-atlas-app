#!/usr/bin/env python3
"""
Convert R4 production history file into plotting snapshots format.

Input:
  apps/api/data/r4-production-history.json

Output format:
{
  "snapshots": [
    {
      "ts": "YYYY-MM-DD",
      "produced": {"food": n, "fuel": n, "ammo": n, "toolkits": n},
      "consumed": {"food": n, "fuel": n, "ammo": n, "toolkits": n}
    }
  ]
}

Notes:
- The history file currently tracks created values per day.
- If explicit consumed data is unavailable, this converter uses a configurable
  default consumed value per resource (0 by default).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, List

RESOURCES = ("food", "fuel", "ammo", "toolkits")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build plot snapshots from R4 history")
    parser.add_argument(
        "--history",
        type=Path,
        default=Path("apps/api/data/r4-production-history.json"),
        help="Path to r4-production-history.json",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("scripts/resource_snapshots.r4.generated.json"),
        help="Output snapshots JSON path",
    )
    parser.add_argument(
        "--default-consumed",
        type=float,
        default=0.0,
        help="Fallback consumed value per resource per day when no consumed history exists",
    )
    return parser.parse_args()


def load_history(path: Path) -> Dict:
    with path.open("r", encoding="utf-8") as fh:
        payload = json.load(fh)
    if not isinstance(payload, dict):
        raise ValueError("History root must be an object")
    return payload


def build_snapshots(history: Dict, default_consumed: float) -> List[Dict]:
    resources = history.get("resources")
    if not isinstance(resources, dict):
        raise ValueError("History 'resources' must be an object")

    by_date: Dict[str, Dict[str, float]] = {}

    for resource in RESOURCES:
        entries = resources.get(resource, [])
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            ts = entry.get("utcDateKey")
            created = entry.get("created", 0)
            if not isinstance(ts, str):
                continue
            try:
                created_num = float(created)
            except (TypeError, ValueError):
                created_num = 0.0

            if ts not in by_date:
                by_date[ts] = {k: 0.0 for k in RESOURCES}
            by_date[ts][resource] = created_num

    snapshots: List[Dict] = []
    for ts in sorted(by_date.keys()):
        produced = by_date[ts]
        consumed = {k: float(default_consumed) for k in RESOURCES}
        snapshots.append(
            {
                "ts": ts,
                "produced": produced,
                "consumed": consumed,
            }
        )

    return snapshots


def main() -> int:
    args = parse_args()
    history = load_history(args.history)
    snapshots = build_snapshots(history, args.default_consumed)

    payload = {"snapshots": snapshots}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)

    print(f"Generated {len(snapshots)} snapshots -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
