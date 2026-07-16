"""
Real sandboxed execution for Code-Builder-generated pandas cells, via Docker.

Before this module, kernel_runner.py ran as a plain subprocess of the Flask
process — same machine, same OS user, full network access, no resource caps.
That's fine for trusted code but not for LLM-generated code executing
against real (if synthetic-demo) data. This module runs the exact same
kernel_runner.py inside a locked-down container instead:

  --network none          no outbound network access at all
  --cap-drop ALL           no Linux capabilities beyond the bare minimum
  --security-opt no-new-privileges
  --read-only              root filesystem is immutable
  --pids-limit              fork-bomb ceiling
  --memory / --cpus         resource caps, not just a wall-clock timeout
  --user <host uid:gid>     bind-mounted files stay owned by you, not root

The wire protocol (JSON lines over stdin/stdout, "___PROBE_READY___" /
"___PROBE_OUTPUT_START___" / "___PROBE_OUTPUT_END___" markers) is unchanged —
notebook_engine.py talks to `docker run -i ...` exactly the way it talked to
a bare `python kernel_runner.py` subprocess. Only _start_kernel()'s command
construction and kernel teardown needed to change.

Falls back to the plain subprocess if Docker isn't installed/running, with a
loud one-time warning — this app should still work on a machine without
Docker, just without the isolation.
"""

import hashlib
import os
import subprocess
import sys
import threading
import time

IMAGE_TAG = "probe-sandbox:latest"
_SANDBOX_DIR = os.path.join(os.path.dirname(__file__), "sandbox")
_BACKEND_DIR = os.path.dirname(__file__)

_build_lock = threading.Lock()
_image_ready = False
_docker_checked = False
_docker_ok = False
_warned = False


def _warn_once(msg: str):
    global _warned
    if not _warned:
        print(f"[sandbox_runner] {msg}", file=sys.stderr)
        _warned = True


def docker_available() -> bool:
    global _docker_checked, _docker_ok
    if _docker_checked:
        return _docker_ok
    _docker_checked = True
    try:
        r = subprocess.run(["docker", "info"], capture_output=True, timeout=10)
        _docker_ok = r.returncode == 0
    except Exception:
        _docker_ok = False
    if not _docker_ok:
        _warn_once("Docker not available — falling back to unsandboxed subprocess execution. "
                    "Generated code will run with full network/filesystem access on this machine.")
    return _docker_ok


def ensure_image_built() -> bool:
    """Idempotent: builds probe-sandbox:latest once per process lifetime.
    Returns True if the image is ready to use."""
    global _image_ready
    if _image_ready:
        return True
    with _build_lock:
        if _image_ready:
            return True
        check = subprocess.run(["docker", "image", "inspect", IMAGE_TAG], capture_output=True)
        if check.returncode == 0:
            _image_ready = True
            return True
        print("[sandbox_runner] Building probe-sandbox image (first run only, ~1-3 min)...", file=sys.stderr)
        build = subprocess.run(
            ["docker", "build", "-f", os.path.join(_SANDBOX_DIR, "Dockerfile"), "-t", IMAGE_TAG, _BACKEND_DIR],
            capture_output=True, text=True,
        )
        if build.returncode != 0:
            _warn_once(f"Sandbox image build failed, falling back to unsandboxed execution:\n{build.stderr[-2000:]}")
            return False
        _image_ready = True
        return True


def _container_name(session_dir: str) -> str:
    h = hashlib.sha256(session_dir.encode()).hexdigest()[:16]
    return f"probe-kernel-{h}"


def start_kernel_process(session_dir: str) -> dict:
    """Returns {"proc": Popen, "backend": "docker"|"subprocess", "container_name": str|None}.
    `proc` behaves like the plain-subprocess case for stdin/stdout purposes —
    callers don't need to know which backend is in use for normal operation,
    only for teardown (use kill_kernel(), not proc.kill() directly)."""
    os.makedirs(session_dir, exist_ok=True)

    if docker_available() and ensure_image_built():
        name = _container_name(session_dir)
        subprocess.run(["docker", "rm", "-f", name], capture_output=True)  # clear any stale container from a crash
        cmd = [
            "docker", "run", "-i", "--rm", "--name", name,
            "--network", "none",
            "--cpus", "1.0",
            "--memory", "768m",
            "--memory-swap", "768m",
            "--pids-limit", "128",
            "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges",
            "--read-only",
            "--tmpfs", "/tmp:rw,size=256m",
            "--user", f"{os.getuid()}:{os.getgid()}",
            "-v", f"{session_dir}:{session_dir}:rw",
            IMAGE_TAG,
        ]
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True, bufsize=1)
        return {"proc": proc, "backend": "docker", "container_name": name}

    # Fallback — same as the pre-sandbox behavior.
    runner = os.path.join(_BACKEND_DIR, "kernel_runner.py")
    proc = subprocess.Popen([sys.executable, runner], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True, bufsize=1)
    return {"proc": proc, "backend": "subprocess", "container_name": None}


def kill_kernel(entry: dict):
    """proc.kill() alone leaks a running container in docker mode — SIGKILL
    can't be forwarded/handled, it just kills the `docker run` CLI client and
    leaves the container running server-side. Stop the container explicitly
    first, then the client process."""
    if entry.get("backend") == "docker" and entry.get("container_name"):
        subprocess.run(["docker", "kill", entry["container_name"]], capture_output=True, timeout=10)
    try:
        entry["proc"].kill()
    except Exception:
        pass
