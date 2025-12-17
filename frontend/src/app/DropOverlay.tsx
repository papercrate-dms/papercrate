import React from 'react';

interface DropOverlayProps {
  active?: boolean;
  folderName?: string | null;
}

const DropOverlay: React.FC<DropOverlayProps> = ({ active = false, folderName }) => (
  <div className={`drop-overlay${active ? ' active' : ''}`}>
    <div className="drop-overlay__content">
      Drop files to upload to <strong>{folderName || 'this location'}</strong>
    </div>
  </div>
);

export default DropOverlay;
