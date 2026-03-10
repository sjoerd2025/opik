"""Temporary demo endpoints to trigger GEPA optimizer scripts from the browser console.

AI_REMOVAL_NOTE: This is temporary demo code. To remove, revert the commit
titled "[NA] [FE+SDK] feat: temporary demo GEPA trigger from browser console".
"""

import os
import subprocess
import signal

from flask import Blueprint, request, jsonify, current_app

demo_runner = Blueprint("demo_runner", __name__, url_prefix="/v1/private/demo")

_running_processes: dict[str, subprocess.Popen] = {}

SCRIPTS = {
    "gepa-quick": os.path.join(
        "/opt/opik-optimizer/scripts/archive",
        "litellm_gepa_tiny_test_example.py",
    ),
    "gepa-e2e": os.path.join(
        "/opt/opik-optimizer/scripts/optimizer_algorithms",
        "gepa_hotpot_example.py",
    ),
}


def _build_env(workspace: str | None) -> dict[str, str]:
    env = os.environ.copy()
    if workspace:
        env["OPIK_WORKSPACE"] = workspace
    return env


@demo_runner.route("/run/<script_key>", methods=["POST"])
def run_script(script_key: str):
    if script_key not in SCRIPTS:
        return jsonify({"error": f"Unknown script: {script_key}"}), 400

    existing = _running_processes.get(script_key)
    if existing and existing.poll() is None:
        return jsonify({"error": f"{script_key} is already running", "pid": existing.pid}), 409

    script_path = SCRIPTS[script_key]
    if not os.path.exists(script_path):
        return jsonify({"error": f"Script not found: {script_path}"}), 404

    body = request.get_json(silent=True) or {}
    workspace = body.get("workspace") or os.environ.get("OPIK_WORKSPACE")

    proc = subprocess.Popen(
        ["python", script_path],
        env=_build_env(workspace),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        cwd=os.path.dirname(script_path),
    )
    _running_processes[script_key] = proc
    current_app.logger.info(f"Started {script_key} (pid={proc.pid}), workspace={workspace}")

    return jsonify({"status": "started", "pid": proc.pid, "script": script_key}), 202


@demo_runner.route("/status", methods=["GET"])
def status():
    result = {}
    for key, proc in _running_processes.items():
        poll = proc.poll()
        result[key] = {
            "pid": proc.pid,
            "running": poll is None,
            "returncode": poll,
        }
    return jsonify(result)


@demo_runner.route("/stop/<script_key>", methods=["POST"])
def stop_script(script_key: str):
    proc = _running_processes.get(script_key)
    if not proc or proc.poll() is not None:
        return jsonify({"error": f"{script_key} is not running"}), 404
    proc.send_signal(signal.SIGTERM)
    return jsonify({"status": "stopping", "pid": proc.pid})
