import type { VideoTaskView } from '../api/endpoints';
import { useI18n } from '../i18n/I18nContext';

/** 发帖框媒体托盘里的视频引入任务占位卡：进行中显示进度，失败可重试/移除 */
export function IngestTaskTile({
  task,
  onCancel,
  onRetry,
  onDismiss,
}: {
  task: VideoTaskView;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const failed = task.status === 'error';
  const stageText =
    task.status === 'pending'
      ? t('composer.videoTaskPending')
      : task.status === 'probing'
        ? t('composer.videoTaskProbing')
        : `${t('composer.videoTaskDownloading')} ${task.progress}%`;

  return (
    <div
      className={`relative flex min-h-24 w-44 shrink-0 flex-col justify-between gap-1 overflow-hidden rounded-xl border p-2 ${
        failed ? 'border-x-red/60' : 'border-x-border'
      } bg-x-input`}
    >
      <div className="flex items-start gap-1.5">
        {!failed && <i className="ri-loader-4-line mt-0.5 shrink-0 animate-spin text-[14px] text-x-blue" />}
        {failed && <i className="ri-error-warning-line mt-0.5 shrink-0 text-[14px] text-x-red" />}
        <span className="line-clamp-2 text-[12px] text-x-dim" title={task.title ?? task.url}>
          {task.title ?? task.url}
        </span>
      </div>
      {failed ? (
        <div className="flex flex-col gap-1">
          {/* 三行 + title 全文；完整 yt-dlp stderr 在服务端 console */}
          <span className="line-clamp-3 text-[11px] leading-tight text-x-red" title={task.errorMessage}>
            {task.errorMessage ?? t('composer.videoTaskFailed')}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onRetry}
              className="rounded-full border border-x-dim px-2 py-0.5 text-[11px] font-bold transition-colors duration-200 hover:bg-x-hover"
            >
              {t('composer.videoTaskRetry')}
            </button>
            <button
              onClick={onDismiss}
              className="rounded-full border border-x-dim px-2 py-0.5 text-[11px] font-bold transition-colors duration-200 hover:bg-x-hover"
            >
              {t('composer.videoTaskDismiss')}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-x-dim">{stageText}</span>
          <div className="h-1 w-full overflow-hidden rounded-full bg-x-bg">
            {task.status === 'downloading' ? (
              <div
                className="h-full bg-x-blue transition-all duration-300"
                style={{ width: `${task.progress}%` }}
              />
            ) : (
              <div className="h-full w-1/3 animate-pulse bg-x-blue" />
            )}
          </div>
        </div>
      )}
      {!failed && (
        <button
          aria-label={t('common.cancel')}
          onClick={onCancel}
          className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white transition-colors duration-200 hover:bg-black/80"
        >
          <i className="ri-close-line text-[12px]" />
        </button>
      )}
    </div>
  );
}
