/// <reference types="vite/client" />
import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import css from '../styles.css?url'

// After a deploy, tabs that were already open still point at the old hashed JS chunks, which no
// longer exist, so the next page change fails to load. Vite fires `vite:preloadError` for that:
// reload once to pick up the new version. The 30 s guard stops a reload loop if the asset is truly broken.
const RELOAD_ON_NEW_VERSION = `window.addEventListener('vite:preloadError',function(e){try{var k='sf-chunk-reload',t=Number(sessionStorage.getItem(k)||0);if(Date.now()-t<30000)return;sessionStorage.setItem(k,String(Date.now()))}catch(_){}e.preventDefault();location.reload()})`

export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'Sagacita Finance' }],
    links: [{ rel: 'stylesheet', href: css }],
  }),
  component: () => (
    <Document>
      <Outlet />
    </Document>
  ),
})

function Document({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: RELOAD_ON_NEW_VERSION }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
