import { Shield, Target, Server, ArrowRight, CheckCircle2, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useVCenters } from "@/hooks/useVCenters";
import { useReplicationTargets } from "@/hooks/useReplication";
import { useNavigate } from "react-router-dom";

interface SetupStep {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  completed: boolean;
  action?: () => void;
  actionLabel?: string;
}

interface DrOnboardingProps {
  onOpenOnboardWizard?: () => void;
}

export function DrOnboarding({ onOpenOnboardWizard }: DrOnboardingProps) {
  const navigate = useNavigate();
  const { vcenters } = useVCenters();
  const { targets } = useReplicationTargets();

  const hasVCenter = vcenters.length > 0;
  const hasTarget = targets.length > 0;

  const steps: SetupStep[] = [
    {
      id: 'vcenter',
      title: 'Connect vCenter',
      description: 'Connect to your VMware vCenter to discover VMs for protection',
      icon: Server,
      completed: hasVCenter,
      action: () => navigate('/vcenter?tab=hosts'),
      actionLabel: hasVCenter ? 'View vCenters' : 'Add vCenter'
    },
    {
      id: 'target',
      title: 'Add ZFS Target',
      description: 'Set up an existing VM as a ZFS replication target for your DR site',
      icon: Target,
      completed: hasTarget,
      action: onOpenOnboardWizard,
      actionLabel: hasTarget ? 'View Targets' : 'Add Target'
    },
    {
      id: 'protect',
      title: 'Create Protection Group',
      description: 'Group VMs together and configure replication policies',
      icon: Shield,
      completed: false,
      actionLabel: 'Create Group'
    }
  ];

  const completedCount = steps.filter(s => s.completed).length;
  const progressPercent = Math.round((completedCount / steps.length) * 100);

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <Card className="max-w-2xl w-full">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 p-4 rounded-full bg-primary/10">
            <Shield className="h-12 w-12 text-primary" />
          </div>
          <CardTitle className="text-2xl">Set Up Disaster Recovery</CardTitle>
          <CardDescription className="text-base">
            Protect your virtual machines with ZFS-based replication to a secondary site
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Progress */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Setup Progress</span>
              <span className="font-medium">{completedCount} of {steps.length} steps</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Steps */}
          <div className="space-y-3">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const isNext = !step.completed && steps.slice(0, index).every(s => s.completed);
              
              return (
                <div 
                  key={step.id}
                  className={`flex items-start gap-4 p-4 rounded-lg border transition-colors ${
                    step.completed 
                      ? 'bg-green-500/5 border-green-500/20' 
                      : isNext 
                        ? 'bg-primary/5 border-primary/20' 
                        : 'bg-muted/30 border-border'
                  }`}
                >
                  <div className={`p-2 rounded-lg ${
                    step.completed 
                      ? 'bg-green-500/10 text-green-500' 
                      : isNext 
                        ? 'bg-primary/10 text-primary' 
                        : 'bg-muted text-muted-foreground'
                  }`}>
                    {step.completed ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : (
                      <Icon className="h-5 w-5" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className={`font-medium ${step.completed ? 'text-green-600' : ''}`}>
                        {step.title}
                      </h3>
                      {step.completed && (
                        <span className="text-xs text-green-600 bg-green-500/10 px-2 py-0.5 rounded-full">
                          Complete
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {step.description}
                    </p>
                  </div>
                  {step.action && (
                    <Button
                      variant={isNext ? "default" : "outline"}
                      size="sm"
                      onClick={step.action}
                      disabled={!step.completed && index > 0 && !steps[index - 1].completed}
                    >
                      {step.actionLabel}
                      <ArrowRight className="h-4 w-4 ml-1" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Help text */}
          <div className="pt-4 border-t">
            <p className="text-sm text-muted-foreground text-center">
              Need help? Check out the{' '}
              <a href="#" className="text-primary hover:underline">
                DR Setup Guide
              </a>
              {' '}or contact support.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
