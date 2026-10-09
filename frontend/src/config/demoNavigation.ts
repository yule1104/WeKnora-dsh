export const DEMO_USER_MENU_PATHS = new Set(['creatChat', 'knowledge-bases', 'artifacts'])

export const isDemoAdministrator = (
  isSystemAdmin: boolean,
  canAccessAllTenants: boolean,
) => isSystemAdmin || canAccessAllTenants

export const canShowDemoMenuPath = (
  path: string,
  isSystemAdmin: boolean,
  canAccessAllTenants: boolean,
) => isDemoAdministrator(isSystemAdmin, canAccessAllTenants) || DEMO_USER_MENU_PATHS.has(path)

