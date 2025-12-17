import React, { useCallback, useId } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
    GithubIcon,
    MatrixIcon,
    WorldIcon,
    CheckIcon,
    SettingsIcon,
    LogoutIcon,
    RestoreIcon,
    SunIcon,
    MoonIcon,
    DesktopIcon,
} from '../../components/icons';
import { useSidebarContext } from '../SidebarContext';
import { THEME_MODE_LABELS, THEME_MODES } from '../../constants/sidebar';
import type { Identifier } from '../../types/identifiers';

export interface TenantOption {
    id?: Identifier | null;
    name?: string | null;
}

interface CommunityLink {
    label: string;
    href: string;
    title: string;
    Icon: typeof GithubIcon;
}

const COMMUNITY_LINKS: CommunityLink[] = [
    {
        label: 'GitHub',
        href: 'https://github.com/papercrate-dms/papercrate',
        title: 'Open Papercrate on GitHub',
        Icon: GithubIcon,
    },
    {
        label: 'Matrix',
        href: 'https://matrix.to/#/#papercrate:matrix.org',
        title: 'Join the Papercrate Matrix room',
        Icon: MatrixIcon,
    },
    {
        label: 'Website',
        href: 'https://papercrate.org',
        title: 'Visit papercrate.org',
        Icon: WorldIcon,
    },
];

interface SidebarMenuProps {
    isOpen: boolean;
    menuRef: React.RefObject<HTMLDivElement>;
    style: CSSProperties | null;
    tenants: TenantOption[];
    activeTenantId: Identifier | null;
    onSelectTenant?: (tenant: TenantOption | null, options?: { refreshOnly?: boolean }) => void;
    onOpenSettings?: () => void;
    onLogout?: () => void;
    onClose: () => void;
}

const SidebarMenu: React.FC<SidebarMenuProps> = ({
    isOpen,
    menuRef,
    style,
    tenants,
    activeTenantId,
    onSelectTenant,
    onOpenSettings,
    onLogout,
    onClose,
}) => {
    const {
        neutralHue,
        setNeutralHue,
        resetNeutralHue,
        neutralChroma,
        setNeutralChroma,
        resetNeutralChroma,
        themeMode,
        cycleThemeMode,
        themeModes,
    } = useSidebarContext();

    const neutralHueInputId = useId();
    const neutralChromaInputId = useId();

    const handleThemeAdjustmentsReset = useCallback(() => {
        resetNeutralHue();
        resetNeutralChroma();
    }, [resetNeutralHue, resetNeutralChroma]);

    const handleNeutralHueChange = useCallback(
        (value: string) => {
            if (value === '') {
                resetNeutralHue();
                return;
            }
            const parsed = Number(value);
            if (Number.isNaN(parsed)) {
                return;
            }
            setNeutralHue(parsed);
        },
        [resetNeutralHue, setNeutralHue],
    );

    const handleNeutralChromaChange = useCallback(
        (value: string) => {
            if (value === '') {
                resetNeutralChroma();
                return;
            }
            const parsed = Number(value);
            if (Number.isNaN(parsed)) {
                return;
            }
            setNeutralChroma(parsed);
        },
        [resetNeutralChroma, setNeutralChroma],
    );

    const formatSliderValue = useCallback((value: number | string) => {
        const parsed = Number(value);
        if (Number.isNaN(parsed)) {
            return String(value);
        }
        return parsed.toFixed(2);
    }, []);

    const themeModeList = Array.isArray(themeModes) && themeModes.length ? themeModes : THEME_MODES;
    const themeModeIndex = themeModeList.indexOf(themeMode as string);
    const safeThemeModeIndex = themeModeIndex === -1 ? 0 : themeModeIndex;
    const resolvedThemeMode = themeModeList[safeThemeModeIndex] || THEME_MODES[0];
    const nextThemeMode = themeModeList[(safeThemeModeIndex + 1) % themeModeList.length];
    const themeModeLabel = THEME_MODE_LABELS[resolvedThemeMode] || THEME_MODE_LABELS.system;
    const nextThemeLabel = THEME_MODE_LABELS[nextThemeMode] || THEME_MODE_LABELS.system;
    const themeModeIcon = resolvedThemeMode === 'dark'
        ? <MoonIcon size={16} />
        : resolvedThemeMode === 'light'
            ? <SunIcon size={16} />
            : <DesktopIcon size={16} />;

    const handleThemeModeToggle = useCallback(() => {
        cycleThemeMode();
    }, [cycleThemeMode]);

    const handleTenantSelect = useCallback(
        (tenant: TenantOption | null) => {
            const targetId = tenant?.id || null;
            if (!targetId) {
                return;
            }
            onClose();
            onSelectTenant?.(tenant);
        },
        [onClose, onSelectTenant],
    );

    const handleLogoutFromMenu = useCallback(() => {
        onClose();
        onLogout?.();
    }, [onClose, onLogout]);

    const handleSettingsFromMenu = useCallback(() => {
        onClose();
        onOpenSettings?.();
    }, [onClose, onOpenSettings]);

    const themeMenuSection =
        neutralHue != null
            ? (
                <div className="menu__section">
                    <div className="menu__heading menu__heading--with-actions">
                        <span>Theme</span>
                        <div className="menu__heading-actions">
                            <button
                                type="button"
                                className="icon-button"
                                onClick={handleThemeModeToggle}
                                aria-label={`Switch theme (next: ${nextThemeLabel})`}
                                title={`Theme: ${themeModeLabel} (next: ${nextThemeLabel})`}
                            >
                                {themeModeIcon}
                            </button>
                            <button
                                type="button"
                                className="icon-button"
                                onClick={handleThemeAdjustmentsReset}
                                aria-label="Reset theme adjustments"
                                title="Reset theme adjustments"
                            >
                                <RestoreIcon size={16} />
                            </button>
                        </div>
                    </div>
                    <label className="menu__slider" htmlFor={neutralHueInputId}>
                        <span className="menu__slider-label">Hue</span>
                        <input
                            id={neutralHueInputId}
                            type="range"
                            min="0"
                            max="360"
                            step="1"
                            value={neutralHue}
                            onChange={(event) => handleNeutralHueChange(event.target.value)}
                            onDoubleClick={resetNeutralHue}
                        />
                        <span className="menu__slider-value">{neutralHue}°</span>
                    </label>
                    <label className="menu__slider" htmlFor={neutralChromaInputId}>
                        <span className="menu__slider-label">Chroma</span>
                        <input
                            id={neutralChromaInputId}
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={neutralChroma}
                            onChange={(event) => handleNeutralChromaChange(event.target.value)}
                            onDoubleClick={resetNeutralChroma}
                        />
                        <span className="menu__slider-value">{formatSliderValue(neutralChroma)}</span>
                    </label>
                </div>
            )
            : null;

    const communityMenuFooter = COMMUNITY_LINKS.length
        ? (
            <div className="menu__footer">
                {COMMUNITY_LINKS.map(({ href, label, title, Icon }) => (
                    <a
                        key={href}
                        href={href}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="menu__footer-link"
                        title={title}
                    >
                        <Icon size={16} stroke={1.5} />
                        <span>{label}</span>
                    </a>
                ))}
            </div>
        )
        : null;

    const showTenantList = tenants.length > 1;
    const menuClassName = `menu${!showTenantList && !themeMenuSection && !communityMenuFooter ? ' menu--simple' : ''}`;

    if (!isOpen || !style) {
        return null;
    }

    return createPortal(
        <div
            className={menuClassName}
            ref={menuRef}
            role="menu"
            aria-label="Account menu"
            style={style}
        >
            {showTenantList ? (
                <div className="menu__section">
                    <div className="menu__heading">Switch tenant</div>
                    <div className="menu__wrapper">
                        {tenants.map((tenant) => {
                            const tenantId = tenant?.id || null;
                            const isActive = tenantId === activeTenantId;
                            const tenantLabel = tenant?.name || tenantId || 'Tenant';
                            return (
                                <button
                                    key={tenantId ?? tenantLabel}
                                    type="button"
                                    className={`menu__button${isActive ? ' active' : ''}`}
                                    onClick={() => handleTenantSelect(tenant)}
                                    role="menuitem"
                                >
                                    <span className="menu__check-slot">
                                        {isActive ? <CheckIcon size={16} /> : null}
                                    </span>
                                    <span className="menu__label">{tenantLabel}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            ) : null}
            <div className="menu__section">
                <div className="menu__wrapper">
                    <button type="button" className="menu__button" onClick={handleSettingsFromMenu}>
                        <SettingsIcon size={16} />
                        Settings
                    </button>
                    <button
                        type="button"
                        className="menu__button menu__button--danger"
                        onClick={handleLogoutFromMenu}
                    >
                        <LogoutIcon size={16} />
                        Log out
                    </button>
                </div>
            </div>
            {themeMenuSection}
            {communityMenuFooter}
        </div>,
        document.body,
    );
};

export default SidebarMenu;
