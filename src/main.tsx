import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { initAutoLock } from "./lib/autoLock";

// Register service worker for PWA offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Use absolute path from root for GitHub Pages
    const swPath = '/PaisaBook/sw.js';
    navigator.serviceWorker.register(swPath).then((registration) => {
      console.log('SW registered:', registration.scope);
    }).catch((err) => {
      console.log('SW registration failed:', err);
      // Silently fail if SW doesn't exist (404) - not critical for app functionality
    });
  });
}

// Initialize auto-lock system
initAutoLock();

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
