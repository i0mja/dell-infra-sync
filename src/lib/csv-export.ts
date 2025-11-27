/**
 * CSV Export Utility
 * Converts data arrays to CSV and triggers download
 */

export interface ExportColumn<T> {
  key: keyof T | string;
  label: string;
  format?: (value: any, row: T) => string;
}

export function exportToCSV<T>(
  data: T[],
  columns: ExportColumn<T>[],
  filename: string
): void {
  if (data.length === 0) {
    return;
  }

  // Create CSV header
  const headers = columns.map((col) => col.label).join(",");

  // Create CSV rows
  const rows = data.map((row) => {
    return columns
      .map((col) => {
        const key = col.key as keyof T;
        const value = row[key];
        const formatted = col.format ? col.format(value, row) : value;
        const stringValue = String(formatted ?? "");
        
        // Escape quotes and wrap in quotes if contains comma/newline
        if (stringValue.includes(",") || stringValue.includes("\n") || stringValue.includes('"')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      })
      .join(",");
  });

  // Combine header and rows
  const csv = [headers, ...rows].join("\n");

  // Create blob and download
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  
  link.setAttribute("href", url);
  link.setAttribute("download", `${filename}_${new Date().toISOString().split("T")[0]}.csv`);
  link.style.visibility = "hidden";
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(url);
}
