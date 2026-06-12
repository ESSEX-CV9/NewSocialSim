import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog } from './ConfirmDialog';

/** confirm() 的入参（文案由调用方传，已 i18n） */
export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;
/** 单按钮告知弹窗（替代 window.alert） */
type AlertFn = (opts: { title: string; description?: string }) => Promise<void>;

const ConfirmContext = createContext<{ confirm: ConfirmFn; alert: AlertFn } | null>(null);

/**
 * 全局确认弹窗：在任意组件 `const confirm = useConfirm()` 后 `await confirm({...})`
 * 取代 window.confirm，统一页面内样式。一次只显示一个（新调用覆盖未决的）。
 */
interface DialogState extends ConfirmOptions {
  /** 告知弹窗：隐藏取消钮 */
  alertOnly?: boolean;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<DialogState | null>(null);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setOpts(options);
    });
  }, []);

  const alert = useCallback<AlertFn>((options) => {
    return new Promise<void>((resolve) => {
      resolverRef.current = () => resolve();
      setOpts({ ...options, alertOnly: true });
    });
  }, []);

  const settle = (ok: boolean) => {
    resolverRef.current?.(ok);
    resolverRef.current = null;
    setOpts(null);
  };

  return (
    <ConfirmContext.Provider value={{ confirm, alert }}>
      {children}
      {opts && (
        <ConfirmDialog
          title={opts.title}
          {...(opts.description !== undefined ? { description: opts.description } : {})}
          {...(opts.confirmLabel !== undefined ? { confirmLabel: opts.confirmLabel } : {})}
          {...(opts.cancelLabel !== undefined ? { cancelLabel: opts.cancelLabel } : {})}
          {...(opts.danger !== undefined ? { danger: opts.danger } : {})}
          {...(opts.alertOnly ? { hideCancel: true } : {})}
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
        />
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm 必须在 ConfirmProvider 内使用');
  return ctx.confirm;
}

export function useAlert(): AlertFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useAlert 必须在 ConfirmProvider 内使用');
  return ctx.alert;
}
