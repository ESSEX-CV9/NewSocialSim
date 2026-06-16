import type { IDockviewPanelProps } from 'dockview';

/** 空面板占位：验证注册表 + 窗格挂载用；后续被具体功能面板替换。 */
export function PlaceholderPanel(props: IDockviewPanelProps) {
  return (
    <div className="p-4 text-sm text-gray-500 space-y-2">
      <p className="text-gray-300">{props.api.title ?? props.api.id}</p>
      <p>空面板占位。后续里程碑的功能面板将注册进面板注册表，挂到此处的窗格里。</p>
    </div>
  );
}
