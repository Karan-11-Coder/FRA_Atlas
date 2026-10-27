# backend/routes/auth_tribal.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import random
import time
import os
from pathlib import Path
import requests
from dotenv import load_dotenv
from backend.routes.auth import create_access_token

# Explicit path, not a bare load_dotenv() — see the comment in
# backend/routes/auth.py for why (frame-based path detection breaks inside
# uvicorn --reload's spawned subprocess on Windows).
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

router = APIRouter(prefix="/auth/tribal", tags=["auth"])

# MSG91 config (optional)
MSG91_API_KEY = os.getenv("MSG91_API_KEY")
MSG91_SENDER_ID = os.getenv("MSG91_SENDER_ID", "FRAOTP")
MSG91_TEMPLATE_ID = os.getenv("MSG91_TEMPLATE_ID")  # optional, provider-specific


def _msg91_configured() -> bool:
    """
    A plain `if MSG91_API_KEY:` treats the unfilled template value in
    backend/.env.example ("your_real_msg91_key_here") as configured, since
    it's a non-empty string — which routed every mobile-number OTP request
    down the real-SMS path (send_sms_otp_msg91) instead of the dev-mode
    fallback logger that the Aadhaar path already correctly uses. Reject
    obvious placeholder values too, not just empty/unset ones.
    """
    key = (MSG91_API_KEY or "").strip()
    if not key:
        return False
    placeholder_markers = ("your_", "changeme", "xxxxx", "placeholder", "replace_me")
    return not any(marker in key.lower() for marker in placeholder_markers)


MSG91_CONFIGURED = _msg91_configured()

# temporary in-memory store — dev only. Lost on restart and not shared across
# worker processes; fine for a single-process hackathon deployment, not for
# production (use Redis or a DB table with a TTL there instead).
otp_store: dict = {}

MAX_OTP_ATTEMPTS = 5
OTP_RESEND_COOLDOWN_SECONDS = 30

class OTPRequest(BaseModel):
    method: str  # "mobile" or "aadhaar"
    value: str   # mobile number or Aadhaar number

class OTPVerify(BaseModel):
    method: str
    value: str
    otp: str

def send_sms_otp_msg91(mobile: str, otp: str):
    """
    Send OTP using MSG91's OTP API.
    Raises HTTPException on failure.
    """
    if not MSG91_CONFIGURED:
        raise RuntimeError("MSG91 API key not configured")

    url = "https://control.msg91.com/api/v5/otp"
    headers = {"authkey": MSG91_API_KEY, "Content-Type": "application/json"}
    payload = {
        "mobile": f"91{mobile}",  # country code for India
        # MSG91 expects template-based OTP or other params depending on your plan
        # We include 'otp' for demo — use the provider's recommended payload.
        "otp": otp,
    }
    # include optional fields only if set
    if MSG91_SENDER_ID:
        payload["sender"] = MSG91_SENDER_ID
    if MSG91_TEMPLATE_ID:
        payload["template_id"] = MSG91_TEMPLATE_ID

    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=10)
        resp.raise_for_status()
        # Optionally, inspect resp.json() for provider-specific success flags.
        return resp.json()
    except requests.RequestException as exc:
        # Log the provider error and raise HTTPException for the FastAPI client
        print(f"[MSG91] Error sending OTP to {mobile}: {exc} - response: {getattr(exc, 'response', None)}")
        raise HTTPException(status_code=502, detail="Failed to send OTP SMS via MSG91")

@router.post("/send-otp")
async def send_otp(data: OTPRequest):
    """
    Generate an OTP and send (or log) it.
    If MSG91 is configured, attempt to send SMS — otherwise print OTP to server logs (dev).
    """
    method = (data.method or "").lower()
    if method not in ("mobile", "aadhaar"):
        raise HTTPException(status_code=400, detail="Invalid method; use 'mobile' or 'aadhaar'")

    # Basic validation for formats (simple, adjust as needed)
    if method == "mobile" and not (data.value.isdigit() and len(data.value) == 10):
        raise HTTPException(status_code=400, detail="Invalid mobile number format")
    if method == "aadhaar" and not (data.value.isdigit() and len(data.value) == 12):
        raise HTTPException(status_code=400, detail="Invalid Aadhaar number format")

    # Cooldown: block rapid repeat requests for the same identifier (basic
    # anti-SMS-bombing / anti-brute-force measure).
    existing = otp_store.get(data.value)
    if existing and time.time() < existing.get("resend_after", 0):
        wait = int(existing["resend_after"] - time.time())
        raise HTTPException(status_code=429, detail=f"Please wait {wait}s before requesting another OTP")

    # Generate OTP
    otp = f"{random.randint(100000, 999999)}"  # 6-digit
    ttl_seconds = 300  # 5 minutes

    record = {
        "otp": otp,
        "expires": time.time() + ttl_seconds,
        "resend_after": time.time() + OTP_RESEND_COOLDOWN_SECONDS,
        "attempts": 0,
    }

    # If MSG91 is configured and method is mobile -> attempt to send SMS
    if method == "mobile" and MSG91_CONFIGURED:
        # Attempt sending; if successful, store OTP; on failure, exception is raised
        send_sms_otp_msg91(data.value, otp)
        # store OTP only after successful SMS send
        otp_store[data.value] = record
        print(f"[OTP] Sent via MSG91 to {data.value}")  # avoid printing OTP in prod
    else:
        # Dev fallback: store OTP and print to logs (for local testing)
        otp_store[data.value] = record
        # For Aadhaar and non-MSG91 flow we print OTP so dev can test UI
        print(f"[DEV OTP] {method} {data.value} -> {otp}")

    return {"success": True, "message": "OTP sent (or logged for dev)."}

@router.post("/verify-otp")
async def verify_otp(data: OTPVerify):
    """
    Verify OTP for identifier. On success, returns a real signed JWT (role
    'tribal', sub = the mobile/Aadhaar identifier) — not a plain mock string.

    Note: this token isn't recognized by get_current_user() in
    backend/routes/auth.py, which looks the subject up in the officers table.
    Tribal claimants aren't officers, so any endpoint meant to accept tribal
    tokens needs its own lookup/authorization path — out of scope for this
    fix, which only replaces the fake token with a real, unforgeable one.
    """
    rec = otp_store.get(data.value)
    if not rec:
        raise HTTPException(status_code=400, detail="No OTP found for this identifier. Request a new OTP.")
    if time.time() > rec["expires"]:
        # cleanup expired OTP
        try:
            del otp_store[data.value]
        except KeyError:
            pass
        raise HTTPException(status_code=400, detail="OTP expired. Request a new OTP.")

    rec["attempts"] = rec.get("attempts", 0) + 1
    if rec["attempts"] > MAX_OTP_ATTEMPTS:
        try:
            del otp_store[data.value]
        except KeyError:
            pass
        raise HTTPException(status_code=429, detail="Too many incorrect attempts. Request a new OTP.")

    if data.otp != rec["otp"]:
        raise HTTPException(status_code=400, detail="Invalid OTP. Please try again.")

    # Successful verification: delete OTP and issue a real signed JWT
    try:
        del otp_store[data.value]
    except KeyError:
        pass

    token = create_access_token({"sub": data.value, "role": "tribal", "method": data.method})
    return {"success": True, "token": token, "role": "tribal", "message": "OTP verified"}
