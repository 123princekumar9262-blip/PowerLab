import { AppShell } from './shell/AppShell.tsx'

/**
 * Power Electronics Lab: the platform shell (Home · Labs · Engineering · Progress) around the lab
 * workspaces. Navigation and information architecture only — the workspaces own their simulations.
 */
export function Platform() {
  return <AppShell />
}
