import { useState, useEffect, useCallback } from 'react';
import { loreApi } from '../api.js';

interface LoreFile {
  filename: string;
  summary: string;
  sizeBytes: number;
}

export function LorePanel() {
  const [files, setFiles] = useState<LoreFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [newFilename, setNewFilename] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const data = await loreApi.list();
      setFiles(data.files);
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const openFile = async (filename: string) => {
    if (dirty && !confirm('Unsaved changes will be lost. Continue?')) return;
    try {
      const data = await loreApi.read(filename);
      setSelected(filename);
      setContent(data.content);
      setDirty(false);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const save = async () => {
    if (!selected) return;
    try {
      await loreApi.write(selected, content);
      setDirty(false);
      refresh();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const createFile = async () => {
    let name = newFilename.trim();
    if (!name) return;
    if (!name.endsWith('.md')) name += '.md';
    try {
      await loreApi.write(name, `# ${name.replace('.md', '')}\n\n`);
      setNewFilename('');
      await refresh();
      openFile(name);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const deleteFile = async (filename: string) => {
    try {
      await loreApi.remove(filename);
      if (selected === filename) { setSelected(null); setContent(''); setDirty(false); }
      refresh();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="rounded-xl border border-gray-700 p-5 flex flex-col" style={{ minHeight: 400 }}>
      <h2 className="text-lg font-semibold mb-4">Lore Documents</h2>
      {error && <div className="text-red-400 text-sm mb-2">{error}</div>}

      <div className="flex gap-4 flex-1 min-h-0">
        {/* File list */}
        <div className="w-48 shrink-0 space-y-1 overflow-y-auto">
          {files.map(f => (
            <div
              key={f.filename}
              className={`flex items-center gap-1 text-sm py-1 px-2 rounded cursor-pointer group
                ${selected === f.filename ? 'bg-gray-700' : 'hover:bg-gray-800'}`}
              onClick={() => openFile(f.filename)}
            >
              <span className="flex-1 truncate">{f.filename}</span>
              <button
                className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 text-xs"
                onClick={e => { e.stopPropagation(); deleteFile(f.filename); }}
              >✕</button>
            </div>
          ))}
          <div className="flex gap-1 mt-2">
            <input
              className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs flex-1 min-w-0"
              placeholder="new-file.md"
              value={newFilename}
              onChange={e => setNewFilename(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createFile()}
            />
            <button onClick={createFile} className="bg-gray-700 hover:bg-gray-600 rounded px-2 py-1 text-xs">+</button>
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 flex flex-col min-w-0">
          {selected ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium">{selected}</span>
                {dirty && <span className="text-xs text-yellow-400">unsaved</span>}
                <button onClick={save} className="ml-auto bg-blue-600 hover:bg-blue-500 rounded px-3 py-1 text-xs font-medium">Save</button>
              </div>
              <textarea
                className="flex-1 bg-gray-900 border border-gray-700 rounded p-3 text-sm font-mono resize-none focus:outline-none focus:border-gray-500"
                value={content}
                onChange={e => { setContent(e.target.value); setDirty(true); }}
              />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
              Select a file or create a new one
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
