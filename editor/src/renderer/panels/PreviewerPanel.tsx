import type { IDockviewPanelProps } from 'dockview';
import { usePreview } from '../state/preview-bus.js';

/**
 * 预览器面板（独立 dockview 面板）：订阅预览总线，展示内容池/语法的组装结果。
 * 内容池面板点「预览」即把结果推到这里——点了才有内容，平时给提示。
 */
export function PreviewerPanel(_props: IDockviewPanelProps) {
  const s = usePreview();
  return (
    <div className="p-3 h-full text-(--text) overflow-y-auto">
      <h4 className="text-xs font-semibold mb-2 flex items-center gap-1.5 text-(--dim)"><i className="ri-eye-line" /> 预览器</h4>
      {s.loading && <p className="text-(--dim) text-sm">组装中…</p>}
      {!s.loading && s.msg && <p className="text-(--dim) text-sm">{s.msg}</p>}
      {!s.loading && !s.msg && !s.samples.length && <p className="text-(--dim) text-sm">在内容池面板点某个池或语法的「预览」，结果显示在这里。</p>}
      <ul className="space-y-1.5">{s.samples.map((t, i) => <li key={i} className="text-sm border-b border-[#15171b] pb-1.5">{t}</li>)}</ul>
    </div>
  );
}
