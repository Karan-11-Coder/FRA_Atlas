from sqlalchemy import select, insert
from sqlalchemy.exc import IntegrityError
from backend.models import Village
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
        result = await session.execute(insert(Village).values(
            state=state, district=district, village=village, lat=lat, lon=lon
        ).returning(Village))
        await session.flush()
        return result.scalar_one_or_none()
    except IntegrityError:
        # Lost a race to a concurrent insert of the same (state, district,
        # village) — fetch whichever row won.
        await session.rollback()
        row = await session.execute(
            select(Village).where(
                Village.state == state,
                Village.district == district,
                Village.village == village,
            )
        )
        return row.scalar_one_or_none()
