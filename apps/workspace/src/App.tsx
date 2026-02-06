import { useState, useEffect, useCallback } from "react";
import { DevBubble } from "@dashboard/dev-bubble";
import type { IBubbleApp } from "@dashboard/dev-bubble";

interface IApp {
  slug: string;
  port: number;
  url: string;
  status: "up" | "down" | "unknown";
}

interface IConfig {
  domain: string;
  opencodeDomain: string;
  apps: IApp[];
}

function App() {
  const [config, setConfig] = useState<IConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeApp, setActiveApp] = useState<IApp | null>(null);

  const fetchApps = useCallback(async () => {
    try {
      const res = await fetch("/api/apps");
      if (!res.ok) {
        throw new Error(`${String(res.status)} ${res.statusText}`);
      }
      const data = (await res.json()) as IConfig;
      setConfig(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch apps");
    }
  }, []);

  useEffect(() => {
    void fetchApps();
    const interval = setInterval(() => {
      void fetchApps();
    }, 10000);
    return () => {
      clearInterval(interval);
    };
  }, [fetchApps]);

  const opencodeUrl =
    config !== null
      ? `https://${config.opencodeDomain}/`
      : "https://opencode.judigot.com/";

  /* Build bubble app list from config */
  const bubbleApps: IBubbleApp[] =
    config?.apps.map((a) => ({
      slug: a.slug,
      url: a.url,
      status: a.status,
    })) ?? [];

  /* App view — fullscreen iframe, no nav bar, only DevBubble */
  if (activeApp !== null) {
    return (
      <div className="app-view">
        <iframe
          src={activeApp.url}
          className="app-view-frame"
          title={activeApp.slug}
          allow="clipboard-read; clipboard-write"
        />
        <DevBubble
          url={opencodeUrl}
          apps={bubbleApps}
          activeSlug={activeApp.slug}
          onSelectApp={(app) => {
            const found = config?.apps.find((a) => a.slug === app.slug);
            if (found) setActiveApp(found);
          }}
          onGoHome={() => setActiveApp(null)}
        />
      </div>
    );
  }

  /* Dashboard view — no bubble */
  return (
    <div className="dashboard">
      <div className="dashboard-content">
        <header className="dashboard-header">
          <h1>Workspace</h1>
          <p className="subtitle">
            {config !== null ? config.domain : "Loading..."}
          </p>
        </header>

        {error !== null && (
          <div className="error-banner">
            <span>Failed to load apps: {error}</span>
            <button onClick={() => void fetchApps()}>Retry</button>
          </div>
        )}

        <div className="app-grid">
          {/* OpenCode card */}
          {config !== null && (
            <button
              className="app-card app-card-opencode"
              onClick={() => {
                window.open(`https://${config.opencodeDomain}/`, "_blank");
              }}
            >
              <div className="app-card-icon app-card-icon-oc">OC</div>
              <div className="app-card-body">
                <div className="app-card-name">OpenCode</div>
                <div className="app-card-url">
                  https://{config.opencodeDomain}/
                </div>
              </div>
              <span className="status-dot status-up" title="Running" />
            </button>
          )}

          {/* App cards */}
          {config?.apps.map((appItem) => (
            <button
              key={appItem.slug}
              className="app-card"
              onClick={() => {
                setActiveApp(appItem);
              }}
            >
              <div className="app-card-icon">
                {appItem.slug.charAt(0).toUpperCase()}
              </div>
              <div className="app-card-body">
                <div className="app-card-name">{appItem.slug}</div>
                <div className="app-card-url">{appItem.url}</div>
              </div>
              <span
                className={`status-dot status-${appItem.status}`}
                title={appItem.status === "up" ? "Running" : "Stopped"}
              />
            </button>
          ))}

          {config !== null && config.apps.length === 0 && (
            <div className="empty-state">
              <p>No apps registered yet.</p>
              <code>~/workspace/scripts/add-app.sh my-app 5177</code>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
