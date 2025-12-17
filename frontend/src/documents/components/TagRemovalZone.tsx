import React, { useEffect, useState } from 'react';
import { subscribeToTagDrag } from '../features/tagging/tagTransfer';
import { TrashIcon } from '../../components/icons';
import './TagRemovalZone.css';

const TagRemovalZone: React.FC = () => {
    const [isVisible, setIsVisible] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);
    const [isInteractive, setIsInteractive] = useState(false);

    useEffect(() => {
        // Subscribe to global tag drag state.
        // This avoids issues with event bubbling (stopPropagation) preventing window listeners.
        return subscribeToTagDrag((state) => {
            if (state.sourceDocId) {
                setIsVisible(true);
                // Delay interactivity to allow drag to start without immediate capture
                // and to allow dropping on documents 'behind' the zone if done quickly
                setTimeout(() => setIsInteractive(true), 200);
            } else {
                setIsVisible(false);
                setIsDragOver(false);
                setIsInteractive(false);
            }
        });
    }, []);

    const onDragOver = (event: React.DragEvent) => {
        if (!isVisible || !isInteractive) return;
        event.preventDefault();
        event.stopPropagation(); // Exclusive zone
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
        }
        setIsDragOver(true);
    };

    const onDragLeave = () => {
        setIsDragOver(false);
    };

    const onDrop = (event: React.DragEvent) => {
        if (!isInteractive) return;
        event.preventDefault();
        event.stopPropagation();
        // Drop accepted. Browser sets dropEffect='move'.
        // Source component's onDragEnd will handle the data removal.
        setIsVisible(false);
        setIsDragOver(false);
        setIsInteractive(false);
    };

    if (!isVisible) {
        return null;
    }

    return (
        <div
            className={`tag-removal-zone ${isDragOver ? 'tag-removal-zone--drag-over' : ''}`}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            style={{ pointerEvents: isInteractive ? 'all' : 'none' }}
        >
            <TrashIcon className="tag-removal-zone__icon" />
        </div>
    );
};

export default TagRemovalZone;
