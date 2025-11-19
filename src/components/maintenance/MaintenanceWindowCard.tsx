import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, Server, Activity, MoreVertical, Trash2 } from "lucide-react";
import { format, formatDistanceToNow, differenceInHours } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface MaintenanceWindow {
  id: string;
  title: string;
  description?: string;
  cluster_ids: string[];
  planned_start: string;
  planned_end: string;
  maintenance_type: string;
  status: string;
  notify_before_hours: number;
}

interface MaintenanceWindowCardProps {
  window: MaintenanceWindow;
  onPreFlightCheck?: (window: MaintenanceWindow) => void;
  onDelete?: (windowId: string) => void;
}

export function MaintenanceWindowCard({
  window,
  onPreFlightCheck,
  onDelete
}: MaintenanceWindowCardProps) {
  
  const getStatusVariant = (status: string) => {
    switch (status) {
      case 'planned': return 'default';
      case 'in_progress': return 'secondary';
      case 'completed': return 'outline';
      case 'cancelled': return 'destructive';
      default: return 'secondary';
    }
  };

  const calculateDuration = (): string => {
    const hours = differenceInHours(
      new Date(window.planned_end),
      new Date(window.planned_start)
    );
    
    if (hours < 24) {
      return `${hours}h`;
    }
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h`;
  };

  const isUpcoming = new Date(window.planned_start) > new Date();

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <CardTitle className="text-lg">{window.title}</CardTitle>
              <Badge variant={getStatusVariant(window.status)}>
                {window.status.replace('_', ' ').toUpperCase()}
              </Badge>
            </div>
            {window.description && (
              <p className="text-sm text-muted-foreground">{window.description}</p>
            )}
          </div>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onDelete && (
                <DropdownMenuItem 
                  onClick={() => onDelete(window.id)}
                  className="text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-start gap-2">
            <Calendar className="h-4 w-4 mt-0.5 text-muted-foreground" />
            <div>
              <div className="font-medium">
                {format(new Date(window.planned_start), 'MMM dd, yyyy')}
              </div>
              <div className="text-xs text-muted-foreground">
                {format(new Date(window.planned_start), 'HH:mm')} - {format(new Date(window.planned_end), 'HH:mm')}
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="font-medium">Duration</div>
              <div className="text-xs text-muted-foreground">{calculateDuration()}</div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="font-medium">
                {window.cluster_ids.length} cluster{window.cluster_ids.length > 1 ? 's' : ''}
              </div>
              <div className="text-xs text-muted-foreground">
                {window.cluster_ids.slice(0, 2).join(', ')}
                {window.cluster_ids.length > 2 && ` +${window.cluster_ids.length - 2}`}
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="font-medium">Type</div>
              <div className="text-xs text-muted-foreground">
                {window.maintenance_type.replace('_', ' ')}
              </div>
            </div>
          </div>
        </div>
        
        {/* Countdown for upcoming maintenance */}
        {window.status === 'planned' && isUpcoming && (
          <div className="pt-3 border-t">
            <p className="text-xs text-muted-foreground">
              Starts {formatDistanceToNow(new Date(window.planned_start), { addSuffix: true })}
            </p>
          </div>
        )}
        
        {/* Actions */}
        {window.status === 'planned' && onPreFlightCheck && (
          <div className="flex gap-2 pt-2">
            <Button 
              size="sm" 
              variant="outline" 
              onClick={() => onPreFlightCheck(window)}
              className="flex-1"
            >
              <Activity className="h-3 w-3 mr-1" />
              Pre-Flight Check
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
