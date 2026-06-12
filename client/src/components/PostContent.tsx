import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * 帖子正文/个人简介/私信共用：URL 转外链，#话题 转搜索链接，@用户名 转主页链接。
 * linkClass 可覆盖链接配色（如私信本人气泡的蓝底需要白色链接）。
 * renderMention 可包装 @用户名 链接（如私信里挂用户悬浮卡）；
 * 由调用方注入而非直接引 UserHoverCard，避免组件循环依赖。
 */
export function PostContent({
  content,
  linkClass,
  renderMention,
}: {
  content: string;
  linkClass?: string | undefined;
  renderMention?: ((handle: string, link: ReactNode) => ReactNode) | undefined;
}) {
  const cls = linkClass ?? 'text-x-blue hover:underline';
  const parts = content.split(/(https?:\/\/[^\s]+|#[^\s#@]+|@[a-zA-Z0-9_]{2,20})/g);
  return (
    <p className="text-[15px] leading-normal wrap-break-word whitespace-pre-wrap">
      {parts.map((part, i) => {
        if (part.startsWith('http://') || part.startsWith('https://')) {
          const display = part.replace(/^https?:\/\/(www\.)?/, '');
          return (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={cls}
            >
              {display.length > 36 ? `${display.slice(0, 36)}…` : display}
            </a>
          );
        }
        if (part.startsWith('#')) {
          return (
            <Link
              key={i}
              to={`/search?q=${encodeURIComponent(part)}&type=posts`}
              onClick={(e) => e.stopPropagation()}
              className={cls}
            >
              {part}
            </Link>
          );
        }
        if (part.startsWith('@')) {
          const link = (
            <Link
              to={`/u/${part.slice(1)}`}
              onClick={(e) => e.stopPropagation()}
              className={cls}
            >
              {part}
            </Link>
          );
          return (
            <Fragment key={i}>
              {renderMention ? renderMention(part.slice(1), link) : link}
            </Fragment>
          );
        }
        return part;
      })}
    </p>
  );
}
