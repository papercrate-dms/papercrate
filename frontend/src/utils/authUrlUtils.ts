export interface MagicLoginParams {
    token: string | null;
    username: string | null;
    preferredTenantId: string | null;
}

export const extractMagicParams = (locationSearch: string, locationHash: string): MagicLoginParams => {
    const extract = (searchString: string) => {
        const params = new URLSearchParams(searchString || '');
        const token = (params.get('magic_token') || '').trim();
        const usernameHint = (params.get('username') || '').trim();
        const preferredTenantId = (params.get('preferred_tenant_id') || '').trim();
        return {
            token: token || null,
            username: usernameHint || null,
            preferredTenantId: preferredTenantId || null,
        };
    };

    let combined = extract(locationSearch);

    const queryIndex = locationHash.indexOf('?');
    if (queryIndex !== -1) {
        const hashQuery = locationHash.slice(queryIndex + 1);
        const hashParams = extract(`?${hashQuery}`);
        combined = {
            token: combined.token || hashParams.token,
            username: combined.username || hashParams.username,
            preferredTenantId: combined.preferredTenantId || hashParams.preferredTenantId,
        };
    }

    // Fallback to window.location.search if not provided in react router location (handling specific edge cases)
    if (!combined.token) {
        const searchParams = extract(window.location.search);
        combined = {
            token: combined.token || searchParams.token,
            username: combined.username || searchParams.username,
            preferredTenantId: combined.preferredTenantId || searchParams.preferredTenantId,
        };
    }

    return combined;
};

export const clearMagicParamsFromUrl = () => {
    const removableKeys = ['magic_token', 'username', 'preferred_tenant_id'];
    const currentSearch = new URLSearchParams(window.location.search);
    let searchChanged = false;
    removableKeys.forEach((key) => {
        if (currentSearch.has(key)) {
            currentSearch.delete(key);
            searchChanged = true;
        }
    });

    const hash = window.location.hash || '';
    let nextHash = hash;
    const hashQuestionIndex = hash.indexOf('?');
    if (hashQuestionIndex !== -1) {
        const hashPath = hash.slice(0, hashQuestionIndex);
        const hashQuery = hash.slice(hashQuestionIndex + 1);
        const hashParams = new URLSearchParams(hashQuery);
        let hashChanged = false;
        removableKeys.forEach((key) => {
            if (hashParams.has(key)) {
                hashParams.delete(key);
                hashChanged = true;
            }
        });
        if (hashChanged) {
            const nextQuery = hashParams.toString();
            nextHash = nextQuery ? `${hashPath}?${nextQuery}` : hashPath;
        }
    }

    if (!searchChanged && nextHash === hash) {
        return;
    }

    const nextSearch = currentSearch.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${nextHash}`;
    window.history.replaceState(window.history.state, document.title, nextUrl);
};
