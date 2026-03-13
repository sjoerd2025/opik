#!/usr/bin/env python3
"""
Monitor optimization log sync progress.

Fetches presigned URL and compares log line counts between Redis and S3
every 10 seconds for 3 minutes.
"""

import argparse
import gzip
import time
from datetime import datetime
from typing import Optional

import requests
import redis


def get_presigned_url(backend_url: str, optimization_id: str, workspace_id: str) -> Optional[str]:
    """Fetch presigned URL from backend."""
    url = f"{backend_url}/v1/private/optimizations/studio/{optimization_id}/logs"
    # Don't send Comet-Workspace header - let backend use default workspace
    headers = {}
    
    try:
        response = requests.get(url, headers=headers)
        if response.status_code != 200:
            print(f"Error: {response.status_code} - {response.text}")
            return None
        data = response.json()
        return data.get("url")
    except Exception as e:
        print(f"Error fetching presigned URL: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"Response: {e.response.text}")
        return None


def get_redis_log_count(redis_client: redis.Redis, workspace_id: str, optimization_id: str) -> int:
    """Get log line count from Redis."""
    key = f"opik:logs:{workspace_id}:{optimization_id}"
    try:
        return redis_client.llen(key)
    except Exception as e:
        print(f"Error reading Redis: {e}")
        return -1


def get_s3_log_count(presigned_url: str) -> int:
    """Get log line count from S3 by fetching and decompressing."""
    try:
        response = requests.get(presigned_url, timeout=10)
        
        # File might not exist yet (404)
        if response.status_code == 404:
            return 0
        
        response.raise_for_status()
        
        # Decompress gzipped content
        decompressed = gzip.decompress(response.content)
        content = decompressed.decode("utf-8")
        
        # Count non-empty lines
        lines = [line for line in content.split("\n") if line.strip()]
        return len(lines)
    except requests.exceptions.RequestException as e:
        print(f"Error fetching from S3: {e}")
        return -1
    except Exception as e:
        print(f"Error processing S3 content: {e}")
        return -1


def main():
    parser = argparse.ArgumentParser(description="Monitor optimization log sync progress")
    parser.add_argument("optimization_id", help="Optimization ID to monitor")
    parser.add_argument("workspace_id", nargs="?", help="Workspace ID (optional, will try to fetch if not provided)")
    
    args = parser.parse_args()
    
    # Hardcoded values for local development
    BACKEND_URL = "http://localhost:8080"
    WORKSPACE_ID = args.workspace_id or "0190babc-62a0-71d2-832a-0feffa4676eb"  # Default, override if needed
    REDIS_HOST = "localhost"
    REDIS_PORT = 6379
    REDIS_PASSWORD = "opik"
    REDIS_DB = 0
    
    # Connect to Redis
    redis_client = redis.Redis(
        host=REDIS_HOST,
        port=REDIS_PORT,
        password=REDIS_PASSWORD,
        db=REDIS_DB,
        decode_responses=False,  # We need raw bytes for binary data
    )
    
    # Fetch presigned URL
    print(f"Fetching presigned URL for optimization {args.optimization_id} in workspace {WORKSPACE_ID}...")
    presigned_url = get_presigned_url(BACKEND_URL, args.optimization_id, WORKSPACE_ID)
    
    if not presigned_url:
        print("Failed to get presigned URL. Exiting.")
        return
    
    print(f"Presigned URL obtained. Monitoring for 3 minutes (every 10 seconds)...")
    print(f"{'Timestamp':<25} {'Redis Lines':<15} {'S3 Lines':<15} {'Diff':<10}")
    print("-" * 65)
    
    # Monitor for 3 minutes (18 iterations at 10s intervals)
    start_time = time.time()
    end_time = start_time + (3 * 60)  # 3 minutes
    
    iteration = 0
    while time.time() < end_time:
        iteration += 1
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        # Get counts
        redis_count = get_redis_log_count(redis_client, WORKSPACE_ID, args.optimization_id)
        s3_count = get_s3_log_count(presigned_url)
        
        # Calculate difference
        diff = redis_count - s3_count if redis_count >= 0 and s3_count >= 0 else "N/A"
        
        # Print results
        print(f"{timestamp:<25} {redis_count:<15} {s3_count:<15} {diff:<10}")
        
        # Wait 10 seconds (or until end time)
        sleep_time = min(10, end_time - time.time())
        if sleep_time > 0:
            time.sleep(sleep_time)
    
    print(f"\nMonitoring complete. Total iterations: {iteration}")


if __name__ == "__main__":
    main()

