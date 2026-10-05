import React from 'react';
import { HelpCircle, X } from 'lucide-react';

const STEPS: { title: string; body: string }[] = [
  { title: 'Pick a location', body: 'Type an address, city or ZIP in the search box, tap a Quick Metro, or choose a state in the bar below.' },
  { title: 'Choose a source', body: 'Realtor.com for live for-sale listings, OpenStreetMap for addressed buildings and businesses, or Both.' },
  { title: 'Set the radius and search', body: 'Use Adjust Radius (1–50 mi), then press Search properties. Saved records load instantly; live ones take a few seconds.' },
  { title: 'Read the colours', body: 'Green = address + phone + email, cyan = phone, amber = email, orange = address only, grey = incomplete.' },
  { title: 'Qualify a property', body: 'Click a marker, then Qualify & Add. The lead goes to Leads & Pipeline and the map stays where it is.' }
];

/** Small trigger button for panel headers. */
export const HowToStartButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-cyan-300 cursor-pointer"
    title="How to start"
  >
    <HelpCircle className="w-3.5 h-3.5" />
    <span>How to start</span>
  </button>
);

/** Compact getting-started guide that floats over the map without blocking it. */
export const HowToStartCard: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <section
    aria-labelledby="how-to-start-title"
    className="absolute bottom-28 right-4 z-[600] w-80 max-w-[calc(100%-2rem)] bg-neutral-950/95 backdrop-blur-md border border-cyan-500/30 rounded-md shadow-2xl text-xs"
  >
    <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-neutral-800">
      <h2 id="how-to-start-title" className="font-semibold text-neutral-100 flex items-center gap-1.5">
        <HelpCircle className="w-3.5 h-3.5 text-cyan-400" />
        How to start
      </h2>
      <button type="button" onClick={onClose} title="Close" className="p-0.5 text-neutral-400 hover:text-white cursor-pointer">
        <X className="w-4 h-4" />
      </button>
    </div>
    <ol className="px-3.5 py-3 space-y-2.5">
      {STEPS.map((step, i) => (
        <li key={step.title} className="flex gap-2.5">
          <span className="w-5 h-5 shrink-0 rounded-full bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 font-mono text-[10px] flex items-center justify-center">
            {i + 1}
          </span>
          <div>
            <div className="font-medium text-neutral-200">{step.title}</div>
            <div className="text-[11px] text-neutral-400 leading-relaxed">{step.body}</div>
          </div>
        </li>
      ))}
    </ol>
    <div className="px-3.5 pb-3">
      <button
        type="button"
        onClick={onClose}
        className="w-full py-1.5 rounded bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold cursor-pointer"
      >
        Got it
      </button>
    </div>
  </section>
);
