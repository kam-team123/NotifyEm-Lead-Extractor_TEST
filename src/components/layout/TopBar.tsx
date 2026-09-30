import React from 'react';
import { Building2, RefreshCw, Database } from 'lucide-react';
import { SalesforceConfig } from '../../types';

interface TopBarProps {
  activeTab: 'map' | 'daily' | 'pipeline' | 'campaigns' | 'salesforce' | 'collections';
  onSelectTab: (tab: 'map' | 'daily' | 'pipeline' | 'campaigns' | 'salesforce' | 'collections') => void;
  salesforceConfig: SalesforceConfig;
  onQuickSync: () => void;
  isSyncing: boolean;
  pendingReviewCount: number;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  onSelectTab,
  salesforceConfig,
  onQuickSync,
  isSyncing,
  pendingReviewCount
}) => {
  return (
    <header className="flex items-center justify-between px-6 py-3.5 bg-neutral-950 border-b border-neutral-800 shrink-0">
      {/* Zone 1: Single text element wordmark in display style */}
      <div className="flex items-center gap-3">
        <a 
          href="#dashboard" 
          onClick={(e) => { e.preventDefault(); onSelectTab('map'); }}
          className="text-xl font-bold tracking-tight text-white hover:text-cyan-400 transition-colors flex items-center gap-2"
        >
          <span className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.25)]">
            <Building2 className="w-4 h-4" />
          </span>
          <span className="bg-gradient-to-r from-white via-cyan-100 to-blue-300 bg-clip-text text-transparent">Notifyem</span>
        </a>
      </div>

      {/* Zone 2: 5-6 clean text navigation links with subtle hover underlines */}
      <nav className="hidden lg:flex items-center gap-7 text-sm font-medium text-neutral-400">
        <button
          onClick={() => onSelectTab('map')}
          className={`hover:text-white transition-colors relative py-1 cursor-pointer ${
            activeTab === 'map' ? 'text-white font-semibold after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-gradient-to-r after:from-cyan-400 after:to-blue-500' : ''
          }`}
        >
          Property Map
        </button>
        <button
          onClick={() => onSelectTab('daily')}
          className={`hover:text-white transition-colors relative py-1 cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'daily' ? 'text-white font-semibold after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-gradient-to-r after:from-cyan-400 after:to-blue-500' : ''
          }`}
        >
          <span>Listings</span>
        </button>
        <button
          onClick={() => onSelectTab('pipeline')}
          className={`hover:text-white transition-colors relative py-1 cursor-pointer ${
            activeTab === 'pipeline' ? 'text-white font-semibold after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-gradient-to-r after:from-cyan-400 after:to-blue-500' : ''
          }`}
        >
          Leads & Pipeline
        </button>
        <button
          onClick={() => onSelectTab('campaigns')}
          className={`hover:text-white transition-colors relative py-1 cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'campaigns' ? 'text-white font-semibold after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-gradient-to-r after:from-cyan-400 after:to-blue-500' : ''
          }`}
        >
          <span>AI Campaigns</span>
          {pendingReviewCount > 0 && (
            <span className="text-[11px] font-mono tabular-nums text-cyan-400">({pendingReviewCount} review)</span>
          )}
        </button>
        <button
          onClick={() => onSelectTab('salesforce')}
          className={`hover:text-white transition-colors relative py-1 cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'salesforce' ? 'text-white font-semibold after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-gradient-to-r after:from-cyan-400 after:to-blue-500' : ''
          }`}
        >
          <span>Salesforce</span>
          <span className={`text-[11px] font-mono tabular-nums ${salesforceConfig.isConnected ? 'text-emerald-400' : 'text-neutral-500'}`}>
            {salesforceConfig.isConnected ? 'Connected' : 'Not connected'}
          </span>
        </button>
        <button
          onClick={() => onSelectTab('collections')}
          className={`hover:text-white transition-colors relative py-1 cursor-pointer ${
            activeTab === 'collections' ? 'text-white font-semibold after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-gradient-to-r after:from-cyan-400 after:to-blue-500' : ''
          }`}
        >
          Collections
        </button>
      </nav>

      {/* Zone 3: 1-2 primary actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={onQuickSync}
          disabled={isSyncing || !salesforceConfig.isConnected}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-neutral-200 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-md transition-colors disabled:opacity-60 cursor-pointer whitespace-nowrap"
          title="Direct two-way sync with Salesforce"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isSyncing ? 'animate-spin' : ''}`} />
          <span>{isSyncing ? 'Syncing Salesforce...' : salesforceConfig.isConnected ? 'Sync Salesforce' : 'Salesforce unavailable'}</span>
        </button>

        <div className="hidden xl:flex items-center gap-2 pl-3 border-l border-neutral-800 text-xs text-neutral-400">
          <Database className="w-3.5 h-3.5 text-cyan-400" />
          <span>OSM lookup</span>
        </div>
      </div>
    </header>
  );
};
