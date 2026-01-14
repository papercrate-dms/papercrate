import React from 'react';
import { TenantOption, TenantSelectionState } from './types';

interface TenantSelectorProps {
    tenantSelection: TenantSelectionState;
    onSelectTenant?: (tenant: TenantOption) => void;
    onCancelSelection?: () => void;
    selectingTenantId?: string | null;
}

export const TenantSelector: React.FC<TenantSelectorProps> = ({
    tenantSelection,
    onSelectTenant,
    onCancelSelection,
    selectingTenantId,
}) => {
    return (
        <div className="login-card__selection">
            <p>Select a tenant to finish signing in.</p>
            <div className="login-card__tenant-list">
                {tenantSelection.tenants?.map((tenant) => (
                    <button
                        key={tenant.id}
                        type="button"
                        onClick={() => onSelectTenant?.(tenant)}
                        disabled={Boolean(selectingTenantId)}
                        className={
                            selectingTenantId === tenant.id
                                ? 'secondary is-loading'
                                : 'secondary'
                        }
                        style={{ justifyContent: 'center', width: '100%' }}
                    >
                        {tenant.name}
                    </button>
                ))}
            </div>
            <button
                type="button"
                className="text-button"
                onClick={() => onCancelSelection?.()}
                disabled={Boolean(selectingTenantId)}
            >
                Use a different account
            </button>
        </div>
    );
};
