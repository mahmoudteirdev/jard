import { useCallback, useEffect, useRef, useState } from "react";
import { Rail } from "./components/Rail";
import { undoLastMove } from "./clean-session";
import { CommandPalette, ShortcutsDialog } from "./components/CommandPalette";
import { ScreenBoundary } from "./components/ScreenBoundary";
import { TruthScreen } from "./screens/TruthScreen";
import { engine, type Drive } from "./engine";
import { go, RAIL_ITEMS, useRoute, type RouteId } from "./routes";
import { openSaved, useSession } from "./scan-session";
import { AboutScreen, LicenseScreen, UpdatesQuestion } from "./screens/AboutScreens";
import { AgentScreen } from "./screens/AgentScreen";
import { CleanupScreen } from "./screens/CleanupScreen";
import { DevCleanerScreen } from "./screens/DevCleanerScreen";
import { GhostFilesScreen } from "./screens/GhostFilesScreen";
import { CompareScreen } from "./screens/CompareScreen";
import { DrivesScreen } from "./screens/DrivesScreen";
import { FinderScreen } from "./screens/FinderScreen";
import { OverviewScreen } from "./screens/OverviewScreen";
import { GuardScreen } from "./screens/GuardScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { WhySlowScreen } from "./screens/MoreScreens";
import { NotBuilt } from "./screens/NotBuilt";
import { HealthScreen, ProgramsScreen, ReportsScreen, SecurityScreen, TestsScreen } from "./screens/SystemScreens";
import { ScanScreen } from "./screens/ScanScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { DriveList, scanAndShow, StorageScreen } from "./screens/StorageScreen";
import { useSettings } from "./settings";

const TITLES: Record<RouteId, string> = {
  ...Object.fromEntries(RAIL_ITEMS.map((i) => [i.id, i.name])),
  scan: "الفحص",
  guard: "ما قبل الحذف",
  about: "حول جَرد",
  license: "النسخة والتفعيل",
  whyslow: "ليش جهازي بطيء؟",
  truth: "ليش الأرقام تختلف عن ويندوز؟",
} as Record<RouteId, string>;

export function App() {
  const route = useRoute();
  const session = useSession();
  const [drives, setDrives] = useState<Drive[]>([]);
  const mainRef = useRef<HTMLElement>(null);

  const { dedupHardlinks, keepResults } = useSettings();

  useEffect(() => {
    engine.listDrives().then(setDrives, () => setDrives([]));
    // Started from Explorer's "Scan with Jard": scan that folder straight away.
    engine.startupFolder().then((folder) => {
      if (folder) {
        void scanAndShow(folder, null, dedupHardlinks, keepResults);
        return;
      }
      // Otherwise pick up where things were: the latest saved result.
      void Promise.all([engine.savedScans(), engine.listDrives()]).then(([saved, list]) => {
        const last = saved[0];
        if (!last) return;
        void openSaved(last, list.find((d) => d.root.toLowerCase() === last.root.toLowerCase()) ?? null).catch(() => {});
      });
    }, () => {});
    // Once, at startup: a settings change must not start a scan.
  }, []);

  useEffect(() => {
    const off = engine.onOpenFolder((folder) => void scanAndShow(folder, null, dedupHardlinks, keepResults));
    return () => void off.then((u) => u());
  }, [dedupHardlinks, keepResults]);

  useEffect(() => {
    document.title = `${TITLES[route]} · جَرد`;
  }, [route]);

  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const rescan = useCallback(() => {
    if (session?.phase === "done" || session?.phase === "failed") void scanAndShow(session.root, session.drive, dedupHardlinks, keepResults);
    else go("storage");
  }, [session, dedupHardlinks, keepResults]);
  const openHelp = useCallback(() => setHelp(true), []);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (ctrl && key === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (ctrl && key === "/") {
        e.preventDefault();
        setHelp((h) => !h);
      } else if (e.key === "F5") {
        // The window's own reload would drop what's on screen.
        e.preventDefault();
        rescan();
      } else if (ctrl && key === "f") {
        e.preventDefault();
        go("finder");
      } else if (ctrl && key === "l") {
        e.preventDefault();
        go("cleanup");
      } else if (ctrl && key === "z" && !(e.target as HTMLElement | null)?.closest("input, textarea")) {
        e.preventDefault();
        void undoLastMove().then(({ back, of }) => {
          if (of > 0) setToast(back === of ? "تم التراجع: رجعت الملفات إلى أماكنها." : `رجع ${back} من ${of}. الباقي في الحجر المؤقت.`);
          else setToast("ما في عملية نقل للتراجع عنها.");
        });
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [rescan]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const railCurrent: RouteId = route === "scan" || route === "truth" ? "storage" : route === "guard" ? "cleanup" : route === "about" || route === "license" ? "settings" : route === "whyslow" ? "overview" : route;

  return (
    <>
      <a className="skip" href="#main" onClick={(e) => (e.preventDefault(), mainRef.current?.focus())}>
        تخطّ إلى المحتوى
      </a>
      <UpdatesQuestion />
      {palette && <CommandPalette session={session} rescan={rescan} onClose={() => setPalette(false)} openHelp={openHelp} />}
      {help && <ShortcutsDialog onClose={() => setHelp(false)} />}
      {toast && <p className="note info toast" role="status"><span>{toast}</span></p>}
      <div className="app">
        <Rail current={railCurrent}>
          {(route === "storage" || route === "scan") && <DriveList drives={drives} session={session} />}
        </Rail>
        <main id="main" ref={mainRef} tabIndex={-1} className="main">
          {engine.demo && (
            <p className="note info" role="note">
              <span>وضع العرض: بيانات تجريبية في المتصفح، لا قراءة حقيقية للقرص. افتح التطبيق عبر Tauri لفحص حقيقي.</span>
            </p>
          )}
          <ScreenBoundary key={route}>
          {route === "storage" ? (
            <StorageScreen session={session} drives={drives} />
          ) : route === "scan" ? (
            <ScanScreen session={session} />
          ) : route === "overview" ? (
            <OverviewScreen session={session} drives={drives} />
          ) : route === "finder" ? (
            <FinderScreen session={session} />
          ) : route === "compare" ? (
            <CompareScreen session={session} />
          ) : route === "drives" ? (
            <DrivesScreen drives={drives} session={session} />
          ) : route === "programs" ? (
            <ProgramsScreen session={session} />
          ) : route === "health" ? (
            <HealthScreen session={session} drives={drives} />
          ) : route === "tests" ? (
            <TestsScreen drives={drives} />
          ) : route === "security" ? (
            <SecurityScreen />
          ) : route === "truth" ? (
            <TruthScreen session={session} />
          ) : route === "reports" ? (
            <ReportsScreen session={session} />
          ) : route === "whyslow" ? (
            <WhySlowScreen drives={drives} />
          ) : route === "about" ? (
            <AboutScreen />
          ) : route === "license" ? (
            <LicenseScreen />
          ) : route === "cleanup" ? (
            <CleanupScreen session={session} />
          ) : route === "devcleaner" ? (
            <DevCleanerScreen />
          ) : route === "ghostfiles" ? (
            <GhostFilesScreen />
          ) : route === "guard" ? (
            <GuardScreen />
          ) : route === "history" ? (
            <HistoryScreen />
          ) : route === "agent" ? (
            <AgentScreen />
          ) : route === "settings" ? (
            <SettingsScreen />
          ) : (
            <NotBuilt title={TITLES[route]} />
          )}
          </ScreenBoundary>
        </main>
      </div>
    </>
  );
}
