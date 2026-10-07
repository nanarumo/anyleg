import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// host: true lets phones on the same Wi-Fi open the dev server at http://<this PC's IP>:5173
export default defineConfig({ plugins: [react()], server: { host: true }, preview: { host: true } })
