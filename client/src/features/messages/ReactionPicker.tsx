import { MESSAGE_REACTION_EMOJIS } from '@socialsim/shared';

/** 表情回应选择器：白名单 emoji 横排小弹层（悬浮在触发按钮上方） */
export function ReactionPicker({
  current,
  align,
  onPick,
}: {
  /** 我当前的回应 emoji（高亮显示；再点 = 撤销，由调用方处理） */
  current: string | undefined;
  /** 弹层贴左还是贴右（自己的消息在右侧，向左展开避免溢出） */
  align: 'left' | 'right';
  onPick: (emoji: string) => void;
}) {
  return (
    <div
      className={`absolute bottom-full z-30 mb-1 flex gap-0.5 rounded-full border border-x-border bg-x-card px-1.5 py-1 shadow-lg ${
        align === 'right' ? 'right-0' : 'left-0'
      }`}
    >
      {MESSAGE_REACTION_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          onClick={(e) => {
            e.stopPropagation();
            onPick(emoji);
          }}
          className={`rounded-full px-1 py-0.5 text-[17px] transition-colors duration-200 hover:bg-x-input ${
            current === emoji ? 'bg-x-blue/15' : ''
          }`}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
