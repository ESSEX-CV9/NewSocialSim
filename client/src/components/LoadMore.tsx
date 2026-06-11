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
      className="block w-full p-4 text-center text-[15px] text-x-blue transition-colors duration-200 hover:bg-x-hover disabled:opacity-50"
    >
      {isFetching ? t('common.loading') : t('common.loadMore')}
    </button>
  );
}
