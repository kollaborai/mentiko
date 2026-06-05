"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NotificationFilled,
  SmsFilled,
  CommandSquareFilled,
  ClockFilled,
  CheckFilled as Check,
  NotificationFilled as BellOff,
} from "@aliimam/icons";
import {
  useNotificationPreferences,
  NotificationCategory,
  NotificationChannel,
} from "@/lib/notifications/notification-preferences";

const categoryInfo: Record<
  NotificationCategory,
  { label: string; description: string }
> = {
  agent: { label: "Agent Events", description: "Agent completion and errors" },
  chain: { label: "Chain Events", description: "Chain start, complete, and failures" },
  webhook: { label: "Webhook Events", description: "Webhook delivery and failures" },
  system: { label: "System Events", description: "System updates and maintenance" },
};

// only show channels that are actually wired up (no push without service worker)
const ACTIVE_CHANNELS: { channel: NotificationChannel; label: string; icon: typeof CommandSquareFilled }[] = [
  { channel: "in_app", label: "In-App", icon: CommandSquareFilled },
  { channel: "email", label: "Email", icon: SmsFilled },
  { channel: "slack", label: "Slack", icon: CommandSquareFilled },
  { channel: "webhook", label: "Webhook", icon: CommandSquareFilled },
];

function CategoryRow({
  pref,
  onToggle,
  emailSet,
}: {
  pref: { category: NotificationCategory; channels: Record<NotificationChannel, boolean> };
  onToggle: (category: NotificationCategory, channel: NotificationChannel, enabled: boolean) => Promise<void>;
  emailSet: boolean;
}) {
  const info = categoryInfo[pref.category];
  if (!info) return null;

  return (
    <div className="py-3 px-4 rounded-md bg-muted/40">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">{info.label}</p>
          <p className="text-xs text-muted-foreground">{info.description}</p>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          {ACTIVE_CHANNELS.map(({ channel, label, icon: Icon }) => (
            <div key={channel} className="flex flex-col items-center gap-1">
              <span className="text-[10px] text-muted-foreground">{label}</span>
              <div className="flex items-center gap-1">
                <Icon className="h-3 w-3 text-muted-foreground" />
                <Switch
                  checked={pref.channels[channel]}
                  onCheckedChange={(enabled) => onToggle(pref.category, channel, enabled)}
                  disabled={channel === "email" && !emailSet}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function NotificationPreferencesPanel() {
  const { settings, updatePreference, setEmail, updateSettings, initialized, init } =
    useNotificationPreferences();
  const [saved, setSaved] = useState(false);
  const [emailInput, setEmailInput] = useState(settings.email);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEmailInput(settings.email);
  }, [settings.email]);

  useEffect(() => {
    if (!initialized) {
      init();
    }
  }, [initialized, init]);

  const handleChannelToggle = async (
    category: NotificationCategory,
    channel: NotificationChannel,
    enabled: boolean
  ) => {
    await updatePreference(category, { [channel]: enabled });
  };

  const handleSaveEmail = async () => {
    setEmail(emailInput);
    await updateSettings({ email: emailInput });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!initialized) {
    return (
      <div className="bg-card rounded-md p-6 text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  const emailSet = !!settings.email;

  return (
    <div className="space-y-6">
      {/* master toggle */}
      <div className="bg-card rounded-md p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {settings.enabled ? (
              <NotificationFilled className="h-5 w-5 text-muted-foreground" />
            ) : (
              <BellOff className="h-5 w-5 text-muted-foreground" />
            )}
            <div>
              <p className="text-sm font-medium">Notifications</p>
              <p className="text-xs text-muted-foreground">
                {settings.enabled ? "Receive notifications" : "All notifications silenced"}
              </p>
            </div>
          </div>
          <Switch
            checked={settings.enabled}
            onCheckedChange={(enabled) => updateSettings({ enabled })}
          />
        </div>
      </div>

      {settings.enabled && (
        <>
          {/* email settings */}
          <div className="bg-card rounded-md p-6 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <SmsFilled className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Email Notifications</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Set an email address to receive notifications for enabled categories.
            </p>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="your@email.com"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
              />
              <Button
                size="sm"
                onClick={handleSaveEmail}
                disabled={!emailInput || emailInput === settings.email}
              >
                {saved ? <><Check className="h-4 w-4 mr-1" />Saved</> : "Save"}
              </Button>
            </div>
          </div>

          {/* quiet hours */}
          <QuietHoursSection />

          {/* category preferences */}
          <div className="bg-card rounded-md p-6 space-y-3">
            <h2 className="text-sm font-semibold">Categories</h2>
            <p className="text-xs text-muted-foreground">
              Control which events trigger In-App and Email notifications.
              {!emailSet && " Set an email above to enable email notifications."}
            </p>
            <div className="space-y-2 mt-2">
              {settings.preferences.map((pref) => (
                <CategoryRow
                  key={pref.category}
                  pref={pref}
                  onToggle={handleChannelToggle}
                  emailSet={emailSet}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function QuietHoursSection() {
  const { settings, toggleQuietHours, setQuietHours } = useNotificationPreferences();
  const [localStart, setLocalStart] = useState(settings.quiet_hours.start);
  const [localEnd, setLocalEnd] = useState(settings.quiet_hours.end);

  /* eslint-disable react-hooks/set-state-in-effect -- sync local state from prop changes */
  useEffect(() => {
    setLocalStart(settings.quiet_hours.start);
    setLocalEnd(settings.quiet_hours.end);
  }, [settings.quiet_hours.start, settings.quiet_hours.end]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <div className="bg-card rounded-md p-6 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClockFilled className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Quiet Hours</h2>
        </div>
        <Switch
          checked={settings.quiet_hours.enabled}
          onCheckedChange={toggleQuietHours}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Suppress in-app notifications during specific hours.
      </p>
      {settings.quiet_hours.enabled && (
        <div className="grid grid-cols-2 gap-4 mt-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Start Time</Label>
            <Input
              type="time"
              value={localStart}
              onChange={(e) => {
                setLocalStart(e.target.value);
                setQuietHours(e.target.value, localEnd);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">End Time</Label>
            <Input
              type="time"
              value={localEnd}
              onChange={(e) => {
                setLocalEnd(e.target.value);
                setQuietHours(localStart, e.target.value);
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground col-span-2">
            Timezone: {settings.quiet_hours.timezone}
          </p>
        </div>
      )}
    </div>
  );
}
