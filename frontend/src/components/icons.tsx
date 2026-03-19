import React from 'react';
import type { JSX } from 'react';
import type { IconProps as TablerIconProps } from '@tabler/icons-react';
import {
  IconChevronRight as TablerChevronRight,
  IconDownload as TablerDownload,
  IconZoomInArea as TablerZoomInArea,
  IconPencil,
  IconTagFilled,
  IconUserFilled,
  IconTrash,
  IconLayoutList,
  IconLayoutGrid,
  IconArrowLeft,
  IconAnalyze,
  IconUpload,
  IconWindowMaximize,
  IconFolderPlus,
  IconFolder,
  IconFolders,
  IconFoldersOff,
  IconRefresh,
  IconRestore,
  IconMinusVertical,
  IconLogout,
  IconChevronDown,
  IconChevronUp,
  IconX as TablerIconX,
  IconSettings,
  IconCheck,
  IconPlus,
  IconSun,
  IconMoon,
  IconDeviceLaptop,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLayoutBottombarCollapse,
  IconLayoutBottombarExpand,
  IconInfoCircle,
  IconCircleDashedCheck,
  IconFile,
  IconLoader,
  IconSortAscendingLetters,
  IconSortDescendingLetters,
  IconFileInfo,
  IconAlertTriangle,
  IconBrandGithub,
  IconBrandMatrix,
  IconWorld,
  IconApi,
  IconSearch,
  IconEye,
  IconFileText,
  IconCode,
} from '@tabler/icons-react';
import FolderSvg from '../assets/folder.svg';
const logoWebp = new URL('../assets/logo.webp', import.meta.url).toString();
const logoSmallWebp = new URL('../assets/logo_small.webp', import.meta.url).toString();
import { composeClassName } from './classNames';

type TablerIconComponent = (props: TablerIconProps) => JSX.Element;

// Factory for creating standard icon wrappers with consistent defaults
const createIcon = (
  Icon: TablerIconComponent,
  { baseClass = 'icon', defaultStroke = 1.6 }: { baseClass?: string; defaultStroke?: number } = {},
): TablerIconComponent => {
  const WrappedIcon: TablerIconComponent = ({ className, size = '1em', stroke = defaultStroke, ...rest }) => (
    <Icon
      className={composeClassName(baseClass, className)}
      size={size}
      stroke={stroke}
      {...rest}
    />
  );
  return WrappedIcon;
};

// Standard stroke icons (stroke = 1.6)
export const ChevronIcon = createIcon(TablerChevronRight);
export const TrashIcon = createIcon(IconTrash);
export const EditIcon = createIcon(IconPencil);
export const DownloadIcon = createIcon(TablerDownload);
export const IconZoomInArea = createIcon(TablerZoomInArea);
export const GithubIcon = createIcon(IconBrandGithub);
export const MatrixIcon = createIcon(IconBrandMatrix);
export const WorldIcon = createIcon(IconWorld);
export const ApiIcon = createIcon(IconApi);
export const ViewListIcon = createIcon(IconLayoutList);
export const ViewGridIcon = createIcon(IconLayoutGrid);
export const UploadIcon = createIcon(IconUpload);
export const ArrowLeftIcon = createIcon(IconArrowLeft);
export const SidebarCollapseIcon = createIcon(IconLayoutSidebarLeftCollapse);
export const SidebarExpandIcon = createIcon(IconLayoutSidebarLeftExpand);
export const InfoIcon = createIcon(IconInfoCircle);
export const FileInfoIcon = createIcon(IconFileInfo);
export const BottombarCollapseIcon = createIcon(IconLayoutBottombarCollapse);
export const BottombarExpandIcon = createIcon(IconLayoutBottombarExpand);
export const FolderPlusIcon = createIcon(IconFolderPlus);
export const FoldersIcon = createIcon(IconFolders);
export const FoldersOffIcon = createIcon(IconFoldersOff);
export const RefreshIcon = createIcon(IconRefresh);
export const RestoreIcon = createIcon(IconRestore);
export const MinusVerticalIcon = createIcon(IconMinusVertical);
export const SortAscendingLettersIcon = createIcon(IconSortAscendingLetters);
export const SortDescendingLettersIcon = createIcon(IconSortDescendingLetters);
export const IconX = createIcon(TablerIconX);
export const CloseIcon = createIcon(TablerIconX);
export const SettingsIcon = createIcon(IconSettings);
export const SearchIcon = createIcon(IconSearch);
export const PlusIcon = createIcon(IconPlus);
export const SunIcon = createIcon(IconSun);
export const MoonIcon = createIcon(IconMoon);
export const DesktopIcon = createIcon(IconDeviceLaptop);
export const CheckIcon = createIcon(IconCheck);
export const CircleDashedCheckIcon = createIcon(IconCircleDashedCheck);
export const FileIcon = createIcon(IconFile);
export const FolderOutlineIcon = createIcon(IconFolder);
export const AnalyzeIcon = createIcon(IconAnalyze);
export const WindowMaximizeIcon = createIcon(IconWindowMaximize);
export const LogoutIcon = createIcon(IconLogout);
export const ChevronDownIcon = createIcon(IconChevronDown);
export const ChevronUpIcon = createIcon(IconChevronUp);
export const EyeIcon = createIcon(IconEye);
export const FileTextIcon = createIcon(IconFileText);
export const CodeIcon = createIcon(IconCode);

// Icons with different default stroke
export const LoaderIcon = createIcon(IconLoader, { defaultStroke: 1.8 });
export const WarningIcon = createIcon(IconAlertTriangle, { defaultStroke: 1.8 });

// Filled icons (stroke = 0)
export const TagIcon = createIcon(IconTagFilled, { baseClass: 'icon icon--fill', defaultStroke: 0 });
export const CorrespondentIcon = createIcon(IconUserFilled, { baseClass: 'icon icon--fill', defaultStroke: 0 });

// Custom icons that need special handling
export const FolderIcon: TablerIconComponent = ({ className, size = 16, title, ...rest }) => {
  return (
    <FolderSvg
      className={composeClassName('folder-icon', className)}
      width={size}
      height={size}
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      focusable="false"
      title={title}
      {...rest}
    />
  );
};

interface LogoIconProps {
  className?: string;
  width?: number;
  height?: number;
  variant?: 'default' | 'small';
}

export const LogoIcon: React.FC<LogoIconProps> = ({ className, width = 24, height = 24, variant = 'default' }) => {
  const src = variant === 'small' ? logoSmallWebp : logoWebp;
  return (
    <img
      src={src}
      className={composeClassName('logo-icon', className)}
      width={width}
      height={height}
      alt="Papercrate logo"
      loading="lazy"
      decoding="async"
    />
  );
};

export const IconFileStack: TablerIconComponent = ({ className, size = 24, stroke = 160, ...rest }) => (
  <svg
    className={composeClassName('icon', className)}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
    xmlns="http://www.w3.org/2000/svg"
    xmlnsXlink="http://www.w3.org/1999/xlink"
    {...rest}
  >
    <path d="M 17.9392 19.2642 c 0.6299 -0.3377 1.0608 -1.0031 1.0608 -1.7642 l 0 -11.4909 l 2.502 0.5318 c 1.0329 0.2195 1.6984 1.2443 1.4788 2.2772 l -2.6346 12.3951 c -0.2196 1.0329 -1.2443 1.6984 -2.2772 1.4789 l -5.1403 -1.0926 l 3.4203 -0.727 c 0.8245 -0.1753 1.4308 -0.8288 1.5902 -1.6083 Z" />
    <path d="M 5 5.173 l 0 -1.673 c 0 -1.1 0.9 -2 2 -2 l 10 0 c 1.1 0 2 0.9 2 2 l 0 14 c 0 0.7611 -0.4309 1.4265 -1.0608 1.7642 c 0.0548 -0.2682 0.0567 -0.5513 -0.0036 -0.835 l -2.8267 -13.2989 c -0.2356 -1.1082 -1.3351 -1.8223 -2.4433 -1.5867 l -7.6656 1.6294 Z" />
    <path d="M 16.349 20.8725 l -10.075 2.1415 c -1.1082 0.2355 -2.2077 -0.4785 -2.4432 -1.5867 l -2.8268 -13.2989 c -0.2356 -1.1083 0.4784 -2.2077 1.5867 -2.4433 l 10.0749 -2.1415 c 1.1082 -0.2356 2.2077 0.4785 2.4433 1.5867 l 2.8267 13.2989 c 0.2356 1.1082 -0.4784 2.2077 -1.5866 2.4433 Z" />
  </svg>
);

export const FolderMoveIcon: TablerIconComponent = ({ className, size = '1em', stroke = 1.6, ...rest }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={composeClassName('icon', className)}
    {...rest}
  >
    <g transform="translate(2, 0)">
      <path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-2m0 -6v-3a2 2 0 0 1 2 -2" />
    </g>
    <g transform="translate(-4, 0)">
      <path d="M5 12l11 0"></path>
      <path d="M13 16l4 -4"></path>
      <path d="M13 8l4 4"></path>
    </g>
  </svg>
);
