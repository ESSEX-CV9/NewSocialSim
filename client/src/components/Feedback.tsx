import { useI18n } from '../i18n/I18nContext';

export function Spinner() {
  const { t } = useI18n();
  return <div className="p-8 text-center text-gray-500">{t('common.loading')}</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  const { t } = useI18n();
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="m-4 rounded-lg border border-red-900 bg-red-950/40 p-4 text-red-400">
      {t('common.error', { message })}
    </div>
  );
}

export function EmptyBox({ text }: { text: string }) {
  return <div className="p-8 text-center text-gray-500">{text}</div>;
}
