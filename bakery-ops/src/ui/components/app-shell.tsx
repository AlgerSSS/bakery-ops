"use client";

import { useState } from "react";
import { ForecastProvider } from "@/ui/components/providers/forecast-provider";
import { ToastProvider } from "@/ui/components/providers/toast-provider";
import { TopNav } from "@/ui/components/nav/top-nav";
import { OverviewPage } from "@/ui/components/pages/overview-page";
import { ReviewPage } from "@/ui/components/pages/review-page";
import { ProductionPage } from "@/ui/components/pages/production-page";
import { TimeslotsPage } from "@/ui/components/pages/timeslots-page";
import { TrendsPage } from "@/ui/components/pages/trends-page";
import { CalendarPage } from "@/ui/components/pages/calendar-page";
import { EmpowermentPage } from "@/ui/components/pages/empowerment-page";
import { SettingsPage } from "@/ui/components/pages/settings-page";
import type { PageId } from "@/ui/constants";

function AppShellInner() {
  const [activePage, setActivePage] = useState<PageId>("overview");

  const navigate = (page: PageId) => setActivePage(page);

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav activePage={activePage} navigate={navigate} />
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
        {activePage === "overview" && <OverviewPage navigate={navigate} />}
        {activePage === "review" && <ReviewPage navigate={navigate} />}
        {activePage === "production" && <ProductionPage navigate={navigate} />}
        {activePage === "timeslots" && <TimeslotsPage navigate={navigate} />}
        {activePage === "trends" && <TrendsPage />}
        {activePage === "calendar" && <CalendarPage />}
        {activePage === "empowerment" && <EmpowermentPage />}
        {activePage === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}

export function AppShell() {
  return (
    <ToastProvider>
      <ForecastProvider>
        <AppShellInner />
      </ForecastProvider>
    </ToastProvider>
  );
}
