import { useI18n } from '../i18n/I18nContext';

export function Spinner() {
  return (
    <div className="flex justify-center p-8">
      <div className="spinner" />
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const { t } = useI18n();
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="m-4 rounded-xl border border-x-red/40 bg-x-red/10 p-4 text-[15px] text-x-red">
      {t('common.error', { message })}
    </div>
  );
}

export function EmptyBox({
  text,
  icon,
  title,
}: {
  text: string;
  icon?: string | undefined;
  title?: string | undefined;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-8 py-12 text-center">
      {icon && <i className={`${icon} text-[48px] text-x-dim opacity-50`} />}
      {title && <div className="mt-2 text-xl font-bold text-x-text">{title}</div>}
      <p className="max-w-90 text-[15px] text-x-dim">{text}</p>
    </div>
  );
}
