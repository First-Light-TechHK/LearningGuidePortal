export function avatarCrop(width: number, height: number, zoom: number, x: number, y: number) {
  const size = Math.min(width, height) / Math.max(1, zoom);
  return { size, x: (width - size) * Math.min(100, Math.max(0, x)) / 100, y: (height - size) * Math.min(100, Math.max(0, y)) / 100 };
}

export async function croppedAvatar(image: HTMLImageElement, zoom: number, x: number, y: number) {
  const crop = avatarCrop(image.naturalWidth, image.naturalHeight, zoom, x, y);
  const canvas = document.createElement('canvas');
  canvas.width = 600; canvas.height = 600;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, 600, 600);
  context.drawImage(image, crop.x, crop.y, crop.size, crop.size, 0, 0, 600, 600);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .9));
  if (!blob) throw new Error('Image encoding failed');
  return new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
}
