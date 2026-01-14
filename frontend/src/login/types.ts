export interface TenantOption {
    id?: string | null;
    name?: string | null;
}

export interface TenantSelectionState {
    selectionToken?: string | null;
    tenants?: TenantOption[];
}

export type LoginActionState = 'idle' | 'passkey' | 'signup' | 'magic' | 'tenant';
