// Small inline icons: no extra asset files, no icon dependency, all 18px.
type IconProps = { size?: number };

export function HeartIcon({ size = 17 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 20.5s-7.5-4.6-7.5-9.4A4.1 4.1 0 0 1 12 8.4a4.1 4.1 0 0 1 7.5 2.7c0 4.8-7.5 9.4-7.5 9.4Z" strokeLinejoin="round" />
    </svg>
  );
}

export function ThumbDownIcon({ size = 17 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M7 4v10l4 6a2 2 0 0 0 3.6-1.3L14 14h4.6a2 2 0 0 0 2-2.4l-1.2-6A2 2 0 0 0 17.4 4H7Z" strokeLinejoin="round" />
    </svg>
  );
}

export function CommentIcon({ size = 17 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M20 12a7.5 7.5 0 0 1-7.5 7.5H8L4 22v-4.3A7.5 7.5 0 0 1 12.5 4.5 7.5 7.5 0 0 1 20 12Z" strokeLinejoin="round" />
    </svg>
  );
}

export function ShareIcon({ size = 17 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function FlagIcon({ size = 17 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M6 21V4m0 0 12 3.5L6 11" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TrashIcon({ size = 17 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MegaphoneIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M12.6 1.5a.9.9 0 0 1 1.4.8v11.4a.9.9 0 0 1-1.4.8L8 11.3H5.2A2.2 2.2 0 0 1 3 9.1V7a2.2 2.2 0 0 1 2.2-2.2H8l4.6-3.3ZM4.6 12.2h2.6l1.3 2.4a.9.9 0 0 1-.8 1.3H5.6a.9.9 0 0 1-.8-.5l-.2-.4v-2.8Z" />
    </svg>
  );
}
