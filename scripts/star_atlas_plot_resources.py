#!/usr/bin/env python3
"""
Plot Star Atlas resource trends from snapshot JSON.

Input schema supports either:
1) {"snapshots": [{"ts": "YYYY-MM-DD", "produced": {...}, "consumed": {...}}]}
2) [{"ts": "YYYY-MM-DD", "produced": {...}, "consumed": {...}}]
3) [{"ts": "YYYY-MM-DD", "resource": "food", "produced": 10, "consumed": 5}, ...]

Produces one PNG chart per resource in --out-dir:
- produced series
- consumed series
- cumulative stock = sum(produced - consumed)

Dependency:
  pip install matplotlib
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

RESOURCES = ("food", "fuel", "ammo", "toolkits")


@dataclass
class Point:
    ts: datetime
    produced: float
    consumed: float


def parse_ts(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"Invalid ts value: {value}") from exc


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def as_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Value is not numeric: {value}") from exc


def normalize_snapshots(payload: Any) -> Dict[str, List[Point]]:
    if isinstance(payload, dict):
        raw_items = payload.get("snapshots")
    else:
        raw_items = payload

    if not isinstance(raw_items, list):
        raise ValueError("Input must be a list or an object with 'snapshots' list")

    series: Dict[str, List[Point]] = {k: [] for k in RESOURCES}

    for item in raw_items:
        if not isinstance(item, dict):
            continue
        ts_raw = item.get("ts")
        if not isinstance(ts_raw, str):
            continue
        ts = parse_ts(ts_raw)

        # Row-per-resource format.
        if isinstance(item.get("resource"), str):
            key = str(item.get("resource")).lower().strip()
            if key not in series:
                continue
            produced = as_float(item.get("produced", 0))
            consumed = as_float(item.get("consumed", 0))
            series[key].append(Point(ts=ts, produced=produced, consumed=consumed))
            continue

        # Wide format with produced/consumed maps.
        produced_map = item.get("produced")
        consumed_map = item.get("consumed")
        if not isinstance(produced_map, dict) or not isinstance(consumed_map, dict):
            continue

        for key in RESOURCES:
            produced = as_float(produced_map.get(key, 0))
            consumed = as_float(consumed_map.get(key, 0))
            series[key].append(Point(ts=ts, produced=produced, consumed=consumed))

    for key in RESOURCES:
        series[key].sort(key=lambda p: p.ts)
    return series


def build_stock(points: List[Point]) -> Tuple[List[datetime], List[float], List[float], List[float]]:
    dates: List[datetime] = []
    produced: List[float] = []
    consumed: List[float] = []
    stock: List[float] = []

    current = 0.0
    for p in points:
        dates.append(p.ts)
        produced.append(p.produced)
        consumed.append(p.consumed)
        current += p.produced - p.consumed
        stock.append(current)

    return dates, produced, consumed, stock


def plot_one(resource: str, points: List[Point], out_path: Path) -> None:
    # Import lazily so --help works without matplotlib installed.
    try:
        import matplotlib.pyplot as plt  # type: ignore
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "matplotlib is not installed. Run: pip install matplotlib"
        ) from exc

    dates, produced, consumed, stock = build_stock(points)
    if not dates:
        return

    plt.figure(figsize=(11, 5))
    plt.plot(dates, produced, label="Produced", color="green")
    plt.plot(dates, consumed, label="Consumed", color="red")
    plt.plot(dates, stock, label="Stock (cumulative)", color="blue")

    plt.title(f"{resource.upper()} trends")
    plt.xlabel("Time")
    plt.ylabel("Amount")
    plt.legend()
    plt.grid(True, alpha=0.35)
    plt.tight_layout()
    plt.savefig(out_path)
    plt.close()


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Plot Star Atlas resource trends from snapshots")
    parser.add_argument("--input", type=Path, required=True, help="Path to snapshots JSON")
    parser.add_argument("--out-dir", type=Path, default=Path("charts"), help="Output directory for PNG charts")
    parser.add_argument(
        "--resources",
        default="food,fuel,ammo,toolkits",
        help="Comma-separated list of resources to plot",
    )
    return parser.parse_args(list(argv) if argv is not None else None)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    payload = load_json(args.input)
    series = normalize_snapshots(payload)

    selected = [x.strip().lower() for x in args.resources.split(",") if x.strip()]
    for key in selected:
        if key not in RESOURCES:
            raise ValueError(f"Unknown resource in --resources: {key}")

    args.out_dir.mkdir(parents=True, exist_ok=True)

    generated = 0
    for key in selected:
        points = series.get(key, [])
        if not points:
            continue
        out_path = args.out_dir / f"{key}_trend.png"
        plot_one(key, points, out_path)
        generated += 1
        print(f"saved: {out_path}")

    if generated == 0:
        print("No charts generated: no matching points in input")
    else:
        print(f"Generated {generated} chart(s) in {args.out_dir}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
