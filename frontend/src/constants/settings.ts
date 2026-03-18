import type { SettingsSectionConfig } from '../settings/SettingsModal';
import ApiTokensSection from '../settings/sections/ApiTokensSection';
import CapabilitySetsSection from '../settings/sections/CapabilitySetsSection';
import MembersSection from '../settings/sections/MembersSection';
import PasskeysSection from '../settings/sections/PasskeysSection';

const PASSKEYS_SECTION: SettingsSectionConfig = {
  id: 'passkeys',
  label: 'Passkeys',
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

const MEMBERS_SECTION: SettingsSectionConfig = {
  id: 'members',
  label: 'Members',
  component: MembersSection,
};

export const DEFAULT_SETTINGS_SECTIONS = [
  PASSKEYS_SECTION,
  MEMBERS_SECTION,
  API_TOKENS_SECTION,
  CAPABILITY_SETS_SECTION,
];
