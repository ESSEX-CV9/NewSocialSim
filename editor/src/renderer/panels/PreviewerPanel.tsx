import type { IDockviewPanelProps } from 'dockview';
import { usePreview, reroll } from '../state/preview-bus.js';

/**
 * 预览器面板（独立 dockview 面板）：订阅预览总线，随机模拟一条并**按槽位拆解**可视化——
 * 每个出现的槽贡献一段，用彩色虚线框 + 浅背景标出，下方连线标注它来自哪个组件；没出现的槽不显示。
 * 顶部提示本次用的语法（池子预览时即可看出随机选了哪套语法）。
 */

const COLORS = ['#e0a458', '#6cb6ff', '#7ee787', '#ff7b72', '#d2a8ff', '#79c0ff', '#f0883e', '#56d4bb'];
function colorOf(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length]!;
}

export function PreviewerPanel(_props: IDockviewPanelProps) {
  const st = usePreview();
  return (
    <div className="p-3 h-full text-(--text) overflow-y-auto">
      <div className="flex items-center gap-2 mb-2">
        <h4 className="text-xs font-semibold flex items-center gap-1.5 text-(--dim)"><i className="ri-eye-line" /> 预览器</h4>
        {st.sample && (
          <button className="px-2 py-0.5 text-xs rounded-lg bg-(--chip) border border-(--border) text-(--text) hover:bg-[#2a2e33] cursor-pointer" onClick={reroll}>
            <i className="ri-refresh-line" /> 再来一个
          </button>
        )}
      </div>

      {st.loading && <p className="text-(--dim) text-sm">组装中…</p>}
      {!st.loading && st.msg && <p className="text-(--dim) text-sm">{st.msg}</p>}
      {!st.loading && !st.msg && !st.sample && <p className="text-(--dim) text-sm">在内容池面板点某个池或语法的「预览」，结果显示在这里。</p>}

      {st.sample && (
        <div>
          <div className="text-[11px] text-(--dim) mb-2">本次语法：<span className="text-(--text)">{st.sample.grammar}</span></div>
          <div className="flex flex-wrap gap-2 items-start">
            {st.sample.segments.map((seg, i) => {
              if (seg.status === 'shown') {
                const c = colorOf(seg.component ?? '');
                return (
                  <div key={i} className="flex flex-col items-center">
                    <div className="border border-dashed rounded px-2 py-1 text-sm" style={{ borderColor: c, background: `${c}22` }}>{seg.text}</div>
                    <div className="w-px h-3" style={{ background: c }} />
                    <div className="text-[10px] whitespace-nowrap" style={{ color: c }}>{seg.component}</div>
                  </div>
                );
              }
              // 未出现的槽：红色虚线框 + 候选组件（划掉）+ 原因
              const reason = seg.status === 'excluded' ? '被互斥' : '概率落选';
              return (
                <div key={i} className="flex flex-col items-center opacity-80">
                  <div className="border border-dashed rounded px-2 py-1 text-sm line-through" style={{ borderColor: 'var(--pink)', background: 'rgba(255,123,114,0.12)', color: 'var(--dim)' }}>
                    {seg.components.join('/') || '—'}
                  </div>
                  <div className="w-px h-3" style={{ background: 'var(--pink)' }} />
                  <div className="text-[10px] whitespace-nowrap" style={{ color: 'var(--pink)' }}>{reason}</div>
                </div>
              );
            })}
          </div>
          <div className="text-sm mt-3 text-(--dim)">成文：<span className="text-(--text)">{st.sample.text}</span></div>
        </div>
      )}
    </div>
  );
}
