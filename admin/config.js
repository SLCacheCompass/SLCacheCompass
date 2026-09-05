window.CACHE_COMPASS_ADMIN_CONFIG = {
  supabaseUrl: 'https://glamoujtjfczrpkrpbmp.supabase.co',
  supabaseAnonKey: 'sb_publishable_Mm_pNT0-ETEpKIF3Ezm2iw_DGx273vf',
  adminFunctionUrl: 'https://glamoujtjfczrpkrpbmp.supabase.co/functions/v1/admin-licenses',
  releaseFunctionUrl: 'https://glamoujtjfczrpkrpbmp.supabase.co/functions/v1/admin-release',
  nameResolverFunctionUrl: 'https://glamoujtjfczrpkrpbmp.supabase.co/functions/v1/avatar-name-resolver',
  deleteLicenseFunctionUrl: 'https://glamoujtjfczrpkrpbmp.supabase.co/functions/v1/admin-delete-license',
  entitlementFunctionUrl: 'https://glamoujtjfczrpkrpbmp.supabase.co/functions/v1/admin-entitlements',
};

const licenseDeleteModule = document.createElement('script');
licenseDeleteModule.type = 'module';
licenseDeleteModule.src = 'license-delete.js';
document.head.append(licenseDeleteModule);

window.addEventListener('load', () => {
  for (const src of ['operations.js', 'capacity-approvals.js', 'issue-guard.js', 'release-upload.js']) {
    const module = document.createElement('script');
    module.type = 'module';
    module.src = src;
    document.head.append(module);
  }
}, { once: true });