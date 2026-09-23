type IconName = 'menu' | 'city' | 'plan' | 'close' | 'arrow';
const paths: Record<IconName, string> = {
  menu: 'M4 5h16M4 12h16M4 19h16',
  city: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 12h8m-4-4v8',
  plan: 'M9 5H5v16h14V5h-4M9 3h6v4H9zM8 12h8M8 16h5',
  close: 'm6 6 12 12M6 18 18 6',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
};
export default function UiIcon({ name }: { name: IconName }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} /></svg>;
}
