import type { SettingsSectionConfig } from '../settings/SettingsModal';
import ApiTokensSection from '../settings/sections/ApiTokensSection';
import CapabilitySetsSection from '../settings/sections/CapabilitySetsSection';
import TenantSection from '../settings/sections/TenantSection';
import PasskeysSection from '../settings/sections/PasskeysSection';

const USER_SECTION: SettingsSectionConfig = {
  id: 'user',
  label: 'User',
  component: PasskeysSection,
};

const API_TOKENS_SECTION: SettingsSectionConfig = {
  id: 'apiTokens',
  label: 'API tokens',
  component: ApiTokensSection,
};

const CAPABILITY_SETS_SECTION: SettingsSectionConfig = {
  id: 'capabilitySets',
  label: 'Capability sets',
  component: CapabilitySetsSection,
};

const TENANT_SECTION: SettingsSectionConfig = {
  id: 'tenant',
  label: 'Tenant',
  component: TenantSection,
};

export const DEFAULT_SETTINGS_SECTIONS = [
  USER_SECTION,
  TENANT_SECTION,
  API_TOKENS_SECTION,
  CAPABILITY_SETS_SECTION,
];
