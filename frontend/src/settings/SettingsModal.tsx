import React, {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import PanelHeader from '../components/PanelHeader';
import { CloseIcon, RefreshIcon } from '../components/icons';
import { DEFAULT_SETTINGS_SECTIONS } from '../constants/settings';

export interface SettingsSectionConfig {
  id: string;
  label: string;
  component?: React.ComponentType<any>;
  render?: (props: Record<string, unknown>) => ReactNode;
}

interface SettingsModalProps {
  open?: boolean;
  onClose?: () => void;
  onRefresh?: () => void;
  sections?: SettingsSectionConfig[];
  defaultSectionId?: string;
  [key: string]: unknown;
}

const SettingsModal: React.FC<SettingsModalProps> = ({
  open = false,
  onClose,
  onRefresh,
  sections,
  defaultSectionId,
  ...sectionProps
}) => {
  const sectionList: SettingsSectionConfig[] = useMemo(() => {
    if (Array.isArray(sections) && sections.length) {
      return sections;
    }
    return DEFAULT_SETTINGS_SECTIONS as SettingsSectionConfig[];
  }, [sections]);

  const firstSectionId = sectionList[0]?.id ?? null;
  const resolvedDefaultSection = defaultSectionId || firstSectionId;

  const [activeSection, setActiveSection] = useState(resolvedDefaultSection);

  useEffect(() => {
    if (!open) {
      setActiveSection(resolvedDefaultSection);
      return;
    }
    const hasActiveSection = sectionList.some((section) => section.id === activeSection);
    if (!hasActiveSection) {
      setActiveSection(resolvedDefaultSection);
    }
  }, [open, sectionList, resolvedDefaultSection, activeSection]);

  const handleBackdropClick = useCallback(() => {
    onClose?.();
  }, [onClose]);

  const handleInnerClick = useCallback((event) => {
    event.stopPropagation();
  }, []);

  if (!open) {
    return null;
  }

  const activeSectionConfig = sectionList.find((section) => section.id === activeSection);
  let sectionContent = null;
  if (activeSectionConfig) {
    if (activeSectionConfig.component) {
      const SectionComponent = activeSectionConfig.component;
      sectionContent = <SectionComponent {...sectionProps} />;
    } else if (activeSectionConfig.render) {
      sectionContent = activeSectionConfig.render(sectionProps);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={handleBackdropClick}>
      <div
        className="modal modal--panel settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        onClick={handleInnerClick}
      >
        <PanelHeader
          className="panel-modal__header"
          title="Settings"
          titleTag="h3"
          titleProps={{ id: 'settings-modal-title' }}
          actions={(
            <>
              {onRefresh ? (
                <button type="button" className="icon-button" onClick={onRefresh} aria-label="Refresh">
                  <RefreshIcon size={16} />
                </button>
              ) : null}
              <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
                <CloseIcon size={16} />
              </button>
            </>
          )}
        />
        <div className="settings-modal__body">
          <nav className="settings-modal__sidebar" aria-label="Settings sections">
            <ul>
              {sectionList.map((section) => (
                <li key={section.id}>
                  <button
                    type="button"
                    className={section.id === activeSection ? 'active' : ''}
                    onClick={() => setActiveSection(section.id)}
                  >
                    {section.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div className="settings-modal__content">
            {sectionContent || (
              <p>Select a settings section.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
