from fastapi import APIRouter, Depends, HTTPException, Request
from backend.services.officer_metrics import calculate_metrics
from backend.services.credibility_engine import calculate_credibility
from backend.routes.auth import get_current_user
from pydantic import BaseModel, EmailStr
from backend.utils.password import hash_password
from fastapi import Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
security = HTTPBearer()
import sqlite3
from backend.db import get_db_path

class OfficerCreate(BaseModel):
    username: EmailStr
    password: str
    full_name: str
    age: int
    gender: str
    district: str
    role: str = "case_officer"

router = APIRouter(prefix="/api", tags=["officers"])

@router.post("/officers")
async def create_officer(
    payload: OfficerCreate,
    request: Request,
    credentials: HTTPAuthorizationCredentials = Security(security),
    current_user=Depends(get_current_user)
):
    print("AUTH HEADER:", request.headers.get("Authorization"))

    # 🔐 Only admin can create officers
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    import sqlite3
    from backend.db import get_db_path

    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    hashed_pwd = hash_password(payload.password)

    cur.execute("""
        INSERT INTO officers (
            username,
            hashed_password,
            full_name,
            age,
            gender,
            district,
            role,
            is_active
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    """, (
        payload.username,
        hashed_pwd,
        payload.full_name,
        payload.age,
        payload.gender,
        payload.district,
        payload.role
    ))

    conn.commit()
    conn.close()

    return {"message": "Officer created successfully"}

@router.get("/officers")
def list_officers():
    import sqlite3
    from backend.db import get_db_path  # or use your db helper

    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute("""
        SELECT
            id,
            username,
            full_name,
            age,
            gender,
            district,
            is_active,
            role,
            created_at
        FROM officers
    """)

    rows = cur.fetchall()
    conn.close()

    officers = [dict(r) for r in rows]
    return officers


@router.get("/officers/{officer_id}/dashboard")
def officer_dashboard(officer_id: int):
    raw_metrics = calculate_metrics(officer_id)

    # 🔧 NORMALIZE METRICS (single source of truth)
    metrics = {
    "assigned": raw_metrics.get("total_assigned", 0),
        "completed": raw_metrics.get("granted", 0),
        "pending": raw_metrics.get("pending", 0),
        "avg_resolution": raw_metrics.get("avg_resolution_days", 0),
        "long_pending": raw_metrics.get("long_pending", 0),
    # ✅ REQUIRED BY credibility_engine
    "reopened": raw_metrics.get("reopened", 0),
    "reopen_rate": raw_metrics.get("reopen_rate", 0.0),
    }

    credibility = calculate_credibility(metrics)

    alerts = []
    if metrics["long_pending"] > 0:
        alerts.append("Long pending cases detected")

    if credibility["label"] in ["Low", "Critical"]:
        alerts.append("Credibility below acceptable level")

    return {
    "metrics": {
        **raw_metrics,
        **metrics,
    },

    # ✅ ADD THIS (frontend-friendly)
    "credibility_score": credibility["score"],

    # keep full object for charts / labels
    "credibility": credibility,

    "alerts": alerts,
}


#  OFFICER CASE BREAKDOWN 
@router.get("/officers/{officer_id}/breakdown")
def officer_case_breakdown(officer_id: int):
    raw_metrics = calculate_metrics(officer_id)
    return {
    "approved": raw_metrics.get("granted", 0),
    "pending": raw_metrics.get("pending", 0),
    "rejected": raw_metrics.get("rejected", 0),
    "reopened": raw_metrics.get("reopened", 0),
    }

@router.get("/officers/{officer_id}/timeline")
def officer_timeline(officer_id: int):
    import sqlite3
    from backend.db import DATABASE_URL

    db_path = DATABASE_URL.split("///")[-1]
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cur.execute("""
        SELECT DATE(assigned_date) as day, COUNT(*)
        FROM claims
        WHERE assigned_officer_id = ?
        GROUP BY day
        ORDER BY day
    """, (officer_id,))

    rows = cur.fetchall()
    conn.close()

    return [{"date": r[0], "count": r[1]} for r in rows]


