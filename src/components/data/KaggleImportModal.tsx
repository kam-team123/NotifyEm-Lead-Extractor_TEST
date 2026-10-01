import React, { useRef, useState } from 'react';
import Papa from 'papaparse';
import { FileUp, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { US_STATES } from '../../data/referenceData';
import { apiSend } from '../../services/apiClient';

// Streams a Kaggle real-estate CSV in the browser and posts normalised batches to /api/import/kaggle.
// Works with e.g. "USA Real Estate Dataset" (realtor-data.csv) and any CSV with price + address/city columns.

type FieldKey =
  | 'address' | 'city' | 'state' | 'zip' | 'price' | 'beds' | 'baths' | 'sqft' | 'lotAcres'
  | 'status' | 'propertyType' | 'yearBuilt' | 'lat' | 'lng' | 'soldDate' | 'listDate' | 'broker';

const FIELDS: { key: FieldKey; label: string; synonyms: string[]; required?: boolean }[] = [
  { key: 'price', label: 'Price', synonyms: ['price', 'list_price', 'listprice', 'listing_price', 'sale_price', 'sold_price', 'saleprice'], required: true },
  { key: 'address', label: 'Street address', synonyms: ['street', 'address', 'full_address', 'street_address', 'streetaddress', 'address_line', 'addr', 'unparsedaddress'] },
  { key: 'city', label: 'City', synonyms: ['city', 'city_name', 'town'] },
  { key: 'state', label: 'State', synonyms: ['state', 'state_code', 'stateorprovince', 'st'] },
  { key: 'zip', label: 'ZIP', synonyms: ['zip_code', 'zip', 'zipcode', 'postal_code', 'postalcode', 'postcode'] },
  { key: 'beds', label: 'Beds', synonyms: ['bed', 'beds', 'bedrooms', 'bedroomstotal', 'bedroom'] },
  { key: 'baths', label: 'Baths', synonyms: ['bath', 'baths', 'bathrooms', 'bathroomstotal', 'bathroomstotalinteger', 'bathroom'] },
  { key: 'sqft', label: 'Living sqft', synonyms: ['house_size', 'sqft', 'square_feet', 'living_area', 'livingarea', 'livingareasqft', 'area', 'size'] },
  { key: 'lotAcres', label: 'Lot acres', synonyms: ['acre_lot', 'lot_acres', 'lotsizeacres', 'acres', 'lot_size_acres'] },
  { key: 'status', label: 'Status', synonyms: ['status', 'listing_status', 'standardstatus', 'homestatus'] },
  { key: 'propertyType', label: 'Property type', synonyms: ['property_type', 'propertytype', 'home_type', 'hometype', 'type', 'propertysubtype'] },
  { key: 'yearBuilt', label: 'Year built', synonyms: ['year_built', 'yearbuilt', 'built'] },
  { key: 'lat', label: 'Latitude', synonyms: ['latitude', 'lat'] },
  { key: 'lng', label: 'Longitude', synonyms: ['longitude', 'lng', 'lon', 'long'] },
  { key: 'soldDate', label: 'Sold date', synonyms: ['prev_sold_date', 'sold_date', 'last_sold_date', 'closedate', 'datesold'] },
  { key: 'listDate', label: 'List date', synonyms: ['list_date', 'listing_date', 'listingcontractdate', 'onmarketdate'] },
  { key: 'broker', label: 'Broker', synonyms: ['brokered_by', 'broker', 'brokerage', 'listofficename', 'office'] }
];

const BATCH = 500;

function detectMapping(headers: string[]): Partial<Record<FieldKey, string>> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const lookup = new Map(headers.map(h => [norm(h), h]));
  const mapping: Partial<Record<FieldKey, string>> = {};
  for (const field of FIELDS) {
    const hit = field.synonyms.map(s => lookup.get(norm(s))).find(Boolean);
    if (hit) mapping[field.key] = hit;
  }
  return mapping;
}

interface Props {
  onClose: () => void;
  onImported: (summary: { imported: number; skipped: number }) => void;
}

export const KaggleImportModal: React.FC<Props> = ({ onClose, onImported }) => {
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<FieldKey, string>>>({});
  const [dataset, setDataset] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [maxRows, setMaxRows] = useState(20000);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ read: 0, matched: 0, imported: 0, skipped: 0 });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const cancelRef = useRef(false);

  const handleFile = (f: File | null) => {
    setFile(f);
    setError(null);
    setDone(false);
    setHeaders([]);
    if (!f) return;
    setDataset(f.name.replace(/\.csv$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    Papa.parse<Record<string, string>>(f, {
      header: true,
      preview: 20,
      skipEmptyLines: true,
      complete: result => {
        const fields = result.meta.fields ?? [];
        if (!fields.length) {
          setError('Could not read a header row from this CSV.');
          return;
        }
        setHeaders(fields);
        setMapping(detectMapping(fields));
      },
      error: err => setError(err.message)
    });
  };

  const stateMatches = (raw: string | undefined) => {
    if (!stateFilter) return true;
    if (!raw) return false;
    const st = US_STATES.find(s => s.code === stateFilter)!;
    const v = raw.trim().toLowerCase();
    return v === st.code.toLowerCase() || v === st.name.toLowerCase();
  };

  const runImport = () => {
    if (!file) return;
    if (!mapping.price || (!mapping.address && !mapping.city)) {
      setError('Map at least the Price column and an Address or City column.');
      return;
    }
    if (stateFilter && !mapping.state) {
      setError('Map the State column to filter by state.');
      return;
    }
    cancelRef.current = false;
    setRunning(true);
    setDone(false);
    setError(null);
    const totals = { read: 0, matched: 0, imported: 0, skipped: 0 };
    setProgress({ ...totals });

    const get = (row: Record<string, string>, key: FieldKey) => (mapping[key] ? row[mapping[key]!] : undefined);
    let pending: Record<string, unknown>[] = [];
    let rowIndex = 0;

    const flush = async () => {
      if (!pending.length) return;
      const rows = pending;
      pending = [];
      const res = await apiSend<{ imported: number; skipped: number }>('POST', '/api/import/kaggle', { dataset, rows }, 60000);
      totals.imported += res.imported;
      totals.skipped += res.skipped;
      setProgress({ ...totals });
    };

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      chunkSize: 1024 * 512,
      chunk: (result, parser) => {
        parser.pause();
        (async () => {
          for (const row of result.data) {
            rowIndex++;
            totals.read++;
            if (totals.matched >= maxRows) break;
            if (!stateMatches(get(row, 'state'))) continue;
            totals.matched++;
            let address = get(row, 'address')?.trim() || '';
            // Some Kaggle sets (e.g. realtor-data v2) replace street names with numeric ids.
            if (/^\d+(\.\d+)?$/.test(address)) address = '';
            pending.push({
              rowKey: String(rowIndex),
              address,
              city: get(row, 'city'),
              state: get(row, 'state'),
              zip: get(row, 'zip'),
              price: get(row, 'price'),
              beds: get(row, 'beds'),
              baths: get(row, 'baths'),
              sqft: get(row, 'sqft'),
              lotAcres: get(row, 'lotAcres'),
              status: get(row, 'status'),
              propertyType: get(row, 'propertyType'),
              yearBuilt: get(row, 'yearBuilt'),
              lat: get(row, 'lat'),
              lng: get(row, 'lng'),
              soldDate: get(row, 'soldDate'),
              listDate: get(row, 'listDate'),
              broker: get(row, 'broker')
            });
            if (pending.length >= BATCH) await flush();
          }
          setProgress({ ...totals });
          if (cancelRef.current || totals.matched >= maxRows) {
            parser.abort();
          } else {
            parser.resume();
          }
        })().catch(err => {
          setError(err instanceof Error ? err.message : 'Import failed.');
          cancelRef.current = true;
          parser.abort();
        });
      },
      complete: () => {
        flush()
          .then(() => {
            setRunning(false);
            if (!cancelRef.current) {
              setDone(true);
              onImported({ imported: totals.imported, skipped: totals.skipped });
            }
          })
          .catch(err => {
            setRunning(false);
            setError(err instanceof Error ? err.message : 'Import failed.');
          });
      },
      error: err => {
        setRunning(false);
        setError(err.message);
      }
    });
  };

  return (
    <div className="fixed inset-0 z-[1000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl text-xs">
        <div className="flex items-center justify-between p-4 border-b border-neutral-800">
          <div>
            <h2 className="text-sm font-semibold text-white">Import a Kaggle real estate CSV</h2>
            <p className="text-neutral-400 mt-0.5">
              Download a dataset from{' '}
              <a className="text-cyan-300 hover:underline" href="https://www.kaggle.com/datasets/ahmedshahriarsakib/usa-real-estate-dataset" target="_blank" rel="noreferrer">
                Kaggle
              </a>
              , unzip it, and choose the CSV. Rows are saved to Supabase as historical snapshot listings.
            </p>
          </div>
          <button onClick={onClose} disabled={running} className="p-1 text-neutral-400 hover:text-white cursor-pointer disabled:opacity-40" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-neutral-600 rounded cursor-pointer hover:border-cyan-500/60 text-neutral-300">
            <FileUp className="w-4 h-4 text-cyan-400" />
            <span>{file ? `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)` : 'Choose CSV file…'}</span>
            <input type="file" accept=".csv,text/csv" className="hidden" disabled={running} onChange={e => handleFile(e.target.files?.[0] ?? null)} />
          </label>

          {headers.length > 0 && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-neutral-300 font-medium mb-1">Dataset name</label>
                  <input value={dataset} onChange={e => setDataset(e.target.value)} disabled={running}
                    className="w-full px-2 py-1.5 bg-neutral-950 border border-neutral-700 rounded text-neutral-100 focus:outline-none focus:border-cyan-400" />
                </div>
                <div>
                  <label className="block text-neutral-300 font-medium mb-1">Only this state</label>
                  <select value={stateFilter} onChange={e => setStateFilter(e.target.value)} disabled={running}
                    className="w-full px-2 py-1.5 bg-neutral-950 border border-neutral-700 rounded text-neutral-100 focus:outline-none focus:border-cyan-400">
                    <option value="">All states</option>
                    {US_STATES.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-neutral-300 font-medium mb-1">Max rows to import</label>
                  <input type="number" min={100} max={500000} step={1000} value={maxRows} disabled={running}
                    onChange={e => setMaxRows(Math.max(100, Math.min(500000, Number(e.target.value) || 100)))}
                    className="w-full px-2 py-1.5 bg-neutral-950 border border-neutral-700 rounded text-neutral-100 focus:outline-none focus:border-cyan-400" />
                </div>
              </div>
              <p className="text-neutral-500">
                Supabase's free plan holds 500 MB. Roughly 1,000 rows use about 1 MB, so filter large national files by state.
              </p>

              <div>
                <div className="text-neutral-300 font-medium mb-1.5">Column mapping (auto-detected)</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {FIELDS.map(f => (
                    <label key={f.key} className="block">
                      <span className="text-[11px] text-neutral-400">{f.label}{f.required ? ' *' : ''}</span>
                      <select
                        value={mapping[f.key] ?? ''}
                        disabled={running}
                        onChange={e => setMapping(m => ({ ...m, [f.key]: e.target.value || undefined }))}
                        className="w-full px-1.5 py-1 bg-neutral-950 border border-neutral-700 rounded text-neutral-100 focus:outline-none focus:border-cyan-400"
                      >
                        <option value="">—</option>
                        {headers.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          {(running || done) && (
            <div className="p-3 rounded border border-neutral-800 bg-neutral-950 font-mono text-[11px] text-neutral-300 flex flex-wrap gap-4">
              <span>Read {progress.read.toLocaleString()}</span>
              <span>Matched {progress.matched.toLocaleString()}</span>
              <span className="text-cyan-300">Saved {progress.imported.toLocaleString()}</span>
              <span>Skipped {progress.skipped.toLocaleString()} (no price or location)</span>
            </div>
          )}
          {done && (
            <div className="flex items-center gap-1.5 text-emerald-300">
              <CheckCircle2 className="w-3.5 h-3.5" /> Import finished.
            </div>
          )}
          {error && (
            <div className="flex items-start gap-1.5 text-rose-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-neutral-800">
          {running ? (
            <button onClick={() => { cancelRef.current = true; }} className="px-3 py-1.5 bg-neutral-800 text-neutral-200 rounded cursor-pointer">
              Stop after this batch
            </button>
          ) : (
            <button onClick={onClose} className="px-3 py-1.5 bg-neutral-800 text-neutral-300 rounded cursor-pointer">
              {done ? 'Close' : 'Cancel'}
            </button>
          )}
          <button
            onClick={runImport}
            disabled={!headers.length || running || !dataset}
            className="px-4 py-1.5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold rounded cursor-pointer disabled:opacity-50"
          >
            {running ? 'Importing…' : 'Import to Supabase'}
          </button>
        </div>
      </div>
    </div>
  );
};
