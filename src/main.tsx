import { createRoot } from "react-dom/client";
import { startTrafficMonitor } from "./lib/eagle/monitor";
import "./index.css";

// Install the destination policy before loading modules that can create backend clients.
startTrafficMonitor().then(async () => {
  const { default: App } = await import('./App.tsx');
  createRoot(document.getElementById("root")!).render(<App />);
}).catch(() => {
  document.getElementById('root')!.textContent = 'The traffic policy could not initialize. Reload the app to retry.';
});
