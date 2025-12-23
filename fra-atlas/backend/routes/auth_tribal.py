# backend/routes/auth_tribal.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import random
import time
import os
import requests
from dotenv import load_dotenv

# Load environment variables from .env (dev)
load_dotenv()

router = APIRouter(prefix="/auth/tribal", tags=["auth"])

# MSG91 config (optional)
MSG91_API_KEY = os.getenv("MSG91_API_KEY")
MSG91_SENDER_ID = os.getenv("MSG91_SENDER_ID", "FRAOTP")
MSG91_TEMPLATE_ID = os.getenv("MSG91_TEMPLATE_ID")  # optional, provider-specific

# temporary in-memory store — dev only
otp_store: dict = {}

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
    if not MSG91_API_KEY:
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

    # Generate OTP
    otp = f"{random.randint(100000, 999999)}"  # 6-digit
    ttl_seconds = 300  # 5 minutes

    # If MSG91 is configured and method is mobile -> attempt to send SMS
    if method == "mobile" and MSG91_API_KEY:
        # Attempt sending; if successful, store OTP; on failure, exception is raised
        send_sms_otp_msg91(data.value, otp)
        # store OTP only after successful SMS send
        otp_store[data.value] = {"otp": otp, "expires": time.time() + ttl_seconds}
        print(f"[OTP] Sent via MSG91 to {data.value}")  # avoid printing OTP in prod
    else:
        # Dev fallback: store OTP and print to logs (for local testing)
        otp_store[data.value] = {"otp": otp, "expires": time.time() + ttl_seconds}
        # For Aadhaar and non-MSG91 flow we print OTP so dev can test UI
        print(f"[DEV OTP] {method} {data.value} -> {otp}")

    return {"success": True, "message": "OTP sent (or logged for dev)."}

@router.post("/verify-otp")
async def verify_otp(data: OTPVerify):
    """
    Verify OTP for identifier. On success, returns a token (mock) and role 'tribal'.
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
    if data.otp != rec["otp"]:
        raise HTTPException(status_code=400, detail="Invalid OTP. Please try again.")

    # Successful verification: delete OTP and return mock token (replace with real auth)
    try:
        del otp_store[data.value]
    except KeyError:
        pass

    token = f"mock-jwt-token-for-{data.value}"
    return {"success": True, "token": token, "role": "tribal", "message": "OTP verified"}
