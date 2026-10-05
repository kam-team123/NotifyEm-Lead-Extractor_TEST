import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import { 
  Search, 
  MapPin, 
  Layers, 
  Flame, 
  CheckCircle, 
  AlertTriangle, 
  Compass,
  UserPlus,
  X,
} from 'lucide-react';
import { LeadCategory, RealEstateLead, PropertyListing, DatabaseCollection, SourceRunStatus } from '../../types';
import { US_STATES } from '../../data/referenceData';
import { geocodeAddress, LiveSource, MappedBuilding, searchMapRecords } from '../../services/openStreetMapService';
import { DataSourcesPanel } from '../data/DataSourcesPanel';
import { SidebarSection } from './SidebarSection';

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** Marker colour per data source family. */
const sourceColor = (slug: string) =>
  slug === 'realtor' ? '#f59e0b' : slug === 'osm' ? '#3b82f6' : slug === 'overture' ? '#8b5cf6' : '#06b6d4';

/** Matches the server cap in api/map-search.ts. */
const MAX_RADIUS_MILES = 50;

const LIVE_SOURCE_OPTIONS: { value: LiveSource; label: string }[] = [
  { value: 'realty', label: 'Realtor.com' },
  { value: 'osm', label: 'OpenStreetMap' },
  { value: 'both', label: 'Both' }
];
const LIVE_SOURCE_STORAGE_KEY = 'notifyem.leadFinder.liveSource';

const readStoredLiveSource = (): LiveSource => {
  try {
    const saved = localStorage.getItem(LIVE_SOURCE_STORAGE_KEY);
    return saved === 'osm' || saved === 'both' ? saved : 'realty';
  } catch {
    return 'realty';
  }
};

const SOURCE_GROUPS = [
  { label: 'Realtor.com', slug: 'realtor', match: (slug: string) => slug === 'realtor' },
  { label: 'OSM', slug: 'osm', match: (slug: string) => slug === 'osm' },
  { label: 'Overture', slug: 'overture', match: (slug: string) => slug === 'overture' },
  { label: 'Other', slug: 'other', match: (slug: string) => !['realtor', 'osm', 'overture'].includes(slug) }
];

/** Lead readiness by which contact details the record carries; drives marker colours and the legend. */
const CONTACT_TIERS = [
  { key: 'full', label: 'Fully Enriched', detail: 'Address + Phone + Email', color: '#10B981', meaning: 'Outreach ready via any channel' },
  { key: 'phone', label: 'High Contactability', detail: 'Address + Phone', color: '#06B6D4', meaning: 'Calling / SMS ready' },
  { key: 'email', label: 'Moderate Contactability', detail: 'Address + Email', color: '#F59E0B', meaning: 'Email campaign / direct mail ready' },
  { key: 'address', label: 'Low Contactability', detail: 'Address only', color: '#F97316', meaning: 'Needs skip-tracing or enrichment' },
  { key: 'missing', label: 'Unverified / Missing', detail: 'Incomplete address', color: '#6B7280', meaning: 'Logged but not actionable yet' }
] as const;

type ContactTier = (typeof CONTACT_TIERS)[number];

const contactTier = (c: MappedBuilding): ContactTier => {
  const hasAddress = Boolean(c.address) && c.address !== 'Unknown address' && !c.address.startsWith('Parcel ');
  const hasPhone = Boolean(c.phone?.trim());
  const hasEmail = Boolean(c.email?.trim());
  const key = !hasAddress ? 'missing' : hasPhone && hasEmail ? 'full' : hasPhone ? 'phone' : hasEmail ? 'email' : 'address';
  return CONTACT_TIERS.find(t => t.key === key)!;
};

const formatPrice = (value: number) => `$${Math.round(value).toLocaleString()}`;

/** "4 bd · 2 ba · 1,560 sqft" from whichever listing fields the source supplied. */
const listingFacts = (c: MappedBuilding) =>
  [
    c.beds !== undefined && `${c.beds} bd`,
    c.baths !== undefined && `${c.baths} ba`,
    c.sqft !== undefined && `${c.sqft.toLocaleString()} sqft`
  ].filter(Boolean).join(' · ');

interface HeatmapLeadFinderProps {
  leads: RealEstateLead[];
  properties: PropertyListing[];
  collections: DatabaseCollection[];
  onAddLead: (lead: Partial<RealEstateLead>) => void;
  onPushToSalesforce: (lead: RealEstateLead) => void;
  onCreateCollection: (name: string, description: string, state: string) => string;
  onOpenListings: () => void;
}

export const HeatmapLeadFinder: React.FC<HeatmapLeadFinderProps> = ({
  leads,
  properties,
  collections,
  onAddLead,
  onPushToSalesforce,
  onCreateCollection,
  onOpenListings
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const heatmapLayerRef = useRef<L.LayerGroup | null>(null);

  // Address search state
  const [addressInput, setAddressInput] = useState('');
  const [searchRadius, setSearchRadius] = useState<number>(5);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearchLocation, setHasSearchLocation] = useState(false);
  const [searchStage, setSearchStage] = useState<'locating' | 'records'>('records');
  const [searchSeconds, setSearchSeconds] = useState(0);

  useEffect(() => {
    if (!isSearching) return;
    setSearchSeconds(0);
    const timer = setInterval(() => setSearchSeconds(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, [isSearching]);

  // Current focal coordinates
  const [currentFocus, setCurrentFocus] = useState<{ lat: number; lng: number; label: string; city: string; state: string }>({
    lat: 39.5,
    lng: -98.35,
    label: 'United States',
    city: '',
    state: ''
  });

  const [liveSource, setLiveSource] = useState<LiveSource>(readStoredLiveSource);
  const chooseLiveSource = (value: LiveSource) => {
    setLiveSource(value);
    try {
      localStorage.setItem(LIVE_SOURCE_STORAGE_KEY, value);
    } catch {
      // Storage blocked (private mode): the choice just isn't remembered.
    }
  };

  // Discovered candidates
  const [candidates, setCandidates] = useState<MappedBuilding[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<MappedBuilding | null>(null);
  const [propertyQuery, setPropertyQuery] = useState('');
  const markersByIdRef = useRef(new Map<string, L.Marker>());

  // Every word must match somewhere in the record, so "oak 39201" finds Oak St in that ZIP.
  const queryWords = propertyQuery.toLowerCase().split(/\s+/).filter(Boolean);
  const visibleCandidates = queryWords.length
    ? candidates.filter(c => {
        const haystack = [c.address, c.city, c.state, c.postalCode, c.category, c.name, c.ownerName, c.phone, c.email, c.website, c.parcelId, c.sourceLabel]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return queryWords.every(word => haystack.includes(word));
      })
    : candidates;

  /** Selects a property from the list and flies the map to its marker. */
  const focusCandidate = (candidate: MappedBuilding) => {
    setSelectedCandidate(candidate);
    const map = mapInstanceRef.current;
    if (!map) return;
    map.setView([candidate.lat, candidate.lng], Math.max(map.getZoom(), 16));
    markersByIdRef.current.get(candidate.id)?.openPopup();
  };
  const [qualifyingCandidate, setQualifyingCandidate] = useState<MappedBuilding | null>(null);
  const [qualificationError, setQualificationError] = useState<string | null>(null);
  const [qualificationForm, setQualificationForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    company: '',
    role: '' as RealEstateLead['role'] | '',
    category: '' as LeadCategory | '',
    street: '',
    city: '',
    state: '',
    postalCode: ''
  });
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [sourceStatuses, setSourceStatuses] = useState<SourceRunStatus[]>([]);
  const [sourcesRefreshKey, setSourcesRefreshKey] = useState(0);

  // Quick State Navigation
  const [selectedStateCode, setSelectedStateCode] = useState<string>('');
  const [selectedRegion, setSelectedRegion] = useState<'ALL' | 'Northeast' | 'South' | 'Midwest' | 'West'>('ALL');

  // Regions classification for all 50 US States
  const REGION_MAP: Record<string, 'Northeast' | 'South' | 'Midwest' | 'West'> = {
    'CT': 'Northeast', 'ME': 'Northeast', 'MA': 'Northeast', 'NH': 'Northeast', 'RI': 'Northeast', 'VT': 'Northeast', 'NJ': 'Northeast', 'NY': 'Northeast', 'PA': 'Northeast',
    'IL': 'Midwest', 'IN': 'Midwest', 'MI': 'Midwest', 'OH': 'Midwest', 'WI': 'Midwest', 'IA': 'Midwest', 'KS': 'Midwest', 'MN': 'Midwest', 'MO': 'Midwest', 'NE': 'Midwest', 'ND': 'Midwest', 'SD': 'Midwest',
    'DE': 'South', 'FL': 'South', 'GA': 'South', 'MD': 'South', 'NC': 'South', 'SC': 'South', 'VA': 'South', 'DC': 'South', 'WV': 'South', 'AL': 'South', 'KY': 'South', 'MS': 'South', 'TN': 'South', 'AR': 'South', 'LA': 'South', 'OK': 'South', 'TX': 'South',
    'AZ': 'West', 'CO': 'West', 'ID': 'West', 'MT': 'West', 'NV': 'West', 'NM': 'West', 'UT': 'West', 'WY': 'West', 'AK': 'West', 'CA': 'West', 'HI': 'West', 'OR': 'West', 'WA': 'West'
  };

  const displayedStates = selectedRegion === 'ALL' 
    ? US_STATES 
    : US_STATES.filter(st => REGION_MAP[st.code] === selectedRegion);

  // Tile Layer and Map Theme - Default: OpenStreetMap Standard (OSM)
  const [mapTheme, setMapTheme] = useState<'osm' | 'satellite' | 'dark'>('osm');
  const tileLayerInstanceRef = useRef<L.TileLayer | null>(null);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [currentFocus.lat, currentFocus.lng],
        zoom: 11,
        // Canvas keeps thousands of heatmap circles responsive; markers stay as DOM icons.
        preferCanvas: true,
        zoomControl: true,
        attributionControl: true
      });

      // Default: OpenStreetMap Standard (OSM)
      const tile = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
        maxZoom: 19
      }).addTo(map);

      tileLayerInstanceRef.current = tile;
      markersLayerRef.current = L.layerGroup().addTo(map);
      heatmapLayerRef.current = L.layerGroup().addTo(map);

      mapInstanceRef.current = map;

      // Force size invalidation right after mount to handle flex layout settlement
      setTimeout(() => {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.invalidateSize();
        }
      }, 100);

      setTimeout(() => {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.invalidateSize();
        }
      }, 300);
    }

    // Attach ResizeObserver to keep tiles aligned on panel collapse / resize
    const container = mapContainerRef.current;
    const resizeObserver = new ResizeObserver(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    });
    if (container) {
      resizeObserver.observe(container);
    }

    return () => {
      if (container) {
        resizeObserver.unobserve(container);
      }
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Handle map theme / tile changes dynamically
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (tileLayerInstanceRef.current) {
      map.removeLayer(tileLayerInstanceRef.current);
    }

    let url = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    let options: L.TileLayerOptions = {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
      maxZoom: 19
    };

    if (mapTheme === 'satellite') {
      url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
      options = {
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
        maxZoom: 19
      };
    } else if (mapTheme === 'dark') {
      url = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
      options = {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 19
      };
    }

    const newTile = L.tileLayer(url, options).addTo(map);
    tileLayerInstanceRef.current = newTile;
    newTile.bringToBack();
  }, [mapTheme]);

  /** Popup shown when a property marker is clicked: pick between the source record and qualifying it as a lead. */
  const buildMarkerPopup = (candidate: MappedBuilding): HTMLElement => {
    const locality = [candidate.city, candidate.state, candidate.postalCode].filter(Boolean).join(', ');
    const facts = listingFacts(candidate);
    const tier = contactTier(candidate);
    const contactRows = [
      candidate.agentName && ['Agent', escapeHtml([candidate.agentName, candidate.agentOffice].filter(Boolean).join(' · '))],
      candidate.name && ['Name', escapeHtml(candidate.name)],
      candidate.ownerName && ['Owner', escapeHtml(candidate.ownerName)],
      candidate.phone && ['Phone', `<a href="tel:${escapeHtml(candidate.phone)}" class="text-cyan-300 hover:underline">${escapeHtml(candidate.phone)}</a>`],
      candidate.email && ['Email', `<a href="mailto:${escapeHtml(candidate.email)}" class="text-cyan-300 hover:underline break-all">${escapeHtml(candidate.email)}</a>`],
      candidate.website && [
        'Web',
        `<a href="${escapeHtml(/^https?:\/\//i.test(candidate.website) ? candidate.website : `https://${candidate.website}`)}" target="_blank" rel="noreferrer" class="text-cyan-300 hover:underline break-all">${escapeHtml(candidate.website.replace(/^https?:\/\//i, ''))}</a>`
      ]
    ].filter(Boolean) as [string, string][];

    const root = document.createElement('div');
    root.className = 'space-y-2';
    root.innerHTML = `
      ${candidate.photoUrl ? `<img src="${escapeHtml(candidate.photoUrl)}" alt="" loading="lazy" class="w-full h-28 object-cover rounded" />` : ''}
      <div>
        ${
          candidate.listPrice !== undefined
            ? `<div class="text-[14px] font-bold text-amber-300">${formatPrice(candidate.listPrice)}${
                candidate.listingStatus ? ` <span class="text-[10px] font-medium text-neutral-400">${escapeHtml(candidate.listingStatus)}</span>` : ''
              }</div>`
            : ''
        }
        ${facts ? `<div class="text-[11px] text-neutral-300">${escapeHtml(facts)}</div>` : ''}
        <div class="text-[13px] font-semibold text-neutral-100 leading-snug">${escapeHtml(candidate.address)}</div>
        <div class="text-[11px] text-neutral-400">${escapeHtml(locality || 'City/state not supplied by source')}</div>
        <div class="mt-1 text-[11px]"><span class="text-cyan-300/90">${escapeHtml(candidate.category)}</span>
          <span class="text-neutral-500"> · ${escapeHtml(candidate.sourceLabel)}</span></div>
        <div class="mt-1 flex items-center gap-1.5 text-[11px]" title="${escapeHtml(tier.meaning)}">
          <span style="background-color:${tier.color}" class="w-2 h-2 rounded-full shrink-0"></span>
          <span style="color:${tier.color}" class="font-medium">${tier.label}</span>
          <span class="text-neutral-500">· ${tier.meaning}</span>
        </div>
      </div>
      ${
        contactRows.length
          ? `<div class="space-y-0.5 text-[11px] border-t border-neutral-800 pt-2">${contactRows
              .map(([label, value]) => `<div class="flex gap-2"><span class="w-11 shrink-0 text-neutral-500">${label}</span><span class="min-w-0 text-neutral-200">${value}</span></div>`)
              .join('')}</div>`
          : '<div class="text-[11px] text-neutral-500 border-t border-neutral-800 pt-2">No contact details published for this record.</div>'
      }
      <div class="grid grid-cols-2 gap-1.5 pt-1">
        <button type="button" data-action="source" class="py-1.5 rounded border border-neutral-700 bg-neutral-900 text-[11px] font-medium text-neutral-200 hover:border-cyan-500/50 hover:text-cyan-300 cursor-pointer disabled:opacity-40">View record</button>
        <button type="button" data-action="qualify" class="py-1.5 rounded bg-gradient-to-r from-cyan-500 to-blue-600 text-[11px] font-bold text-white hover:from-cyan-400 hover:to-blue-500 cursor-pointer">Qualify &amp; Add</button>
      </div>`;

    const sourceButton = root.querySelector<HTMLButtonElement>('[data-action="source"]')!;
    if (!candidate.sourceUrl) sourceButton.disabled = true;
    sourceButton.addEventListener('click', () => {
      if (candidate.sourceUrl) window.open(candidate.sourceUrl, '_blank', 'noopener,noreferrer');
    });
    root.querySelector('[data-action="qualify"]')!.addEventListener('click', () => {
      mapInstanceRef.current?.closePopup();
      openQualificationForm(candidate);
    });
    return root;
  };

  // Update map layers when focus, candidates, leads, or heatmap state changes
  // Recenter only when the search location or radius changes, so redrawing markers (new results,
  // heatmap toggle, adding a lead) never moves the map away from what the user is looking at.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const dynamicZoom = searchRadius > 80 ? 7 : searchRadius > 45 ? 8 : searchRadius > 20 ? 10 : searchRadius > 8 ? 11 : 13;
    map.setView([currentFocus.lat, currentFocus.lng], dynamicZoom);
  }, [currentFocus, searchRadius]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Clear previous markers
    if (markersLayerRef.current) {
      markersLayerRef.current.clearLayers();
    }
    if (heatmapLayerRef.current) {
      heatmapLayerRef.current.clearLayers();
    }

    // Draw Heatmap Density Circles
    if (showHeatmap && heatmapLayerRef.current) {
      // 1. Search Radius Boundary Circle with interactive tooltip - Cyan & Blue
      if (hasSearchLocation) {
        const radiusCircle = L.circle([currentFocus.lat, currentFocus.lng], {
          radius: searchRadius * 1609.34,
          color: '#06b6d4',
          weight: 2,
          dashArray: '5, 7',
          fillColor: '#06b6d4',
          fillOpacity: 0.08
        }).addTo(heatmapLayerRef.current);

        radiusCircle.bindTooltip(`Search perimeter: ${searchRadius} miles`, { className: 'leaflet-tooltip-dark' });
      }

      // 2. High-Density Intensity Blobs - Cyan & Blue Oceanic Gradient
      candidates.forEach(pt => {
        // Outer halo - deep blue
        L.circle([pt.lat, pt.lng], {
          radius: 350,
          stroke: false,
          fillColor: '#2563eb',
          fillOpacity: 0.14
        }).addTo(heatmapLayerRef.current!);

        // Core heat - vibrant cyan
        L.circle([pt.lat, pt.lng], {
          radius: 120,
          stroke: false,
          fillColor: '#06b6d4',
          fillOpacity: 0.3
        }).addTo(heatmapLayerRef.current!);
      });
    }

    // Place Markers
    if (markersLayerRef.current) {
      // Search Focal Center Marker - Electric Cyan with blue glow
      if (hasSearchLocation) {
        const centerIcon = L.divIcon({
          className: 'custom-pin',
          html: '<div style="background-color: #fff; width: 14px; height: 14px; border-radius: 50%; border: 3px solid #000; box-shadow: 0 0 0 2px #06b6d4, 0 0 14px #06b6d4;"></div>',
          iconSize: [14, 14],
          iconAnchor: [7, 7]
        });
        L.marker([currentFocus.lat, currentFocus.lng], { icon: centerIcon })
          .bindTooltip(`Search location: ${escapeHtml(currentFocus.label)}`, { className: 'leaflet-tooltip-dark' })
          .addTo(markersLayerRef.current);
      }

      // Discovered candidates markers, coloured by contact completeness
      markersByIdRef.current.clear();
      candidates.forEach(candidate => {
        const tier = contactTier(candidate);
        const color = tier.color;
        const candIcon = L.divIcon({
          className: 'candidate-pin',
          html: `<div style="background-color: ${color}; width: 11px; height: 11px; border-radius: 50%; border: 2px solid #020617; box-shadow: 0 0 6px ${color}99; cursor: pointer;"></div>`,
          iconSize: [11, 11],
          iconAnchor: [5.5, 5.5]
        });

        const marker = L.marker([candidate.lat, candidate.lng], { icon: candIcon });
        marker.on('click', () => setSelectedCandidate(candidate));
        marker.bindPopup(() => buildMarkerPopup(candidate), { className: 'leaflet-popup-dark', minWidth: 240, maxWidth: 280 });
        const nameLine = candidate.name ? `<br/>${escapeHtml(candidate.name)}` : '';
        const ownerLine = candidate.ownerName ? `<br/>Owner: ${escapeHtml(candidate.ownerName)}` : '';
        const tierLine = `<br/><span style="color:${color}">●</span> ${tier.label}`;
        marker.bindTooltip(`${escapeHtml(candidate.address)}${nameLine}${ownerLine}<br/>${escapeHtml(candidate.sourceLabel)}${tierLine}`, {
          className: 'leaflet-tooltip-dark'
        });
        marker.addTo(markersLayerRef.current!);
        markersByIdRef.current.set(candidate.id, marker);
      });
    }
  }, [currentFocus, searchRadius, showHeatmap, candidates, hasSearchLocation]);

  const handleAddressSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!addressInput.trim()) return;

    setIsSearching(true);
    setSearchStage('locating');
    setSearchError(null);
    setCandidates([]);
    setSelectedCandidate(null);

    try {
      const geo = await geocodeAddress(addressInput);
      if (!geo) {
        setSearchError('No verified US location was returned. Check the search and try again.');
        return;
      }
      setCurrentFocus({
        lat: geo.lat,
        lng: geo.lng,
        label: geo.displayName,
        city: geo.city || '',
        state: geo.state || ''
      });
      setHasSearchLocation(true);
      await triggerCandidateSearch(geo.lat, geo.lng);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'The live location search failed.');
    } finally {
      setIsSearching(false);
    }
  };

  const triggerCandidateSearch = async (lat: number, lng: number) => {
    setIsSearching(true);
    setSearchStage('records');
    setSearchError(null);
    setPropertyQuery('');
    try {
      const result = await searchMapRecords(lat, lng, searchRadius, liveSource);
      setCandidates(result.records);
      setSourceStatuses(result.sources);
      setLastSync(new Date().toISOString());
      if (!result.records.length && result.sources.some(s => s.status === 'error')) {
        setSearchError('No records loaded: every live source failed or returned nothing. See source details below.');
      }
      setSourcesRefreshKey(k => k + 1);
    } catch (error) {
      setCandidates([]);
      setSourceStatuses([]);
      setSearchError(error instanceof Error ? error.message : 'The property search failed.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleRunDiscovery = () => {
    if (hasSearchLocation) triggerCandidateSearch(currentFocus.lat, currentFocus.lng);
  };

  const openQualificationForm = (candidate: MappedBuilding) => {
    setQualifyingCandidate(candidate);
    setQualificationError(null);
    // Realtor.com listings name the listing agent, which is the contact we can actually reach.
    const [agentFirst = '', ...agentRest] = (!candidate.ownerName && candidate.agentName ? candidate.agentName : '').split(/\s+/);
    setQualificationForm({
      firstName: agentFirst,
      lastName: agentRest.join(' '),
      email: candidate.email || '',
      phone: candidate.phone || '',
      company: candidate.ownerName || candidate.name || candidate.agentOffice || '',
      role: candidate.ownerName ? 'Property Owner' : candidate.agentName ? 'Listing Agent' : '',
      category: '',
      street: candidate.address,
      city: candidate.city,
      state: candidate.state,
      postalCode: candidate.postalCode
    });
  };

  const handleQualificationSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = qualifyingCandidate;
    const { role, category, ...form } = qualificationForm;
    if (!candidate || !role || !category) return;
    if (!candidate.sourceUrl) {
      setQualificationError('This record has no source URL and cannot be added as a lead.');
      return;
    }

    onAddLead({
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email,
      phone: form.phone,
      brokerageOrCompany: form.company,
      role,
      category,
      street: form.street,
      city: form.city,
      state: form.state,
      postalCode: form.postalCode,
      latitude: candidate.lat,
      longitude: candidate.lng,
      pipelineState: 'New',
      leadSource: 'Lead Finder Discovery',
      notes: [
        candidate.sourceLabel,
        candidate.listPrice !== undefined ? `List price: ${formatPrice(candidate.listPrice)}${candidate.listingStatus ? ` (${candidate.listingStatus})` : ''}` : '',
        listingFacts(candidate),
        candidate.parcelId ? `Parcel ID: ${candidate.parcelId}` : '',
        candidate.website ? `Website: ${candidate.website}` : ''
      ].filter(Boolean).join(' · '),
      sourceUrl: candidate.sourceUrl,
      verificationStatus: 'source_record',
      confidenceScore: candidate.confidenceScore,
      scoreReason: 'Manually qualified from a sourced property record.'
    });
    setQualifyingCandidate(null);
  };

  const handleStateSelect = (stateCode: string) => {
    setSelectedStateCode(stateCode);
    const summary = US_STATES.find(s => s.code === stateCode);
    if (summary) {
      // Centre on the state's largest city: a state's geographic centroid is usually empty land.
      void handleAddressSubmitFor(`${summary.anchorCity}, ${summary.name}`);
    }
  };

  const handleAddressSubmitFor = async (query: string) => {
    setAddressInput(`${query}, USA`);
    setIsSearching(true);
    setSearchStage('locating');
    setSearchError(null);
    setCandidates([]);
    setSelectedCandidate(null);
    try {
      const geo = await geocodeAddress(`${query}, USA`);
      if (!geo) {
        setSearchError('No verified US location was returned. Check the search and try again.');
        return;
      }
      setCurrentFocus({ lat: geo.lat, lng: geo.lng, label: geo.displayName, city: geo.city || '', state: geo.state || '' });
      setHasSearchLocation(true);
      await triggerCandidateSearch(geo.lat, geo.lng);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'The live location search failed.');
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col xl:flex-row overflow-hidden bg-neutral-950">
      {/* Left Control Panel / Search Configuration (SOP Section 04) */}
      <aside className="w-full xl:w-[410px] max-h-[calc(100dvh-62px-50vh)] xl:max-h-none xl:h-full border-r border-neutral-800 bg-neutral-900/90 flex flex-col shrink-0 overflow-y-auto z-10">
        <div className="p-4 border-b border-neutral-800 shrink-0">
          <div className="flex items-center justify-between">
            <h1 className="text-base font-semibold text-white tracking-tight">Property Map</h1>
            <div className="flex items-center gap-1.5 text-xs text-neutral-400">
              <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_#06b6d4]" />
              <span className="text-amber-300 font-mono text-[11px]">Realtor.com</span>
            </div>
          </div>
          <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
            Searches live Realtor.com for-sale listings (RealtyAPI) and property records already saved in Supabase. Falls back to OpenStreetMap when no listings come back.
          </p>
        </div>

        {/* Section 04 Part C: User Address Input */}
        {searchError && (
          <div className="px-4 py-2.5 border-b border-neutral-800 text-xs text-rose-400 flex items-start gap-1.5 shrink-0">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{searchError}</span>
          </div>
        )}

        <SidebarSection
          title="Search Location (Address, City, State, or ZIP)"
          icon={<MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />}
          summary={hasSearchLocation ? currentFocus.label : 'No location searched yet'}
          storageKey="notifyem.locationSectionOpen"
        >
          <form onSubmit={handleAddressSubmit} className="space-y-2">
            <div className="relative">
              <input
                type="text"
                value={addressInput}
                onChange={(e) => setAddressInput(e.target.value)}
                placeholder="Address, city, state, or ZIP code"
                className="w-full pl-8 pr-3 py-2 bg-neutral-950 border border-neutral-700 rounded-md text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-cyan-400 font-normal"
              />
              <MapPin className="w-3.5 h-3.5 text-cyan-400 absolute left-2.5 top-2.5" />
            </div>

            <fieldset className="flex items-center gap-3 text-[11px] text-neutral-300">
              <legend className="sr-only">Live data source</legend>
              <span className="text-neutral-500">Source:</span>
              {LIVE_SOURCE_OPTIONS.map(option => (
                <label key={option.value} className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="live-source"
                    value={option.value}
                    checked={liveSource === option.value}
                    onChange={() => chooseLiveSource(option.value)}
                    className="accent-cyan-400 cursor-pointer"
                  />
                  <span style={{ color: liveSource === option.value ? sourceColor(option.value === 'realty' ? 'realtor' : option.value === 'osm' ? 'osm' : 'other') : undefined }}>
                    {option.label}
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={isSearching}
                className="flex-1 py-1.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-neutral-950 font-bold rounded text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 shadow-[0_0_12px_rgba(6,182,212,0.3)]"
              >
                <Search className="w-3.5 h-3.5" />
                <span>{isSearching ? 'Searching live sources...' : 'Search properties'}</span>
              </button>
            </div>
          </form>

          {sourceStatuses.length > 0 && (
            <div className="space-y-1 pt-1">
              {sourceStatuses.map(st => (
                <div key={`${st.slug}-${st.label}`} className="text-[11px] flex items-start gap-1.5">
                  <span
                    className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                      st.status === 'ok' ? 'bg-emerald-400' : st.status === 'error' ? 'bg-rose-400' : 'bg-neutral-500'
                    }`}
                  />
                  <span className="text-neutral-300">
                    <span className="font-medium">{st.label}</span>
                    <span className="text-neutral-500"> · {st.status === 'ok' ? `${st.count} records` : st.status}{st.ms ? ` · ${(st.ms / 1000).toFixed(1)}s` : ''}</span>
                    {st.message && <span className="block text-neutral-500 break-words">{st.message}</span>}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* State Search */}
          <div>
            <div className="flex items-center justify-between text-[11px] font-medium text-neutral-300 mb-1">
              <span>Search a US state</span>
            </div>
            <select
              value={selectedStateCode}
              onChange={(e) => handleStateSelect(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-neutral-950 border border-neutral-700 rounded text-xs text-neutral-100 focus:outline-none focus:border-cyan-400 cursor-pointer"
            >
              <option value="">Choose a state</option>
              {US_STATES.map(st => (
                <option key={st.code} value={st.code}>
                  {st.name} ({st.code})
                </option>
              ))}
            </select>
          </div>

          {/* Quick Metro Jumps */}
          <div>
            <div className="text-[11px] font-medium text-neutral-400 mb-1.5">Quick Metros:</div>
            <div className="flex flex-wrap gap-1.5">
              {['Austin, TX', 'Miami, FL', 'Seattle, WA', 'Denver, CO', 'Charlotte, NC', 'Los Angeles, CA'].map(metro => (
                <button
                  key={metro}
                  onClick={() => {
                    void handleAddressSubmitFor(metro);
                  }}
                  className="px-2 py-1 text-[11px] bg-neutral-900 hover:bg-neutral-800 text-cyan-200/90 rounded border border-neutral-700/80 transition-colors cursor-pointer"
                >
                  {metro}
                </button>
              ))}
            </div>
          </div>
        </SidebarSection>

        {/* Section 04 Part D: Adjustable Radius & Discovery Provider */}
        <SidebarSection
          title="Adjustable Search Radius"
          icon={<Compass className="w-3.5 h-3.5 text-cyan-400 shrink-0" />}
          summary={`${searchRadius} mi · ~${Math.round(Math.PI * searchRadius * searchRadius).toLocaleString()} sq mi`}
          storageKey="notifyem.radiusSectionOpen"
        >
          {/* Fully Adjustable Search Radius Slider & Direct Input */}
          <div className="space-y-2 bg-neutral-950 p-3 rounded-lg border border-neutral-800">
            <div className="flex items-center justify-between">
              <label htmlFor="sidebar-radius" className="text-xs font-medium text-neutral-400">Radius</label>
              <div className="flex items-center gap-1">
                <input
                  id="sidebar-radius"
                  type="number"
                  min={1}
                  max={MAX_RADIUS_MILES}
                  value={searchRadius}
                  onChange={(e) => setSearchRadius(Math.max(1, Math.min(MAX_RADIUS_MILES, Number(e.target.value) || 1)))}
                  className="w-14 px-2 py-0.5 bg-neutral-900 border border-neutral-700 rounded text-xs font-mono font-bold text-cyan-300 text-right focus:outline-none focus:border-cyan-400"
                />
                <span className="text-xs font-mono text-neutral-400">miles</span>
              </div>
            </div>

            {/* Range Slider */}
            <div className="space-y-1">
              <input
                type="range"
                min={1}
                max={MAX_RADIUS_MILES}
                step={1}
                value={searchRadius}
                onChange={(e) => setSearchRadius(Number(e.target.value))}
                className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-neutral-800 rounded-lg appearance-none"
              />
              <div className="flex items-center justify-between text-[10px] font-mono text-neutral-500">
                <span>1 mi</span>
                <span className="text-cyan-400/80">Coverage: ~{Math.round(Math.PI * searchRadius * searchRadius).toLocaleString()} sq mi</span>
                <span>{MAX_RADIUS_MILES} mi</span>
              </div>
            </div>

            {/* Quick Radius Presets */}
            <div className="flex items-center gap-1 pt-1 overflow-x-auto">
              {[1, 5, 10, 15, 25, 50].map(mi => (
                <button
                  key={mi}
                  type="button"
                  onClick={() => setSearchRadius(mi)}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors cursor-pointer shrink-0 ${
                    searchRadius === mi
                      ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold shadow-[0_0_8px_rgba(6,182,212,0.4)]'
                      : 'bg-neutral-900 text-neutral-400 hover:text-white border border-neutral-800'
                  }`}
                >
                  {mi}mi
                </button>
              ))}
            </div>
          </div>
        </SidebarSection>

        {/* Action to re-run discovery (always visible, even with the sections collapsed) */}
        <div className="px-4 py-3 border-b border-neutral-800 shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={handleRunDiscovery}
              disabled={isSearching || !hasSearchLocation}
              className="flex-1 py-2 bg-gradient-to-r from-blue-900/60 to-cyan-950/60 hover:from-blue-800/80 hover:to-cyan-900/80 text-cyan-200 text-xs font-semibold rounded border border-cyan-500/30 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Compass className={`w-3.5 h-3.5 text-cyan-400 ${isSearching ? 'animate-spin' : ''}`} />
              <span>{isSearching ? 'Loading mapped buildings...' : `Refresh ${searchRadius}mi Search`}</span>
            </button>

            <button
              onClick={() => setShowHeatmap(!showHeatmap)}
              className={`px-3 py-2 text-xs font-medium rounded border transition-colors flex items-center gap-1.5 cursor-pointer ${
                showHeatmap
                  ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-300 shadow-[0_0_8px_rgba(6,182,212,0.2)]'
                  : 'bg-neutral-800 border-neutral-700 text-neutral-400'
              }`}
              title="Toggle Heatmap Layer"
            >
              <Flame className="w-3.5 h-3.5 text-cyan-400" />
              <span>Heatmap</span>
            </button>
          </div>
        </div>

        <DataSourcesPanel refreshKey={sourcesRefreshKey} onOpenListings={onOpenListings} />

        {/* Discovered Candidates List (Section 04 Step 9) */}
        <div className="flex-1 px-4 pb-4">
          <div className="sticky top-0 z-10 -mx-4 px-4 pt-4 pb-2 mb-1 bg-neutral-900/95 backdrop-blur-sm space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">
                Properties found ({propertyQuery.trim() ? `${visibleCandidates.length} of ${candidates.length}` : candidates.length})
              </div>
              <div className="text-[11px] text-neutral-500">
                {lastSync ? `Updated ${new Date(lastSync).toLocaleString()}` : 'No search run'}
              </div>
            </div>
            {candidates.length > 0 && (
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-2" />
                <input
                  type="search"
                  value={propertyQuery}
                  onChange={event => setPropertyQuery(event.target.value)}
                  placeholder="Find a street, name, ZIP, type, phone…"
                  aria-label="Filter properties found"
                  className="w-full pl-8 pr-8 py-1.5 bg-neutral-950 border border-neutral-700 rounded-md text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-cyan-400"
                />
                {propertyQuery && (
                  <button
                    type="button"
                    onClick={() => setPropertyQuery('')}
                    aria-label="Clear filter"
                    className="absolute right-1.5 top-1 p-0.5 text-neutral-500 hover:text-cyan-300 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            {visibleCandidates.map((candidate) => {
              const isSelected = selectedCandidate?.id === candidate.id;
              return (
                <div
                  key={candidate.id}
                  onClick={() => focusCandidate(candidate)}
                  className={`p-3 rounded-md border text-left cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-neutral-900 border-cyan-500 shadow-[0_0_12px_rgba(6,182,212,0.2)]'
                      : 'bg-neutral-950/60 border-neutral-800/80 hover:border-cyan-500/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-neutral-100 leading-snug">
                        {candidate.address}
                      </div>
                      <div className="text-[11px] text-neutral-400 mt-0.5">
                        {[candidate.city, candidate.state, candidate.postalCode].filter(Boolean).join(', ') || 'City/state not supplied by source'}
                      </div>
                      {candidate.listPrice !== undefined && (
                        <div className="text-xs font-bold text-amber-300 mt-0.5">
                          {formatPrice(candidate.listPrice)}
                          {candidate.listingStatus && <span className="ml-1.5 text-[10px] font-medium text-neutral-400">{candidate.listingStatus}</span>}
                        </div>
                      )}
                      {listingFacts(candidate) && <div className="text-[11px] text-neutral-300 mt-0.5">{listingFacts(candidate)}</div>}
                      {candidate.agentName && (
                        <div className="text-[11px] text-neutral-300 mt-0.5">
                          Agent: {[candidate.agentName, candidate.agentOffice].filter(Boolean).join(' · ')}
                        </div>
                      )}
                      {candidate.name && <div className="text-[11px] text-neutral-200 mt-0.5">{candidate.name}</div>}
                      {candidate.ownerName && (
                        <div className="text-[11px] text-neutral-300 mt-0.5">Owner: {candidate.ownerName}</div>
                      )}
                      {(candidate.phone || candidate.email) && (
                        <div className="text-[11px] text-neutral-400 mt-0.5 break-all">
                          {[candidate.phone, candidate.email].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Clean unboxed metadata per Frontend Constitution */}
                  <div className="flex items-center gap-2 text-[11px] text-neutral-400 mt-2">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: contactTier(candidate).color }}
                      title={`${contactTier(candidate).label}: ${contactTier(candidate).meaning}`}
                      aria-label={contactTier(candidate).label}
                    />
                    <span className="text-cyan-300/90 font-medium truncate max-w-[110px]">{candidate.category}</span>
                    <span aria-hidden="true">·</span>
                    <span style={{ color: sourceColor(candidate.sourceSlug) }} className="truncate">{candidate.sourceLabel}</span>
                    {candidate.assessedValue !== undefined && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-neutral-300 font-mono">${Math.round(candidate.assessedValue).toLocaleString()}</span>
                      </>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={event => {
                      event.stopPropagation();
                      openQualificationForm(candidate);
                    }}
                    className="w-full mt-3 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-bold rounded transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    Qualify &amp; Add to Leads
                  </button>

                  {isSelected && (
                    <div className="mt-3 pt-2.5 border-t border-neutral-700/60 space-y-1 text-[11px] text-neutral-400">
                      {candidate.parcelId && <div>Parcel ID: <span className="font-mono">{candidate.parcelId}</span></div>}
                      {candidate.yearBuilt && <div>Year built: {candidate.yearBuilt}</div>}
                      {candidate.lotAcres && <div>Lot: {candidate.lotAcres.toFixed(2)} acres</div>}
                      <div>Address completeness: {candidate.confidenceScore}%</div>
                      <div>
                        {candidate.fromStore ? 'Saved in Supabase' : 'Fetched live'} · {new Date(candidate.retrievedAt).toLocaleString()}
                      </div>
                      {candidate.sourceUrl && (
                        <a href={candidate.sourceUrl} target="_blank" rel="noreferrer" className="text-cyan-300 hover:underline">
                          View source record
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {candidates.length > 0 && visibleCandidates.length === 0 && (
              <div className="text-center py-8 text-neutral-500 text-xs">
                No properties match “{propertyQuery.trim()}”.{' '}
                <button type="button" onClick={() => setPropertyQuery('')} className="text-cyan-300 hover:underline cursor-pointer">
                  Clear filter
                </button>
              </div>
            )}

            {candidates.length === 0 && !isSearching && (
              <div className="text-center py-8 text-neutral-500 text-xs">
                {searchError ? 'No records loaded because the source requests failed.' : hasSearchLocation ? 'No property records were returned for this search. Try a nearby city or street address.' : 'Search a location to load property records.'}
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Map Viewport */}
      <main className="flex-1 relative min-h-[50vh] xl:min-h-0 h-full overflow-hidden bg-neutral-950">
        <form onSubmit={handleAddressSubmit} className="absolute top-4 left-4 z-[500] flex w-[min(360px,calc(100%-2rem))] overflow-hidden rounded-md border border-neutral-700 bg-neutral-950/95 shadow-xl backdrop-blur-md">
          <input
            type="search"
            value={addressInput}
            onChange={event => setAddressInput(event.target.value)}
            placeholder="Search address or city"
            aria-label="Search map by address or city"
            className="min-w-0 flex-1 bg-transparent px-3 py-2 text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none"
          />
          <button type="submit" disabled={isSearching} aria-label="Search map" title="Search map" className="flex w-10 shrink-0 items-center justify-center border-l border-neutral-800 text-cyan-300 hover:bg-neutral-800 disabled:opacity-50">
            <Search className="h-4 w-4" />
          </button>
        </form>
        {/* Map Control & Legend Overlay */}
        <div className="absolute top-4 right-4 z-[500] bg-neutral-950/95 backdrop-blur-md border border-neutral-800 rounded-md p-3.5 text-xs shadow-2xl max-w-xs pointer-events-auto space-y-3">
          <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
            <div className="font-semibold text-neutral-200 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>Map Layer Controls</span>
            </div>
            <button
              onClick={() => {
                if (mapInstanceRef.current) {
                  mapInstanceRef.current.setView([currentFocus.lat, currentFocus.lng], 11);
                  mapInstanceRef.current.invalidateSize();
                }
              }}
              className="text-[11px] text-cyan-400 hover:underline cursor-pointer"
              title="Recenter on search focus"
            >
              Recenter
            </button>
          </div>

          {/* Tile Layer Selector */}
          <div>
            <div className="text-[11px] text-neutral-400 mb-1.5 font-medium">Map Tiles:</div>
            <div className="grid grid-cols-3 gap-1 bg-neutral-900 p-1 rounded border border-neutral-800">
              <button
                type="button"
                onClick={() => setMapTheme('osm')}
                className={`py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                  mapTheme === 'osm' ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold shadow-[0_0_8px_rgba(6,182,212,0.4)]' : 'text-neutral-400 hover:text-white'
                }`}
              >
                OSM Standard
              </button>
              <button
                type="button"
                onClick={() => setMapTheme('satellite')}
                className={`py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                  mapTheme === 'satellite' ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold shadow-[0_0_8px_rgba(6,182,212,0.4)]' : 'text-neutral-400 hover:text-white'
                }`}
              >
                Satellite
              </button>
              <button
                type="button"
                onClick={() => setMapTheme('dark')}
                className={`py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                  mapTheme === 'dark' ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold shadow-[0_0_8px_rgba(6,182,212,0.4)]' : 'text-neutral-400 hover:text-white'
                }`}
              >
                Dark
              </button>
            </div>
          </div>

          {/* Quick On-Map Adjustable Radius */}
          <div className="pt-2 border-t border-neutral-800 space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-medium text-neutral-300 flex items-center gap-1">
                <Compass className="w-3 h-3 text-cyan-400" />
                <span>Adjust Radius:</span>
              </span>
              <span className="font-mono font-bold text-cyan-300 bg-neutral-900 px-1.5 py-0.5 rounded border border-neutral-800">
                {searchRadius} mi
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={MAX_RADIUS_MILES}
              step={1}
              value={searchRadius}
              onChange={(e) => setSearchRadius(Number(e.target.value))}
              className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-neutral-900 rounded-lg appearance-none"
            />
            <div className="flex items-center justify-between text-[10px] font-mono text-neutral-500">
              <span>1 mi</span>
              <span className="text-cyan-400/90">~{Math.round(Math.PI * searchRadius * searchRadius).toLocaleString()} sq mi</span>
              <span>{MAX_RADIUS_MILES} mi</span>
            </div>
          </div>

          {/* Entity Legend */}
          <div className="space-y-1.5 text-[11px] text-neutral-300 pt-1 border-t border-neutral-800">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-white border border-neutral-950 shadow-[0_0_0_2px_#06b6d4] shrink-0" />
              <span>{hasSearchLocation ? currentFocus.label : 'No location selected'}</span>
            </div>
            {CONTACT_TIERS.map(tier => (
              <div key={tier.key} className="flex items-center gap-2" title={tier.meaning}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tier.color, boxShadow: `0 0 6px ${tier.color}` }} />
                <span>{tier.label}</span>
                <span className="text-neutral-500 truncate">{tier.detail}</span>
                <span className="ml-auto font-mono text-neutral-400">{candidates.filter(c => contactTier(c).key === tier.key).length}</span>
              </div>
            ))}
            {candidates.length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 pt-1 text-[10px] text-neutral-500">
                <span>Sources:</span>
                {SOURCE_GROUPS.map(group => ({ ...group, count: candidates.filter(c => group.match(c.sourceSlug)).length }))
                  .filter(group => group.count)
                  .map(group => (
                    <span key={group.label} style={{ color: sourceColor(group.slug) }}>
                      {group.label} {group.count}
                    </span>
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* State Quick Switcher Bar with Regional Filter */}
        <div className="absolute bottom-4 left-4 z-[500] bg-neutral-950/95 backdrop-blur-md border border-neutral-800 rounded-md p-2.5 text-xs flex flex-col gap-2 shadow-2xl max-w-[calc(100vw-450px)]">
          <div className="flex items-center justify-between gap-3 border-b border-neutral-800 pb-1.5">
            <span className="text-neutral-400 font-semibold text-[11px] uppercase tracking-wider">
              US states ({displayedStates.length}):
            </span>
            <div className="flex items-center gap-1">
              {(['ALL', 'Northeast', 'South', 'Midwest', 'West'] as const).map(reg => (
                <button
                  key={reg}
                  type="button"
                  onClick={() => setSelectedRegion(reg)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                    selectedRegion === reg
                      ? 'bg-blue-950 text-cyan-300 font-bold border border-cyan-500/40 shadow-[0_0_6px_rgba(6,182,212,0.2)]'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  {reg}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
            {displayedStates.map(st => (
              <button
                key={st.code}
                onClick={() => handleStateSelect(st.code)}
                title={`Search ${st.name}`}
                className={`px-2 py-1 rounded text-[11px] font-mono transition-all shrink-0 cursor-pointer ${
                  selectedStateCode === st.code
                    ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold shadow-[0_0_10px_rgba(6,182,212,0.4)]'
                    : 'bg-neutral-900 border border-neutral-800 text-neutral-300 hover:bg-neutral-800 hover:border-cyan-500/30'
                }`}
              >
                {st.code}
              </button>
            ))}
          </div>
        </div>

        {isSearching && (
          <div
            role="status"
            aria-live="polite"
            className="absolute inset-0 z-[700] flex items-center justify-center bg-neutral-950/55 backdrop-blur-[2px]"
          >
            <div className="w-[min(320px,calc(100%-2rem))] rounded-lg border border-cyan-500/30 bg-neutral-950/95 p-5 shadow-[0_0_30px_rgba(6,182,212,0.2)]">
              <div className="flex items-center gap-3">
                <div className="relative h-10 w-10 shrink-0">
                  <div className="absolute inset-0 rounded-full border-2 border-neutral-800" />
                  <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-cyan-400 border-r-blue-500 animate-spin" />
                  <MapPin className="absolute inset-0 m-auto h-4 w-4 text-cyan-300" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-neutral-100">Searching properties…</div>
                  <div className="text-[11px] text-neutral-400 truncate">
                    {searchStage === 'locating' ? addressInput || 'Finding location' : `${searchRadius} mi around ${currentFocus.label}`}
                  </div>
                </div>
              </div>

              <ol className="mt-4 space-y-2 text-[12px]">
                {[
                  { key: 'locating', label: 'Finding the location' },
                  { key: 'records', label: 'Loading Realtor.com listings + saved records' }
                ].map((step, index) => {
                  const done = searchStage === 'records' && step.key === 'locating';
                  const active = searchStage === step.key;
                  return (
                    <li key={step.key} className="flex items-center gap-2">
                      {done ? (
                        <CheckCircle className="h-4 w-4 shrink-0 text-cyan-400" />
                      ) : (
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold ${
                            active ? 'border-cyan-400 text-cyan-300 animate-pulse' : 'border-neutral-700 text-neutral-600'
                          }`}
                        >
                          {index + 1}
                        </span>
                      )}
                      <span className={done ? 'text-neutral-500' : active ? 'text-neutral-100' : 'text-neutral-600'}>{step.label}</span>
                    </li>
                  );
                })}
              </ol>

              <div className="mt-4 h-1 overflow-hidden rounded-full bg-neutral-800">
                <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-cyan-400 to-blue-600 animate-[loading-bar_1.4s_ease-in-out_infinite]" />
              </div>
              <div className="mt-2 flex justify-between text-[10px] font-mono text-neutral-500">
                <span>{searchSeconds}s elapsed</span>
                {searchStage === 'records' && searchSeconds >= 8 && <span>Larger areas can take ~30s</span>}
              </div>
            </div>
          </div>
        )}

        {/* Leaflet DOM Node with guaranteed absolute positioning */}
        <div 
          ref={mapContainerRef} 
          className="absolute inset-0 w-full h-full z-0 cursor-grab active:cursor-grabbing" 
          style={{ minHeight: '100%' }}
        />
      </main>

      {qualifyingCandidate && (
        // Side panel instead of a full-screen modal: the map stays visible and usable behind it.
        <div className="fixed top-[62px] right-0 bottom-0 z-[1000] w-full max-w-md p-3 flex pointer-events-none">
          <section
            role="dialog"
            aria-modal="false"
            aria-labelledby="qualify-lead-title"
            onKeyDown={event => {
              if (event.key === 'Escape') setQualifyingCandidate(null);
            }}
            className="pointer-events-auto w-full max-h-full overflow-y-auto bg-neutral-900/95 backdrop-blur-md border border-neutral-700 rounded-lg shadow-2xl"
          >
            <div className="p-4 border-b border-neutral-800 flex items-start justify-between gap-3">
              <div>
                <h2 id="qualify-lead-title" className="text-sm font-bold text-white">Qualify property lead</h2>
                <p className="mt-1 text-xs text-neutral-400">{qualifyingCandidate.address}</p>
              </div>
              <button type="button" onClick={() => setQualifyingCandidate(null)} title="Close" className="p-1 text-neutral-400 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            {qualificationError && <div className="mx-4 mt-3 text-xs text-rose-300">{qualificationError}</div>}

            <form onSubmit={handleQualificationSubmit} className="p-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-neutral-300">First name *
                  <input required value={qualificationForm.firstName} onChange={event => setQualificationForm({ ...qualificationForm, firstName: event.target.value })} className="mt-1 w-full px-2.5 py-2 bg-neutral-950 border border-neutral-700 rounded text-neutral-100" />
                </label>
                <label className="text-neutral-300">Last name *
                  <input required value={qualificationForm.lastName} onChange={event => setQualificationForm({ ...qualificationForm, lastName: event.target.value })} className="mt-1 w-full px-2.5 py-2 bg-neutral-950 border border-neutral-700 rounded text-neutral-100" />
                </label>
                <label className="text-neutral-300">Role *
                  <select required value={qualificationForm.role} onChange={event => setQualificationForm({ ...qualificationForm, role: event.target.value as RealEstateLead['role'] | '' })} className="mt-1 w-full px-2.5 py-2 bg-neutral-950 border border-neutral-700 rounded text-neutral-100">
                    <option value="">Choose role</option>
                    {['Property Owner', 'Listing Agent', 'Broker', 'Real Estate Investor', 'Referral Partner', 'Homebuyer'].map(role => <option key={role} value={role}>{role}</option>)}
                  </select>
                </label>
                <label className="text-neutral-300">Lead category *
                  <select required value={qualificationForm.category} onChange={event => setQualificationForm({ ...qualificationForm, category: event.target.value as LeadCategory | '' })} className="mt-1 w-full px-2.5 py-2 bg-neutral-950 border border-neutral-700 rounded text-neutral-100">
                    <option value="">Choose category</option>
                    {['Residential Single-Family', 'Multi-Family 2-4 Units', 'Luxury Estate', 'Commercial & Retail', 'Distressed / Pre-Foreclosure', 'FSBO (For Sale By Owner)', 'Investor Buyer'].map(category => <option key={category} value={category}>{category}</option>)}
                  </select>
                </label>
                <label className="text-neutral-300 col-span-2">Company / owner
                  <input value={qualificationForm.company} onChange={event => setQualificationForm({ ...qualificationForm, company: event.target.value })} className="mt-1 w-full px-2.5 py-2 bg-neutral-950 border border-neutral-700 rounded text-neutral-100" />
                </label>
                <label className="text-neutral-300 col-span-2">Street address *
                  <input required value={qualificationForm.street} onChange={event => setQualificationForm({ ...qualificationForm, street: event.target.value })} className="mt-1 w-full px-2.5 py-2 bg-neutral-950 border border-neutral-700 rounded text-neutral-100" />
                </label>
                <label className="text-neutral-300">City *
                  <input required value={qualificationForm.city} onChange={event => setQualificationForm({ ...qualificationForm, city: event.target.value })} className="mt-1 w-full px-2.5 py-2 bg-neutral-950 border border-neutral-700 rounded text-neutral-100" />
                </label>
                <label className="text-neutral-300">State *
                  <input required value={qualificationForm.state} onChange={event => setQualificationForm({ ...qualificationForm, state: event.target.value })} className="mt-1 w-full px-2.5 py-2 bg-neutral-950 border border-neutral-700 rounded text-neutral-100" />
                </label>
                <label className="text-neutral-300">ZIP code *
                  <input required value={qualificationForm.postalCode} onChange={event => setQualificationForm({ ...qualificationForm, postalCode: event.target.value })} className="mt-1 w-full px-2.5 py-2 bg-neutral-950 border border-neutral-700 rounded text-neutral-100" />
                </label>
                <label className="text-neutral-300">Email
                  <input type="email" value={qualificationForm.email} onChange={event => setQualificationForm({ ...qualificationForm, email: event.target.value })} className="mt-1 w-full px-2.5 py-2 bg-neutral-950 border border-neutral-700 rounded text-neutral-100" />
                </label>
                <label className="text-neutral-300">Phone
                  <input type="tel" value={qualificationForm.phone} onChange={event => setQualificationForm({ ...qualificationForm, phone: event.target.value })} className="mt-1 w-full px-2.5 py-2 bg-neutral-950 border border-neutral-700 rounded text-neutral-100" />
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setQualifyingCandidate(null)} className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded cursor-pointer">Cancel</button>
                <button type="submit" className="px-3 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold rounded flex items-center gap-1.5 cursor-pointer">
                  <CheckCircle className="w-3.5 h-3.5" /> Add Lead
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
};
