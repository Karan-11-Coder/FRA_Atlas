# backend/scripts/docker_start.py
"""
Container entry point: optionally seed demo data, then run the API.
(Python rather than a shell script so Windows line endings can't break it.)

  SEED_DEMO=1   run backend.scripts.seed_demo first (idempotent)
  PORT          default 8000
"""
import os
import sys

if os.getenv("SEED_DEMO") == "1":
    from backend.scripts import seed_demo
    seed_demo.main()

# exec replaces this process without flushing Python's buffers; flush first
# or the seed output can be lost.
sys.stdout.flush()
sys.stderr.flush()
os.execvp(sys.executable, [sys.executable, "-m", "uvicorn", "backend.main:app",
                           "--host", "0.0.0.0", "--port", os.getenv("PORT", "8000")])
