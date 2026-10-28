export const DEMO_USER_MENU_PATHS = new Set(['creatChat', 'knowledge-bases', 'artifacts', 'toolbox', 'organizations'])

export const isDemoAdministrator = (
  isSystemAdmin: boolean,
  canAccessAllTenants: boolean,
) => isSystemAdmin || canAccessAllTenants

export const canShowDemoMenuPath = (
  path: string,
  isSystemAdmin: boolean,
  canAccessAllTenants: boolean,
) => isDemoAdministrator(isSystemAdmin, canAccessAllTenants) || DEMO_USER_MENU_PATHS.has(path)


// The routed internal agent must remain visible to ordinary cloud customers.
export const canShowDemoAgent = (
  agentId: string,
  isSystemAdmin: boolean,
  canAccessAllTenants: boolean,
) => isDemoAdministrator(isSystemAdmin, canAccessAllTenants)
  || agentId === 'builtin-smart-reasoning'
  || agentId === 'yunzhuang-internal-qa'
