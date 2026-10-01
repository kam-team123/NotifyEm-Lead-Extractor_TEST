import React from 'react';
import { RefreshCw, Database } from 'lucide-react';
import logo from '../../assets/images/notifyem-logo.png';
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
      <div className="flex items-center gap-3">
        <a
          href="#dashboard"
          onClick={(e) => { e.preventDefault(); onSelectTab('map'); }}
          className="flex items-center transition-opacity hover:opacity-95"
          aria-label="Notifyem dashboard"
        >
          <img
            src={logo}
            alt="Notifyem logo"
            className="h-12 w-auto select-none object-contain md:h-14"
          />
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
