import React, { useEffect, useReducer } from 'react';
import { createSafeContext } from '../../utils/createSafeContext';
import { clearAuthToken, setAuthToken, setAuthRefreshHandlers } from '../api/apiClient';
import { listTenants } from '../api/apiClient';
import { STORED_TOKEN_KEY } from '../../constants/app';

type Tenant = Record<string, unknown> | null;

interface TenantSelection {
  selectionToken: string;
  tenants: Tenant[];
}

type AppStatus =
  | 'logged-out'
  | 'authenticating'
  | 'authenticated'
  | 'selecting-tenant'
  | 'bootstrapping'
  | 'ready';

interface AppState {
  status: AppStatus;
  token: string;
  error: string | null;
  isRefreshing: boolean;
  tenantSelection: TenantSelection | null;
  tenant: Tenant;
  tenants: Tenant[];
}

type AppAction =
  | { type: 'LOGIN_REQUEST' }
  | { type: 'LOGIN_SUCCESS'; token: string; tenant?: Tenant }
  | { type: 'LOGIN_FAILURE'; error?: string | null }
  | { type: 'TENANT_SELECTION_REQUIRED'; selectionToken: string; tenants: Tenant[] }
  | { type: 'CLEAR_TENANT_SELECTION' }
  | { type: 'LOGOUT_SUCCESS' }
  | { type: 'BOOTSTRAP_START' }
  | { type: 'BOOTSTRAP_SUCCESS' }
  | { type: 'BOOTSTRAP_FAILURE'; error?: string | null }
  | { type: 'TOKEN_REFRESH_START' }
  | { type: 'TOKEN_REFRESH_SUCCESS'; token: string; tenant?: Tenant }
  | { type: 'TOKEN_REFRESH_FAILURE'; error?: string | null }
  | { type: 'LOGOUT' }
  | { type: 'RESET_ERROR' }
  | { type: 'SET_TENANTS'; tenants: Tenant[] };

const storage = window.sessionStorage;

const storedToken = storage?.getItem(STORED_TOKEN_KEY) ?? '';
let STORED_TENANT: Tenant = null;

if (storage) {
  try {
    const rawTenant = storage.getItem('papercrate_tenant');
    if (rawTenant) {
      STORED_TENANT = JSON.parse(rawTenant);
    }
  } catch (error) {
    console.warn('[app] Failed to parse stored tenant metadata', error);
  }
}

if (storedToken) {
  setAuthToken(storedToken);
}

const initialAppState: AppState = {
  status: storedToken ? 'authenticated' : 'logged-out',
  token: storedToken,
  error: null,
  isRefreshing: false,
  tenantSelection: null,
  tenant: STORED_TENANT,
  tenants: [],
};

const [AppStateContext, useAppState] = createSafeContext<AppState>('AppState');
const [AppDispatchContext, useAppDispatch] = createSafeContext<React.Dispatch<AppAction>>('AppDispatch');

const appStateReducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case 'LOGIN_REQUEST':
      return {
        ...state,
        status: 'authenticating',
        error: null,
        tenantSelection: null,
        tenant: null,
        tenants: [],
      };
    case 'LOGIN_SUCCESS':
      return {
        ...state,
        status: 'authenticated',
        token: action.token,
        error: null,
        tenantSelection: null,
        tenant: action.tenant ?? null,
        tenants: state.tenants,
      };
    case 'LOGIN_FAILURE':
      return {
        status: 'logged-out',
        token: '',
        error: action.error ?? null,
        isRefreshing: false,
        tenantSelection: null,
        tenant: null,
        tenants: [],
      };
    case 'TENANT_SELECTION_REQUIRED':
      return {
        status: 'selecting-tenant',
        token: '',
        error: null,
        isRefreshing: false,
        tenantSelection: {
          selectionToken: action.selectionToken,
          tenants: action.tenants,
        },
        tenant: null,
        tenants: [],
      };
    case 'CLEAR_TENANT_SELECTION':
      return {
        status: 'logged-out',
        token: '',
        error: null,
        isRefreshing: false,
        tenantSelection: null,
        tenant: null,
        tenants: [],
      };
    case 'LOGOUT_SUCCESS':
    case 'LOGOUT':
      return {
        status: 'logged-out',
        token: '',
        error: null,
        isRefreshing: false,
        tenantSelection: null,
        tenant: null,
        tenants: [],
      };
    case 'BOOTSTRAP_START':
      return { ...state, status: 'bootstrapping', error: null };
    case 'BOOTSTRAP_SUCCESS':
      return { ...state, status: 'ready', error: null };
    case 'BOOTSTRAP_FAILURE':
      return { ...state, status: 'authenticated', error: action.error ?? null };
    case 'TOKEN_REFRESH_START':
      return { ...state, isRefreshing: true, error: null };
    case 'TOKEN_REFRESH_SUCCESS':
      return {
        ...state,
        token: action.token,
        isRefreshing: false,
        status: state.status === 'logged-out' ? 'authenticated' : state.status,
        tenantSelection: null,
        tenant: action.tenant ?? state.tenant ?? null,
        tenants: state.tenants,
      };
    case 'TOKEN_REFRESH_FAILURE':
      return {
        status: 'logged-out',
        token: '',
        error: action.error ?? null,
        isRefreshing: false,
        tenantSelection: null,
        tenant: null,
        tenants: [],
      };
    case 'RESET_ERROR':
      return { ...state, error: null };
    case 'SET_TENANTS':
      return {
        ...state,
        tenants: Array.isArray(action.tenants) ? action.tenants : [],
      };
    default:
      return state;
  }
};

const AppStateProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(appStateReducer, initialAppState);

  useEffect(() => {
    const token = state.token ?? '';
    if (token) {
      setAuthToken(token);
      storage?.setItem('papercrate_token', token);
    } else {
      clearAuthToken();
      storage?.removeItem('papercrate_token');
    }
  }, [state.token]);

  useEffect(() => {
    if (state.tenant) {
      try {
        storage?.setItem('papercrate_tenant', JSON.stringify(state.tenant));
      } catch (error) {
        console.warn('[app] Failed to persist tenant info', error);
      }
    } else {
      storage?.removeItem('papercrate_tenant');
    }
  }, [state.tenant]);

  useEffect(() => {
    setAuthRefreshHandlers({
      onRefreshSuccess: (token, payload) => {
        dispatch({ type: 'TOKEN_REFRESH_SUCCESS', token, tenant: payload?.tenant ?? null });
      },
      onRefreshFailure: (error) => {
        dispatch({ type: 'TOKEN_REFRESH_FAILURE', error: (error as Error)?.message || null });
      },
    });

    return () => {
      setAuthRefreshHandlers({});
    };
  }, [dispatch]);

  useEffect(() => {
    let abort = false;

    const loadTenants = async () => {
      if (state.status !== 'authenticated' || !state.token) {
        dispatch({ type: 'SET_TENANTS', tenants: [] });
        return;
      }

      try {
        if (!abort) {
          const tenants = await listTenants();
          dispatch({
            type: 'SET_TENANTS',
            tenants,
          });
        }
      } catch (error) {
        if (!abort) {
          console.warn('Failed to load tenant list', error);
        }
      }
    };

    loadTenants();

    return () => {
      abort = true;
    };
  }, [state.status, state.token, dispatch]);

  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        {children}
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
};

export { AppStateProvider, useAppState, useAppDispatch };
