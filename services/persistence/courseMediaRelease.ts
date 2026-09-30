import uatMedia from '@/deploy/uat-course-media.json';

export function courseMediaVersion(bucket: string, key: string, environment = process.env.APP_ENV) {
  if (environment !== 'UAT') return undefined;
  const asset = uatMedia.objects.find(item => item.bucket === bucket && item.key === key);
  if (!asset?.version || asset.version === 'null') throw new Error('Course media has not been included in the UAT release manifest.');
  return asset.version;
}
