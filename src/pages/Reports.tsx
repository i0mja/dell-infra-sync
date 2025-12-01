import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReportCategory } from "@/components/reports/ReportCategory";
import { REPORT_CATEGORIES, getReportsByCategory, ReportCategory as ReportCategoryType } from "@/config/reports-config";
import { ReportsStatsBar } from "@/components/reports/ReportsStatsBar";

export default function Reports() {
  const [activeCategory, setActiveCategory] = useState<ReportCategoryType>("inventory");
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    to: new Date(),
  });

  const currentReports = getReportsByCategory(activeCategory);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ReportsStatsBar
        activeCategory={activeCategory}
        reportCount={currentReports.length}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
      />

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          <Tabs value={activeCategory} onValueChange={(value) => setActiveCategory(value as ReportCategoryType)} className="h-full flex flex-col">
            <div className="flex items-center border-b bg-card px-4">
              <TabsList className="h-auto p-0 bg-transparent gap-2">
                {REPORT_CATEGORIES.map((category) => {
                  const Icon = category.icon;
                  return (
                    <TabsTrigger
                      key={category.id}
                      value={category.id}
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3"
                    >
                      <Icon className="h-4 w-4 mr-2" />
                      {category.label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
              <div className="flex-1" />
            </div>

            {REPORT_CATEGORIES.map((category) => (
              <TabsContent
                key={category.id}
                value={category.id}
                className="flex-1 mt-0 overflow-auto p-4 lg:p-6"
              >
                <div className="space-y-6">
                  {getReportsByCategory(category.id).map((report) => (
                    <ReportCategory
                      key={report.id}
                      reportType={report.id}
                      dateRange={dateRange}
                    />
                  ))}
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </div>
    </div>
  );
}
