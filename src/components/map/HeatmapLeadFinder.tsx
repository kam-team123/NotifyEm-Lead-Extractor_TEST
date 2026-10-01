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
} from 'lucide-react';
import { RealEstateLead, PropertyListing, DatabaseCollection, SourceRunStatus } from '../../types';
import { US_STATES } from '../../data/referenceData';
import { geocodeAddress, MappedBuilding, searchMapRecords } from '../../services/openStreetMapService';
import { DataSourcesPanel } from '../data/DataSourcesPanel';

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** Marker colour per data source family. */
const sourceColor = (slug: string) =>
  slug === 'osm' ? '#3b82f6' : slug.startsWith('parcel-layer:') ? '#10b981' : slug === 'overture' ? '#8b5cf6' : '#06b6d4';

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

  // Current focal coordinates
  const [currentFocus, setCurrentFocus] = useState<{ lat: number; lng: number; label: string; city: string; state: string }>({
    lat: 39.5,
    lng: -98.35,
    label: 'United States',
    city: '',
    state: ''
  });

  // Discovered candidates
  const [candidates, setCandidates] = useState<MappedBuilding[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<MappedBuilding | null>(null);
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

  // Update map layers when focus, candidates, leads, or heatmap state changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const dynamicZoom = searchRadius > 80 ? 7 : searchRadius > 45 ? 8 : searchRadius > 20 ? 10 : searchRadius > 8 ? 11 : 13;
    map.setView([currentFocus.lat, currentFocus.lng], dynamicZoom);

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
          html: '<div style="background-color: #06b6d4; width: 14px; height: 14px; border-radius: 50%; border: 3px solid #000; box-shadow: 0 0 14px #06b6d4;"></div>',
          iconSize: [14, 14],
          iconAnchor: [7, 7]
        });
        L.marker([currentFocus.lat, currentFocus.lng], { icon: centerIcon })
          .bindTooltip(`Search location: ${escapeHtml(currentFocus.label)}`, { className: 'leaflet-tooltip-dark' })
          .addTo(markersLayerRef.current);
      }

      // Discovered candidates markers - Electric Blue
      candidates.forEach(candidate => {
        const color = sourceColor(candidate.sourceSlug);
        const candIcon = L.divIcon({
          className: 'candidate-pin',
          html: `<div style="background-color: ${color}; width: 11px; height: 11px; border-radius: 50%; border: 2px solid #020617; box-shadow: 0 0 6px ${color}99; cursor: pointer;"></div>`,
          iconSize: [11, 11],
          iconAnchor: [5.5, 5.5]
        });

        const marker = L.marker([candidate.lat, candidate.lng], { icon: candIcon });
        marker.on('click', () => {
          setSelectedCandidate(candidate);
        });
        const ownerLine = candidate.ownerName ? `<br/>Owner: ${escapeHtml(candidate.ownerName)}` : '';
        marker.bindTooltip(`${escapeHtml(candidate.address)}${ownerLine}<br/>${escapeHtml(candidate.sourceLabel)}`, {
          className: 'leaflet-tooltip-dark'
        });
        marker.addTo(markersLayerRef.current!);
      });
    }
  }, [currentFocus, searchRadius, showHeatmap, candidates, hasSearchLocation]);

  const handleAddressSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!addressInput.trim()) return;

    setIsSearching(true);
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
    setSearchError(null);
    try {
      const result = await searchMapRecords(lat, lng, searchRadius);
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
    <div className="flex-1 flex flex-col xl:flex-row h-[calc(100vh-57px)] overflow-hidden bg-neutral-950">
      {/* Left Control Panel / Search Configuration (SOP Section 04) */}
      <aside className="w-full xl:w-[410px] border-r border-neutral-800 bg-neutral-900/90 flex flex-col shrink-0 overflow-y-auto z-10">
        <div className="p-4 border-b border-neutral-800">
          <div className="flex items-center justify-between">
            <h1 className="text-base font-semibold text-white tracking-tight">Property Map</h1>
            <div className="flex items-center gap-1.5 text-xs text-neutral-400">
              <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_#06b6d4]" />
              <span className="text-cyan-300 font-mono text-[11px]">OpenStreetMap</span>
            </div>
          </div>
          <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
            Searches OpenStreetMap buildings, connected county parcel layers (owner and assessed value) and everything already saved in Supabase.
          </p>
        </div>

        {/* Section 04 Part C: User Address Input */}
        <div className="p-4 border-b border-neutral-800 space-y-3">
          <label className="block text-xs font-semibold text-neutral-300">
            Search Location (Address, City, State, or ZIP)
          </label>
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

          {searchError && (
            <div className="text-xs text-rose-400 flex items-start gap-1.5 pt-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{searchError}</span>
            </div>
          )}

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
        </div>

        {/* Section 04 Part D: Adjustable Radius & Discovery Provider */}
        <div className="p-4 border-b border-neutral-800 space-y-3.5">
          {/* Fully Adjustable Search Radius Slider & Direct Input */}
          <div className="space-y-2 bg-neutral-950 p-3 rounded-lg border border-neutral-800">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-neutral-200 flex items-center gap-1.5">
                <Compass className="w-3.5 h-3.5 text-cyan-400" />
                <span>Adjustable Search Radius</span>
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={searchRadius}
                  onChange={(e) => setSearchRadius(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
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
                max={500}
                step={1}
                value={searchRadius}
                onChange={(e) => setSearchRadius(Number(e.target.value))}
                className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-neutral-800 rounded-lg appearance-none"
              />
              <div className="flex items-center justify-between text-[10px] font-mono text-neutral-500">
                <span>1 mi</span>
                <span className="text-cyan-400/80">Coverage: ~{Math.round(Math.PI * searchRadius * searchRadius).toLocaleString()} sq mi</span>
                <span>500 mi</span>
              </div>
            </div>

            {/* Quick Radius Presets */}
            <div className="flex items-center gap-1 pt-1 overflow-x-auto">
              {[1, 5, 10, 15, 25, 50, 100, 200, 300, 500].map(mi => (
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

          {/* Action to re-run discovery */}
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
        <div className="flex-1 p-4 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">
              Properties found ({candidates.length})
            </div>
            <div className="text-[11px] text-neutral-500">
              {lastSync ? `Updated ${new Date(lastSync).toLocaleString()}` : 'No search run'}
            </div>
          </div>

          <div className="space-y-2">
            {candidates.map((candidate) => {
              const isSelected = selectedCandidate?.id === candidate.id;
              return (
                <div
                  key={candidate.id}
                  onClick={() => setSelectedCandidate(candidate)}
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
                      {candidate.ownerName && (
                        <div className="text-[11px] text-neutral-300 mt-0.5">Owner: {candidate.ownerName}</div>
                      )}
                    </div>
                  </div>

                  {/* Clean unboxed metadata per Frontend Constitution */}
                  <div className="flex items-center gap-2 text-[11px] text-neutral-400 mt-2">
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

            {candidates.length === 0 && !isSearching && (
              <div className="text-center py-8 text-neutral-500 text-xs">
                {searchError ? 'No records loaded because the source requests failed.' : hasSearchLocation ? 'No property records were returned for this search. Try a city address or connect a county parcel layer.' : 'Search a location to load property records.'}
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Map Viewport */}
      <main className="flex-1 relative min-h-[500px] h-full overflow-hidden bg-neutral-950">
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
              max={500}
              step={1}
              value={searchRadius}
              onChange={(e) => setSearchRadius(Number(e.target.value))}
              className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-neutral-900 rounded-lg appearance-none"
            />
            <div className="flex items-center justify-between text-[10px] font-mono text-neutral-500">
              <span>1 mi</span>
              <span className="text-cyan-400/90">~{Math.round(Math.PI * searchRadius * searchRadius).toLocaleString()} sq mi</span>
              <span>500 mi</span>
            </div>
          </div>

          {/* Entity Legend */}
          <div className="space-y-1.5 text-[11px] text-neutral-300 pt-1 border-t border-neutral-800">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-cyan-400 border border-neutral-950 shadow-[0_0_6px_#06b6d4] shrink-0" />
              <span>{hasSearchLocation ? currentFocus.label : 'No location selected'}</span>
            </div>
            {[
              { label: 'OpenStreetMap', color: sourceColor('osm'), match: (slug: string) => slug === 'osm' },
              { label: 'County parcels', color: sourceColor('parcel-layer:'), match: (slug: string) => slug.startsWith('parcel-layer:') },
              { label: 'Overture', color: sourceColor('overture'), match: (slug: string) => slug === 'overture' },
              { label: 'MLS / Kaggle / other', color: sourceColor('other'), match: (slug: string) => !['osm', 'overture'].includes(slug) && !slug.startsWith('parcel-layer:') }
            ].map(item => (
              <div key={item.label} className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color, boxShadow: `0 0 6px ${item.color}` }} />
                <span>{item.label} ({candidates.filter(c => item.match(c.sourceSlug)).length})</span>
              </div>
            ))}
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

        {/* Leaflet DOM Node with guaranteed absolute positioning */}
        <div 
          ref={mapContainerRef} 
          className="absolute inset-0 w-full h-full z-0 cursor-grab active:cursor-grabbing" 
          style={{ minHeight: '100%' }}
        />
      </main>
    </div>
  );
};
