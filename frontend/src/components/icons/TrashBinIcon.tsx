import React from 'react';

interface TrashBinIconProps {
  size?: number;
  className?: string;
}

const TrashBinIcon: React.FC<TrashBinIconProps> = ({ size = 16, className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    xmlnsXlink="http://www.w3.org/1999/xlink"
    width={size}
    height={size}
    viewBox="0 0 128 128"
    className={className}
    role="presentation"
    aria-hidden="true"
    focusable="false"
  >
    <linearGradient id="tb_a" gradientUnits="userSpaceOnUse" x1="18" x2="110" y1="71" y2="71">
      <stop offset="0" stopColor="var(--trash-icon-body-dark)" />
      <stop offset=".039" stopColor="var(--trash-icon-body-light)" />
      <stop offset=".087" stopColor="var(--trash-icon-body-mid)" />
      <stop offset=".957" stopColor="var(--trash-icon-body-mid)" />
      <stop offset="1" stopColor="var(--trash-icon-body-dark)" />
    </linearGradient>
    <clipPath id="tb_b"><path d="m18 32h92v82H18z" /></clipPath>
    <clipPath id="tb_c"><path d="M26.656 32h74.688c4.781 0 8.656 3.875 8.656 8.656v64.688c0 4.781-3.875 8.656-8.656 8.656H26.656C21.875 114 18 110.125 18 105.344V40.656C18 35.875 21.875 32 26.656 32z" /></clipPath>
    <filter id="tb_d"><feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0" /></filter>
    <mask id="tb_e"><g filter="url(#tb_d)"><rect fillOpacity=".2" height="128" width="128" /></g></mask>
    <clipPath id="tb_f"><rect height="152" width="192" /></clipPath>
    <linearGradient id="tb_g" gradientTransform="matrix(1.043 0 0 .909 -6.957 -159.273)" gradientUnits="userSpaceOnUse" x1="22" x2="114" y1="206" y2="206">
      <stop offset="0" stopColor="var(--trash-icon-lid)" />
      <stop offset="1" stopColor="var(--trash-icon-lid)" />
    </linearGradient>
    <clipPath id="tb_h"><path d="m20 12h6v24h-6z" /></clipPath>
    <clipPath id="tb_i"><path d="M24 12h80a4 4 0 014 4v16a4 4 0 01-4 4H24a4 4 0 01-4-4V16a4 4 0 014-4z" /></clipPath>
    <clipPath id="tb_k"><path d="m20 12h88v24H20z" /></clipPath>
    <clipPath id="tb_l"><path d="M24 12h80a4 4 0 014 4v16a4 4 0 01-4 4H24a4 4 0 01-4-4V16a4 4 0 014-4z" /></clipPath>
    <mask id="tb_m"><g filter="url(#tb_d)"><rect fillOpacity=".317" height="128" width="128" /></g></mask>
    <clipPath id="tb_o"><rect height="152" width="192" /></clipPath>
    {/* Bin body */}
    <path d="M26 34h76a8 8 0 018 8v66a8 8 0 01-8 8H26a8 8 0 01-8-8V42a8 8 0 018-8z" fill="var(--trash-icon-body-dark)" />
    <path d="M26 30h76a8 8 0 018 8v68a8 8 0 01-8 8H26a8 8 0 01-8-8V38a8 8 0 018-8z" fill="url(#tb_a)" />
    {/* Bin body shadow */}
    <g clipPath="url(#tb_b)"><g clipPath="url(#tb_c)"><g clipPath="url(#tb_f)" mask="url(#tb_e)" transform="translate(-8 -16)"><path d="M31.883 26h80.234a7.883 7.883 0 017.883 7.883v24.234a7.883 7.883 0 01-7.883 7.883H31.883A7.883 7.883 0 0124 58.117V33.883A7.883 7.883 0 0131.883 26z" /></g></g></g>
    {/* Lid */}
    <path d="M24 8h80a8 8 0 018 8v24a8 8 0 01-8 8H24a8 8 0 01-8-8V16a8 8 0 018-8z" fill="url(#tb_g)" />
    <path d="M24 8h80a8 8 0 018 8v16a8 8 0 01-8 8H24a8 8 0 01-8-8V16a8 8 0 018-8z" fill="var(--trash-icon-lid)" />
    <path d="M24 12h80a4 4 0 014 4v16a4 4 0 01-4 4H24a4 4 0 01-4-4V16a4 4 0 014-4z" fill="var(--trash-icon-lid-handle)" />
    {/* Recycling arrows */}
    <g fillRule="evenodd" fill="var(--trash-icon-arrows)">
      <path d="M64 58l-4.39.004 6.925 11.996 1.27 2.195-3.465 2 12.66 1.93 4.66-11.93-3.464 2-3-5.195a6 6 0 00-5.196-3z" />
      <path d="M70 84l-8 10 8 10v-4h6a6 6 0 005.195-3l3-5.195 2.195-3.805H70z" />
      <path d="M53 71.484l-12.66 1.926 3.465 2-3 5.195a6 6 0 000 6l2.996 5.2 2.2 3.8 6.925-12 1.27-2.195 3.464 2z" />
    </g>
  </svg>
);

export default TrashBinIcon;
