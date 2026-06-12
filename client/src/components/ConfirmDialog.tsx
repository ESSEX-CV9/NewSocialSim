import { useI18n } from '../i18n/I18nContext';

/**
 * 页面内确认弹窗（替代 window.confirm，对齐 X 风格）。
 * 遮罩点击与取消都触发 onCancel；确认钮 danger 时为红色（删除类操作）。
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onCancel();
      }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xs rounded-2xl bg-x-bg p-6 text-center"
      >
        <h2 className="text-xl font-extrabold text-x-text">{title}</h2>
        {description && <p className="mt-2 text-[15px] text-x-dim">{description}</p>}
        <div className="mt-6 flex flex-col gap-3">
          <button
            onClick={onConfirm}
            className={`rounded-full py-2.5 text-[15px] font-bold text-white transition-colors duration-200 ${
              danger ? 'bg-x-red hover:bg-x-red/90' : 'bg-x-blue hover:bg-x-blue-dark'
            }`}
          >
            {confirmLabel ?? t('common.confirm')}
          </button>
          <button
            onClick={onCancel}
            className="rounded-full border border-x-border py-2.5 text-[15px] font-bold text-x-text transition-colors duration-200 hover:bg-x-hover"
          >
            {cancelLabel ?? t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
