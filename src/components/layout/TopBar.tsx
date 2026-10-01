import React from 'react';
import logo from '../../assets/images/notifyem-logo.svg';
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
  onSelectTab
}) => {
  return (
    <header className="flex items-center justify-start px-4 py-3 bg-white border-b border-neutral-200 shrink-0">
      <a
        href="#dashboard"
        onClick={(e) => { e.preventDefault(); onSelectTab('map'); }}
        className="inline-flex items-center transition-opacity hover:opacity-95"
        aria-label="Notifyem dashboard"
      >
        <img
          src={logo}
          alt="Notifyem logo"
          className="h-16 w-auto object-contain select-none md:h-20"
        />
      </a>
    </header>
  );
};
