import { Component, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RotateCw } from "lucide-react";

interface Props { children: ReactNode; label?: string }
interface State { error: Error | null }

/**
 * Wraps a single proposal step. If the step crashes, the rest of the
 * proposal page (header, tabs, sibling steps) keeps working.
 */
export class StepErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("StepErrorBoundary caught:", this.props.label, error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              This section encountered an error
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Your other work is safe. You can retry this step or switch tabs.
            </p>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Technical details</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words">{this.state.error.message}</pre>
            </details>
            <Button size="sm" variant="outline" onClick={this.reset}>
              <RotateCw className="h-3.5 w-3.5 mr-1.5" /> Retry
            </Button>
          </CardContent>
        </Card>
      );
    }
    return this.props.children;
  }
}
