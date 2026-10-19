import { useLayoutEffect, useRef } from 'react';

export interface CloudActionOwnerToken {
  identityKey: string;
  leaseEpoch: number;
  scopeKey: string;
  generation: number;
  active: boolean;
  revoked: boolean;
}

export function useCloudActionOwner(identityKey: string, leaseEpoch: number) {
  const generation = useRef(0);
  const current = useRef<CloudActionOwnerToken | null>(null);
  const scopeKey = JSON.stringify([identityKey, leaseEpoch]);

  useLayoutEffect(() => {
    const owner: CloudActionOwnerToken = {
      identityKey, leaseEpoch, scopeKey, generation: ++generation.current, active: true, revoked: false,
    };
    current.current = owner;
    return () => {
      owner.active = false;
      if (current.current === owner) current.current = null;
    };
  }, [identityKey, leaseEpoch, scopeKey]);

  return current;
}

export function isCurrentCloudActionOwner(
  current: { current: CloudActionOwnerToken | null },
  owner: CloudActionOwnerToken | null,
): owner is CloudActionOwnerToken {
  return Boolean(owner && owner.active && !owner.revoked && current.current === owner);
}
