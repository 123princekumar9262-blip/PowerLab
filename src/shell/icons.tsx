/**
 * The platform's navigation icons: one 20 × 20 line set (1.6 stroke, round caps), drawn here so every icon
 * has the same weight and size in every font. Decorative: the label beside an icon carries its meaning.
 */
export type IconName = 'home' | 'labs' | 'machines' | 'grid' | 'practice' | 'guide' | 'progress' | 'settings' | 'search' | 'expand' | 'collapse' | 'menu' | 'close' | 'arrow'

const PATHS: Record<IconName, string> = {
  home: 'M3.5 9.2 10 4l6.5 5.2V16a1 1 0 0 1-1 1h-3.3v-4.5H7.8V17H4.5a1 1 0 0 1-1-1z',
  // a flask
  labs: 'M8 3.5h4M8.6 3.5v4.4L4.4 15a1.3 1.3 0 0 0 1.1 2h9a1.3 1.3 0 0 0 1.1-2l-4.2-7.1V3.5M6.4 12.5h7.2',
  // a cube (the 3D lab)
  machines: 'M10 2.8 16.5 6.4v7.2L10 17.2 3.5 13.6V6.4zM3.5 6.4 10 10l6.5-3.6M10 10v7.2',
  // a transmission tower (Power Systems)
  grid: 'M10 2.5 5.8 17.5M10 2.5l4.2 15M3.5 6.5h13M5 10h10M7.4 14h5.2M3.5 6.5v1.8M16.5 6.5v1.8M5 10v1.8M15 10v1.8',
  // a target
  practice: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 13.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM10 10.6a.6.6 0 1 0 0-1.2.6.6 0 0 0 0 1.2z',
  // an open book
  guide: 'M10 5.5C8.6 4.4 6.6 4 3.5 4v11c3.1 0 5.1.4 6.5 1.5 1.4-1.1 3.4-1.5 6.5-1.5V4c-3.1 0-5.1.4-6.5 1.5zM10 5.5v11',
  // bars
  progress: 'M4 16.5h12M6 16.5V11M10 16.5V6.5M14 16.5V9',
  settings:
    'M10 12.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2zM16.2 11.6l1.3 1-1.6 2.8-1.6-.6a6 6 0 0 1-1.6.9l-.3 1.7H9.2l-.3-1.7a6 6 0 0 1-1.6-.9l-1.6.6-1.6-2.8 1.3-1a6 6 0 0 1 0-1.9l-1.3-1L5.7 6l1.6.6a6 6 0 0 1 1.6-.9l.3-1.7h3.2l.3 1.7a6 6 0 0 1 1.6.9l1.6-.6 1.6 2.8-1.3 1a6 6 0 0 1 0 1.9z',
  search: 'M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM13.4 13.4 17 17',
  expand: 'M3.5 4.5h13v11h-13zM8 4.5v11M11 8l2 2-2 2',
  collapse: 'M3.5 4.5h13v11h-13zM8 4.5v11M13 8l-2 2 2 2',
  menu: 'M3.5 6h13M3.5 10h13M3.5 14h13',
  close: 'M5 5l10 10M15 5 5 15',
  arrow: 'M4 10h11M11 6l4 4-4 4',
}

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={`icon ${className ?? ''}`} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  )
}
