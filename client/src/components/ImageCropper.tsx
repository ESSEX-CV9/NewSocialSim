import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useI18n } from '../i18n/I18nContext';

interface ImageCropperProps {
  file: File;
  /** 裁剪框宽高比（宽/高），头像 1、横幅 3 */
  aspect: number;
  /** 圆形遮罩预览（头像）；输出仍为方形位图 */
  round?: boolean;
  outWidth: number;
  outHeight: number;
  onCancel: () => void;
  onCropped: (file: File) => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

/**
 * 缩放 + 拖动定位的图片裁剪器（原生 Canvas，无第三方依赖）。
 * 预览用 CSS 定位实时渲染，确认时按同一几何参数 drawImage 出成品。
 * GIF 经 canvas 裁剪后输出静帧（已知取舍）。
 */
export function ImageCropper({
  file,
  aspect,
  round,
  outWidth,
  outHeight,
  onCancel,
  onCropped,
}: ImageCropperProps) {
  const { t } = useI18n();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [boxW, setBoxW] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  // objectURL 必须在 effect 内创建并配对 revoke：StrictMode 的"挂载→清理→再挂载"
  // 会执行一次清理，若 URL 建在渲染期（useState 初始化器）会被提前撤销导致图片永远加载不出
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    const probe = new Image();
    probe.onload = () => {
      setNatural({ w: probe.naturalWidth, h: probe.naturalHeight });
      setUrl(objectUrl);
    };
    probe.src = objectUrl;
    return () => {
      setUrl(null);
      setNatural(null);
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  // 裁剪框宽度跟随容器实际宽度（弹窗内自适应）
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setBoxW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const boxH = boxW / aspect;
  // cover 基准：zoom=1 时图片恰好铺满裁剪框
  const baseScale = natural ? Math.max(boxW / natural.w, boxH / natural.h) : 0;
  const displayW = natural ? natural.w * baseScale * zoom : 0;
  const displayH = natural ? natural.h * baseScale * zoom : 0;

  const clampOffset = (x: number, y: number, dw: number, dh: number) => ({
    x: Math.max(-(dw - boxW) / 2, Math.min((dw - boxW) / 2, x)),
    y: Math.max(-(dh - boxH) / 2, Math.min((dh - boxH) / 2, y)),
  });

  const setZoomClamped = (next: number) => {
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    setZoom(z);
    if (natural) {
      const dw = natural.w * baseScale * z;
      const dh = natural.h * baseScale * z;
      setOffset((o) => clampOffset(o.x, o.y, dw, dh));
    }
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    setOffset(clampOffset(d.baseX + e.clientX - d.startX, d.baseY + e.clientY - d.startY, displayW, displayH));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const apply = async () => {
    const img = imgRef.current;
    if (!img || !natural || busy) return;
    setBusy(true);
    try {
      const scale = baseScale * zoom;
      // 裁剪框左上角在原图坐标系中的位置
      const imgLeft = boxW / 2 - displayW / 2 + offset.x;
      const imgTop = boxH / 2 - displayH / 2 + offset.y;
      const srcX = -imgLeft / scale;
      const srcY = -imgTop / scale;
      const srcW = boxW / scale;
      const srcH = boxH / scale;
      const canvas = document.createElement('canvas');
      canvas.width = outWidth;
      canvas.height = outHeight;
      canvas.getContext('2d')!.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outWidth, outHeight);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (blob) onCropped(new File([blob], 'crop.png', { type: 'image/png' }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-4 p-2 pr-4">
        <button
          onClick={onCancel}
          className="flex size-9 items-center justify-center rounded-full transition-colors duration-200 hover:bg-x-input"
        >
          <i className="ri-arrow-left-line text-[18px]" />
        </button>
        <span className="flex-1 text-[17px] font-bold">{t('crop.title')}</span>
        <button
          onClick={() => void apply()}
          disabled={busy || !natural}
          className="rounded-full bg-x-text px-4 py-1 text-[14px] font-bold text-x-bg transition-opacity duration-200 hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <i className="ri-loader-4-line animate-spin" /> : t('crop.apply')}
        </button>
      </div>

      {/* 裁剪视口：拖动平移、滚轮缩放；圆形遮罩仅作预览 */}
      <div
        ref={boxRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={(e) => setZoomClamped(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}
        className="relative w-full cursor-grab touch-none overflow-hidden bg-black select-none active:cursor-grabbing"
        style={{ height: boxH || undefined }}
      >
        {url && natural && (
          <img
            ref={imgRef}
            src={url}
            alt=""
            draggable={false}
            className="absolute max-w-none"
            style={{
              width: displayW,
              height: displayH,
              left: boxW / 2 - displayW / 2 + offset.x,
              top: boxH / 2 - displayH / 2 + offset.y,
            }}
          />
        )}
        {round && boxW > 0 && (
          <div
            className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ width: boxH, height: boxH, boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }}
          />
        )}
      </div>

      {/* 缩放滑杆 */}
      <div className="flex items-center gap-3 px-6 py-4">
        <i className="ri-zoom-out-line text-[18px] text-x-dim" />
        <input
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoomClamped(Number(e.target.value))}
          className="flex-1 accent-x-blue"
        />
        <i className="ri-zoom-in-line text-[18px] text-x-dim" />
      </div>
    </div>
  );
}
