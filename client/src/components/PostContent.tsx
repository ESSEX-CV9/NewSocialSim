import { Link } from 'react-router-dom';

/** 帖子正文/个人简介共用：URL 转外链，#话题 转搜索链接，@用户名 转主页链接 */
export function PostContent({ content }: { content: string }) {
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
              className="text-x-blue hover:underline"
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
              className="text-x-blue hover:underline"
            >
              {part}
            </Link>
          );
        }
        if (part.startsWith('@')) {
          return (
            <Link
              key={i}
              to={`/u/${part.slice(1)}`}
              onClick={(e) => e.stopPropagation()}
              className="text-x-blue hover:underline"
            >
              {part}
            </Link>
          );
        }
        return part;
      })}
    </p>
  );
}
