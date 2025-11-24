interface ModeBannerProps {
  mode: 'job-executor' | 'cloud';
  vcenterHost: string | null;
  isLocal: boolean;
  isPrivate: boolean;
}

export function ModeBanner(_: ModeBannerProps) {
  return null;
}
