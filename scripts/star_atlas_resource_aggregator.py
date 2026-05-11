#!/usr/bin/env python3
"""
Star Atlas resource aggregation from program-owned PDA accounts via Solana JSON-RPC.

This script is production-oriented infrastructure code: it handles RPC paging,
filtering, decoding, and exports. You only need to fill real account schemas
(discriminator + field offsets) from Star Atlas IDL in the JSON config.

Usage example:
  python3 scripts/star_atlas_resource_aggregator.py \
    --rpc-url https://api.mainnet-beta.solana.com \
    --config scripts/star_atlas_account_layouts.example.json \
    --out-json /tmp/star-atlas-resources.json \
    --out-csv /tmp/star-atlas-resources.csv

Dependencies:
    none (stdlib only)
"""

from __future__ import annotations

import argparse
import base64
import csv
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional
from urllib import error as url_error
from urllib import request as url_request


SUPPORTED_RESOURCES = ("food", "fuel", "ammo", "toolkits")

DEFAULT_PROGRAM_IDS = {
    "sage": "SAGE2HAwep459SNq61LHvjxPk4pLPEJLoMETef7f7EE",
    "cargo": "Cargo2VNTPPTi9c1vq1Jw5d3BWUNr18MjRtSupAghKEk",
    "crafting": "CRAFT2RPXPJWCEix4WpJST3E7NLf79GTqZUL75wngXo5",
    "playerProfile": "pprofELXjL5Kck7Jn5hCpwAL82DpTkSYBENzahVtbc9",
}


@dataclass
class RpcConfig:
    url: str
    commitment: str
    timeout_sec: int
    retries: int
    retry_backoff_sec: float


class RpcError(RuntimeError):
    pass


class SolanaRpc:
    def __init__(self, config: RpcConfig):
        self._config = config
        self._request_id = 1

    def _post(self, method: str, params: List[Any]) -> Any:
        payload = {
            "jsonrpc": "2.0",
            "id": self._request_id,
            "method": method,
            "params": params,
        }
        self._request_id += 1

        last_error: Optional[Exception] = None
        for attempt in range(self._config.retries + 1):
            try:
                req = url_request.Request(
                    self._config.url,
                    data=json.dumps(payload).encode("utf-8"),
                    headers={
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                    },
                    method="POST",
                )
                with url_request.urlopen(req, timeout=self._config.timeout_sec) as response:
                    response_body = response.read().decode("utf-8")
                data = json.loads(response_body)
                if "error" in data:
                    raise RpcError(f"RPC {method} error: {data['error']}")
                return data.get("result")
            except (url_error.URLError, url_error.HTTPError, TimeoutError, ValueError, RpcError) as exc:
                last_error = exc
                if attempt >= self._config.retries:
                    break
                time.sleep(self._config.retry_backoff_sec * (attempt + 1))

        raise RpcError(f"RPC {method} failed after retries: {last_error}")

    def get_program_accounts(
        self,
        program_id: str,
        filters: Optional[List[Dict[str, Any]]] = None,
        data_slice: Optional[Dict[str, int]] = None,
    ) -> List[Dict[str, Any]]:
        config: Dict[str, Any] = {
            "encoding": "base64",
            "commitment": self._config.commitment,
            "withContext": False,
        }
        if filters:
            config["filters"] = filters
        if data_slice:
            config["dataSlice"] = data_slice

        result = self._post("getProgramAccounts", [program_id, config])
        if not isinstance(result, list):
            raise RpcError(f"Unexpected getProgramAccounts result type: {type(result)}")
        return result


def decode_account_data(account: Dict[str, Any]) -> bytes:
    data_field = account.get("account", {}).get("data")
    if not isinstance(data_field, list) or len(data_field) < 1:
        raise ValueError("Invalid account.data format")
    if not isinstance(data_field[0], str):
        raise ValueError("Invalid base64 payload")
    return base64.b64decode(data_field[0])


def parse_discriminator(value: Optional[str]) -> Optional[bytes]:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    if value.startswith("0x"):
        return bytes.fromhex(value[2:])
    # allow plain hex without 0x
    try:
        return bytes.fromhex(value)
    except ValueError as exc:
        raise ValueError(
            "discriminator must be hex (e.g. 0x1234abcd...)"
        ) from exc


def u64le_at(raw: bytes, offset: int) -> int:
    if offset < 0 or offset + 8 > len(raw):
        raise ValueError(f"Offset {offset} out of bounds for account length {len(raw)}")
    return int.from_bytes(raw[offset : offset + 8], "little", signed=False)


def decode_u64_fields(raw: bytes, decoder_cfg: Dict[str, Any]) -> Dict[str, int]:
    discriminator = parse_discriminator(decoder_cfg.get("discriminator_hex"))
    if discriminator is not None:
        if len(discriminator) == 0:
            raise ValueError("Empty discriminator_hex is not allowed")
        if raw[: len(discriminator)] != discriminator:
            raise ValueError("Account discriminator mismatch")

    fields = decoder_cfg.get("fields")
    if not isinstance(fields, dict) or not fields:
        raise ValueError("decoder.fields must be a non-empty object")

    values: Dict[str, int] = {}
    for key in SUPPORTED_RESOURCES:
        offset = fields.get(key)
        if offset is None:
            values[key] = 0
            continue
        if not isinstance(offset, int):
            raise ValueError(f"Offset for {key} must be int")
        values[key] = u64le_at(raw, offset)
    return values


def build_filters(target: Dict[str, Any]) -> List[Dict[str, Any]]:
    filters: List[Dict[str, Any]] = []

    data_size = target.get("data_size")
    if data_size is not None:
        if not isinstance(data_size, int) or data_size <= 0:
            raise ValueError("data_size must be a positive integer")
        filters.append({"dataSize": data_size})

    memcmp_filters = target.get("memcmp")
    if memcmp_filters is not None:
        if not isinstance(memcmp_filters, list):
            raise ValueError("memcmp must be an array")
        for item in memcmp_filters:
            if not isinstance(item, dict):
                raise ValueError("Each memcmp item must be an object")
            offset = item.get("offset")
            bytes_str = item.get("bytes")
            if not isinstance(offset, int) or offset < 0:
                raise ValueError("memcmp.offset must be a non-negative int")
            if not isinstance(bytes_str, str) or not bytes_str:
                raise ValueError("memcmp.bytes must be a non-empty base58 string")
            filters.append({"memcmp": {"offset": offset, "bytes": bytes_str}})

    return filters


def aggregate_target(
    rpc: SolanaRpc,
    target: Dict[str, Any],
) -> Dict[str, Any]:
    label = str(target.get("name") or "unnamed")
    program_id = target.get("program_id")
    if not isinstance(program_id, str) or not program_id:
        raise ValueError(f"Target {label}: program_id is required")

    decoder = target.get("decoder")
    if not isinstance(decoder, dict):
        raise ValueError(f"Target {label}: decoder is required")

    decoder_type = decoder.get("type")
    if decoder_type != "u64_fields":
        raise ValueError(
            f"Target {label}: unsupported decoder.type={decoder_type}. "
            "Use 'u64_fields' and configure offsets from IDL."
        )

    filters = build_filters(target)
    accounts = rpc.get_program_accounts(program_id, filters=filters)

    totals = {key: 0 for key in SUPPORTED_RESOURCES}
    processed = 0
    decoded = 0
    skipped = 0

    for acc in accounts:
        processed += 1
        try:
            raw = decode_account_data(acc)
            values = decode_u64_fields(raw, decoder)
            for key in SUPPORTED_RESOURCES:
                totals[key] += values[key]
            decoded += 1
        except Exception:
            skipped += 1

    return {
        "name": label,
        "programId": program_id,
        "processedAccounts": processed,
        "decodedAccounts": decoded,
        "skippedAccounts": skipped,
        "totals": totals,
    }


def aggregate_all(
    rpc: SolanaRpc,
    config: Dict[str, Any],
) -> Dict[str, Any]:
    targets = config.get("targets")
    if not isinstance(targets, list) or not targets:
        raise ValueError("config.targets must be a non-empty array")

    results: List[Dict[str, Any]] = []
    grand_totals = {key: 0 for key in SUPPORTED_RESOURCES}

    for target in targets:
        if not isinstance(target, dict):
            raise ValueError("Each target must be an object")
        if target.get("enabled") is False:
            continue
        result = aggregate_target(rpc, target)
        results.append(result)
        for key in SUPPORTED_RESOURCES:
            grand_totals[key] += result["totals"][key]

    return {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "rpcUrl": rpc._config.url,
        "commitment": rpc._config.commitment,
        "programIds": DEFAULT_PROGRAM_IDS,
        "targets": results,
        "grandTotals": grand_totals,
    }


def write_csv(path: Path, payload: Dict[str, Any]) -> None:
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(
            [
                "target_name",
                "program_id",
                "processed_accounts",
                "decoded_accounts",
                "skipped_accounts",
                "food",
                "fuel",
                "ammo",
                "toolkits",
            ]
        )
        for item in payload.get("targets", []):
            totals = item.get("totals", {})
            writer.writerow(
                [
                    item.get("name", ""),
                    item.get("programId", ""),
                    item.get("processedAccounts", 0),
                    item.get("decodedAccounts", 0),
                    item.get("skippedAccounts", 0),
                    totals.get("food", 0),
                    totals.get("fuel", 0),
                    totals.get("ammo", 0),
                    totals.get("toolkits", 0),
                ]
            )

        grand = payload.get("grandTotals", {})
        writer.writerow(
            [
                "__grand_total__",
                "",
                "",
                "",
                "",
                grand.get("food", 0),
                grand.get("fuel", 0),
                grand.get("ammo", 0),
                grand.get("toolkits", 0),
            ]
        )


def load_json(path: Path) -> Dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            raise ValueError("JSON root must be object")
        return data
    except Exception as exc:
        raise RuntimeError(f"Failed to load config {path}: {exc}") from exc


def parse_args(argv: Optional[Iterable[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Aggregate Star Atlas resources from PDA accounts via Solana RPC"
    )
    parser.add_argument(
        "--rpc-url",
        default="https://api.mainnet-beta.solana.com",
        help="Solana RPC endpoint",
    )
    parser.add_argument(
        "--commitment",
        default="confirmed",
        choices=["processed", "confirmed", "finalized"],
        help="RPC commitment level",
    )
    parser.add_argument(
        "--timeout-sec",
        type=int,
        default=30,
        help="HTTP timeout per RPC request",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=2,
        help="Retries per RPC call",
    )
    parser.add_argument(
        "--retry-backoff-sec",
        type=float,
        default=0.7,
        help="Linear retry backoff base in seconds",
    )
    parser.add_argument(
        "--config",
        type=Path,
        required=True,
        help="Path to JSON config with program targets and account schema offsets",
    )
    parser.add_argument(
        "--out-json",
        type=Path,
        default=Path("star-atlas-resource-aggregation.json"),
        help="JSON output path",
    )
    parser.add_argument(
        "--out-csv",
        type=Path,
        default=None,
        help="Optional CSV output path",
    )
    return parser.parse_args(argv)


def main(argv: Optional[Iterable[str]] = None) -> int:
    args = parse_args(argv)

    config = load_json(args.config)

    rpc = SolanaRpc(
        RpcConfig(
            url=args.rpc_url,
            commitment=args.commitment,
            timeout_sec=args.timeout_sec,
            retries=args.retries,
            retry_backoff_sec=args.retry_backoff_sec,
        )
    )

    payload = aggregate_all(rpc, config)

    args.out_json.parent.mkdir(parents=True, exist_ok=True)
    with args.out_json.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)

    if args.out_csv:
        args.out_csv.parent.mkdir(parents=True, exist_ok=True)
        write_csv(args.out_csv, payload)

    grand = payload["grandTotals"]
    print("=== Star Atlas Resource Aggregation ===")
    print(f"RPC: {payload['rpcUrl']} ({payload['commitment']})")
    print(f"Targets scanned: {len(payload['targets'])}")
    print("Grand totals:")
    print(f"  food:     {grand['food']}")
    print(f"  fuel:     {grand['fuel']}")
    print(f"  ammo:     {grand['ammo']}")
    print(f"  toolkits: {grand['toolkits']}")
    print(f"JSON saved: {args.out_json}")
    if args.out_csv:
        print(f"CSV saved:  {args.out_csv}")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("Interrupted", file=sys.stderr)
        raise SystemExit(130)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
