import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './styles.css'

const root = createRoot(document.getElementById('root')!)
root.render(<App />)

// Closing the app or tab mid-round runs every table's "you left" handling (finish the hand, cash out, land the balls,
// settle a free leg) before the page goes away. If the browser restores the page from its back/forward cache, reload it.
addEventListener('pagehide', () => root.unmount())
addEventListener('pageshow', e => { if (e.persisted) location.reload() })
