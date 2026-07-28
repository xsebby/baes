interface PlayerIconProps {
  size?: number;
}

function IconFrame({
  size = 20,
  children,
}: PlayerIconProps & { children: React.ReactNode }) {
  return (
    <svg
      className="transport-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function ShuffleIcon(props: PlayerIconProps) {
  return (
    <IconFrame {...props}>
      <path
        d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconFrame>
  );
}

export function PreviousIcon(props: PlayerIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M6 5h2v14H6V5Zm12 1.25v11.5L9 12l9-5.75Z" fill="currentColor" />
    </IconFrame>
  );
}

export function PlayIcon(props: PlayerIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M8.5 5.75v12.5L18 12 8.5 5.75Z" fill="currentColor" />
    </IconFrame>
  );
}

export function PauseIcon(props: PlayerIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M7.5 6h3v12h-3V6Zm6 0h3v12h-3V6Z" fill="currentColor" />
    </IconFrame>
  );
}

export function NextIcon(props: PlayerIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M16 5h2v14h-2V5ZM6 6.25v11.5L15 12 6 6.25Z" fill="currentColor" />
    </IconFrame>
  );
}
