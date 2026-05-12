import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClockFilled as Clock, TickCircleFilled as CheckCircle2, RecordCircleFilled as Circle } from "@aliimam/icons";
import type { ChainEvent as BaseChainEvent } from "@/lib/types";

export interface ChainEvent extends Omit<BaseChainEvent, 'processed'> {
  processed?: string;
}

interface EventTimelineProps {
  events: ChainEvent[];
  title?: string;
}

export function EventTimeline({ events, title = "Events" }: EventTimelineProps) {
  const isProcessed = (event: ChainEvent) =>
    event.processed?.toLowerCase() === "true" || event.processed === "x";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Clock className="h-4 w-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No events yet</p>
        ) : (
          <div className="space-y-2">
            {events.map((event, idx) => (
              <div key={event.filename || idx} className="flex items-start gap-3 text-sm">
                <div className="pt-0.5">
                  {isProcessed(event) ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{event.event || "Unknown"}</span>
                    <Badge variant="outline" className="text-xs">
                      {event.source || "?"}
                    </Badge>
                  </div>
                  {event.timestamp && (
                    <p className="text-xs text-muted-foreground">{event.timestamp}</p>
                  )}
                  {event.data && (
                    <p className="text-xs text-muted-foreground mt-1">{event.data}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
