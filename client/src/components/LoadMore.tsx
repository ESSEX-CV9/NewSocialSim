import { useI18n } from '../i18n/I18nContext';

export function LoadMore({
  hasNextPage,
  isFetching,
  onClick,
}: {
  hasNextPage: boolean;
  isFetching: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  if (!hasNextPage) return null;
  return (
    <button
      onClick={onClick}
      disabled={isFetching}
      className="block w-full p-4 text-center text-sky-500 hover:bg-gray-950 disabled:opacity-50"
    >
      {isFetching ? t('common.loading') : t('common.loadMore')}
    </button>
  );
}
