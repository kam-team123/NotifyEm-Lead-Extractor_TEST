-- Disable legacy parcel connectors without deleting source metadata or saved property records.
update public.data_sources
set is_connected = false,
    is_live = false
where slug = 'county-parcels'
   or slug like 'parcel-layer:%';