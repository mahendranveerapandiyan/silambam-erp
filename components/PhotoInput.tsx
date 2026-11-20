'use client';
import { useRef, useState } from 'react';

/**
 * File input that shrinks photos in the browser before upload
 * (longest side 480 px, JPEG ~40 KB) so pages stay fast on mobile data
 * and the database / backups stay small.
 */
export function PhotoInput({ name = 'photo', required, maxSide = 480, quality = 0.82 }: { name?: string; required?: boolean; maxSide?: number; quality?: number }) {
  const ref = useRef<HTMLInputElement>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
      if (!blob) return;
      const small = new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
      const dt = new DataTransfer();
      dt.items.add(small);
      e.target.files = dt.files;
      setInfo(`${Math.round(file.size / 1024)} KB → ${Math.round(small.size / 1024)} KB`);
      setPreview(URL.createObjectURL(small));
    } catch {
      setInfo(null); // browser could not resize: original is uploaded (server limit 2 MB)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {preview && <img src={preview} alt="" className="h-10 w-10 rounded object-cover" />}
      <div className="flex-1">
        <input ref={ref} type="file" name={name} accept="image/*" capture="user" required={required} onChange={onChange} className="input" />
        {info && <div className="mt-0.5 text-xs text-gray-500">Resized for upload: {info}</div>}
      </div>
    </div>
  );
}
