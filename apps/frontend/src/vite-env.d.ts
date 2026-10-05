/// <reference types="vite/client" />
/// <reference types="vitest" />

interface ImportMetaEnv {
    /** Root URL of the backend, e.g. ``http://localhost:8001`` (default
     *  ``http://localhost:8000``; ``/`` = the page's own origin); read at
     *  dev-server start and build time. */
    readonly VITE_BACKEND_URL?: string;
}
