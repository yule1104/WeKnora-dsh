export const DEMO_USER_MENU_PATHS = new Set(['creatChat', 'knowledge-bases', 'artifacts', 'toolbox', 'agents'])

export const isDemoAdministrator = (
  isSystemAdmin: boolean,
  canAccessAllTenants: boolean,
) => isSystemAdmin || canAccessAllTenants

export const canShowDemoMenuPath = (
  path: string,
  isSystemAdmin: boolean,
  canAccessAllTenants: boolean,
) => isDemoAdministrator(isSystemAdmin, canAccessAllTenants) || DEMO_USER_MENU_PATHS.has(path)


// 云妆普通账号即使是自己空间的 Owner，也不显示这些平台配置入口。
const DEMO_HIDDEN_SETTINGS_SECTIONS = new Set([
  'memory', 'weknoracloud', 'vectorstore', 'parser', 'storage',
  'sandbox', 'websearch', 'system', 'integrations',
])

export const canShowDemoSettingsSection = (
  section: string,
  isSystemAdmin: boolean,
  canAccessAllTenants: boolean,
) => isDemoAdministrator(isSystemAdmin, canAccessAllTenants) || (
  !DEMO_HIDDEN_SETTINGS_SECTIONS.has(section) && !section.startsWith('integration-')
)

export const canShowDemoAgent = (
  agentId: string,
  isSystemAdmin: boolean,
  canAccessAllTenants: boolean,
) => isDemoAdministrator(isSystemAdmin, canAccessAllTenants) || agentId === 'builtin-smart-reasoning'
