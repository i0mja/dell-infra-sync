import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReportCategory } from "@/components/reports/ReportCategory";
import { REPORT_CATEGORIES, getReportsByCategory } from "@/config/reports-config";
import { FileBarChart } from "lucide-react";

export default function Reports() {
  const [activeCategory, setActiveCategory] = useState<string>("inventory");

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <FileBarChart className="h-8 w-8" />
        <div>
          <h1 className="text-3xl font-bold">Reports</h1>
          <p className="text-muted-foreground">
            Generate detailed reports and export data for analysis
          </p>
        </div>
      </div>

      <Tabs value={activeCategory} onValueChange={setActiveCategory} className="space-y-6">
        <TabsList>
          {REPORT_CATEGORIES.map((category) => {
            const Icon = category.icon;
            return (
              <TabsTrigger key={category.id} value={category.id}>
                <Icon className="h-4 w-4 mr-2" />
                {category.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {REPORT_CATEGORIES.map((category) => (
          <TabsContent key={category.id} value={category.id} className="space-y-6">
            {getReportsByCategory(category.id).map((report) => (
              <ReportCategory key={report.id} reportType={report.id} />
            ))}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
