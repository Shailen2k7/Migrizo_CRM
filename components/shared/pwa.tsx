'use client';

import { useEffect } from 'react';
import { registerServiceWorker } from '@/lib/push-client';

/** Registers the PWA service worker once the app shell mounts. */
export function PwaSetup() {
  useEffect(() => {
    registerServiceWorker();
  }, []);
  return null;
}
