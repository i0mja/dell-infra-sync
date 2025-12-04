import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Compare two values for sorting, treating null/undefined/empty as "last"
 * Returns: -1 (a < b), 0 (equal), 1 (a > b)
 */
export function compareValues(aVal: any, bVal: any, direction: "asc" | "desc" = "asc"): number {
  // Treat null, undefined, and empty strings the same
  const isEmpty = (v: any) => v == null || v === "";
  
  if (isEmpty(aVal) && isEmpty(bVal)) return 0;
  if (isEmpty(aVal)) return 1;  // Empty values always go to bottom
  if (isEmpty(bVal)) return -1;
  
  // Handle dates (ISO strings)
  if (typeof aVal === "string" && aVal.match(/^\d{4}-\d{2}-\d{2}/)) {
    const dateA = new Date(aVal).getTime();
    const dateB = new Date(bVal).getTime();
    return direction === "asc" ? dateA - dateB : dateB - dateA;
  }
  
  // Handle numbers
  if (typeof aVal === "number" && typeof bVal === "number") {
    return direction === "asc" ? aVal - bVal : bVal - aVal;
  }
  
  // Handle strings (case-insensitive)
  const strA = String(aVal).toLowerCase();
  const strB = String(bVal).toLowerCase();
  const comparison = strA.localeCompare(strB);
  return direction === "asc" ? comparison : -comparison;
}

export function formatBytes(bytes: number | null | undefined, decimals: number = 2): string {
  if (bytes === null || bytes === undefined || isNaN(bytes)) return '-';
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

