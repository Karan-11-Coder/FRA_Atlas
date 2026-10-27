import sqlite3
from datetime import datetime, timezone

from backend.db import get_db_path
from backend.config.thresholds import LONG_PENDING_DAYS


def calculate_metrics(officer_id: int) -> dict:
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # 1️⃣ Total assigned
    cur.execute("""
        SELECT COUNT(*) AS total
        FROM claims
        WHERE assigned_officer_id = ?
    """, (officer_id,))
    total_assigned = cur.fetchone()["total"]

    # 2️⃣ Granted
    cur.execute("""
        SELECT COUNT(*) AS granted
        FROM claims
        WHERE assigned_officer_id = ?
        AND status = 'Granted'
    """, (officer_id,))
    granted = cur.fetchone()["granted"]

    # 3️⃣ Pending
    cur.execute("""
        SELECT COUNT(*) AS pending
        FROM claims
        WHERE assigned_officer_id = ?
        AND status = 'Pending'
    """, (officer_id,))
    pending = cur.fetchone()["pending"]

    # 4️⃣ Avg resolution time (days)
    cur.execute("""
        SELECT assigned_date, closed_date
        FROM claims
        WHERE assigned_officer_id = ?
        AND closed_date IS NOT NULL
    """, (officer_id,))

    durations = []
    for row in cur.fetchall():
        try:
            start = datetime.fromisoformat(row["assigned_date"])
            end = datetime.fromisoformat(row["closed_date"])
            durations.append((end - start).days)
        except Exception:
            pass

    avg_resolution_days = round(sum(durations) / len(durations), 2) if durations else None

    # 5️⃣ Long pending cases (>30 days)
    cur.execute("""
        SELECT assigned_date
        FROM claims
        WHERE assigned_officer_id = ?
        AND status = 'Pending'
        AND assigned_date IS NOT NULL
    """, (officer_id,))

    long_pending = 0
    now = datetime.now(timezone.utc)

    for row in cur.fetchall():
        try:
            start = datetime.fromisoformat(row["assigned_date"])
            if (now - start).days > LONG_PENDING_DAYS:
                long_pending += 1
        except Exception:
            pass

    # 6️⃣ Reopens
    cur.execute("""
        SELECT SUM(reopen_count) AS total_reopens
        FROM claims
        WHERE assigned_officer_id = ?
    """, (officer_id,))
    reopen_count = cur.fetchone()["total_reopens"] or 0
    reopen_rate = min(1.0, reopen_count / total_assigned) if total_assigned else 0.0

    conn.close()

    return {
        "officer_id": officer_id,
        "total_assigned": total_assigned,
        "granted": granted,
        "pending": pending,
        "avg_resolution_days": avg_resolution_days,
        "long_pending": long_pending,
        "reopen_count": reopen_count,
        "reopen_rate": reopen_rate,
    }
