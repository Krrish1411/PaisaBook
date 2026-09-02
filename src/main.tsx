import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { initAutoLock } from "./lib/autoLock";

// Register service worker for PWA offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swPath = window.location.pathname.endsWith('/') ? 'sw.js' : '../sw.js';
    navigator.serviceWorker.register(swPath).catch(console.error);
  });
}

// Initialize auto-lock system
initAutoLock();

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
