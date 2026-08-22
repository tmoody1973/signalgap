export const routes = {
  home: () => "/",
  signIn: () => "/sign-in",
  workspace: () => "/workspace",
  scan: (scanId: string) => `/scans/${scanId}`,
  lead: (candidateId: string) => `/leads/${candidateId}`,
  compare: () => "/compare",
} as const;
