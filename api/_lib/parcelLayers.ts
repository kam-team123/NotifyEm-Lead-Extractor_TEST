import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import type { ParcelFieldMap, ParcelLayerConfig } from './arcgis.js';
import { BBox } from './geo.js';

type CatalogEntry = Omit<ParcelLayerConfig, 'slug' | 'extent'> & { provider: string; extent: BBox };

const box = (west: number, south: number, east: number, north: number): BBox => ({ west, south, east, north });
const fields = (m: Partial<ParcelFieldMap>): ParcelFieldMap => ({
  parcelId: null, address: null, city: null, zip: null, owner: null, assessedValue: null, landUse: null, yearBuilt: null, lotAcres: null, ...m
});

/**
 * Free public parcel layers verified (2026-10-01) to answer envelope queries with geometry.
 * Counties not covered here can be added from the app ("Connect a county parcel layer").
 * Some layers carry no owner/value fields (IN, WA, VA, DE, HI, UT statewide); TN omits ~9 counties
 * (Davidson, Shelby, Rutherford, Montgomery, …); NY covers counties that publish to the state.
 */
export const PARCEL_CATALOG: CatalogEntry[] = [
  // Large counties (more attributes than the statewide layers)
  { state: 'CA', name: 'Los Angeles County parcels', provider: 'LA County Office of the Assessor',
    url: 'https://public.gis.lacounty.gov/public/rest/services/LACounty_Cache/LACounty_Parcel/MapServer/0',
    extent: box(-118.9535, 32.7923, -117.6441, 34.8235),
    fieldMap: fields({ parcelId: 'AIN', address: 'SitusAddress', city: 'SitusCity', zip: 'SitusZIP', landUse: 'UseDescription', yearBuilt: 'YearBuilt1' }) },
  { state: 'AZ', name: 'Maricopa County parcels', provider: "Maricopa County Assessor's Office",
    url: 'https://gis.mcassessor.maricopa.gov/arcgis/rest/services/Parcels/MapServer/0',
    extent: box(-113.335, 32.6955, -111.0818, 34.0469),
    fieldMap: fields({ parcelId: 'APN', address: 'PHYSICAL_ADDRESS', city: 'PHYSICAL_CITY', zip: 'PHYSICAL_ZIP', owner: 'OWNER_NAME', assessedValue: 'FCV_CUR', landUse: 'PUC', yearBuilt: 'CONST_YEAR' }) },
  { state: 'MN', name: 'Hennepin County parcels', provider: 'Hennepin County GIS',
    url: 'https://gis.hennepin.us/arcgis/rest/services/HennepinData/LAND_PROPERTY/MapServer/1',
    extent: box(-93.7727, 44.7835, -93.1772, 45.2467),
    fieldMap: fields({ parcelId: 'PID', address: 'HOUSE_NO+STREET_NM', city: 'MUNIC_NM', zip: 'ZIP_CD', owner: 'OWNER_NM', assessedValue: 'MKT_VAL_TOT', landUse: 'PR_TYP_NM1', yearBuilt: 'BUILD_YR' }) },
  { state: 'FL', name: 'Miami-Dade County parcels', provider: 'Miami-Dade County Property Appraiser',
    url: 'https://gisweb.miamidade.gov/arcgis/rest/services/MD_LandInformation/MapServer/26',
    extent: box(-80.8747, 25.135, -80.1181, 25.9795),
    fieldMap: fields({ parcelId: 'FOLIO', address: 'TRUE_SITE_ADDR', city: 'TRUE_SITE_CITY', zip: 'TRUE_SITE_ZIP_CODE', owner: 'TRUE_OWNER1', assessedValue: 'TOTAL_VAL_CUR', landUse: 'DOR_DESC', yearBuilt: 'YEAR_BUILT' }) },
  { state: 'UT', name: 'Salt Lake County parcels (LIR)', provider: 'Utah Geospatial Resource Center',
    url: 'https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/Parcels_SaltLake_LIR/FeatureServer/0',
    extent: box(-112.2286, 40.4143, -111.5532, 40.9218),
    fieldMap: fields({ parcelId: 'PARCEL_ID', address: 'PARCEL_ADD', city: 'PARCEL_CITY', assessedValue: 'TOTAL_MKT_VALUE', landUse: 'PROP_CLASS', yearBuilt: 'BUILT_YR', lotAcres: 'PARCEL_ACRES' }) },

  // Statewide layers
  { state: 'WI', name: 'Wisconsin statewide parcels', provider: "Wisconsin State Cartographer's Office",
    url: 'https://services3.arcgis.com/n6uYoouQZW75n5WI/arcgis/rest/services/Wisconsin_Statewide_Parcels_DB/FeatureServer/0',
    extent: box(-92.8886, 42.4919, -86.764, 47.0807),
    fieldMap: fields({ parcelId: 'PARCELID', address: 'SITEADRESS', city: 'PLACENAME', zip: 'ZIPCODE', owner: 'OWNERNME1', assessedValue: 'CNTASSDVALUE', landUse: 'PROPCLASS', lotAcres: 'ASSDACRES' }) },
  { state: 'NC', name: 'NC OneMap parcels', provider: 'NC OneMap / NC CGIA',
    url: 'https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/1',
    extent: box(-84.33, 33.84, -75.4, 36.59),
    fieldMap: fields({ parcelId: 'parno', address: 'siteadd', city: 'scity', zip: 'szip', owner: 'ownname', assessedValue: 'parval', landUse: 'parusedesc', yearBuilt: 'structyear', lotAcres: 'gisacres' }) },
  { state: 'IN', name: 'Indiana statewide parcels', provider: 'IndianaMap / IGIO',
    url: 'https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0',
    extent: box(-88.0973, 37.7725, -84.7857, 41.7607),
    fieldMap: fields({ parcelId: 'parcel_id', address: 'prop_add', city: 'prop_city', zip: 'prop_zip', landUse: 'dlgf_prop_class_code' }) },
  { state: 'CO', name: 'Colorado public parcels', provider: 'Colorado OIT',
    url: 'https://gis.colorado.gov/public/rest/services/Address_and_Parcel/Colorado_Public_Parcels/FeatureServer/0',
    extent: box(-109.0602, 36.992, -102.0467, 41.0033),
    fieldMap: fields({ parcelId: 'parcel_id', address: 'situsAdd', city: 'sitAddCty', zip: 'sitAddZip', owner: 'owner', assessedValue: 'apprValTot', landUse: 'landUseDsc', lotAcres: 'landAcres' }) },
  { state: 'WA', name: 'Washington statewide parcels', provider: 'WaTech Geospatial Program Office',
    url: 'https://services.arcgis.com/jsIt88o09Q0r1j8h/arcgis/rest/services/Current_Parcels/FeatureServer/0',
    extent: box(-124.85, 45.54, -116.91, 49.0),
    fieldMap: fields({ parcelId: 'PARCEL_ID_NR', address: 'SITUS_ADDRESS', city: 'SITUS_CITY_NM', zip: 'SITUS_ZIP_NR', landUse: 'LANDUSE_CD' }) },
  { state: 'VT', name: 'Vermont parcels with grand list', provider: 'Vermont Center for Geographic Information',
    url: 'https://services1.arcgis.com/BkFxaEFNwHqX3tAw/arcgis/rest/services/FS_VCGI_OPENDATA_Cadastral_VTPARCELS_poly_standardized_parcels_SP_v1/FeatureServer/0',
    extent: box(-73.4542, 42.7226, -71.4654, 45.0144),
    fieldMap: fields({ parcelId: 'SPAN', address: 'E911ADDR', city: 'TNAME', owner: 'OWNER1', assessedValue: 'REAL_FLV', landUse: 'CAT', lotAcres: 'ACRESGL' }) },
  { state: 'CT', name: 'Connecticut CAMA parcels', provider: 'CT Office of Policy and Management',
    url: 'https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/Connecticut_CAMA_and_Parcel_Layer/FeatureServer/0',
    extent: box(-73.7422, 40.9799, -71.7813, 42.0486),
    fieldMap: fields({ parcelId: 'Parcel_ID', address: 'Location_1', city: 'Property_City', zip: 'ZIP_CODE', owner: 'Owner', assessedValue: 'Assessed_Total', landUse: 'State_Use_Description', yearBuilt: 'AYB', lotAcres: 'Land_Acres' }) },
  { state: 'DE', name: 'Delaware state parcels', provider: 'Delaware FirstMap',
    url: 'https://enterprise.firstmap.delaware.gov/arcgis/rest/services/PlanningCadastre/DE_StateParcels/MapServer/0',
    extent: box(-75.789, 38.4508, -75.0494, 39.8395),
    fieldMap: fields({ parcelId: 'PIN', lotAcres: 'ACRES' }) },
  { state: 'AR', name: 'Arkansas parcels with CAMA', provider: 'Arkansas GIS Office',
    url: 'https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Planning_Cadastre/FeatureServer/6',
    extent: box(-94.6179, 33.0044, -89.6467, 36.4998),
    fieldMap: fields({ parcelId: 'parcelid', address: 'adrlabel', city: 'adrcity', zip: 'adrzip5', owner: 'ownername', assessedValue: 'totalvalue', landUse: 'parceltype' }) },
  { state: 'NJ', name: 'New Jersey parcels (MOD-IV)', provider: 'NJ Office of GIS',
    url: 'https://maps.nj.gov/arcgis/rest/services/Framework/Cadastral/MapServer/0',
    extent: box(-75.56, 38.93, -73.89, 41.36),
    fieldMap: fields({ parcelId: 'PAMS_PIN', address: 'PROP_LOC', city: 'MUN_NAME', owner: 'OWNER_NAME', assessedValue: 'NET_VALUE', landUse: 'PROP_CLASS', yearBuilt: 'YR_CONSTR', lotAcres: 'CALC_ACRE' }) },
  { state: 'NY', name: 'New York State tax parcels', provider: 'NYS ITS Geospatial Services',
    url: 'https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Tax_Parcels_Public/MapServer/1',
    extent: box(-79.762, 40.4959, -71.8009, 45.0159),
    fieldMap: fields({ parcelId: 'SWIS_PRINT_KEY_ID', address: 'PARCEL_ADDR', city: 'CITYTOWN_NAME', zip: 'LOC_ZIP', owner: 'PRIMARY_OWNER', assessedValue: 'FULL_MARKET_VAL', landUse: 'PROP_CLASS', yearBuilt: 'YR_BLT', lotAcres: 'ACRES' }) },
  { state: 'MA', name: 'MassGIS L3 parcels', provider: 'MassGIS',
    url: 'https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/L3_Parcels_FeatureService_4326/FeatureServer/1',
    extent: box(-73.5333, 41.2305, -69.8993, 42.8883),
    fieldMap: fields({ parcelId: 'LOC_ID', address: 'SITE_ADDR', city: 'CITY', zip: 'ZIP', owner: 'OWNER1', assessedValue: 'TOTAL_VAL', landUse: 'USE_CODE', yearBuilt: 'YEAR_BUILT' }) },
  { state: 'MT', name: 'Montana cadastral parcels', provider: 'Montana State Library',
    url: 'https://gisservice.mt.gov/arcgis/rest/services/msdi_cadastral_map_v1/MapServer/1',
    extent: box(-116.1786, 44.2377, -103.6111, 49.1809),
    fieldMap: fields({ parcelId: 'PARCELID', address: 'AddressLine1', owner: 'OwnerName', assessedValue: 'TotalValue', landUse: 'PropType', lotAcres: 'TotalAcres' }) },
  { state: 'TN', name: 'Tennessee property boundaries', provider: 'TN Comptroller, Division of Property Assessments',
    url: 'https://services1.arcgis.com/YuVBSS7Y1of2Qud1/ArcGIS/rest/services/Tennessee_Property_Boundaries_Public_Use/FeatureServer/0',
    extent: box(-90.3054, 34.9831, -81.6469, 36.6781),
    fieldMap: fields({ parcelId: 'PARCELID', address: 'ADDRESS', owner: 'OWNER', lotAcres: 'DEEDAC' }) },
  { state: 'UT', name: 'Utah statewide parcels', provider: 'Utah Geospatial Resource Center',
    url: 'https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/UtahStatewideParcels/FeatureServer/0',
    extent: box(-114.0529, 36.998, -109.0418, 42.0017),
    fieldMap: fields({ parcelId: 'PARCEL_ID', address: 'PARCEL_ADD', city: 'PARCEL_CITY', zip: 'PARCEL_ZIP' }) },
  { state: 'MD', name: 'Maryland property data (SDAT)', provider: 'MD iMAP / Maryland Department of Planning',
    url: 'https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_PropertyData/MapServer/0',
    extent: box(-79.4869, 37.9299, -75.05, 39.723),
    fieldMap: fields({ parcelId: 'ACCTID', address: 'ADDRESS', city: 'CITY', zip: 'ZIPCODE', assessedValue: 'NFMTTLVL', landUse: 'DESCLU', yearBuilt: 'YEARBLT', lotAcres: 'ACRES' }) },
  { state: 'VA', name: 'Virginia statewide parcels', provider: 'Virginia Geographic Information Network',
    url: 'https://vginmaps.vdem.virginia.gov/arcgis/rest/services/VA_Base_Layers/VA_Parcels/MapServer/0',
    extent: box(-83.6754, 36.5374, -75.2395, 39.464),
    fieldMap: fields({ parcelId: 'PARCELID', city: 'LOCALITY' }) },
  { state: 'HI', name: 'Hawaii statewide TMK parcels', provider: 'Hawaii Statewide GIS Program',
    url: 'https://geodata.hawaii.gov/arcgis/rest/services/ParcelsZoning/MapServer/25',
    extent: box(-160.5502, 18.8934, -154.732, 22.2358),
    fieldMap: fields({ parcelId: 'tmk_txt', lotAcres: 'gisacres' }) }
];

export function parcelSlug(url: string): string {
  return `parcel-layer:${createHash('sha1').update(url.toLowerCase()).digest('hex').slice(0, 12)}`;
}

export function catalogLayers(): ParcelLayerConfig[] {
  return PARCEL_CATALOG.map(({ provider: _provider, ...layer }) => ({ ...layer, slug: parcelSlug(layer.url) }));
}

interface ParcelSourceRow {
  slug: string;
  source_name: string;
  api_url: string | null;
  state: string | null;
  metadata: { fieldMap?: ParcelFieldMap; extent?: BBox | null } | null;
}

/** Catalog layers plus county layers registered in data_sources (slug 'parcel-layer:*'). */
export async function loadParcelLayers(sb: SupabaseClient | null): Promise<ParcelLayerConfig[]> {
  const layers = new Map(catalogLayers().map(l => [l.slug, l]));
  if (sb) {
    const { data } = await sb
      .from('data_sources')
      .select('slug, source_name, api_url, state, metadata')
      .like('slug', 'parcel-layer:%')
      .eq('is_connected', true);
    for (const row of (data ?? []) as ParcelSourceRow[]) {
      if (!row.api_url || !row.metadata?.fieldMap) continue;
      layers.set(row.slug, {
        slug: row.slug,
        name: row.source_name,
        url: row.api_url,
        state: row.state || '',
        fieldMap: row.metadata.fieldMap,
        extent: row.metadata.extent ?? null
      });
    }
  }
  return [...layers.values()];
}

/** Creates the data_sources row for a parcel layer if needed (so its records can be saved). */
export async function ensureParcelSource(sb: SupabaseClient, layer: ParcelLayerConfig, provider: string): Promise<void> {
  const { error } = await sb.from('data_sources').upsert(
    {
      slug: layer.slug,
      source_name: layer.name,
      source_type: 'gis_portal',
      provider,
      country: 'US',
      state: layer.state || null,
      cost: 'free',
      license_type: 'Public',
      access_type: 'public',
      api_url: layer.url,
      is_connected: true,
      is_live: true,
      metadata: { fieldMap: layer.fieldMap, extent: layer.extent }
    },
    { onConflict: 'slug', ignoreDuplicates: true }
  );
  if (error) throw new Error(error.message);
}
