from sqlalchemy import select, insert
from sqlalchemy.exc import IntegrityError
from backend.db.models import Village
from backend.services.locations import normalize_triplet, coords_plausible, geocode_village

async def upsert_village(session, *, state, district, village,
                         claimed_lat=None, claimed_lon=None):
    state, district, village = normalize_triplet(state, district, village)
    if not (state and district and village):
        return None

    # check if already exists
    row = await session.execute(
        select(Village).where(
            Village.state == state,
            Village.district == district,
            Village.village == village
        )
    )
    existing = row.scalar_one_or_none()
    if existing:
        # patch coords if missing
        if (existing.lat is None or existing.lon is None) and coords_plausible(claimed_lat, claimed_lon):
            existing.lat, existing.lon = float(claimed_lat), float(claimed_lon)
            await session.flush()
        return existing

    # new row
    lat, lon = None, None
    if coords_plausible(claimed_lat, claimed_lon):
        lat, lon = claimed_lat, claimed_lon
    else:
        geo = await geocode_village(state, district, village)
        if geo:
            lat, lon = geo

    try:
        await session.execute(insert(Village).values(
            state=state, district=district, village=village, lat=lat, lon=lon
        ))
        await session.flush()
    except IntegrityError:
        await session.rollback()
    return None
