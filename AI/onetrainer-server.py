#!/usr/bin/env python3
"""
OneTrainer local server — started from the admin UI.
Runs on http://localhost:8765  (stdlib only, no extra deps)
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import os
import subprocess
import threading
import time

BASE_DIR      = os.path.dirname(os.path.abspath(__file__))
OT_DIR        = os.path.join(BASE_DIR, "OneTrainer", "OneTrainer")
PYTHON_EXE    = os.path.join(OT_DIR, "venv", "Scripts", "python.exe")
TRAIN_SCRIPT  = os.path.join(OT_DIR, "scripts", "train.py")
PRESETS_DIR   = os.path.join(OT_DIR, "training_presets")
TEMP_CONFIG   = os.path.join(OT_DIR, "_admin_train_config.json")
TEMP_CONCEPTS = os.path.join(OT_DIR, "_admin_concepts.json")
PORT          = 8765

# ── Global state ──────────────────────────────────────────────────────────────

_lock    = threading.Lock()
_process = None
_state   = {
    "status":     "idle",   # idle | running | done | error | cancelled
    "pid":        None,
    "logs":       [],
    "returncode": None,
    "started_at": None,
    "run_name":   None,
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def read_presets():
    out = []
    try:
        for fname in sorted(os.listdir(PRESETS_DIR)):
            if not fname.endswith(".json"):
                continue
            fpath = os.path.join(PRESETS_DIR, fname)
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                out.append({"filename": fname, "name": fname[:-5], "config": cfg})
            except Exception:
                pass
    except Exception:
        pass
    return out


def _stream_output(proc):
    """Background thread: read stdout/stderr and append to _state["logs"]."""
    global _state
    try:
        for raw in proc.stdout:
            line = raw.rstrip()
            with _lock:
                _state["logs"].append(line)
    except Exception:
        pass
    proc.wait()
    with _lock:
        if _state["status"] == "running":
            _state["status"]     = "done" if proc.returncode == 0 else "error"
            _state["returncode"] = proc.returncode
            _state["pid"]        = None


# ── HTTP handler ──────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # suppress default access log

    # ── CORS / response helpers ──────────────────────────────────────────────

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, x-admin-password")

    def _json(self, data, code=200):
        body = json.dumps(data, default=str).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type",   "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors_headers()
        self.end_headers()

    # ── GET ──────────────────────────────────────────────────────────────────

    def do_GET(self):
        if self.path == "/health":
            self._json({"status": "ok"})

        elif self.path == "/presets":
            self._json(read_presets())

        elif self.path == "/status":
            with _lock:
                snap = dict(_state)
                snap["logs"] = list(snap["logs"][-300:])   # last 300 lines
            self._json(snap)

        else:
            self._json({"error": "not found"}, 404)

    # ── POST ─────────────────────────────────────────────────────────────────

    def _body(self):
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n)) if n else {}

    def do_POST(self):
        global _process

        # ── /train ──────────────────────────────────────────────────────────
        if self.path == "/train":
            body     = self._body()
            config   = body.get("config", {})
            concepts = body.get("concepts", [])
            run_name = body.get("name", "Training Run")

            with _lock:
                if _state["status"] == "running":
                    self._json({"error": "Training already in progress"}, 409)
                    return

            # Write concept file
            with open(TEMP_CONCEPTS, "w", encoding="utf-8") as f:
                json.dump(concepts, f, indent=2)

            # Merge concept file path into config (remove inline concepts if any)
            config["concept_file_name"] = TEMP_CONCEPTS
            config.pop("concepts", None)

            # Write merged config
            with open(TEMP_CONFIG, "w", encoding="utf-8") as f:
                json.dump(config, f, indent=2)

            # Reset state
            with _lock:
                _state.update({
                    "status":     "running",
                    "pid":        None,
                    "logs":       [f"[server] Starting '{run_name}'..."],
                    "returncode": None,
                    "started_at": time.time(),
                    "run_name":   run_name,
                })

            try:
                _env = os.environ.copy()
                _env["CUDA_VISIBLE_DEVICES"] = "1"  # Use RTX (GPU 1), not Intel integrated (GPU 0)
                proc = subprocess.Popen(
                    [PYTHON_EXE, TRAIN_SCRIPT, "--config-path", TEMP_CONFIG],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                    cwd=OT_DIR,
                    env=_env,
                )
                _process = proc
                with _lock:
                    _state["pid"] = proc.pid

                t = threading.Thread(target=_stream_output, args=(proc,), daemon=True)
                t.start()

                self._json({"started": True, "pid": proc.pid})

            except Exception as exc:
                with _lock:
                    _state["status"] = "error"
                    _state["logs"].append(f"[server] Failed to start: {exc}")
                self._json({"error": str(exc)}, 500)

        # ── /cancel ─────────────────────────────────────────────────────────
        elif self.path == "/cancel":
            cancelled = False
            with _lock:
                running = _state["status"] == "running"
            if _process and running:
                try:
                    _process.terminate()
                    cancelled = True
                    with _lock:
                        _state["status"] = "cancelled"
                        _state["logs"].append("[server] Training cancelled by user.")
                except Exception:
                    pass
            self._json({"cancelled": cancelled})

        else:
            self._json({"error": "not found"}, 404)


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    server = HTTPServer(("localhost", PORT), Handler)
    print(f"[OneTrainer server] Listening on http://localhost:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[OneTrainer server] Shutting down.", flush=True)
