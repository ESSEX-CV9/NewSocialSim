import type { VerifiedType } from '@socialsim/shared';

/** 认证徽标：个人=蓝标、组织=金标；徽标色不随主题变（与 X 一致），无认证不渲染 */
export function VerifiedBadge({
  verified,
  size = 16,
}: {
  verified: VerifiedType | undefined;
  size?: number;
}) {
  if (verified !== 'personal' && verified !== 'org') return null;
  return (
    <i
      className={`ri-verified-badge-fill shrink-0 ${verified === 'org' ? 'text-x-gold' : 'text-x-blue'}`}
      style={{ fontSize: size }}
    />
  );
}
