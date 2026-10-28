export const PRIVATE_AGENT_ID = 'yunzhuang-internal-qa'
export interface PrivateRouteState {
  switched?: boolean
  session_id?: string
  privacy_locked?: boolean
  effective_agent_id?: string
  model_id?: string
  effective_model_id?: string
  agent_id?: string
}
export function effectivePrivateAgent(state: PrivateRouteState): string {
  return state.privacy_locked ? PRIVATE_AGENT_ID : 'builtin-smart-reasoning'
}
export function canSelectPrivateAgent(locked: boolean, agentId: string): boolean {
  return !locked || agentId === PRIVATE_AGENT_ID
}

export function shouldNotifyPrivateRoute(previous: PrivateRouteState | null | undefined, next: PrivateRouteState, replaying = false): boolean {
  return !replaying && next.switched === true && next.privacy_locked === true && !previous?.privacy_locked
}
