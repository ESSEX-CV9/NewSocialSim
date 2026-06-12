import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type MouseEvent } from 'react';
import { api } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthContext';
import { Avatar } from '../../components/Avatar';
import { ImageCropper } from '../../components/ImageCropper';
import { useI18n } from '../../i18n/I18nContext';
import { inputClass } from '../auth/LoginPage';

/** 头像/横幅编辑项：undefined=未改动；{id:null}=恢复默认 */
type MediaPatch = { id: number | null; url: string | null } | undefined;

interface CropTask {
  file: File;
  kind: 'avatar' | 'banner';
}

/** X 式编辑个人资料弹窗：横幅/头像选图后进入缩放拖动裁剪，昵称/简介沿用原校验 */
export function EditProfileModal({ onClose }: { onClose: () => void }) {
  const { user, setUser } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [website, setWebsite] = useState(user?.website ?? '');
  const [avatar, setAvatar] = useState<MediaPatch>(undefined);
  const [banner, setBanner] = useState<MediaPatch>(undefined);
  const [cropping, setCropping] = useState<CropTask | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const bannerInputRef = useRef<HTMLInputElement | null>(null);

  if (!user) return null;
  const stop = (e: MouseEvent) => e.stopPropagation();
  const avatarPreview = avatar !== undefined ? avatar.url : user.avatarUrl;
  const bannerPreview = banner !== undefined ? banner.url : user.bannerUrl;

  const uploadAndSet = async (kind: CropTask['kind'], file: File) => {
    setError(null);
    try {
      const res = await api.uploadMedia(file);
      const patch = { id: res.media.id, url: res.media.url };
      if (kind === 'avatar') setAvatar(patch);
      else setBanner(patch);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const pickFile = (kind: CropTask['kind']) => (files: FileList | null) => {
    const file = files?.[0];
    if (file) {
      // GIF 选作头像直传原图保留动画（canvas 裁剪会变静帧）；其余格式进裁剪
      if (kind === 'avatar' && file.type === 'image/gif') void uploadAndSet('avatar', file);
      else setCropping({ file, kind });
    }
    if (avatarInputRef.current) avatarInputRef.current.value = '';
    if (bannerInputRef.current) bannerInputRef.current.value = '';
  };

  const onCropped = async (file: File) => {
    if (!cropping) return;
    const kind = cropping.kind;
    setCropping(null);
    await uploadAndSet(kind, file);
  };

  const save = async () => {
    if (busy || displayName.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.updateMe({
        displayName,
        bio,
        website: website.trim().length > 0 ? website.trim() : null,
        ...(avatar !== undefined ? { avatarMediaId: avatar.id } : {}),
        ...(banner !== undefined ? { bannerMediaId: banner.id } : {}),
      });
      setUser(res.user);
      void queryClient.invalidateQueries({ queryKey: ['user', user.handle] });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** 横幅/头像上的圆形相机按钮 */
  const cameraButton = (label: string, onClick: () => void) => (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-10 items-center justify-center rounded-full bg-black/50 text-white transition-colors duration-200 hover:bg-black/40"
    >
      <i className="ri-camera-line text-[18px]" />
    </button>
  );

  return (
    // 不做"点遮罩关闭"：编辑内容易因误触丢失，关闭只走左上 ✕
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-20">
      <div
        onClick={stop}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-x-border bg-x-bg"
      >
        {cropping ? (
          <ImageCropper
            file={cropping.file}
            aspect={cropping.kind === 'avatar' ? 1 : 3}
            round={cropping.kind === 'avatar'}
            outWidth={cropping.kind === 'avatar' ? 400 : 1500}
            outHeight={cropping.kind === 'avatar' ? 400 : 500}
            onCancel={() => setCropping(null)}
            onCropped={(f) => void onCropped(f)}
          />
        ) : (
          <>
            <div className="flex items-center gap-4 p-2 pr-4">
              <button
                onClick={onClose}
                className="flex size-9 items-center justify-center rounded-full transition-colors duration-200 hover:bg-x-input"
              >
                <i className="ri-close-line text-[18px]" />
              </button>
              <span className="flex-1 text-[17px] font-bold">{t('profile.editProfile')}</span>
              <button
                onClick={() => void save()}
                disabled={busy || displayName.trim().length === 0}
                className="rounded-full bg-x-text px-4 py-1 text-[14px] font-bold text-x-bg transition-opacity duration-200 hover:opacity-90 disabled:opacity-50"
              >
                {busy ? <i className="ri-loader-4-line animate-spin" /> : t('common.save')}
              </button>
            </div>

            <input
              ref={avatarInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => pickFile('avatar')(e.target.files)}
            />
            <input
              ref={bannerInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => pickFile('banner')(e.target.files)}
            />

            {/* 横幅：当前图 + 居中相机/恢复默认 */}
            <div className="relative h-44 bg-x-input">
              {bannerPreview && (
                <img src={bannerPreview} alt="" className="h-full w-full object-cover" draggable={false} />
              )}
              <div className="absolute inset-0 flex items-center justify-center gap-3">
                {cameraButton(t('profile.changeBanner'), () => bannerInputRef.current?.click())}
                {bannerPreview && (
                  <button
                    aria-label={t('profile.resetBanner')}
                    title={t('profile.resetBanner')}
                    onClick={() => setBanner({ id: null, url: null })}
                    className="flex size-10 items-center justify-center rounded-full bg-black/50 text-white transition-colors duration-200 hover:bg-black/40"
                  >
                    <i className="ri-close-line text-[18px]" />
                  </button>
                )}
              </div>
            </div>

            {/* 头像骑在横幅下缘，相机按钮叠在头像上 */}
            <div className="px-4">
              <div className="relative -mt-12 w-fit rounded-full border-4 border-x-bg">
                <Avatar handle={user.handle} avatarUrl={avatarPreview} size={96} />
                <div className="absolute inset-0 flex items-center justify-center">
                  {cameraButton(t('profile.changeAvatar'), () => avatarInputRef.current?.click())}
                </div>
              </div>
              {avatarPreview && (
                <button
                  onClick={() => setAvatar({ id: null, url: null })}
                  className="mt-1 rounded-full px-3 py-1 text-[13px] text-x-dim transition-colors duration-200 hover:bg-x-input"
                >
                  {t('profile.resetAvatar')}
                </button>
              )}
            </div>

            <div className="flex flex-col gap-3 p-4">
              {error && <div className="text-sm text-x-red">{t('common.error', { message: error })}</div>}
              <label className="flex flex-col gap-1 text-[13px] text-x-dim">
                {t('profile.displayName')}
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-[13px] text-x-dim">
                {t('profile.bio')}
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  rows={3}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-[13px] text-x-dim">
                {t('profile.website')}
                <input
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://example.com"
                  className={inputClass}
                />
              </label>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
