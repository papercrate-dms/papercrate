export const formatFileSize = (bytes: number): string => {
  const sign = bytes < 0 ? '-' : '';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let index = 0;
  let amount = Math.abs(bytes);

  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }

  const decimals = index === 0 ? 0 : 2;
  return `${sign}${amount.toFixed(decimals)} ${units[index]}`;
};
