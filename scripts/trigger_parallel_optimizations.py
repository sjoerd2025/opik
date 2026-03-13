#!/usr/bin/env python3
"""
Trigger 6 parallel optimizations for stress testing.

Creates all combinations of:
- Optimizers: GEPA, Hierarchical Reflective
- Metrics: Levenshtein, Equals, GEval

Usage:
    python scripts/trigger_parallel_optimizations.py [--api-url http://localhost:5173] [--workspace default]

Requirements:
    pip install requests
"""

import argparse
import json
import requests
import uuid
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Dict, Any, List


def uuid7() -> str:
    """Generate a UUID v7 (time-ordered UUID).
    
    UUID v7 format: tttttttt-tttt-7xxx-yxxx-xxxxxxxxxxxx
    where t = unix timestamp in ms, x = random, y = variant (8, 9, a, or b)
    """
    # Get current timestamp in milliseconds
    timestamp_ms = int(time.time() * 1000)
    
    # Convert to 48-bit timestamp (6 bytes)
    timestamp_bytes = timestamp_ms.to_bytes(6, byteorder='big')
    
    # Generate 10 random bytes
    random_bytes = bytearray(uuid.uuid4().bytes[6:])
    
    # Construct UUID bytes
    uuid_bytes = bytearray(16)
    uuid_bytes[0:6] = timestamp_bytes
    uuid_bytes[6:16] = random_bytes
    
    # Set version to 7 (0111 in bits 48-51)
    uuid_bytes[6] = (uuid_bytes[6] & 0x0F) | 0x70
    
    # Set variant to RFC 4122 (10xx in bits 64-67)
    uuid_bytes[8] = (uuid_bytes[8] & 0x3F) | 0x80
    
    # Format as UUID string
    hex_str = uuid_bytes.hex()
    return f"{hex_str[0:8]}-{hex_str[8:12]}-{hex_str[12:16]}-{hex_str[16:20]}-{hex_str[20:32]}"

# Configuration
DEFAULT_API_URL = "http://localhost:5173/api"
DEFAULT_WORKSPACE = "default"

# Prompt configuration (from user request)
PROMPT_MESSAGES = [
    {"role": "system", "content": "Provide straight answers"},
    {"role": "user", "content": "What would be the file extension for the content in this URL? {{url}}"}
]

DATASET_NAME = "audio_dataset_fixed"
REFERENCE_KEY = "format"  # For Equals and Levenshtein

# Optimizer types
OPTIMIZERS = ["gepa", "hierarchical_reflective"]

# Metric configurations
METRICS = {
    "levenshtein": {
        "type": "levenshtein_ratio",
        "parameters": {
            "reference_key": REFERENCE_KEY,
            "case_sensitive": False
        }
    },
    "equals": {
        "type": "equals",
        "parameters": {
            "reference_key": REFERENCE_KEY,
            "case_sensitive": False
        }
    },
    "geval": {
        "type": "geval",
        "parameters": {
            "task_introduction": "Evaluate if the output correctly identifies the file extension from the URL",
            "evaluation_criteria": "Score 1.0 if the output is a valid file extension (like mp3, wav, flac, etc.) that matches the expected format. Score 0.0 if incorrect or missing."
        }
    }
}


def create_optimization_payload(
    optimizer_type: str,
    metric_name: str,
    metric_config: Dict[str, Any]
) -> Dict[str, Any]:
    """Create the optimization payload for the API."""
    
    opt_id = uuid7()
    name = f"stress_test_{optimizer_type}_{metric_name}_{datetime.now().strftime('%H%M%S')}"
    
    return {
        "id": opt_id,
        "name": name,
        "dataset_name": DATASET_NAME,
        "objective_name": metric_config["type"],
        "status": "initialized",
        "studio_config": {
            "dataset_name": DATASET_NAME,
            "prompt": {
                "messages": PROMPT_MESSAGES
            },
            "llm_model": {
                "model": "openai/gpt-4o-mini",
                "parameters": {
                    "temperature": 0.7
                }
            },
            "evaluation": {
                "metrics": [metric_config]
            },
            "optimizer": {
                "type": optimizer_type,
                "parameters": {}  # Optimizer params are passed to constructor, max_trials is separate
            }
        }
    }


def trigger_optimization(
    api_url: str,
    workspace: str,
    api_key: str,
    payload: Dict[str, Any]
) -> Dict[str, Any]:
    """Trigger a single optimization via the API."""
    
    url = f"{api_url}/v1/private/optimizations"
    headers = {
        "Content-Type": "application/json",
        "Comet-Workspace": workspace,
    }
    
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
        headers["Comet-Api-Key"] = api_key
    
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=30)
        
        if response.status_code == 201:
            location = response.headers.get("Location", "")
            opt_id = location.split("/")[-1] if location else payload["id"]
            return {
                "status": "success",
                "name": payload["name"],
                "id": opt_id,
                "optimizer": payload["studio_config"]["optimizer"]["type"],
                "metric": payload["studio_config"]["evaluation"]["metrics"][0]["type"]
            }
        else:
            return {
                "status": "error",
                "name": payload["name"],
                "error": f"HTTP {response.status_code}: {response.text[:200]}"
            }
    except Exception as e:
        return {
            "status": "error",
            "name": payload["name"],
            "error": str(e)
        }


def main():
    parser = argparse.ArgumentParser(description="Trigger parallel optimizations for stress testing")
    parser.add_argument("--api-url", default=DEFAULT_API_URL, help="API base URL")
    parser.add_argument("--workspace", default=DEFAULT_WORKSPACE, help="Workspace name")
    parser.add_argument("--api-key", default="", help="API key (optional for local)")
    parser.add_argument("--dry-run", action="store_true", help="Print payloads without sending")
    args = parser.parse_args()
    
    # Generate all 6 combinations
    payloads: List[Dict[str, Any]] = []
    for optimizer in OPTIMIZERS:
        for metric_name, metric_config in METRICS.items():
            payload = create_optimization_payload(optimizer, metric_name, metric_config)
            payloads.append(payload)
    
    print(f"\n{'='*60}")
    print(f"Optimization Stress Test - {len(payloads)} jobs")
    print(f"{'='*60}")
    print(f"API URL: {args.api_url}")
    print(f"Workspace: {args.workspace}")
    print(f"Dataset: {DATASET_NAME}")
    print(f"Reference Key: {REFERENCE_KEY}")
    print(f"\nCombinations:")
    for p in payloads:
        opt = p["studio_config"]["optimizer"]["type"]
        met = p["studio_config"]["evaluation"]["metrics"][0]["type"]
        print(f"  - {opt} + {met}")
    print(f"{'='*60}\n")
    
    if args.dry_run:
        print("DRY RUN - Payloads that would be sent:\n")
        for i, payload in enumerate(payloads, 1):
            print(f"--- Payload {i}: {payload['name']} ---")
            print(json.dumps(payload, indent=2))
            print()
        return
    
    # Trigger all optimizations in parallel
    print("Triggering optimizations...")
    results = []
    
    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = {
            executor.submit(
                trigger_optimization,
                args.api_url,
                args.workspace,
                args.api_key,
                payload
            ): payload["name"]
            for payload in payloads
        }
        
        for future in as_completed(futures):
            name = futures[future]
            try:
                result = future.result()
                results.append(result)
                status = "✓" if result["status"] == "success" else "✗"
                print(f"  {status} {result['name']}")
                if result["status"] == "error":
                    print(f"      Error: {result.get('error', 'Unknown')}")
            except Exception as e:
                print(f"  ✗ {name}: {e}")
                results.append({"status": "error", "name": name, "error": str(e)})
    
    # Summary
    print(f"\n{'='*60}")
    print("SUMMARY")
    print(f"{'='*60}")
    
    successes = [r for r in results if r["status"] == "success"]
    failures = [r for r in results if r["status"] == "error"]
    
    print(f"Triggered: {len(successes)}/{len(payloads)}")
    
    if successes:
        print("\nSuccessful optimizations:")
        for r in successes:
            print(f"  - {r['name']} (id: {r['id']})")
            print(f"    Optimizer: {r['optimizer']}, Metric: {r['metric']}")
    
    if failures:
        print("\nFailed optimizations:")
        for r in failures:
            print(f"  - {r['name']}: {r.get('error', 'Unknown error')}")
    
    print(f"\n{'='*60}")
    print("Monitor with: python scripts/monitor_optimization_jobs.py")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
