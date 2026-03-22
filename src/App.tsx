import { useState } from "react";
import {
  Stamp,
  ScanSearch,
  Wrench,
  Settings,
  Loader2,
} from "lucide-react";
import WatermarkPage from "./components/WatermarkPage";
import DecodePage from "./components/DecodePage";
import ToolsPage from "./components/ToolsPage";
import SettingsPanel from "./components/SettingsPanel";
import { useConfig } from "./hooks/useConfig";

type Page = "watermark" | "decode" | "tools" | "settings";

const navItems: { key: Page; label: string; icon: React.ReactNode }[] = [
  {
    key: "watermark",
    label: "添加水印",
    icon: <Stamp className="h-5 w-5" />,
  },
  {
    key: "decode",
    label: "解码水印",
    icon: <ScanSearch className="h-5 w-5" />,
  },
  {
    key: "tools",
    label: "图片工具",
    icon: <Wrench className="h-5 w-5" />,
  },
  {
    key: "settings",
    label: "设置",
    icon: <Settings className="h-5 w-5" />,
  },
];

function App() {
  const { config, loading, updateOss } = useConfig();
  const [page, setPage] = useState<Page>("watermark");

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }

  const ossConfigured = !!(
    config?.oss?.access_key_id &&
    config?.oss?.access_key_secret &&
    config?.oss?.endpoint &&
    config?.oss?.bucket &&
    config?.oss?.region
  );

  return (
    <div className="flex h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Sidebar */}
      <aside className="flex w-[200px] shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {/* Logo / Title */}
        <div
          data-tauri-drag-region
          className="flex h-12 items-center gap-2 px-4 border-b border-zinc-100 dark:border-zinc-800"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-600 text-white">
            <Stamp className="h-4 w-4" />
          </div>
          <span
            data-tauri-drag-region
            className="text-sm font-bold text-zinc-800 dark:text-zinc-200"
          >
            CloudMark
          </span>
        </div>

        {/* Nav items */}
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {navItems.map((item) => (
            <button
              key={item.key}
              onClick={() => setPage(item.key)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                page === item.key
                  ? "bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        {/* Status */}
        <div className="border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <div
              className={`h-2 w-2 rounded-full ${
                ossConfigured
                  ? "bg-emerald-500"
                  : "bg-zinc-300 dark:bg-zinc-600"
              }`}
            />
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {ossConfigured ? "OSS 已连接" : "未配置 OSS"}
            </span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {/* Page header */}
        <header
          data-tauri-drag-region
          className="flex h-12 items-center border-b border-zinc-200 px-5 dark:border-zinc-800"
        >
          <h1
            data-tauri-drag-region
            className="text-sm font-semibold text-zinc-700 dark:text-zinc-300"
          >
            {navItems.find((n) => n.key === page)?.label}
          </h1>
        </header>

        {/* Page content */}
        <div className="h-[calc(100vh-48px)] overflow-y-auto p-5">
          {page === "watermark" && (
            <WatermarkPage ossConfigured={ossConfigured} />
          )}
          {page === "decode" && (
            <DecodePage ossConfigured={ossConfigured} />
          )}
          {page === "tools" && <ToolsPage />}
          {page === "settings" && (
            <SettingsPanel
              ossConfig={config?.oss ?? null}
              onSaveOss={updateOss}
            />
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
