/* global PublicKeyCredentialCreationOptions, PublicKeyCredentialRequestOptions, BufferSource, PublicKeyCredentialUserEntity, PublicKeyCredentialDescriptor, AuthenticatorSelectionCriteria, AuthenticatorTransport, AuthenticationExtensionsClientOutputs */

type CreationChallengeResponse = {
  publicKey?: PublicKeyCredentialCreationOptions & {
    challenge?: string | BufferSource;
    user?: PublicKeyCredentialUserEntity & { id?: string | BufferSource };
    excludeCredentials?: Array<PublicKeyCredentialDescriptor & { id?: string | BufferSource }>;
    authenticatorSelection?: AuthenticatorSelectionCriteria & { requireResidentKey?: boolean };
  };
};

type RequestChallengeResponse = {
  publicKey?: PublicKeyCredentialRequestOptions & {
    challenge?: string | BufferSource;
    allowCredentials?: Array<PublicKeyCredentialDescriptor & { id?: string | BufferSource }>;
  };
};

type RegistrationCredential = PublicKeyCredential & {
  response: AuthenticatorAttestationResponse & {
    getTransports?: () => AuthenticatorTransport[];
  };
};

type AuthenticationCredential = PublicKeyCredential & {
  response: AuthenticatorAssertionResponse;
};

const base64urlToBase64 = (value: string = ''): string => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  if (padding === 0) {
    return normalized;
  }
  const padLength = 4 - padding;
  return normalized + '='.repeat(padLength);
};

const base64ToBase64url = (value: string = ''): string =>
  value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

const decodeBase64 = (value: string): string => window.atob(value);

const encodeBase64 = (binary: string): string => window.btoa(binary);

const base64urlToUint8Array = (value?: string | null): Uint8Array => {
  const base64 = base64urlToBase64(value || '');
  const binary = decodeBase64(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const base64urlToBufferSource = (value: string): ArrayBuffer => {
  const bytes = base64urlToUint8Array(value);
  const clone = new Uint8Array(bytes.length);
  clone.set(bytes);
  return clone.buffer;
};

const toUint8Array = (input?: ArrayBuffer | ArrayBufferView | ArrayLike<number> | null): Uint8Array => {
  if (!input) {
    return new Uint8Array();
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input as ArrayBuffer) as Uint8Array;
  }
  if (ArrayBuffer.isView(input)) {
    const buffer = (input.buffer as ArrayBuffer).slice(
      input.byteOffset,
      input.byteOffset + input.byteLength,
    );
    return new Uint8Array(buffer) as Uint8Array;
  }
  return Uint8Array.from(input as ArrayLike<number>) as Uint8Array;
};

const arrayBufferToBase64url = (
  buffer?: ArrayBuffer | ArrayBufferView | ArrayLike<number> | null,
): string => {
  const bytes = toUint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = encodeBase64(binary);
  return base64ToBase64url(base64);
};

export const isWebAuthnAvailable = (): boolean =>
  Boolean(navigator.credentials?.create && navigator.credentials.get);

export const preparePublicKeyCreationOptions = (
  challengeResponse: CreationChallengeResponse,
): PublicKeyCredentialCreationOptions => {
  if (!challengeResponse || !challengeResponse.publicKey) {
    throw new Error('Missing publicKey challenge options.');
  }

  const publicKey: PublicKeyCredentialCreationOptions = { ...challengeResponse.publicKey };

  if (publicKey.challenge && typeof publicKey.challenge === 'string') {
    publicKey.challenge = base64urlToBufferSource(publicKey.challenge);
  }

  if (publicKey.user?.id) {
    publicKey.user = {
      ...publicKey.user,
      id: typeof publicKey.user.id === 'string'
        ? base64urlToBufferSource(publicKey.user.id)
        : publicKey.user.id,
    };
  }

  if (Array.isArray(publicKey.excludeCredentials)) {
    publicKey.excludeCredentials = publicKey.excludeCredentials.map((descriptor) => ({
      ...descriptor,
      id: typeof descriptor.id === 'string'
        ? base64urlToBufferSource(descriptor.id)
        : descriptor.id,
    }));
  }

  if (publicKey.authenticatorSelection?.residentKey === 'discouraged' && !publicKey.authenticatorSelection.requireResidentKey) {
    delete publicKey.authenticatorSelection.requireResidentKey;
  }

  return publicKey;
};

export const preparePublicKeyRequestOptions = (
  challengeResponse: RequestChallengeResponse,
): PublicKeyCredentialRequestOptions => {
  if (!challengeResponse || !challengeResponse.publicKey) {
    throw new Error('Missing publicKey request options.');
  }

  const publicKey: PublicKeyCredentialRequestOptions = { ...challengeResponse.publicKey };

  if (publicKey.challenge && typeof publicKey.challenge === 'string') {
    publicKey.challenge = base64urlToBufferSource(publicKey.challenge);
  }

  if (Array.isArray(publicKey.allowCredentials)) {
    publicKey.allowCredentials = publicKey.allowCredentials.map((descriptor) => ({
      ...descriptor,
      id: typeof descriptor.id === 'string'
        ? base64urlToBufferSource(descriptor.id)
        : descriptor.id,
    }));
  }

  return publicKey;
};

export const serializeRegistrationCredential = (
  credential?: PublicKeyCredential | null,
): {
  id: string;
  type: PublicKeyCredential['type'];
  rawId: string;
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports?: AuthenticatorTransport[];
  };
  clientExtensionResults: AuthenticationExtensionsClientOutputs;
} | null => {
  if (!credential) {
    return null;
  }

  const response = credential.response as RegistrationCredential['response'];
  const transports = response?.getTransports?.();

  return {
    id: credential.id,
    type: credential.type,
    rawId: arrayBufferToBase64url(credential.rawId),
    response: {
      clientDataJSON: arrayBufferToBase64url(response.clientDataJSON),
      attestationObject: arrayBufferToBase64url(response.attestationObject),
      transports: transports && transports.length
        ? (Array.from(transports) as AuthenticatorTransport[])
        : undefined,
    },
    clientExtensionResults: credential.getClientExtensionResults?.() || {},
  };
};

export const serializeAuthenticationCredential = (
  credential?: PublicKeyCredential | null,
): {
  id: string;
  type: PublicKeyCredential['type'];
  rawId: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string;
  };
  clientExtensionResults: AuthenticationExtensionsClientOutputs;
} | null => {
  if (!credential) {
    return null;
  }

  const response = credential.response as AuthenticationCredential['response'];

  return {
    id: credential.id,
    type: credential.type,
    rawId: arrayBufferToBase64url(credential.rawId),
    response: {
      clientDataJSON: arrayBufferToBase64url(response.clientDataJSON),
      authenticatorData: arrayBufferToBase64url(response.authenticatorData),
      signature: arrayBufferToBase64url(response.signature),
      userHandle: response.userHandle
        ? arrayBufferToBase64url(response.userHandle)
        : undefined,
    },
    clientExtensionResults: credential.getClientExtensionResults?.() || {},
  };
};
