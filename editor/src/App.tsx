import { useState } from 'react';
import { ConsolePanel } from './panels/ConsolePanel.js';
import { LorePanel } from './panels/LorePanel.js';
import { NpcPanel } from './panels/NpcPanel.js';
import { TimelinePanel } from './panels/TimelinePanel.js';
import { TopicsPanel } from './panels/TopicsPanel.js';
import { PoolsPanel } from './panels/PoolsPanel.js';

const TABS = [
  { id: 'console', label: 'Console' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'topics', label: 'Topics' },
  { id: 'pools', label: 'Pools' },
  { id: 'lore', label: 'Lore' },
  { id: 'npc', label: 'NPC Designer' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function App() {
  const [tab, setTab] = useState<TabId>('console');

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="flex items-center gap-6 px-6 py-3 border-b border-gray-800">
        <h1 className="text-lg font-bold shrink-0">SocialSim Editor</h1>
        <nav className="flex gap-1">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition
                ${tab === t.id ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'}`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {/* Panel */}
      <main className="flex-1 p-6">
        {tab === 'console' && <ConsolePanel />}
        {tab === 'timeline' && <TimelinePanel />}
        {tab === 'topics' && <TopicsPanel />}
        {tab === 'pools' && <PoolsPanel />}
        {tab === 'lore' && <LorePanel />}
        {tab === 'npc' && <NpcPanel />}
      </main>
    </div>
  );
}
