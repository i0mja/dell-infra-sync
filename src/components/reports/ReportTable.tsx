import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface ReportTableProps {
  data: any[];
  columns: { key: string; label: string; format?: (value: any, row: any) => React.ReactNode }[];
}

export function ReportTable({ data, columns }: ReportTableProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        No data available for the selected date range
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col.key}>{col.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.slice(0, 100).map((row, idx) => (
            <TableRow key={idx}>
              {columns.map((col) => (
                <TableCell key={col.key}>
                  {col.format ? col.format(row[col.key], row) : row[col.key] || "-"}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {data.length > 100 && (
        <div className="p-3 text-sm text-muted-foreground text-center border-t">
          Showing first 100 of {data.length} rows. Export to CSV for complete data.
        </div>
      )}
    </div>
  );
}
