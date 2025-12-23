# backend/models.py
from sqlalchemy import Column, Integer, String, Text, DateTime, Float
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime

from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    DateTime,
    Float,
    UniqueConstraint,
    Index,
)
from sqlalchemy.orm import declarative_base  # modern import

Base = declarative_base()


class Claim(Base):
    __tablename__ = "claims"

    id = Column(Integer, primary_key=True, index=True)

    # Core FRA claim fields
    state = Column(String, nullable=False, index=True)
    district = Column(String, nullable=False, index=True)
    block = Column(String, nullable=True)
    village = Column(String, nullable=True, index=True)
    patta_holder = Column(String, nullable=True, index=False)
    address = Column(Text, nullable=True)
    land_area = Column(String, nullable=True)
    status = Column(String, default="Pending", index=True)
    date = Column(String, nullable=True)

    # Geo coords
    lat = Column(Float, nullable=True)
    lon = Column(Float, nullable=True)

    # Provenance / metadata
    source = Column(String, default="manual")   # e.g. "manual" or "uploaded"
    raw_ocr = Column(Text, nullable=True)       # JSON/text dump of OCR/NER results

    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    # Helpful composite index for common filters
    __table_args__ = (
        Index("ix_claims_state_district_village", "state", "district", "village"),
    )


class Village(Base):
    __tablename__ = "villages"

    id = Column(Integer, primary_key=True, index=True)
    state = Column(String, nullable=False, index=True)
    district = Column(String, nullable=False, index=True)
    block = Column(String, nullable=True)
    village = Column(String, nullable=False, index=True)
    lat = Column(Float, nullable=True)
    lon = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    # ✅ Make (state, district, village) canonical & deduplicated
    __table_args__ = (
        UniqueConstraint(
            "state", "district", "village",
            name="ux_villages_state_district_village"
        ),
        # Optional but useful composite index for filtering chains
        Index("ix_villages_state_district", "state", "district"),
    )
