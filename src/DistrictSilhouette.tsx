import { zones, type DistrictId } from './data';

type DistrictSilhouetteProps = {
  districtId: DistrictId;
  className?: string;
};

const longitudeScale = Math.cos(51.15 * Math.PI / 180);
const silhouettePaths = new Map(zones.features.map((feature) => {
  const points = feature.geometry.coordinates[0];
  const xs = points.map(([longitude]) => longitude * longitudeScale);
  const ys = points.map(([, latitude]) => -latitude);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(...xs) - minX;
  const height = Math.max(...ys) - minY;
  const scale = 50.4 / Math.max(width, height);
  const path = points.map((_, index) => {
    const x = (xs[index] - minX) * scale + (60 - width * scale) / 2;
    const y = (ys[index] - minY) * scale + (60 - height * scale) / 2;
    return `${index ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ') + 'Z';

  return [feature.properties.districtId, path];
}));

export function DistrictSilhouette({ districtId, className }: DistrictSilhouetteProps) {
  return (
    <svg viewBox="0 0 60 60" className={className} aria-hidden="true" focusable="false">
      <path d={silhouettePaths.get(districtId)} />
    </svg>
  );
}
