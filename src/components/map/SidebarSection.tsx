import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface Props {
  title: string;
  /** Shown under the title while collapsed, e.g. the current location or radius. */
  summary?: React.ReactNode;
  icon?: React.ReactNode;
  /** localStorage key that remembers whether the section is open. */
  storageKey: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/** Collapsible sidebar block so the property list gets more room. */
export const SidebarSection: React.FC<Props> = ({ title, summary, icon, storageKey, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved === null ? defaultOpen : saved === '1';
    } catch {
      return defaultOpen;
    }
  });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(storageKey, next ? '1' : '0');
    } catch {
      // Storage unavailable; the section just won't remember its state.
    }
  };

  return (
    <div className="border-b border-neutral-800 shrink-0">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full px-4 py-3 flex items-center gap-2 text-left cursor-pointer group hover:bg-neutral-900/60"
      >
        {icon}
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-neutral-200 group-hover:text-cyan-300">{title}</div>
          {!open && summary && <div className="mt-0.5 text-[11px] text-neutral-500 truncate">{summary}</div>}
        </div>
        <ChevronDown className={`w-4 h-4 shrink-0 text-neutral-500 group-hover:text-cyan-300 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
};
