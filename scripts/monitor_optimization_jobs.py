#!/usr/bin/env python3
"""
Optimization Studio Job Monitor

Displays real-time status of optimization jobs by querying:
- RQ jobs from Redis (queue state, worker assignments)
- Optimization logs from the python-backend container

Usage:
    python scripts/monitor_optimization_jobs.py [--interval 10] [--redis-host localhost]

Requirements:
    pip install redis rich
"""

import argparse
import json
import os
import sys
import time
import zlib
from datetime import datetime
from typing import Dict, List, Any, Optional

try:
    import redis
    from rich.console import Console
    from rich.table import Table
    from rich.live import Live
    from rich.panel import Panel
    from rich.text import Text
except ImportError:
    print("Missing dependencies. Install with: pip install redis rich")
    sys.exit(1)


# Global cache for RQ job ID -> optimization ID mapping
_job_to_opt_map: Dict[str, str] = {}
_opt_to_job_map: Dict[str, str] = {}


# Redis configuration
DEFAULT_REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
DEFAULT_REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
DEFAULT_REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", "opik")
DEFAULT_REDIS_DB = int(os.getenv("REDIS_DB", "0"))

# Queue name for optimizer jobs
OPTIMIZER_QUEUE = "opik:optimizer-cloud"

console = Console()


def get_redis_client(host: str, port: int, password: str, db: int) -> redis.Redis:
    """Create Redis client with connection pooling."""
    return redis.Redis(
        host=host,
        port=port,
        password=password,
        db=db,
        decode_responses=False,  # Handle binary data manually
        socket_timeout=5,
    )


def safe_decode(value) -> str:
    """Safely decode bytes to string."""
    if value is None:
        return ""
    if isinstance(value, bytes):
        try:
            return value.decode('utf-8')
        except UnicodeDecodeError:
            return "<binary>"
    return str(value)


def extract_optimization_id_from_job(job_data_bytes: bytes) -> Optional[str]:
    """Extract optimization_id from RQ job data (may be compressed or plain JSON)."""
    if not job_data_bytes:
        return None
    
    # Try to decode - might be plain text or compressed
    try:
        # First try as plain text/JSON
        if isinstance(job_data_bytes, bytes):
            try:
                text = job_data_bytes.decode('utf-8')
            except UnicodeDecodeError:
                # Might be compressed, try zlib
                try:
                    text = zlib.decompress(job_data_bytes).decode('utf-8')
                except:
                    return None
        else:
            text = str(job_data_bytes)
        
        # Format: ["function_name", null, [{"optimization_id": "...", ...}], {}]
        data = json.loads(text)
        if isinstance(data, list) and len(data) >= 3:
            args = data[2]
            if isinstance(args, list) and len(args) > 0:
                msg = args[0]
                if isinstance(msg, dict):
                    return msg.get("optimization_id")
    except (json.JSONDecodeError, IndexError, TypeError, Exception):
        pass
    return None


def update_job_optimization_maps(r: redis.Redis) -> None:
    """Scan RQ jobs and update the job_id <-> optimization_id mappings."""
    global _job_to_opt_map, _opt_to_job_map
    
    job_keys = r.keys("rq:job:*")
    for key in job_keys:
        try:
            key_str = safe_decode(key)
            job_id = key_str.replace("rq:job:", "")
            
            # Skip if already mapped
            if job_id in _job_to_opt_map:
                continue
            
            # Get the compressed job data
            job_data = r.hget(key, "data")
            if job_data:
                opt_id = extract_optimization_id_from_job(job_data)
                if opt_id:
                    _job_to_opt_map[job_id] = opt_id
                    _opt_to_job_map[opt_id] = job_id
        except Exception:
            pass


def get_rq_jobs(r: redis.Redis) -> List[Dict[str, Any]]:
    """Get all RQ jobs from Redis."""
    jobs = []
    
    # Get all job keys
    job_keys = r.keys("rq:job:*")
    
    for key in job_keys:
        try:
            key_str = safe_decode(key)
            job_data = r.hgetall(key)
            if job_data:
                job_id = key_str.replace("rq:job:", "")
                
                # Safely decode all fields
                decoded_data = {safe_decode(k): safe_decode(v) for k, v in job_data.items()}
                
                # Parse timestamps
                created_at = decoded_data.get("created_at", "")
                started_at = decoded_data.get("started_at", "")
                ended_at = decoded_data.get("ended_at", "")
                status = decoded_data.get("status", "unknown")
                worker_name = decoded_data.get("worker_name", "")
                origin = decoded_data.get("origin", "")
                
                # Extract optimization_id from description if available
                optimization_id = None
                description = decoded_data.get("description", "")
                if "optimization_id" in description.lower() or job_id.startswith("019b"):
                    # Use job_id as optimization reference
                    optimization_id = job_id
                
                jobs.append({
                    "job_id": job_id[:16] + "..." if len(job_id) > 19 else job_id,
                    "_full_job_id": job_id,  # Keep full ID for meta lookup
                    "optimization_id": optimization_id[:16] + "..." if optimization_id and len(optimization_id) > 19 else optimization_id,
                    "status": status,
                    "origin": origin,
                    "created_at": _format_timestamp(created_at),
                    "started_at": _format_timestamp(started_at),
                    "ended_at": _format_timestamp(ended_at),
                    "worker_name": worker_name,  # Full worker name
                    "_raw_created_at": created_at,  # For sorting
                })
        except Exception as e:
            pass  # Silently skip unparseable jobs
    
    # Sort by raw created_at timestamp (ISO format sorts correctly as string)
    return sorted(jobs, key=lambda x: x.get("_raw_created_at", ""), reverse=True)


def get_queue_info(r: redis.Redis) -> Dict[str, Any]:
    """Get queue statistics."""
    queue_key = f"rq:queue:{OPTIMIZER_QUEUE}"
    queue_length = r.llen(queue_key)
    queued_jobs = r.lrange(queue_key, 0, -1)
    
    return {
        "queue_name": OPTIMIZER_QUEUE,
        "pending_jobs": queue_length,
        "queued_job_ids": [safe_decode(j) for j in queued_jobs[:5]],  # First 5
    }


def get_worker_info(r: redis.Redis) -> List[Dict[str, Any]]:
    """Get registered RQ workers."""
    workers = []
    worker_keys = r.smembers("rq:workers")
    
    for worker_key in worker_keys:
        try:
            worker_key_str = safe_decode(worker_key)
            # Worker key format: rq:worker:<hostname>-<pid>-<index>
            worker_name = worker_key_str.replace("rq:worker:", "") if worker_key_str.startswith("rq:worker:") else worker_key_str
            
            # Get worker data
            worker_data = r.hgetall(f"rq:worker:{worker_name}")
            decoded_data = {safe_decode(k): safe_decode(v) for k, v in worker_data.items()}
            
            workers.append({
                "name": worker_name,
                "state": decoded_data.get("state", "unknown"),
                "current_job": decoded_data.get("current_job", ""),
                "last_heartbeat": _format_timestamp(decoded_data.get("last_heartbeat", "")),
            })
        except Exception as e:
            pass  # Silently skip
    
    return workers


def _format_timestamp(ts: str) -> str:
    """Format ISO timestamp to readable format."""
    if not ts:
        return "-"
    try:
        # Handle various timestamp formats
        if "T" in ts:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            return dt.strftime("%H:%M:%S")
        return ts[:19] if len(ts) > 19 else ts
    except Exception:
        return ts[:19] if ts else "-"


def _format_epoch_ms(ts_ms: str) -> str:
    """Format epoch milliseconds to readable format."""
    if not ts_ms or ts_ms == "-":
        return "-"
    try:
        ts_int = int(ts_ms)
        dt = datetime.fromtimestamp(ts_int / 1000)
        return dt.strftime("%H:%M:%S")
    except (ValueError, OSError):
        return "-"


def get_optimization_meta(r: redis.Redis, optimization_id: str) -> Dict[str, str]:
    """Get optimization metadata (last_append_ts, last_flush_ts) from Redis."""
    # We need to find the workspace ID - scan for matching keys
    pattern = f"opik:logs:*:{optimization_id}:meta"
    keys = r.keys(pattern)
    
    if not keys:
        return {"last_log": "-", "last_flush": "-"}
    
    key = safe_decode(keys[0])
    meta = r.hgetall(key)
    decoded_meta = {safe_decode(k): safe_decode(v) for k, v in meta.items()}
    
    return {
        "last_log": _format_epoch_ms(decoded_meta.get("last_append_ts", "")),
        "last_flush": _format_epoch_ms(decoded_meta.get("last_flush_ts", "")),
    }


def get_all_optimizations(r: redis.Redis) -> List[Dict[str, Any]]:
    """Get all optimization metadata from Redis meta keys."""
    optimizations = []
    
    # Find all meta keys
    meta_keys = r.keys("opik:logs:*:meta")
    
    for key in meta_keys:
        try:
            key_str = safe_decode(key)
            # Parse key: opik:logs:{workspace_id}:{optimization_id}:meta
            parts = key_str.split(":")
            if len(parts) >= 4:
                optimization_id = parts[3]
                
                # Get meta data
                meta = r.hgetall(key)
                decoded_meta = {safe_decode(k): safe_decode(v) for k, v in meta.items()}
                
                last_append = decoded_meta.get("last_append_ts", "")
                last_flush = decoded_meta.get("last_flush_ts", "")
                
                optimizations.append({
                    "optimization_id": optimization_id,  # Full ID, no truncation
                    "last_log": _format_epoch_ms(last_append),
                    "last_flush": _format_epoch_ms(last_flush),
                    "_raw_last_append": last_append,
                })
        except Exception:
            pass
    
    # Sort by last_append timestamp (most recent first)
    return sorted(optimizations, key=lambda x: x.get("_raw_last_append", ""), reverse=True)


def _status_color(status: str) -> str:
    """Get color for status."""
    colors = {
        "queued": "yellow",
        "started": "blue",
        "finished": "green",
        "failed": "red",
        "running": "blue",
        "completed": "green",
        "error": "red",
        "cancelled": "magenta",
    }
    return colors.get(status.lower(), "white")


def create_jobs_table(jobs: List[Dict[str, Any]]) -> Table:
    """Create Rich table for jobs."""
    table = Table(title="RQ Jobs", show_header=True, header_style="bold cyan")
    
    table.add_column("Optimization ID", style="dim", width=15)
    table.add_column("Status", width=10)
    table.add_column("Worker", width=25)
    table.add_column("Created", width=10)
    table.add_column("Started", width=10)
    table.add_column("Ended", width=10)
    
    for job in jobs[:20]:  # Limit to 20 most recent
        status = job.get("status", "unknown")
        status_text = Text(status, style=_status_color(status))
        
        table.add_row(
            job.get("optimization_id") or job.get("job_id", "-"),
            status_text,
            job.get("worker_name", "-")[:25],
            job.get("created_at", "-"),
            job.get("started_at", "-"),
            job.get("ended_at", "-"),
        )
    
    return table


def create_workers_table(workers: List[Dict[str, Any]]) -> Table:
    """Create Rich table for workers."""
    table = Table(title="RQ Workers", show_header=True, header_style="bold cyan")
    
    table.add_column("Worker Name", style="dim", width=35)
    table.add_column("State", width=12)
    table.add_column("Current Job", width=15)
    table.add_column("Last Heartbeat", width=12)
    
    for worker in workers:
        state = worker.get("state", "unknown")
        state_text = Text(state, style="green" if state == "busy" else "yellow" if state == "idle" else "dim")
        
        current_job = worker.get("current_job", "")
        if current_job:
            current_job = current_job[:12] + "..."
        
        table.add_row(
            worker.get("name", "-"),
            state_text,
            current_job or "-",
            worker.get("last_heartbeat", "-"),
        )
    
    return table


def create_summary_panel(queue_info: Dict[str, Any], jobs: List[Dict[str, Any]], workers: List[Dict[str, Any]]) -> Panel:
    """Create summary panel."""
    # Count job statuses
    status_counts = {}
    for job in jobs:
        status = job.get("status", "unknown")
        status_counts[status] = status_counts.get(status, 0) + 1
    
    # Count worker states
    busy_workers = sum(1 for w in workers if w.get("state") == "busy")
    idle_workers = sum(1 for w in workers if w.get("state") == "idle")
    
    summary_parts = [
        f"[cyan]Queue:[/cyan] {queue_info.get('pending_jobs', 0)} pending",
        f"[cyan]Workers:[/cyan] {busy_workers} busy, {idle_workers} idle",
        f"[cyan]Jobs:[/cyan] " + ", ".join(f"[{_status_color(s)}]{s}:{c}[/{_status_color(s)}]" for s, c in status_counts.items()),
    ]
    
    return Panel(
        " | ".join(summary_parts),
        title=f"Optimization Monitor - {datetime.now().strftime('%H:%M:%S')}",
        border_style="blue",
    )


def get_unified_optimizations(r: redis.Redis) -> List[Dict[str, Any]]:
    """Get unified view of optimizations combining RQ job data and Redis meta."""
    global _opt_to_job_map, _job_to_opt_map
    
    optimizations = {}
    
    # STEP 1: Scan ALL RQ jobs first - this is the source of truth for status/started/ended
    # This includes queued, started, finished, and failed jobs
    job_keys = r.keys("rq:job:*")
    for key in job_keys:
        try:
            key_str = safe_decode(key)
            job_id = key_str.replace("rq:job:", "")
            
            # Get job info
            job_info = r.hgetall(key)
            if not job_info:
                continue
            
            decoded_job = {safe_decode(k): safe_decode(v) for k, v in job_info.items()}
            status = decoded_job.get("status", "unknown")
            
            # Check if this is an optimizer job (check origin queue)
            origin = decoded_job.get("origin", "")
            if "optimizer" not in origin.lower():
                continue
            
            # Try to extract optimization_id from job data
            job_data = r.hget(key, "data")
            opt_id = None
            if job_data:
                opt_id = extract_optimization_id_from_job(job_data)
            
            if opt_id:
                # Update maps
                _job_to_opt_map[job_id] = opt_id
                _opt_to_job_map[opt_id] = job_id
                
                # Create/update optimization entry
                optimizations[opt_id] = {
                    "optimization_id": opt_id,
                    "status": status,
                    "started": _format_timestamp(decoded_job.get("started_at", "")),
                    "last_log": "-",
                    "last_flush": "-",
                    "ended": _format_timestamp(decoded_job.get("ended_at", "")),
                    "worker": decoded_job.get("worker_name", "-"),
                    "_raw_last_append": "",
                    "_raw_created_at": decoded_job.get("created_at", ""),
                }
        except Exception:
            pass
    
    # STEP 2: Enrich with optimization meta from Redis (for last_log and last_flush)
    meta_keys = r.keys("opik:logs:*:meta")
    for key in meta_keys:
        try:
            key_str = safe_decode(key)
            parts = key_str.split(":")
            if len(parts) >= 4:
                optimization_id = parts[3]
                meta = r.hgetall(key)
                decoded_meta = {safe_decode(k): safe_decode(v) for k, v in meta.items()}
                
                if optimization_id in optimizations:
                    # Update existing entry with meta
                    optimizations[optimization_id]["last_log"] = _format_epoch_ms(decoded_meta.get("last_append_ts", ""))
                    optimizations[optimization_id]["last_flush"] = _format_epoch_ms(decoded_meta.get("last_flush_ts", ""))
                    optimizations[optimization_id]["_raw_last_append"] = decoded_meta.get("last_append_ts", "")
                else:
                    # Meta exists but no RQ job (job expired) - still show it
                    optimizations[optimization_id] = {
                        "optimization_id": optimization_id,
                        "status": "expired",
                        "started": "-",
                        "last_log": _format_epoch_ms(decoded_meta.get("last_append_ts", "")),
                        "last_flush": _format_epoch_ms(decoded_meta.get("last_flush_ts", "")),
                        "ended": "-",
                        "worker": "-",
                        "_raw_last_append": decoded_meta.get("last_append_ts", ""),
                        "_raw_created_at": "",
                    }
        except Exception:
            pass
    
    # Sort by created_at (most recent first), with fallback to last_append
    result = list(optimizations.values())
    return sorted(result, key=lambda x: x.get("_raw_created_at", "") or x.get("_raw_last_append", ""), reverse=True)


def monitor_loop(r: redis.Redis, interval: int):
    """Main monitoring loop with periodic prints."""
    
    while True:
        try:
            # Gather data
            queue_info = get_queue_info(r)
            workers = get_worker_info(r)
            optimizations = get_unified_optimizations(r)
            
            # Print header
            print(f"{'='*140}")
            print(f"  Optimization Monitor - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
            print(f"{'='*140}")
            
            # Summary
            busy_workers = sum(1 for w in workers if w.get("state") == "busy")
            idle_workers = sum(1 for w in workers if w.get("state") == "idle")
            
            print(f"\nQueue: {queue_info.get('pending_jobs', 0)} pending | Workers: {busy_workers} busy, {idle_workers} idle | Optimizations: {len(optimizations)}")
            
            # Single unified table
            print(f"\n{'─'*140}")
            print(f"{'OPTIMIZATION ID':<40} {'STATUS':<10} {'STARTED':<10} {'LAST LOG':<10} {'LAST FLUSH':<12} {'ENDED':<10} {'WORKER':<25}")
            print(f"{'─'*140}")
            for opt in optimizations[:20]:
                opt_id = opt.get("optimization_id", "-")
                status = opt.get("status", "-")
                started = opt.get("started", "-")
                last_log = opt.get("last_log", "-")
                last_flush = opt.get("last_flush", "-")
                ended = opt.get("ended", "-")
                worker = opt.get("worker", "-")
                print(f"{opt_id:<40} {status:<10} {started:<10} {last_log:<10} {last_flush:<12} {ended:<10} {worker:<25}")
            
            print(f"\n{'='*140}")
            print(f"  Refresh in {interval}s... (Ctrl+C to exit)")
            sys.stdout.flush()
            
        except redis.ConnectionError as e:
            print(f"\n[ERROR] Redis connection error: {e}\nRetrying...")
            sys.stdout.flush()
        except Exception as e:
            print(f"\n[ERROR] {e}")
            sys.stdout.flush()
        
        time.sleep(interval)


def main():
    parser = argparse.ArgumentParser(description="Monitor Optimization Studio jobs")
    parser.add_argument("--interval", "-i", type=int, default=5, help="Refresh interval in seconds (default: 5)")
    parser.add_argument("--redis-host", default=DEFAULT_REDIS_HOST, help=f"Redis host (default: {DEFAULT_REDIS_HOST})")
    parser.add_argument("--redis-port", type=int, default=DEFAULT_REDIS_PORT, help=f"Redis port (default: {DEFAULT_REDIS_PORT})")
    parser.add_argument("--redis-password", default=DEFAULT_REDIS_PASSWORD, help="Redis password")
    parser.add_argument("--redis-db", type=int, default=DEFAULT_REDIS_DB, help=f"Redis DB (default: {DEFAULT_REDIS_DB})")
    
    args = parser.parse_args()
    
    console.print(f"[cyan]Connecting to Redis at {args.redis_host}:{args.redis_port}...[/cyan]")
    
    try:
        r = get_redis_client(args.redis_host, args.redis_port, args.redis_password, args.redis_db)
        r.ping()
        console.print("[green]Connected to Redis![/green]")
    except redis.ConnectionError as e:
        console.print(f"[red]Failed to connect to Redis: {e}[/red]")
        sys.exit(1)
    
    console.print(f"[cyan]Starting monitor (refresh every {args.interval}s). Press Ctrl+C to exit.[/cyan]")
    time.sleep(1)
    
    try:
        monitor_loop(r, args.interval)
    except KeyboardInterrupt:
        console.print("\n[yellow]Monitor stopped.[/yellow]")


if __name__ == "__main__":
    main()
