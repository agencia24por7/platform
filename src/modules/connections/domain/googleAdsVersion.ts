export const GOOGLE_ADS_VERSION = 'v26';

export const GOOGLE_ADS_SUPPORTED = ['v23', 'v24', 'v25', 'v26'] as const;

export function isSupportedVersion(version: string): boolean {
  return (GOOGLE_ADS_SUPPORTED as readonly string[]).includes(version);
}
